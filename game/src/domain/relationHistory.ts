import type { PersonId, ResultId, WorldTick } from './ids.ts';
import type { EventLedger, LedgerEntry, SettlementReceipt } from './eventLedger.ts';
import { applyResult, canonicalJson, summaryHash } from './eventLedger.ts';
import { LedgerConflict, assertNever } from './errors.ts';
import type { Relations, RelationFact, TrustDeltaRules } from './relation.ts';
import { applyRelationFact, applyTrustDelta } from './relation.ts';

export type RelationHistory = { readonly relations: Relations; readonly ledger: EventLedger };
export type RelationEvent = {
  readonly fact: RelationFact;
  readonly resultId: ResultId;
  readonly worldTime: WorldTick;
  readonly actor: PersonId;
  readonly ruleVersion: string;
  readonly contentVersion: string;
  readonly change: 'fact' | 'trust';
};
export type RelationApplication = RelationHistory & { readonly receipt: SettlementReceipt };

// Dedicated relation ledger uses the task-12 result/chain/version contract.
export function applyRelationEvent(state: RelationHistory, event: RelationEvent, rules?: TrustDeltaRules): RelationApplication {
  const request = { ...event, fact: { ...event.fact }, rules: rules ? { deltas: { ...rules.deltas } } : null };
  const metadata = {
    causeId: event.fact.causeId, command: 'relation:' + event.change, worldTime: event.worldTime,
    actor: event.actor, target: canonicalJson([event.fact.from, event.fact.to]),
    ruleVersion: event.ruleVersion, contentVersion: event.contentVersion, resultId: event.resultId,
  };
  const previous = state.ledger.entries.find(entry => entry.resultId === event.resultId);
  if (previous) {
    // Request identity is independent of the now-changed relation snapshot.
    const payload = previous.payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload) ||
      !('request' in payload) || summaryHash(payload['request']) !== summaryHash(request)) throw new LedgerConflict(event.resultId);
    const replay = applyResult(state.ledger, { ...previous, ...metadata });
    return { ...state, receipt: replay.receipt };
  }
  let relations: Relations;
  switch (event.change) {
    case 'fact': relations = applyRelationFact(state.relations, event.fact); break;
    case 'trust': relations = applyTrustDelta(state.relations, event.fact, rules); break;
    default: return assertNever(event.change);
  }
  const before = { trust: state.relations.trust.map(edge => ({ ...edge })), facts: state.relations.facts.map(fact => ({ ...fact })) };
  const after = { trust: relations.trust.map(edge => ({ ...edge })), facts: relations.facts.map(fact => ({ ...fact })) };
  const entry: LedgerEntry = { ...metadata, beforeHash: summaryHash(before), afterHash: summaryHash(after), payload: { request, before, after } };
  const applied = applyResult(state.ledger, entry);
  return { relations, ledger: applied.ledger, receipt: applied.receipt };
}

export function relationHistory(state: RelationHistory, from: PersonId, to: PersonId): readonly LedgerEntry[] {
  const target = canonicalJson([from, to]);
  return state.ledger.entries.filter(entry => entry.target === target);
}
