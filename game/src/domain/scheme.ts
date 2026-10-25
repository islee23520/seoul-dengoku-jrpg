import type { Brand, CauseId, PersonId, ResultId } from './ids.ts';
import type { Character } from './character.ts';
import type { Relations } from './relation.ts';
import type { Opinion } from './opinion.ts';
import { evaluateOpinion } from './opinion.ts';
import { InvariantViolation, assertNever, requireCause } from './errors.ts';

export type SchemeId = Brand<string, 'SchemeId'>;
export const schemeKinds = ['informant-recruitment', 'supply-theft-exposure', 'defection-negotiation'] as const;
export type SchemeKind = typeof schemeKinds[number];
export type SchemeProgress = 'unstarted' | 'evidence-gathered' | 'prepared' | 'ready';
export type SchemeRisk = 'unexposed' | 'warning' | 'discovered';
export type SchemeOutcome = 'success' | 'failure';
export type Scheme = {
  readonly id: SchemeId;
  readonly causeId: CauseId;
  readonly kind: SchemeKind;
  readonly owner: PersonId;
  readonly target: PersonId;
  readonly intent: string;
  readonly agents: readonly PersonId[];
  readonly visibleTo: PersonId;
  readonly progress: SchemeProgress;
  readonly risk: SchemeRisk;
  readonly evidence: readonly CauseId[];
} & (
  | { readonly stage: 'proposed' | 'accepted' | 'active' | 'discovered'; readonly outcome: null; readonly resultId: null }
  | { readonly stage: 'resolved'; readonly outcome: SchemeOutcome; readonly resultId: ResultId }
);
export type SchemeWorld = {
  readonly viewer: PersonId;
  readonly visiblePersons: readonly PersonId[];
  readonly persons: readonly Character[];
  readonly relations: Relations;
};
export type SchemeAgentInfluence = {
  readonly agent: PersonId;
  readonly towardOwner: Opinion;
  readonly towardTarget: Opinion;
};
export type SchemeResolutionInput = {
  readonly scheme: Scheme;
  readonly agents: readonly SchemeAgentInfluence[];
};
export type SchemeRules = {
  readonly successProbability: (input: SchemeResolutionInput) => number;
  readonly relationDeltas: Readonly<Record<'scheme-success' | 'scheme-failure' | 'scheme-discovered', number>>;
};
export type SchemeProposal = Pick<Scheme, 'id' | 'causeId' | 'kind' | 'owner' | 'target' | 'intent' | 'agents'>;

// Only the caller's player-visible slice participates; this module has no scheduler.
export function assertSchemeVisible(scheme: SchemeProposal & { readonly visibleTo: PersonId }, world: SchemeWorld): void {
  requireCause(scheme.causeId);
  if (scheme.visibleTo !== world.viewer || !scheme.intent.trim() || scheme.owner === scheme.target ||
    new Set(scheme.agents).size !== scheme.agents.length || scheme.agents.includes(scheme.owner) || scheme.agents.includes(scheme.target)) {
    throw new InvariantViolation('scheme-participants');
  }
  for (const personId of [scheme.owner, scheme.target, ...scheme.agents]) {
    if (!world.visiblePersons.includes(personId) || !world.persons.some(person => person.id === personId)) {
      throw new InvariantViolation('scheme-person-unshown', [personId]);
    }
  }
  for (const agent of scheme.agents) {
    for (const to of [scheme.owner, scheme.target]) {
      const opinion = evaluateOpinion(world.relations, agent, to);
      if (opinion.trust === null && !opinion.facts.length) throw new InvariantViolation('scheme-agent-relation-missing', [agent, to]);
      for (const fact of opinion.facts) requireCause(fact.causeId);
    }
  }
}
export function proposeScheme(proposal: SchemeProposal, world: SchemeWorld): Scheme {
  const scheme: Scheme = { ...proposal, agents: [...proposal.agents], visibleTo: world.viewer,
    stage: 'proposed', progress: 'unstarted', risk: 'unexposed', evidence: [], outcome: null, resultId: null };
  assertSchemeVisible(scheme, world);
  return scheme;
}
export function schemeResolutionInput(scheme: Scheme, world: SchemeWorld): SchemeResolutionInput {
  assertSchemeVisible(scheme, world);
  if (!scheme.agents.length) throw new InvariantViolation('scheme-agent-required');
  for (const agent of scheme.agents) {
    const person = world.persons.find(person => person.id === agent);
    if (!person || !person.alive || person.captive || !person.conscious || !person.agency) {
      throw new InvariantViolation('scheme-agent-unavailable', [agent]);
    }
  }
  return { scheme, agents: scheme.agents.map(agent => ({ agent,
    towardOwner: evaluateOpinion(world.relations, agent, scheme.owner),
    towardTarget: evaluateOpinion(world.relations, agent, scheme.target) })) };
}
export function acceptScheme(scheme: Scheme, world: SchemeWorld): Scheme {
  assertSchemeVisible(scheme, world);
  if (scheme.stage !== 'proposed') throw new InvariantViolation('scheme-stage', [scheme.stage]);
  return { ...scheme, stage: 'accepted', outcome: null, resultId: null };
}
export function activateScheme(scheme: Scheme, world: SchemeWorld): Scheme {
  schemeResolutionInput(scheme, world);
  if (scheme.stage !== 'accepted') throw new InvariantViolation('scheme-stage', [scheme.stage]);
  return { ...scheme, stage: 'active', outcome: null, resultId: null };
}
export function advanceScheme(scheme: Scheme, evidence: { readonly causeId: CauseId; readonly warning: boolean }, world: SchemeWorld): Scheme {
  schemeResolutionInput(scheme, world);
  requireCause(evidence.causeId);
  if (scheme.stage !== 'active') throw new InvariantViolation('scheme-stage', [scheme.stage]);
  if (scheme.evidence.includes(evidence.causeId)) throw new InvariantViolation('scheme-evidence-reused');
  let progress: SchemeProgress;
  switch (scheme.progress) {
    case 'unstarted': progress = 'evidence-gathered'; break;
    case 'evidence-gathered': progress = 'prepared'; break;
    case 'prepared': progress = 'ready'; break;
    case 'ready': throw new InvariantViolation('scheme-already-ready');
    default: return assertNever(scheme.progress);
  }
  return { ...scheme, progress, risk: evidence.warning ? 'warning' : scheme.risk,
    evidence: [...scheme.evidence, evidence.causeId] };
}
