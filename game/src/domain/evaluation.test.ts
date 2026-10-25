import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, integer } from './ids.ts';
import { CheckpointCorrupt, InvariantViolation, LedgerConflict, MissingRuleInput, VersionMismatch } from './errors.ts';
import { foldLedger, summaryHash } from './eventLedger.ts';
import { evaluateOpinion, evaluateOpinions } from './opinion.ts';
import { applyRelationEvent, relationHistory } from './relationHistory.ts';
import type { RelationEvent, RelationHistory } from './relationHistory.ts';
import { evaluateStress } from './stressEvaluation.ts';
import type { StressEvaluationRules } from './stressEvaluation.ts';
import { cause, lord, retainer, specialist, tick, schemaVersion } from './fixtures/opening.ts';

// TESTINPUT: all noncanonical deltas, thresholds, scene keys and versions below.
const fact = { from: lord, to: retainer, kind: 'service', causeId: cause } as const;
const versions = { schemaVersion, ruleVersion: 'TESTINPUT:rule', contentVersion: 'TESTINPUT:content' };
const empty: RelationHistory = { relations: { trust: [], facts: [] }, ledger: { ...versions, entries: [], pendingResultIds: [] } };
const event: RelationEvent = { fact, resultId: id('ResultId', 'TESTINPUT:relation'), worldTime: tick, actor: lord, ...versions, change: 'fact' };
const rules: StressEvaluationRules = {
  minimum: 0, thresholds: [{ key: 'warning', value: 4 }, { key: 'break', value: 8 }],
  eventDeltas: { violation: 5, calm: -2, unchanged: 0, severe: 10 }, recoveryRates: { rest: 3 },
  breakingThresholdKey: 'break', consequences: {
    warning: { penalty: 'TESTINPUT:warning', recoveryScene: 'TESTINPUT:rest' },
    break: { penalty: 'TESTINPUT:break', recoveryScene: 'TESTINPUT:retreat' },
  },
};
const stress = { value: 0, thresholds: [], recovery: [] };
const action = { kind: 'event', key: 'violation', causeId: cause, at: tick } as const;

for (const [value, expected] of [[24, 'neutral'], [25, 'friend'], [-24, 'neutral'], [-25, 'enemy'], [-49, 'enemy'], [-50, 'rival']] as const) {
  test('T14 opinion classifies existing trust at ' + value, () => {
    // Given
    const state = { trust: [{ from: lord, to: retainer, value }], facts: [fact] };
    // When
    const opinion = evaluateOpinion(state, lord, retainer);
    // Then
    assert.deepEqual(opinion, { from: lord, to: retainer, trust: value, classification: expected, facts: [fact] });
  });
}
test('T14 sparse opinions retain unknown trust and direction without fact modifiers', () => {
  // Given
  const state = { trust: [{ from: retainer, to: lord, value: 25 }], facts: [fact, fact] };
  // When
  const opinions = evaluateOpinions(state, lord);
  // Then
  assert.deepEqual(opinions, [{ from: lord, to: retainer, trust: null, classification: null, facts: [fact, fact] }]);
  assert.equal(evaluateOpinion(state, lord, specialist).classification, null);
  assert.deepEqual(state.trust, [{ from: retainer, to: lord, value: 25 }]);
});
test('T14 history records cause, time, actor, versions and complete before/after state', () => {
  // Given
  const state = { ...empty, relations: { trust: [{ from: retainer, to: lord, value: -25 }], facts: [] } };
  // When
  const applied = applyRelationEvent(state, event);
  // Then
  const entries = relationHistory(applied, lord, retainer);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    causeId: cause, command: 'relation:fact', worldTime: tick, actor: lord, target: JSON.stringify([lord, retainer]),
    ruleVersion: versions.ruleVersion, contentVersion: versions.contentVersion, resultId: event.resultId,
    beforeHash: summaryHash({ ...state.relations }), afterHash: summaryHash({ ...applied.relations }),
    payload: { request: { ...event, rules: null }, before: state.relations, after: applied.relations },
  });
  assert.equal(applied.relations.trust, state.relations.trust);
  assert.deepEqual(relationHistory(applied, retainer, lord), []);
  assert.deepEqual(state.relations.facts, []);
});
test('T14 trust history applies an injected delta once even after later events', () => {
  // Given
  const input = { ...event, change: 'trust' } as const;
  const deltaRules = { deltas: { service: 3 } };
  const first = applyRelationEvent(empty, input, deltaRules);
  const later = applyRelationEvent(first, { ...event, resultId: id('ResultId', 'TESTINPUT:later'), worldTime: integer('WorldTick', 3) });
  // When
  const replay = applyRelationEvent(later, input, deltaRules);
  // Then
  assert.equal(replay.relations, later.relations);
  assert.equal(replay.ledger, later.ledger);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.deepEqual(replay.relations.trust, [{ from: lord, to: retainer, value: 3 }]);
  assert.equal(replay.ledger.entries.length, 2);
});
for (const changed of [
  { ...event, actor: retainer }, { ...event, worldTime: integer('WorldTick', 3) },
  { ...event, fact: { ...fact, to: specialist } }, { ...event, change: 'trust' } as const,
]) test('T14 changed request conflicts for an applied ResultId: ' + JSON.stringify(changed), () => {
  // Given
  const first = applyRelationEvent(empty, event);
  // When / Then
  assert.throws(() => applyRelationEvent(first, changed), LedgerConflict);
  assert.equal(first.ledger.entries.length, 1);
});
test('T14 changed injected rules conflict rather than silently replaying', () => {
  // Given
  const input = { ...event, change: 'trust' } as const;
  const first = applyRelationEvent(empty, input, { deltas: { service: 3 } });
  // When / Then
  assert.throws(() => applyRelationEvent(first, input, { deltas: { service: 4 } }), LedgerConflict);
});
test('T14 numeric relation changes reject absent rule objects and entries', () => {
  // Given
  const input = { ...event, change: 'trust' } as const;
  // When / Then
  assert.throws(() => applyRelationEvent(empty, input), MissingRuleInput);
  assert.throws(() => applyRelationEvent(empty, input, { deltas: {} }), MissingRuleInput);
  assert.deepEqual(empty.relations, { trust: [], facts: [] });
});
test('T14 history rejects missing causes, stale versions and unrecorded relation changes', () => {
  // Given
  const first = applyRelationEvent(empty, event);
  const next = { ...event, resultId: id('ResultId', 'TESTINPUT:next') };
  const altered = { ...first, relations: { ...first.relations, facts: [] } };
  // When / Then
  assert.throws(() => applyRelationEvent(empty, { ...event, fact: Object.assign({}, fact, { causeId: '' }) }), InvariantViolation);
  assert.throws(() => applyRelationEvent(empty, { ...event, ruleVersion: 'TESTINPUT:stale' }), VersionMismatch);
  assert.throws(() => applyRelationEvent(altered, next), CheckpointCorrupt);
});
for (const [value, key, kind, phase, expected, crossed] of [
  [0, 'violation', 'event', 'rising', 5, ['warning']],
  [5, 'violation', 'event', 'breaking', 10, ['break']],
  [0, 'severe', 'event', 'breaking', 10, ['warning', 'break']],
  [5, 'calm', 'event', 'falling', 3, []],
  [0, 'unchanged', 'event', 'steady', 0, []],
  [10, 'rest', 'recovery', 'falling', 7, []],
  [2, 'rest', 'recovery', 'falling', 0, []],
] as const) test('T14 stress transition ' + kind + ':' + key + ' from ' + value, () => {
  // Given
  const state = { ...stress, value };
  // When
  const transition = evaluateStress(state, { ...action, key, kind }, rules);
  // Then
  assert.equal(transition.state.value, expected);
  assert.equal(transition.phase, phase);
  assert.deepEqual(transition.crossed.map(item => item.key), crossed);
  for (const item of transition.crossed) assert.deepEqual(item, { key: item.key, ...rules.consequences[item.key] });
  assert.deepEqual(transition.event, { key, causeId: cause, at: tick });
  assert.deepEqual(transition.state.recovery, kind === 'recovery' ? [{ causeId: cause, at: tick, amount: 3 }] : []);
  assert.equal(state.value, value);
});
test('T14 stress fails closed for all missing numerical and consequence rule inputs', () => {
  // Given
  const incomplete = [
    undefined, { ...rules, eventDeltas: {} }, { ...rules, breakingThresholdKey: 'absent' },
    { ...rules, consequences: {} },
  ];
  // When / Then
  for (const input of incomplete) assert.throws(() => evaluateStress(stress, action, input), MissingRuleInput);
  assert.throws(() => evaluateStress(stress, { ...action, kind: 'recovery' }, rules), MissingRuleInput);
});
test('T14 stress rejects invalid injected values', () => {
  // Given
  const invalid = [
    { ...rules, minimum: NaN }, { ...rules, thresholds: [...rules.thresholds, { key: 'break', value: 9 }] },
    { ...rules, eventDeltas: { violation: Infinity } },
  ];
  // When / Then
  for (const input of invalid) assert.throws(() => evaluateStress(stress, action, input), InvariantViolation);
});
test('T14 relation and stress evaluations are deterministic for identical explicit inputs', () => {
  // Given
  const input = { ...event, change: 'trust' } as const;
  const deltaRules = { deltas: { service: 3 } };
  // When
  const left = applyRelationEvent(empty, input, deltaRules);
  const right = applyRelationEvent(empty, input, deltaRules);
  // Then
  assert.deepEqual(left, right);
  assert.equal(foldLedger(left.ledger), foldLedger(right.ledger));
  assert.deepEqual(evaluateStress(stress, action, rules), evaluateStress(stress, action, rules));
});
