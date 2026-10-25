import type { CauseId, WorldTick } from './ids.ts';
import { InvariantViolation, MissingRuleInput, requireCause } from './errors.ts';

// No SP stress numbers exist: all gameplay values come from the caller.
export type StressState = {
  readonly value: number;
  readonly thresholds: readonly { readonly key: string; readonly value: number }[];
  readonly recovery: readonly { readonly causeId: CauseId; readonly at: WorldTick; readonly amount: number }[];
};
export type StressRules = {
  readonly thresholds: readonly { readonly key: string; readonly value: number }[];
  readonly eventDeltas: Readonly<Record<string, number>>;
  readonly recoveryRates: Readonly<Record<string, number>>;
  readonly minimum: number;
};
export type StressEvent = { readonly key: string; readonly causeId: CauseId; readonly at: WorldTick };
export function assertStressState(state: StressState): void {
  if (!Number.isFinite(state.value) || state.thresholds.some(t => !t.key || !Number.isFinite(t.value)) ||
    state.recovery.some(r => !r.causeId || !Number.isFinite(r.amount) || !Number.isSafeInteger(r.at) || r.at < 0)) {
    throw new InvariantViolation('stress-shape');
  }
}
export function applyStressEvent(state: StressState, event: StressEvent, rules?: StressRules): StressState {
  assertStressState(state); requireCause(event.causeId);
  if (!rules) throw new MissingRuleInput('StressRules.eventDeltas');
  const delta = rules.eventDeltas[event.key];
  if (delta === undefined) throw new MissingRuleInput('StressRules.eventDeltas.' + event.key);
  const next = { ...state, value: Math.max(rules.minimum, state.value + delta), thresholds: rules.thresholds };
  assertStressState(next); return next;
}
export function recoverStress(state: StressState, event: StressEvent, rules?: StressRules): StressState {
  assertStressState(state); requireCause(event.causeId);
  if (!rules) throw new MissingRuleInput('StressRules.recoveryRates');
  const amount = rules.recoveryRates[event.key];
  if (amount === undefined) throw new MissingRuleInput('StressRules.recoveryRates.' + event.key);
  if (!Number.isFinite(amount) || amount < 0) throw new InvariantViolation('stress-recovery');
  const next = { value: Math.max(rules.minimum, state.value - amount), thresholds: rules.thresholds,
    recovery: [...state.recovery, { causeId: event.causeId, at: event.at, amount }] };
  assertStressState(next); return next;
}
