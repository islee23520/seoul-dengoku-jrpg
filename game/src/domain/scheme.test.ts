import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id } from './ids.ts';
import { InvariantViolation, LedgerConflict, MissingRuleInput } from './errors.ts';
import { canonicalJson } from './eventLedger.ts';
import type { EventLedger } from './eventLedger.ts';
import { relationHistory } from './relationHistory.ts';
import type { Scheme, SchemeKind, SchemeRules, SchemeWorld } from './scheme.ts';
import { acceptScheme, activateScheme, advanceScheme, proposeScheme, schemeKinds, schemeResolutionInput } from './scheme.ts';
import { applySchemeEvent } from './schemeLifecycle.ts';
import type { SchemeEvent, SchemeHistory } from './schemeLifecycle.ts';
import { character, retainerCharacter, specialistCharacter, lord, retainer, specialist, cause, tick, schemaVersion } from './fixtures/opening.ts';

const world: SchemeWorld = {
  viewer: lord, visiblePersons: [lord, retainer, specialist], persons: [character, retainerCharacter, specialistCharacter],
  relations: { trust: [
    { from: retainer, to: lord, value: 25 }, { from: retainer, to: specialist, value: -25 },
    { from: specialist, to: lord, value: 0 }, { from: specialist, to: retainer, value: 0 },
    { from: lord, to: retainer, value: 25 },
  ], facts: [{ from: retainer, to: lord, kind: 'service', causeId: cause }] },
};
// TESTINPUT only; no production balance values.
const rules: SchemeRules = { successProbability: input => input.agents[0]?.towardOwner.classification === 'friend' ? 1 : 0,
  relationDeltas: { 'scheme-success': 3, 'scheme-failure': -2, 'scheme-discovered': -5 } };
function proposal(kind: SchemeKind = 'informant-recruitment') {
  return { id: id('SchemeId', 'TESTINPUT:scheme'), causeId: cause, kind, owner: lord,
    target: specialist, intent: 'TESTINPUT:intent', agents: [retainer] };
}
function ready(kind: SchemeKind = 'informant-recruitment'): Scheme {
  let scheme = activateScheme(acceptScheme(proposeScheme(proposal(kind), world), world), world);
  for (const step of ['evidence', 'preparation', 'completion']) {
    scheme = advanceScheme(scheme, { causeId: id('CauseId', 'TESTINPUT:' + step), warning: true }, world);
  }
  return scheme;
}
function history(scheme: Scheme): SchemeHistory {
  const ledger: EventLedger = { schemaVersion, ruleVersion: 'TESTINPUT:rules', contentVersion: 'TESTINPUT:content', entries: [], pendingResultIds: [] };
  return { scheme, ledger, relationHistory: { relations: world.relations, ledger } };
}
function event(kind: 'resolve' | 'discover'): SchemeEvent {
  const metadata = { causeId: cause, resultId: id('ResultId', 'TESTINPUT:' + kind), worldTime: tick,
    ruleVersion: 'TESTINPUT:rules', contentVersion: 'TESTINPUT:content' };
  switch (kind) {
    case 'resolve': return { ...metadata, kind, roll: 0.5 };
    case 'discover': return { ...metadata, kind };
  }
}
for (const kind of schemeKinds) test('T15 lifecycle resolves ' + kind + ' when real agents prepare it', () => {
  // Given
  const proposed = proposeScheme(proposal(kind), world);
  const accepted = acceptScheme(proposed, world);
  const active = activateScheme(accepted, world);
  const state = history(ready(kind));
  // When
  const applied = applySchemeEvent(state, event('resolve'), { world, rules });
  // Then
  assert.deepEqual([proposed.stage, accepted.stage, active.stage, state.scheme.progress, state.scheme.risk, applied.scheme.stage],
    ['proposed', 'accepted', 'active', 'ready', 'warning', 'resolved']);
  assert.equal(applied.scheme.outcome, 'success');
  assert.equal(applied.ledger.entries.length, 1);
  assert.equal(relationHistory(applied.relationHistory, lord, retainer).length, 1);
  assert.equal(applied.relationHistory.relations.trust.find(edge => edge.from === lord && edge.to === retainer)?.value, 28);
});
test('T15 agent relations change the resolution input and selected outcome', () => {
  // Given
  const state = history(ready());
  const hostile = { ...state, relationHistory: { ...state.relationHistory, relations: { ...world.relations,
    trust: world.relations.trust.map(edge => edge.from === retainer && edge.to === lord ? { ...edge, value: -50 } : edge) } } };
  const input = schemeResolutionInput(state.scheme, world);
  // When
  const friendlyResult = applySchemeEvent(state, event('resolve'), { world, rules });
  const hostileResult = applySchemeEvent(hostile, event('resolve'), { world, rules });
  // Then
  assert.equal(input.agents[0]?.towardOwner.classification, 'friend');
  assert.equal(input.agents[0]?.towardTarget.classification, 'enemy');
  assert.equal(input.agents[0]?.towardOwner.facts[0]?.kind, 'service');
  assert.deepEqual([friendlyResult.scheme.outcome, hostileResult.scheme.outcome], ['success', 'failure']);
  assert.equal(hostileResult.relationHistory.relations.facts.at(-1)?.kind, 'scheme-failure');
});
test('T15 discovery worsens target relations and has visible structural risk', () => {
  // Given
  const state = history(ready());
  // When
  const discovered = applySchemeEvent(state, event('discover'), { world, rules });
  const resolved = applySchemeEvent(discovered, event('resolve'), { world, rules });
  // Then
  assert.equal(discovered.scheme.stage, 'discovered');
  assert.equal(discovered.scheme.risk, 'discovered');
  for (const to of [lord, retainer]) {
    assert.equal(discovered.relationHistory.relations.trust.find(edge => edge.from === specialist && edge.to === to)?.value, -5);
    assert.equal(relationHistory(discovered.relationHistory, specialist, to)[0]?.command, 'relation:trust');
  }
  assert.equal(resolved.ledger.entries.length, 2);
});
test('T15 ResultId retries return one receipt without duplicate relation effects', () => {
  // Given
  const applied = applySchemeEvent(history(ready()), event('resolve'), { world, rules });
  // When
  const retry = applySchemeEvent(applied, event('resolve'), { world, rules });
  // Then
  assert.deepEqual(retry.receipt, applied.receipt);
  assert.equal(retry.ledger, applied.ledger);
  assert.equal(retry.relationHistory, applied.relationHistory);
  assert.throws(() => applySchemeEvent(applied, { ...event('resolve'), kind: 'resolve', roll: 0.9 }, { world, rules }), LedgerConflict);
});
test('T15 agentless schemes cannot activate advance or resolve', () => {
  // Given
  const agentless = { ...ready(), agents: [] };
  // When / Then
  assert.throws(() => activateScheme(acceptScheme(proposeScheme({ ...proposal(), agents: [] }, world), world), world), InvariantViolation);
  assert.throws(() => advanceScheme(agentless, { causeId: cause, warning: false }, world), InvariantViolation);
  assert.throws(() => applySchemeEvent(history(agentless), event('resolve'), { world, rules }), InvariantViolation);
});
test('T15 missing SchemeRules fail closed', () => {
  // Given
  const state = history(ready());
  // When / Then
  assert.throws(() => applySchemeEvent(state, event('resolve'), { world }), MissingRuleInput);
  assert.throws(() => applySchemeEvent(state, event('discover'), { world }), MissingRuleInput);
  assert.equal(state.ledger.entries.length, 0);
});
test('T15 unshown nonexistent unavailable or unrelated agents are rejected', () => {
  // Given
  const proposed = proposal();
  // When / Then
  assert.throws(() => proposeScheme(proposed, { ...world, visiblePersons: [lord, specialist] }), InvariantViolation);
  assert.throws(() => proposeScheme(proposed, { ...world, persons: [character, specialistCharacter] }), InvariantViolation);
  assert.throws(() => proposeScheme(proposed, { ...world, relations: { trust: [], facts: [] } }), InvariantViolation);
  assert.throws(() => schemeResolutionInput(ready(), { ...world, persons: [character, specialistCharacter, { ...retainerCharacter, captive: true }] }), InvariantViolation);
});
test('T15 evidence cannot be reused and incomplete active schemes cannot resolve', () => {
  // Given
  const active = activateScheme(acceptScheme(proposeScheme(proposal(), world), world), world);
  const evidence = { causeId: cause, warning: false };
  const progressed = advanceScheme(active, evidence, world);
  // When / Then
  assert.throws(() => advanceScheme(progressed, evidence, world), InvariantViolation);
  assert.throws(() => applySchemeEvent(history(progressed), event('resolve'), { world, rules }), InvariantViolation);
  assert.throws(() => acceptScheme(active, world), InvariantViolation);
  assert.throws(() => activateScheme(active, world), InvariantViolation);
});
test('T15 invalid probabilities and non-worsening discovery deltas are rejected atomically', () => {
  // Given
  const state = history(ready());
  // When / Then
  assert.throws(() => applySchemeEvent(state, event('resolve'), { world, rules: { ...rules, successProbability: () => NaN } }), InvariantViolation);
  assert.throws(() => applySchemeEvent(state, event('discover'), { world, rules: { ...rules, relationDeltas: { ...rules.relationDeltas, 'scheme-discovered': 0 } } }), InvariantViolation);
  assert.equal(state.relationHistory.ledger.entries.length, 0);
});
test('T15 identical inputs produce deterministic scheme and relation ledgers', () => {
  // Given
  const state = history(ready());
  // When
  const first = applySchemeEvent(state, event('resolve'), { world, rules });
  const second = applySchemeEvent(state, event('resolve'), { world, rules });
  // Then
  assert.equal(canonicalJson({ ...first }), canonicalJson({ ...second }));
  assert.equal(state.ledger.entries.length, 0);
  assert.equal(state.relationHistory.relations, world.relations);
});
