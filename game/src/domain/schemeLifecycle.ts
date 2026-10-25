import type { CauseId, ResultId, WorldTick } from './ids.ts';
import { id } from './ids.ts';
import type { EventLedger, JsonValue, SettlementReceipt } from './eventLedger.ts';
import { applyResult, canonicalJson, summaryHash } from './eventLedger.ts';
import type { RelationHistory } from './relationHistory.ts';
import { applyRelationEvent } from './relationHistory.ts';
import type { RelationFact } from './relation.ts';
import type { Scheme, SchemeRules, SchemeWorld } from './scheme.ts';
import { schemeResolutionInput } from './scheme.ts';
import { InvariantViolation, LedgerConflict, MissingRuleInput, assertNever, requireCause } from './errors.ts';

// Dedicated scheme and relation chains retain their own snapshot hash boundaries.
export type SchemeHistory = {
  readonly scheme: Scheme;
  readonly ledger: EventLedger;
  readonly relationHistory: RelationHistory;
};
export type SchemeEvent = {
  readonly causeId: CauseId;
  readonly resultId: ResultId;
  readonly worldTime: WorldTick;
  readonly ruleVersion: string;
  readonly contentVersion: string;
} & ({ readonly kind: 'discover' } | { readonly kind: 'resolve'; readonly roll: number });
export type SchemeApplication = SchemeHistory & { readonly receipt: SettlementReceipt };

export function applySchemeEvent(state: SchemeHistory, event: SchemeEvent,
  context: { readonly world: Omit<SchemeWorld, 'relations'>; readonly rules?: SchemeRules }): SchemeApplication {
  requireCause(event.causeId);
  const rules = context.rules;
  if (!rules) throw new MissingRuleInput('SchemeRules');
  const request = { ...event, schemeId: state.scheme.id, owner: state.scheme.owner, target: state.scheme.target,
    schemeKind: state.scheme.kind, relationDeltas: { ...rules.relationDeltas } };
  const metadata = { causeId: event.causeId, resultId: event.resultId, worldTime: event.worldTime,
    ruleVersion: event.ruleVersion, contentVersion: event.contentVersion, actor: state.scheme.owner,
    target: state.scheme.id, command: 'scheme:' + event.kind };
  const previous = state.ledger.entries.find(entry => entry.resultId === event.resultId);
  if (previous) {
    const payload = previous.payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload) ||
      !('request' in payload) || summaryHash(payload['request']) !== summaryHash(request)) throw new LedgerConflict(event.resultId);
    return { ...state, receipt: applyResult(state.ledger, { ...previous, ...metadata }).receipt };
  }
  const scheme = state.scheme;
  const input = schemeResolutionInput(scheme, { ...context.world, relations: state.relationHistory.relations });
  let next: Scheme;
  let relationKind: 'scheme-success' | 'scheme-failure' | 'scheme-discovered';
  let probability: number | null = null;
  switch (event.kind) {
    case 'discover':
      if (scheme.stage !== 'active') throw new InvariantViolation('scheme-stage', [scheme.stage]);
      next = { ...scheme, stage: 'discovered', risk: 'discovered', outcome: null, resultId: null };
      relationKind = 'scheme-discovered';
      break;
    case 'resolve': {
      if (scheme.stage !== 'discovered' && (scheme.stage !== 'active' || scheme.progress !== 'ready')) {
        throw new InvariantViolation('scheme-not-ready');
      }
      probability = rules.successProbability(input);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1 ||
        !Number.isFinite(event.roll) || event.roll < 0 || event.roll >= 1) throw new InvariantViolation('scheme-probability');
      const outcome = event.roll < probability ? 'success' : 'failure';
      next = { ...scheme, stage: 'resolved', outcome, resultId: event.resultId };
      relationKind = outcome === 'success' ? 'scheme-success' : 'scheme-failure';
      break;
    }
    default: return assertNever(event);
  }
  const delta = rules.relationDeltas[relationKind];
  if (delta === undefined) throw new MissingRuleInput('SchemeRules.relationDeltas.' + relationKind);
  if (!Number.isFinite(delta) || (relationKind === 'scheme-discovered' && delta >= 0)) throw new InvariantViolation('scheme-relation-delta');
  let relationHistory = state.relationHistory;
  // Discovery exposes owner and agents to the target; outcomes affect owner-agent trust.
  const edges = relationKind === 'scheme-discovered'
    ? [scheme.owner, ...scheme.agents].map(to => ({ from: scheme.target, to }))
    : [{ from: scheme.target, to: scheme.owner }, ...scheme.agents.map(to => ({ from: scheme.owner, to }))];
  for (const edge of edges) {
    if (!relationHistory.relations.trust.some(trust => trust.from === edge.from && trust.to === edge.to)) {
      throw new InvariantViolation('scheme-effect-relation-missing', [edge.from, edge.to]);
    }
    const fact: RelationFact = { ...edge, kind: relationKind, causeId: event.causeId };
    relationHistory = applyRelationEvent(relationHistory, { fact, worldTime: event.worldTime,
      resultId: id('ResultId', canonicalJson([event.resultId, 'relation', edge.from, edge.to])),
      actor: scheme.owner, ruleVersion: event.ruleVersion, contentVersion: event.contentVersion, change: 'trust' },
    { deltas: { [relationKind]: delta } });
  }
  const before: JsonValue = { scheme: { ...scheme }, relations: { ...state.relationHistory.relations } };
  const after: JsonValue = { scheme: { ...next }, relations: { ...relationHistory.relations } };
  const applied = applyResult(state.ledger, { ...metadata,
    beforeHash: summaryHash(before), afterHash: summaryHash(after),
    payload: { request, before, after, resolutionInput: { scheme: { ...input.scheme }, agents: input.agents.map(agent => ({
      ...agent, towardOwner: { ...agent.towardOwner }, towardTarget: { ...agent.towardTarget } })) }, probability } });
  return { scheme: next, ledger: applied.ledger, relationHistory, receipt: applied.receipt };
}
