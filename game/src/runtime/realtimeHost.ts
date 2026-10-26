import { z } from '../../../engine/node_modules/zod/index.js';
import { battleSchema, count, ref, json, hash, canonical, startBattle, stepBattle, confirmIntent, MissingRuleInput, BattleConflict } from '../battle/realtime.ts';
import type { BattleContext, BattleRules, CommanderIntent, Json } from '../battle/realtime.ts';

export const runtimeSchema = z.strictObject({
  worldTick: count, worldTime: z.number().nonnegative(), clockCarry: z.number().nonnegative(),
  encounterAccumulator: z.number().nonnegative(), encounterSerial: count,
  purposeRngStates: z.record(ref, count).readonly(), battle: battleSchema.nullable(), campaignState: json,
}).readonly();
export type RuntimeState = z.infer<typeof runtimeSchema>;
export type MovementStep = { readonly mapId: string; readonly x: number; readonly y: number };
export type Admission = { readonly kind: 'handled-opened'; readonly battleId: string } | { readonly kind: 'handled-rejected'; readonly reason: string };
export type HostRules = {
  readonly intervalMs: number; readonly worldUnitsPerStep: number; readonly battle: BattleRules | null;
  /** Composed campaigns supply exact world milliseconds, not presentation-frame deltas. */
  readonly campaignClock?: { readonly epoch: number; readonly maximumWorldMilliseconds: number; readonly exactEventBoundaries?: boolean };
  readonly provenance: 'TESTINPUT' | 'CANON'; readonly approvedInputsHash: string;
  readonly validateApproval: (context: BattleContext) => boolean;
  readonly encounter: ((state: RuntimeState, step: MovementStep) => {
    readonly rate: number; readonly eligible: boolean; readonly safe: boolean;
    readonly accumulator: number; readonly rng: Readonly<Record<string, number>>; readonly context: BattleContext | null;
  }) | null;
  readonly advanceWorld: (campaign: Json, tick: number) => Json;
};
export type HostOptions = {
  readonly state: RuntimeState; readonly rules: HostRules | null; readonly mode: 'TESTINPUT' | 'production';
  readonly settle: (state: RuntimeState) => RuntimeState;
};
/** Sole mutable clock owner. Scene handles are generation- and presentation-scoped. */
export class RealtimeHost {
  #state: RuntimeState;
  #generation = 0;
  #presentation = 0;
  #listeners = new Set<(state: RuntimeState) => void>();
  #clockClaimed = false;
  #peaceSpeed: 0 | 1 | 2 | 4 = 1;
  readonly options: HostOptions;
  constructor(options: HostOptions) {
    this.options = options; this.#state = runtimeSchema.parse(options.state);
    const rules = options.rules;
    if (rules && (!Number.isSafeInteger(rules.intervalMs) || rules.intervalMs <= 0 || !Number.isFinite(rules.worldUnitsPerStep) || rules.worldUnitsPerStep <= 0)) throw new BattleConflict('clock-contract');
    if (rules && this.#state.clockCarry >= rules.intervalMs) throw new BattleConflict('clock-carry');
    if (rules?.campaignClock && (!Number.isSafeInteger(rules.campaignClock.maximumWorldMilliseconds) || rules.campaignClock.maximumWorldMilliseconds <= 0 || !Number.isSafeInteger(rules.campaignClock.epoch))) throw new BattleConflict('clock-contract');
    if (rules?.campaignClock && this.#state.battle) throw new MissingRuleInput('battle-admission');
  }
  get state(): RuntimeState { return this.#state; }
  subscribe(listener: (state: RuntimeState) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  setSpeed(speed: 0 | 1 | 2 | 4): void {
    if (this.#clockClaimed) throw new BattleConflict('clock-owned');
    const parsed = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]).parse(speed);
    if (this.#state.battle && !this.#state.battle.outcome && parsed !== 1) throw new BattleConflict('battle-speed-locked');
    this.#peaceSpeed = parsed; this.#publish();
  }
  #publish(): void { for (const listener of this.#listeners) listener(this.#state); }
  #rules(): HostRules {
    const rules = this.options.rules;
    if (!rules || !rules.approvedInputsHash || (this.options.mode === 'production' && rules.provenance !== 'CANON')) throw new MissingRuleInput('approved-GP-content-time-inputs');
    return rules;
  }
  replace(state: RuntimeState): void {
    if (this.#clockClaimed) throw new BattleConflict('clock-owned');
    this.#replace(state);
  }
  #replace(state: RuntimeState): void {
    const parsed = runtimeSchema.parse(state);
    const rules = this.#rules();
    if (rules.campaignClock && parsed.battle) throw new MissingRuleInput('battle-admission');
    if (parsed.clockCarry >= rules.intervalMs || (parsed.battle && (!rules.battle || !rules.validateApproval(parsed.battle.context) || parsed.battle.context.rulesHash !== rules.battle.rulesHash))) throw new BattleConflict('restore-rules');
    this.#generation += 1; this.#state = parsed; this.#publish();
  }
  bind(): {
    readonly elapsed: (milliseconds: number) => void; readonly completedStep: (step: MovementStep) => Admission;
    readonly release: () => void;
  } {
    const generation = this.#generation; const presentation = ++this.#presentation; let live = true;
    return {
      elapsed: milliseconds => { if (live && generation === this.#generation && presentation === this.#presentation) this.elapsed(milliseconds); },
      completedStep: step => live && generation === this.#generation && presentation === this.#presentation ? this.completedStep(step) : { kind: 'handled-rejected', reason: 'stale-generation' },
      release: () => { live = false; },
    };
  }
  elapsed(milliseconds: number): void {
    if (this.#clockClaimed) throw new BattleConflict('clock-owned');
    this.#elapsed(milliseconds);
  }
  /** One session capability; scene callbacks cannot become an alternate clock writer. */
  claimClock(): { readonly elapsed: (milliseconds: number) => void; readonly replace: (state: RuntimeState) => void; readonly release: () => void } {
    if (this.#clockClaimed) throw new BattleConflict('clock-owned');
    this.#clockClaimed = true;
    let live = true;
    const active = () => { if (!live) throw new BattleConflict('stale-clock'); };
    return {
      elapsed: milliseconds => { active(); this.#elapsed(milliseconds); },
      replace: state => { active(); this.#replace(state); },
      release: () => { live = false; },
    };
  }
  #elapsed(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new BattleConflict('elapsed-time');
    const rules = this.#rules();
    if (rules.campaignClock) {
      const clock = rules.campaignClock;
      if (!Number.isSafeInteger(milliseconds) || !Number.isSafeInteger(this.#state.worldTime + milliseconds)) throw new BattleConflict('elapsed-time');
      let next = this.#state;
      const until = next.worldTime + milliseconds;
      while (next.worldTime < until) {
        // An event-aware reducer already splits at every causal boundary. Fixed subframes
        // would only repeat full journal validation, creating an elapsed-time backlog.
        const at = clock.exactEventBoundaries ? until : Math.min(until, next.worldTime + clock.maximumWorldMilliseconds);
        next = runtimeSchema.parse(this.options.settle({ ...next, worldTime: at,
          worldTick: Math.floor((at - clock.epoch) / clock.maximumWorldMilliseconds),
          campaignState: rules.advanceWorld(next.campaignState, at) }));
      }
      this.#state = next; this.#publish(); return;
    }
    const speed = this.#state.battle && !this.#state.battle.outcome ? 1 : this.#peaceSpeed;
    let next = { ...this.#state, clockCarry: this.#state.clockCarry + milliseconds * speed };
    while (next.clockCarry >= rules.intervalMs) {
      const tick = next.worldTick + 1;
      if (next.battle && !rules.battle) throw new MissingRuleInput('battle-admission');
      const battle = next.battle === null || rules.battle === null ? null : stepBattle(next.battle, tick, rules.battle);
      next = { ...next, worldTick: tick, worldTime: next.worldTime + rules.worldUnitsPerStep,
        clockCarry: next.clockCarry - rules.intervalMs, campaignState: rules.advanceWorld(next.campaignState, tick), battle };
      next = runtimeSchema.parse(this.options.settle(next));
    }
    this.#state = runtimeSchema.parse(next); this.#publish();
  }
  completedStep(step: MovementStep): Admission {
    if (this.#state.battle && !this.#state.battle.outcome) return { kind: 'handled-rejected', reason: 'active-battle' };
    const rules = this.#rules();
    if (!rules.battle || !rules.encounter) return { kind: 'handled-rejected', reason: 'battle-not-admitted' };
    const selected = rules.encounter(structuredClone(this.#state), step);
    if (!Number.isFinite(selected.rate) || selected.rate <= 0 || !selected.eligible || selected.safe) return { kind: 'handled-rejected', reason: 'ineligible-or-safe' };
    const context = selected.context;
    if (context && (context.worldStartTick !== this.#state.worldTick || context.worldStartTime !== this.#state.worldTime || context.provenance !== rules.provenance || context.approvedInputsHash !== rules.approvedInputsHash || context.rulesHash !== rules.battle.rulesHash || !rules.validateApproval(context))) throw new MissingRuleInput('canonical-battle-context');
    const battle = context === null ? this.#state.battle : startBattle(context);
    this.#state = runtimeSchema.parse({ ...this.#state, encounterAccumulator: selected.accumulator, purposeRngStates: selected.rng,
      encounterSerial: this.#state.encounterSerial + (context === null ? 0 : 1), battle });
    this.#publish();
    return context === null ? { kind: 'handled-rejected', reason: 'pacing' } : { kind: 'handled-opened', battleId: context.battleId };
  }
  confirm(intent: CommanderIntent): void {
    if (!this.#state.battle) throw new BattleConflict('no-battle');
    const rules = this.#rules().battle;
    if (!rules) throw new MissingRuleInput('battle-admission');
    this.#state = { ...this.#state, battle: confirmIntent(this.#state.battle, intent, { tick: this.#state.worldTick, rules }) };
    this.#publish();
  }
}

/** Authored commands are not an alternate ingress to stock resources or saves. */
const traversalCommand = z.strictObject({ kind: z.literal('transfer'), mapId: ref, x: count, y: count });
export function validateHostContent(value: Json, traversal = false): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) validateHostContent(item, traversal); return; }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'commands' && (!Array.isArray(item) || item.some(command => !traversal || !traversalCommand.safeParse(command).success))) throw new BattleConflict('authored-command-requires-game-ingress');
    if (key === 'save' && item !== false) throw new BattleConflict('stock-save-access');
    validateHostContent(item, traversal);
  }
}
export function captureProjection<T extends Json>(boundary: RuntimeState, project: (copy: RuntimeState) => T): T {
  const copy = structuredClone(boundary); const before = canonical(copy);
  const projection = project(copy);
  if (before !== canonical(copy) || hash(boundary) !== hash(copy)) throw new BattleConflict('projection-mutated-boundary');
  return projection;
}
