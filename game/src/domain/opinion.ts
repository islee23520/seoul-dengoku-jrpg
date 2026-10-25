import type { PersonId } from './ids.ts';
import type { Relations, RelationFact } from './relation.ts';
import { classifyOpinion } from './relation.ts';

export type Opinion = {
  readonly from: PersonId;
  readonly to: PersonId;
  readonly trust: number | null;
  readonly classification: ReturnType<typeof classifyOpinion> | null;
  readonly facts: readonly RelationFact[];
};

// Classification only (sp1.b79). Facts are evidence, never numerical modifiers.
// Missing trust is unknown, not an invented neutral relationship.
export function evaluateOpinion(state: Relations, from: PersonId, to: PersonId): Opinion {
  const trust = state.trust.find(edge => edge.from === from && edge.to === to);
  return {
    from, to, trust: trust?.value ?? null,
    classification: trust ? classifyOpinion(trust.value) : null,
    facts: state.facts.filter(fact => fact.from === from && fact.to === to),
  };
}

// Sparse outgoing edges only: no all-person opinion matrix or second affection axis.
export function evaluateOpinions(state: Relations, from: PersonId): readonly Opinion[] {
  const targets = new Set([...state.trust, ...state.facts].filter(edge => edge.from === from).map(edge => edge.to));
  return [...targets].map(to => evaluateOpinion(state, from, to));
}
