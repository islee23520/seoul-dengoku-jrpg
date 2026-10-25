import type { CauseId, PersonId, WorldTick } from './ids.ts';
import type { Character } from './character.ts';
import type { Grant, ServiceRelation } from './authority.ts';
import { revokeGrant } from './authority.ts';
import type { Relations, RelationFact } from './relation.ts';
import type { Opinion } from './opinion.ts';
import { evaluateOpinion } from './opinion.ts';
import type { SuccessionRules } from './succession.ts';
import { computeLegitimacy } from './succession.ts';
import { InvariantViolation, MissingRuleInput, assertNever, requireCause } from './errors.ts';

export type ContinuityTrigger = { readonly kind: 'death' | 'departure'; readonly causeId: CauseId };
export type ContinuityInput = {
  readonly trigger: ContinuityTrigger;
  readonly predecessor: Character;
  readonly control: Grant;
  readonly candidates: readonly Character[];
  readonly services: readonly ServiceRelation[];
  readonly relations: Relations;
};
export type CandidateCompetition = {
  readonly stage: 'candidates';
  readonly trigger: ContinuityTrigger;
  readonly predecessor: PersonId;
  readonly previousControl: Grant;
  readonly candidates: readonly {
    readonly person: Character;
    readonly legitimacy: number;
    readonly support: readonly Opinion[];
  }[];
  readonly stability: {
    readonly kind: 'unresolved-loyalties';
    readonly retainers: readonly PersonId[];
    readonly facts: readonly RelationFact[];
  };
};
export type ContinuityTransfer = {
  readonly stage: 'transferred';
  readonly competition: CandidateCompetition;
  readonly controlledPerson: Character;
  readonly previousControl: Grant;
  readonly control: Grant;
  readonly property: { readonly state: 'pending-rule'; readonly granted: readonly [] };
};

// Support and historical bonds remain directional evidence, never invented weights.
export function beginSuccessionContinuity(input: ContinuityInput, rules?: SuccessionRules): CandidateCompetition {
  requireCause(input.trigger.causeId);
  if (!rules) throw new MissingRuleInput('SuccessionRules');
  switch (input.trigger.kind) {
    case 'death':
      if (input.predecessor.alive) throw new InvariantViolation('death-basis-mismatch');
      break;
    case 'departure':
      if (!input.predecessor.alive) throw new InvariantViolation('departure-basis-mismatch');
      break;
    default: return assertNever(input.trigger.kind);
  }
  if (input.control.grantee !== input.predecessor.id || input.control.state !== 'valid' ||
    !input.control.scope.includes('control-person')) throw new InvariantViolation('predecessor-control');
  if (!input.candidates.length || new Set(input.candidates.map(person => person.id)).size !== input.candidates.length) {
    throw new InvariantViolation('succession-candidates');
  }
  const retainers = [...new Set(input.services.filter(service => service.principal === input.predecessor.id &&
    service.role === 'household-retainer' && service.disposition === 'active').map(service => service.personId))];
  const candidates = input.candidates.map(person => {
    if (person.id === input.predecessor.id || !person.alive || !person.conscious || person.captive || !person.agency ||
      !rules.eligibleCandidates.includes(person.id)) throw new InvariantViolation('candidate-ineligible', [person.id]);
    return { person, legitimacy: computeLegitimacy(person.id, rules),
      support: retainers.map(retainer => evaluateOpinion(input.relations, retainer, person.id)) };
  });
  const facts = input.relations.facts.filter(fact => fact.to === input.predecessor.id && retainers.includes(fact.from));
  for (const fact of facts) requireCause(fact.causeId);
  return { stage: 'candidates', trigger: input.trigger, predecessor: input.predecessor.id,
    previousControl: input.control, candidates,
    stability: { kind: 'unresolved-loyalties', retainers, facts } };
}

// A newly evidenced control grant is not an inheritance of offices, assets or command.
export function transferSuccessionControl(event: CandidateCompetition, grant: Grant,
  context: { readonly rules: SuccessionRules; readonly now: WorldTick }): ContinuityTransfer {
  const { rules, now } = context;
  if (!rules) throw new MissingRuleInput('SuccessionRules');
  const candidate = event.candidates.find(item => item.person.id === grant.grantee);
  if (event.stage !== 'candidates' || !candidate || !rules.procedureApproved ||
    rules.ratifiedCandidate !== grant.grantee || !rules.eligibleCandidates.includes(grant.grantee)) {
    throw new InvariantViolation('candidate-unratified');
  }
  requireCause(grant.basis.causeId);
  if (grant.id === event.previousControl.id || grant.grantor === event.predecessor || grant.parentAuthorityId !== null ||
    grant.state !== 'valid' || now < grant.effectiveAt || now >= grant.expiresAt ||
    grant.basis.kind !== 'right' || grant.basis.id !== 'control-person:' + grant.grantee ||
    !grant.basisEvents.includes(grant.basis.causeId) || grant.scope.length !== 1 || grant.scope[0] !== 'control-person' ||
    grant.assets.length || grant.roster.length || Object.keys(grant.budget).length || grant.subdelegation) {
    throw new InvariantViolation('succession-control-only');
  }
  return { stage: 'transferred', competition: event, controlledPerson: candidate.person,
    previousControl: revokeGrant(event.previousControl, grant.basis.causeId), control: grant,
    property: { state: 'pending-rule', granted: [] } };
}
