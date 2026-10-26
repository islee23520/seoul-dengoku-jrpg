import { CampaignApplication } from '../game/src/campaign/application.ts';
import type { CampaignContent } from '../game/src/campaign/content.ts';
import { createCampaignE0 } from '../game/src/campaign/state.ts';
import type { CampaignState } from '../game/src/campaign/state.ts';
import { CAMPAIGN_SAVE_NAMESPACE, createCampaignSave, loadCampaignSave, persistCampaignSave } from '../game/src/campaign/saveCheckpoint.ts';
import type { CheckpointStorage } from '../game/src/save/campaignCheckpoint.ts';

export class CampaignEntryError extends Error {
  readonly code: 'read-only' | 'already-started' | 'closed';
  constructor(code: 'read-only' | 'already-started' | 'closed') { super(code); this.code = code; this.name = 'CampaignEntryError'; }
}
export type CampaignRuntimeOptions = {
  readonly content: CampaignContent;
  readonly storage: CheckpointStorage;
  readonly locks: LockManager;
  readonly now: () => number;
};

/** The production composition owns one application for the entire Web Lock lifetime.
 * Views only release subscriptions. A new clock origin requires an explicit start/load. */
export class ProductionCampaign {
  readonly #options: CampaignRuntimeOptions;
  #app: CampaignApplication | null = null;
  #state: CampaignState | null = null;
  #unlock: (() => void) | null = null;
  #claiming = false;
  #closed = false;
  readonly #listeners = new Set<() => void>();
  constructor(options: CampaignRuntimeOptions) { this.#options = options; }
  get content(): CampaignContent { return this.#options.content; }
  get app(): CampaignApplication {
    if (!this.#app) throw new CampaignEntryError('read-only');
    return this.#app;
  }
  get state(): CampaignState {
    if (!this.#state) throw new CampaignEntryError('read-only');
    return this.#state;
  }
  get active(): boolean { return this.#app !== null; }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener); return () => this.#listeners.delete(listener);
  }
  async start(mode: 'new' | 'saved'): Promise<boolean> {
    if (this.#closed) throw new CampaignEntryError('closed');
    if (this.#app || this.#claiming) throw new CampaignEntryError('already-started');
    this.#claiming = true;
    return new Promise<boolean>((resolve, reject) => {
      void this.#options.locks.request('campaign:' + CAMPAIGN_SAVE_NAMESPACE, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock || this.#closed) { resolve(false); return; }
        // Parse before creating the clock, and never fall back to E0 on a load failure.
        const state = mode === 'new' ? createCampaignE0(this.content) : loadCampaignSave(this.#options.storage, this.content).state;
        this.#state = state;
        this.#app = new CampaignApplication({ content: this.content, state, now: this.#options.now });
        this.#app.subscribe(next => { this.#state = next; for (const listener of this.#listeners) listener(); });
        const held = new Promise<void>(release => { this.#unlock = release; });
        resolve(true);
        await held;
      }).catch(reject).finally(() => { this.#claiming = false; });
    });
  }
  reconcile(): void { this.#app?.reconcile(); }
  save() {
    return persistCampaignSave(this.#options.storage, createCampaignSave(this.app.checkpoint(), this.content), this.content);
  }
  close(): void {
    this.#closed = true;
    this.#app?.close(); this.#app = null; this.#state = null;
    this.#unlock?.(); this.#unlock = null; this.#listeners.clear();
  }
}

/** Timer callbacks are wakeups only; the application reconciles monotonic elapsed time. */
export function attachProductionLifecycle(runtime: ProductionCampaign, browser: Window): () => void {
  const reconcile = (): void => runtime.reconcile();
  const close = (): void => runtime.close();
  // Presentation wakes once per second; the event-aware host still visits every exact
  // causal boundary. Revalidating a growing journal at 10 Hz can starve browser input.
  const timer = browser.setInterval(reconcile, 1000);
  browser.document.addEventListener('visibilitychange', reconcile);
  browser.document.addEventListener('freeze', reconcile);
  browser.document.addEventListener('resume', reconcile);
  browser.addEventListener('pagehide', close);
  browser.addEventListener('pageshow', reconcile);
  return () => {
    browser.clearInterval(timer);
    browser.document.removeEventListener('visibilitychange', reconcile);
    browser.document.removeEventListener('freeze', reconcile);
    browser.document.removeEventListener('resume', reconcile);
    browser.removeEventListener('pagehide', close);
    browser.removeEventListener('pageshow', reconcile);
    runtime.close();
  };
}
