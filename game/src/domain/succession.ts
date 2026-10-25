import type { CauseId, OfficeId, PersonId } from './ids.ts';
import type { Character } from './character.ts';
import type { Relations } from './relation.ts';
import { assertSuccessorTrustNotInherited } from './relation.ts';
import { InvariantViolation, MissingRuleInput, assertNever, requireCause } from './errors.ts';

// sp1.b47/b51/b86/b94/b99: separate subject changes and per-item ratification.
export type BodySuccession = { readonly kind: 'body'; readonly previous: PersonId; readonly successor: PersonId; readonly causeId: CauseId };
export type InstitutionHeadSuccession = { readonly kind: 'institution-head'; readonly institution: string; readonly office: OfficeId; readonly causeId: CauseId };
export type TitleSuccession = { readonly kind: 'title'; readonly itemId: string; readonly causeId: CauseId };
export type PropertySuccession = { readonly kind: 'property'; readonly itemId: string; readonly causeId: CauseId };
export type SuccessionEvent = BodySuccession | InstitutionHeadSuccession | TitleSuccession | PropertySuccession;
export type VacancyBasis = 'vacancy' | 'death' | 'imprisonment';
export const successionStages = ['vacancy', 'office-halted', 'snapshot', 'lookup', 'candidates', 'procedure', 'ratified', 'transferred', 'handover', 'dispute'] as const;
export type SuccessionStage = typeof successionStages[number];
export type SuccessionItem = { readonly id: string; readonly kind: 'title' | 'property' | 'institution-head'; readonly holder: string; readonly institutional: boolean };
export type SuccessionState = {
  readonly event: SuccessionEvent; readonly basis: VacancyBasis; readonly stage: SuccessionStage;
  readonly office: OfficeId; readonly officePowersHalted: boolean; readonly candidates: readonly PersonId[];
  readonly selected: PersonId | null; readonly ratificationCause: CauseId | null;
  readonly items: readonly SuccessionItem[]; readonly transferredItemIds: readonly string[];
  readonly contracts: readonly string[]; readonly disputeRecords: readonly CauseId[];
};
export type SuccessionRules = {
  readonly eligibleCandidates: readonly PersonId[]; readonly procedureApproved: boolean;
  readonly ratifiedCandidate: PersonId | null; readonly transferableItemIds: readonly string[];
  readonly legitimacyByCandidate: Readonly<Record<string, number>>;
};
export function computeLegitimacy(person: PersonId, rules?: SuccessionRules): number {
  if (!rules) throw new MissingRuleInput('SuccessionRules.legitimacyByCandidate');
  const value = rules.legitimacyByCandidate[person];
  if (value === undefined) throw new MissingRuleInput('SuccessionRules.legitimacyByCandidate.' + person);
  if (!Number.isFinite(value)) throw new InvariantViolation('legitimacy-value');
  return value;
}
export function advanceSuccession(state: SuccessionState, next: SuccessionStage, rules?: SuccessionRules): SuccessionState {
  requireCause(state.event.causeId);
  if (successionStages.indexOf(next) !== successionStages.indexOf(state.stage) + 1) throw new InvariantViolation('succession-stage');
  switch (next) {
    case 'office-halted': return { ...state, stage: next, officePowersHalted: true };
    case 'snapshot': case 'lookup': case 'candidates': return { ...state, stage: next };
    case 'procedure':
      if (!rules) throw new MissingRuleInput('SuccessionRules.procedure');
      if (!rules.procedureApproved || !state.selected || !state.candidates.includes(state.selected) || !rules.eligibleCandidates.includes(state.selected)) throw new InvariantViolation('candidate-ineligible');
      return { ...state, stage: next };
    case 'ratified':
      if (!rules) throw new MissingRuleInput('SuccessionRules.ratification');
      if (!state.selected || rules.ratifiedCandidate !== state.selected || !state.ratificationCause) throw new InvariantViolation('ratification-missing');
      requireCause(state.ratificationCause); return { ...state, stage: next };
    case 'transferred': throw new InvariantViolation('transfer-items-individually');
    case 'handover': return { ...state, stage: next };
    case 'dispute': return { ...state, stage: next, disputeRecords: [...state.disputeRecords, state.event.causeId] };
    case 'vacancy': throw new InvariantViolation('succession-stage');
    default: return assertNever(next);
  }
}
export function transferSuccessionItem(state: SuccessionState, itemId: string, rules?: SuccessionRules): SuccessionState {
  if (state.stage !== 'ratified' && state.stage !== 'transferred') throw new InvariantViolation('rights-before-ratification');
  if (!rules) throw new MissingRuleInput('SuccessionRules.transferableItemIds');
  const item = state.items.find(item => item.id === itemId);
  if (!item || item.institutional || !state.selected || rules.ratifiedCandidate !== state.selected || !state.ratificationCause ||
    !rules.transferableItemIds.includes(itemId) || state.transferredItemIds.includes(itemId)) throw new InvariantViolation('item-not-transferable');
  return { ...state, stage: 'transferred', items: state.items.map(i => i.id === itemId ? { ...i, holder: state.selected ?? i.holder } : i), transferredItemIds: [...state.transferredItemIds, itemId] };
}
export function assertSuccessorStartsWithOwnRelations(successor: Character, inherited: { readonly traits: readonly string[]; readonly skills: Readonly<Record<string, number>>; readonly relations: Relations }): void {
  assertSuccessorTrustNotInherited(inherited.relations.trust);
  if (inherited.traits.length || Object.keys(inherited.skills).length || inherited.relations.facts.length) throw new InvariantViolation('succession-person-copy', [successor.id]);
}
export function personalActionsDuringVacancy(person: Character, basis: VacancyBasis): { readonly privateLife: boolean; readonly movement: boolean; readonly contractsContinue: boolean } {
  switch (basis) {
    case 'death':
      if (person.alive) throw new InvariantViolation('death-basis-mismatch');
      return { privateLife: false, movement: false, contractsContinue: false };
    case 'imprisonment':
      if (!person.alive || !person.captive) throw new InvariantViolation('imprisonment-basis-mismatch');
      return { privateLife: true, movement: false, contractsContinue: true };
    case 'vacancy': return { privateLife: person.alive, movement: person.alive && !person.captive && person.agency, contractsContinue: person.alive };
    default: return assertNever(basis);
  }
}
