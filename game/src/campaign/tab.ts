import { CampaignSession } from './session.ts';
import type { PeaceSpeed } from './session.ts';
import type { CampaignContent } from './content.ts';
import { parseCampaignState } from './state.ts';
import type { CampaignState } from './state.ts';
import { BattleConflict } from '../battle/realtime.ts';

export type TabStatus = 'read-only' | 'writer' | 'closed';
export type CampaignTabOptions = {
  readonly key: string;
  readonly content: CampaignContent;
  readonly locks: LockManager;
  readonly now: () => number;
  /** Only a user-selected new campaign or explicit durable checkpoint, never cached live state. */
  readonly readCheckpoint: () => unknown;
  readonly writeCheckpoint: (state: CampaignState) => void;
};

/** Web Lock lifetime, not a storage timestamp or expiring heartbeat, is the fencing authority. */
export class CampaignTab {
  readonly #options: CampaignTabOptions;
  #session: CampaignSession | null = null;
  #release: (() => void) | null = null;
  #status: TabStatus = 'read-only';
  #claiming = false;
  #generation = 0;
  readonly #listeners = new Set<() => void>();
  constructor(options: CampaignTabOptions) { this.#options = options; }
  get status(): TabStatus { return this.#status; }
  get state(): CampaignState | null { return this.#session?.state ?? null; }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #publish(): void { for (const listener of this.#listeners) listener(); }
  /** Invoked on initial explicit start or explicit takeover; never queues automatic ownership. */
  async takeOver(): Promise<boolean> {
    if (this.#status === 'closed') throw new BattleConflict('stale-clock');
    if (this.#claiming || this.#session) throw new BattleConflict('clock-owned');
    this.#claiming = true;
    const generation = this.#generation;
    return new Promise<boolean>((resolve, reject) => {
      void this.#options.locks.request('campaign:' + this.#options.key, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock || generation !== this.#generation) { resolve(false); return; }
        const state = parseCampaignState(this.#options.readCheckpoint(), this.#options.content);
        this.#session = new CampaignSession({ content: this.#options.content, state, now: this.#options.now });
        this.#session.subscribe(() => this.#publish());
        this.#status = 'writer';
        const held = new Promise<void>(release => { this.#release = release; });
        this.#publish(); resolve(true);
        await held;
      }).catch(error => { reject(error); }).finally(() => { this.#claiming = false; });
    });
  }
  #writer(): CampaignSession {
    if (this.#status !== 'writer' || !this.#session) throw new BattleConflict('read-only-session');
    return this.#session;
  }
  reconcile(): void { if (this.#session) this.#writer().reconcile(); }
  setSpeed(speed: PeaceSpeed): void { this.#writer().setSpeed(speed); }
  save(): CampaignState {
    const state = this.#writer().checkpoint();
    this.#options.writeCheckpoint(state); return state;
  }
  /** Suspension retains monotonic origin and ownership; navigation releases both, without saving. */
  leave(): void {
    this.#generation += 1;
    this.#session?.close(); this.#session = null;
    this.#status = 'read-only'; this.#release?.(); this.#release = null; this.#publish();
  }
  close(): void { this.leave(); this.#status = 'closed'; this.#publish(); }
}

/** Timer cadence is only a wakeup. Hidden/throttled tabs reconcile the whole monotonic interval. */
export function attachCampaignLifecycle(tab: CampaignTab, window: Window): () => void {
  const reconcile = () => tab.reconcile();
  const leave = () => tab.leave();
  const interval = window.setInterval(reconcile, 100);
  window.document.addEventListener('visibilitychange', reconcile);
  window.document.addEventListener('freeze', reconcile);
  window.document.addEventListener('resume', reconcile);
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', reconcile);
  return () => {
    window.clearInterval(interval);
    window.document.removeEventListener('visibilitychange', reconcile);
    window.document.removeEventListener('freeze', reconcile);
    window.document.removeEventListener('resume', reconcile);
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', reconcile);
    tab.close();
  };
}
