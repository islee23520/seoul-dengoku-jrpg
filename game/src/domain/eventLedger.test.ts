import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, integer } from './ids.ts';
import { CheckpointCorrupt, LedgerConflict, VersionMismatch } from './errors.ts';
import { applyResult, restoreLedger, foldLedger, cursor, summaryHash } from './eventLedger.ts';
import type { EventLedger, LedgerEntry } from './eventLedger.ts';
import { cause, lord, tick, schemaVersion } from './fixtures/opening.ts';

const versions = { schemaVersion, ruleVersion: 'TESTINPUT:rule', contentVersion: 'TESTINPUT:content' };
const entry: LedgerEntry = { causeId: cause, command: 'TESTINPUT:apply', worldTime: tick, actor: lord, target: 'TESTINPUT:target', beforeHash: summaryHash(null), afterHash: summaryHash({ value: 3 }), ...versions, resultId: id('ResultId', 'TESTINPUT:result'), payload: { value: 3 } };
const empty: EventLedger = { ...versions, entries: [], pendingResultIds: [entry.resultId, id('ResultId', 'TESTINPUT:pending')] };
test('T12-06 identical ResultId reapply returns original receipt without state mutation', () => {
  // Given
  const first = applyResult(empty, entry);
  // When
  const second = applyResult(first.ledger, entry);
  // Then
  assert.equal(second.ledger, first.ledger); assert.deepEqual(second.receipt, first.receipt);
  assert.equal(second.ledger.entries.length, 1);
  assert.deepEqual(second.ledger.pendingResultIds, [id('ResultId', 'TESTINPUT:pending')]);
});
test('T12-06 conflicting payload and stale versions fail without mutation', () => {
  // Given
  const first = applyResult(empty, entry);
  const before = foldLedger(first.ledger);
  // When / Then
  assert.throws(() => applyResult(first.ledger, { ...entry, payload: { value: 4 } }), LedgerConflict);
  assert.throws(() => applyResult(first.ledger, { ...entry, ruleVersion: 'TESTINPUT:stale' }), VersionMismatch);
  assert.equal(foldLedger(first.ledger), before);
});
test('T12-13 independent folds are deterministic with strictly monotonic cursor', () => {
  // Given
  const next = { ...entry, resultId: id('ResultId', 'TESTINPUT:next'), beforeHash: entry.afterHash, afterHash: summaryHash({ value: 4 }), payload: { value: 4 }, worldTime: integer('WorldTick', 3) };
  // When
  const left = [entry, next].reduce((ledger, result) => applyResult(ledger, result).ledger, empty);
  const right = [entry, next].reduce((ledger, result) => applyResult(ledger, result).ledger, empty);
  // Then
  assert.equal(foldLedger(left), foldLedger(right));
  assert.equal(cursor(empty), 0); assert.equal(cursor(applyResult(empty, entry).ledger), 1); assert.equal(cursor(left), 2);
  assert.equal(summaryHash({ a: 1, b: 2 }), summaryHash({ b: 2, a: 1 }));
});
test('snapshot restores exact ledger and rejects version mismatch', () => {
  // Given
  const original = applyResult(empty, entry).ledger;
  // When
  const restored = restoreLedger(JSON.parse(JSON.stringify(original)), versions);
  // Then
  assert.equal(foldLedger(restored), foldLedger(original));
  assert.throws(() => restoreLedger({ ...original, schemaVersion: 9 }, versions), VersionMismatch);
});
for (const [name, invalid] of [
  ['null', null], ['missing entries', versions], ['invalid time', { ...empty, entries: [{ ...entry, worldTime: -1 }] }],
  ['invalid cause', { ...empty, entries: [{ ...entry, causeId: '' }] }],
  ['duplicate result', { ...empty, pendingResultIds: [], entries: [entry, entry] }],
  ['pending overlap', { ...empty, entries: [entry] }],
  ['broken chain', { ...empty, pendingResultIds: [], entries: [entry, { ...entry, resultId: 'TESTINPUT:second', beforeHash: 'wrong' }] }],
] as const) test('snapshot fails explicitly on ' + name, () => {
  // Given / When / Then
  assert.throws(() => restoreLedger(invalid, versions), CheckpointCorrupt);
});
