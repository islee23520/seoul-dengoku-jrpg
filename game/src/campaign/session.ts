import { z } from '../../../engine/node_modules/zod/index.js';
import { RealtimeHost, runtimeSchema } from '../runtime/realtimeHost.ts';
import { BattleConflict } from '../battle/realtime.ts';
import { integer } from '../domain/ids.ts';
import { CampaignContent } from './content.ts';
import { parseCampaignState } from './state.ts';
import type { CampaignState } from './state.ts';

export type PeaceSpeed = CampaignState['clock']['speed'];
export type CampaignAdvance = (state: CampaignState, until: CampaignState['clock']['worldMilliseconds']) => CampaignState;
export type SessionOptions = {
  readonly content: CampaignContent;
  readonly state: CampaignState;
  readonly now: () => number;
  /** Task 8 splits this interval at causal event times; views never supply it. */
  readonly advance?: CampaignAdvance;
};
const speedSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]);

/** Owns the sole mutable host. No Date, stored wall origin, scene clock, or offline credit. */
export class CampaignSession {
  readonly #content: CampaignContent;
  readonly #host: RealtimeHost;
  readonly #clock: ReturnType<RealtimeHost['claimClock']>;
  readonly #now: () => number;
  #origin: number;
  #live = true;
  #advancing = false;
  readonly #listeners = new Set<(state: CampaignState) => void>();
  constructor(options: SessionOptions) {
    this.#content = options.content; this.#now = options.now;
    const state = parseCampaignState(options.state, options.content);
    const rules = options.content.data.operations.clock;
    this.#origin = this.#sample();
    this.#host = new RealtimeHost({ mode: 'production', state: runtimeSchema.parse({
      worldTick: 0, worldTime: state.clock.worldMilliseconds, clockCarry: 0,
      encounterAccumulator: 0, encounterSerial: 0, purposeRngStates: {}, battle: null, campaignState: state,
    }), rules: {
      intervalMs: rules.hostIntegrationMaxRealMilliseconds, worldUnitsPerStep: rules.worldSecondsPerRealSecond,
      campaignClock: { epoch: rules.epochSeconds * rules.worldMillisecondsPerSecond,
        maximumWorldMilliseconds: rules.hostIntegrationMaxRealMilliseconds * rules.worldSecondsPerRealSecond,
        exactEventBoundaries: options.advance !== undefined },
      battle: null, encounter: null, validateApproval: () => false,
      provenance: 'CANON', approvedInputsHash: options.content.hashes.operations,
      advanceWorld: (value, at) => {
        const previous = parseCampaignState(value, options.content);
        const until = integer('WorldMilliseconds', at);
        const progressed = options.advance ? options.advance(previous, until) : previous;
        return parseCampaignState({ ...progressed,
          revision: previous.revision + at - previous.clock.worldMilliseconds,
          clock: { ...progressed.clock, worldMilliseconds: until },
        }, options.content);
      },
    }, settle: value => value });
    this.#clock = this.#host.claimClock();
  }
  get state(): CampaignState { return parseCampaignState(this.#host.state.campaignState, this.#content); }
  get active(): boolean { return this.#live; }
  subscribe(listener: (state: CampaignState) => void): () => void {
    this.#listeners.add(listener); return () => this.#listeners.delete(listener);
  }
  #publish(): void { for (const listener of this.#listeners) listener(this.state); }
  #sample(): number {
    const time = Math.round(this.#now() * 1000);
    if (!Number.isSafeInteger(time) || time < 0) throw new BattleConflict('monotonic-time');
    return time;
  }
  #requireLive(): void {
    if (!this.#live) throw new BattleConflict('stale-clock');
    if (this.#advancing) throw new BattleConflict('clock-reentry');
  }
  /** Quantize absolute monotonic samples, never each frame delta. Retain the fractional world ms. */
  reconcile(): void {
    this.#requireLive();
    const sample = this.#sample();
    if (sample < this.#origin) throw new BattleConflict('monotonic-regression');
    const state = this.state;
    const micros = (sample - this.#origin) * this.#content.data.operations.clock.worldSecondsPerRealSecond * state.clock.speed + state.clock.subWorldMicroseconds;
    if (!Number.isSafeInteger(micros)) throw new BattleConflict('elapsed-time');
    this.#advancing = true;
    try {
      this.#clock.elapsed(Math.floor(micros / 1000));
      const current = this.state;
      this.#clock.replace({ ...this.#host.state, campaignState: { ...current, clock: { ...current.clock, subWorldMicroseconds: micros % 1000 } } });
      this.#origin = sample;
    } finally { this.#advancing = false; }
    this.#publish();
  }
  setSpeed(input: PeaceSpeed): void {
    const speed = speedSchema.parse(input);
    this.reconcile();
    const state = this.state;
    if (state.clock.speed === speed) return;
    this.#clock.replace({ ...this.#host.state, campaignState: { ...state, revision: state.revision + 1, clock: { ...state.clock, speed } } });
    this.#publish();
  }
  /** Application-only reducer ingress, committed atomically into the existing host. */
  command(reduce: (state: CampaignState) => CampaignState): void {
    this.reconcile();
    const state = this.state;
    const next = parseCampaignState(reduce(state), this.#content);
    this.#clock.replace({ ...this.#host.state, campaignState: next });
    this.#publish();
  }
  checkpoint(): CampaignState { this.reconcile(); return this.state; }
  /** Explicit load discards unsaved elapsed time. Validate and sample before one host commit. */
  restore(input: unknown): void {
    this.#requireLive();
    const state = parseCampaignState(input, this.#content);
    const origin = this.#sample();
    const clock = this.#content.data.operations.clock;
    const worldTime = state.clock.worldMilliseconds;
    this.#clock.replace({ ...this.#host.state, worldTime,
      worldTick: Math.floor((worldTime - clock.epochSeconds * clock.worldMillisecondsPerSecond) /
        (clock.hostIntegrationMaxRealMilliseconds * clock.worldSecondsPerRealSecond)),
      campaignState: state });
    this.#origin = origin;
    this.#publish();
  }
  close(): void {
    if (!this.#live) return;
    this.reconcile(); this.#live = false; this.#clock.release();
  }
}
