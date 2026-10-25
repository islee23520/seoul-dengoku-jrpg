import type { StressEvent, StressRules, StressState } from './stress.ts';
import { applyStressEvent, recoverStress } from './stress.ts';
import { InvariantViolation, MissingRuleInput, assertNever } from './errors.ts';

// CK3 port 4 structure only. No threshold, penalty or recovery value is supplied here.
export type StressPhase = 'steady' | 'rising' | 'falling' | 'breaking';
export type StressEvaluationRules = StressRules & {
  readonly breakingThresholdKey: string;
  readonly consequences: Readonly<Record<string, { readonly penalty: string; readonly recoveryScene: string }>>;
};
export type StressTransition = {
  readonly state: StressState;
  readonly phase: StressPhase;
  readonly event: StressEvent;
  readonly crossed: readonly { readonly key: string; readonly penalty: string; readonly recoveryScene: string }[];
};
export type StressAction = StressEvent & { readonly kind: 'event' | 'recovery' };

export function evaluateStress(state: StressState, action: StressAction, rules?: StressEvaluationRules): StressTransition {
  if (!rules) throw new MissingRuleInput('StressRules');
  if (!Number.isFinite(rules.minimum) || rules.thresholds.some(threshold => !threshold.key || !Number.isFinite(threshold.value)) ||
    new Set(rules.thresholds.map(threshold => threshold.key)).size !== rules.thresholds.length) throw new InvariantViolation('stress-rules');
  const breaking = rules.thresholds.find(threshold => threshold.key === rules.breakingThresholdKey);
  if (!breaking) throw new MissingRuleInput('StressRules.breakingThresholdKey');
  for (const threshold of rules.thresholds) {
    const consequence = rules.consequences[threshold.key];
    if (!consequence?.penalty || !consequence.recoveryScene) throw new MissingRuleInput('StressRules.consequences.' + threshold.key);
  }
  let next: StressState;
  switch (action.kind) {
    case 'event': {
      const delta = rules.eventDeltas[action.key];
      if (delta !== undefined && !Number.isFinite(delta)) throw new InvariantViolation('stress-delta');
      next = applyStressEvent(state, action, rules); break;
    }
    case 'recovery': next = recoverStress(state, action, rules); break;
    default: return assertNever(action.kind);
  }
  const crossed = rules.thresholds.filter(threshold => state.value < threshold.value && next.value >= threshold.value).map(threshold => {
    const consequence = rules.consequences[threshold.key];
    if (!consequence) throw new MissingRuleInput('StressRules.consequences.' + threshold.key);
    return { key: threshold.key, ...consequence };
  });
  const phase = next.value >= breaking.value ? 'breaking' : next.value > state.value ? 'rising' : next.value < state.value ? 'falling' : 'steady';
  return { state: next, phase, event: { key: action.key, causeId: action.causeId, at: action.at }, crossed };
}
