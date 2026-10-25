import type { CauseId, PersonId } from './ids.ts';
import { InvariantViolation, MissingRuleInput, requireCause } from './errors.ts';

export type Trust = { readonly from: PersonId; readonly to: PersonId; readonly value: number };
export type RelationFact = {
  readonly from: PersonId; readonly to: PersonId; readonly causeId: CauseId;
  readonly kind: 'family' | 'marriage' | 'lover' | 'mentor-contract' | 'debt' | 'oath' | 'command' | 'employment' | 'service' | 'scheme-success' | 'scheme-failure' | 'scheme-discovered';
};
export type Relations = { readonly trust: readonly Trust[]; readonly facts: readonly RelationFact[] };
export type TrustDeltaRules = { readonly deltas: Readonly<Partial<Record<RelationFact['kind'], number>>> };
// sp1.b79: rival is the strongest enemy class, never another affection axis.
export function classifyOpinion(value: number): 'friend' | 'neutral' | 'enemy' | 'rival' {
  if (!Number.isFinite(value)) throw new InvariantViolation('trust-value');
  if (value <= -50) return 'rival';
  if (value <= -25) return 'enemy';
  if (value >= 25) return 'friend';
  return 'neutral';
}
export function applyRelationFact(state: Relations, fact: RelationFact): Relations {
  requireCause(fact.causeId); return { ...state, facts: [...state.facts, fact] };
}
export function applyTrustDelta(state: Relations, fact: RelationFact, rules?: TrustDeltaRules): Relations {
  requireCause(fact.causeId);
  if (!rules) throw new MissingRuleInput('TrustDeltaRules.deltas');
  const delta = rules.deltas[fact.kind];
  if (delta === undefined) throw new MissingRuleInput('TrustDeltaRules.deltas.' + fact.kind);
  if (!Number.isFinite(delta)) throw new InvariantViolation('trust-delta');
  const previous = state.trust.find(t => t.from === fact.from && t.to === fact.to);
  const updated = { from: fact.from, to: fact.to, value: (previous?.value ?? 0) + delta };
  classifyOpinion(updated.value);
  return { facts: [...state.facts, fact], trust: [...state.trust.filter(t => t !== previous), updated] };
}
export function constructExtraAffectionAxis(axis: 'fear' | 'loyalty'): never { throw new MissingRuleInput('RelationRules.' + axis); }
export function assertNoSymmetricCopy(before: Relations, after: Relations, fact: RelationFact): void {
  const a = before.trust.find(t => t.from === fact.to && t.to === fact.from);
  const b = after.trust.find(t => t.from === fact.to && t.to === fact.from);
  if (a?.value !== b?.value) throw new InvariantViolation('symmetric-trust-copy');
}
export function assertSuccessorTrustNotInherited(inherited: readonly Trust[]): void {
  if (inherited.length) throw new InvariantViolation('successor-trust-copy');
}
