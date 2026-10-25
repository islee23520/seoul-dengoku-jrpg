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
  readonly intervalMs: number; readonly worldUnitsPerStep: number; readonly battle: BattleRules;
  readonly provenance: 'TESTINPUT' | 'CANON'; readonly approvedInputsHash: string;
  readonly validateApproval: (context: BattleContext) => boolean;
  readonly encounter: (state: RuntimeState, step: MovementStep) => {
    readonly rate: number; readonly eligible: boolean; readonly safe: boolean;
    readonly accumulator: number; readonly rng: Readonly<Record<string, number>>; readonly context: BattleContext | null;
  };
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
  readonly options: HostOptions;
  constructor(options: HostOptions) {
    this.options = options; this.#state = runtimeSchema.parse(options.state);
    const rules = options.rules;
    if (rules && (!Number.isSafeInteger(rules.intervalMs) || rules.intervalMs <= 0 || !Number.isFinite(rules.worldUnitsPerStep) || rules.worldUnitsPerStep <= 0)) throw new BattleConflict('clock-contract');
    if (rules && this.#state.clockCarry >= rules.intervalMs) throw new BattleConflict('clock-carry');
  }
  get state(): RuntimeState { return this.#state; }
  subscribe(listener: (state: RuntimeState) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #publish(): void { for (const listener of this.#listeners) listener(this.#state); }
  #rules(): HostRules {
    const rules = this.options.rules;
    if (!rules || !rules.approvedInputsHash || (this.options.mode === 'production' && rules.provenance !== 'CANON')) throw new MissingRuleInput('approved-GP-content-time-inputs');
    return rules;
  }
  replace(state: RuntimeState): void {
    const parsed = runtimeSchema.parse(state);
    const rules = this.#rules();
    if (parsed.clockCarry >= rules.intervalMs || (parsed.battle && (!rules.validateApproval(parsed.battle.context) || parsed.battle.context.rulesHash !== rules.battle.rulesHash))) throw new BattleConflict('restore-rules');
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
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new BattleConflict('elapsed-time');
    const rules = this.#rules();
    let next = { ...this.#state, clockCarry: this.#state.clockCarry + milliseconds };
    while (next.clockCarry >= rules.intervalMs) {
      const tick = next.worldTick + 1;
      const battle = next.battle === null ? null : stepBattle(next.battle, tick, rules.battle);
      next = { ...next, worldTick: tick, worldTime: next.worldTime + rules.worldUnitsPerStep,
        clockCarry: next.clockCarry - rules.intervalMs, campaignState: rules.advanceWorld(next.campaignState, tick), battle };
      next = runtimeSchema.parse(this.options.settle(next));
    }
    this.#state = runtimeSchema.parse(next); this.#publish();
  }
  completedStep(step: MovementStep): Admission {
    if (this.#state.battle && !this.#state.battle.outcome) return { kind: 'handled-rejected', reason: 'active-battle' };
    const rules = this.#rules();
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
    this.#state = { ...this.#state, battle: confirmIntent(this.#state.battle, intent, { tick: this.#state.worldTick, rules: this.#rules().battle }) };
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
