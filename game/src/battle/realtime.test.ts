import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextSchema, intentSchema, startBattle, confirmIntent, previewIntent, stepBattle, hash, BattleConflict, MissingRuleInput } from './realtime.ts';
import type { BattleRules, Resolution } from './realtime.ts';
import { grant, lord } from '../domain/fixtures/opening.ts';
import { id, integer } from '../domain/ids.ts';

// Explicit synthetic inputs; no fixture rule is a production default.
export const context = contextSchema.parse({ battleId: 'TESTINPUT:battle', encounterId: 'TESTINPUT:encounter', worldStartTick: 0, worldStartTime: 0,
  schemaVersion: 1, rulesHash: 'TESTINPUT:rules', contentHash: 'TESTINPUT:content', approvedInputsHash: 'TESTINPUT:approval', provenance: 'TESTINPUT',
  persons: [{ id: lord, hp: 10, equipment: 10 }], heroes: [{ id: 'hero', personId: lord, x: 0, y: 0 }],
  squads: [{ id: 'squad', population: 10, supply: 10, x: 0, y: 0, meleeLocked: false }], commandGrants: {}, formations: {}, navigation: {}, objective: {},
  supplyReservations: {}, legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: { battle: 0 } });
export const resolution: Resolution = { effects: [], positions: [], rngCursors: { battle: 0 }, evaluationReceipts: [], terminal: null };
export const rules: BattleRules = { rulesHash: context.rulesHash,
  authorize: () => ({ ...grant, grantor: lord, basis: { ...grant.basis, kind: 'command' }, scope: ['move'], assets: ['squad'] }),
  resolve: () => resolution };
const intent = intentSchema.parse({ commandId: 'first', originPersonId: lord, contextHash: hash(context), observationVersion: 0,
  selectedUnitIds: ['squad'], kind: 'move', targetOrPath: [1, 0], parentSignalId: 'signal' });

test('only latest replacement executes when multiple commands arrive before a step', () => {
  // Given
  const initial = startBattle(context); const before = hash(initial);
  previewIntent(initial, intent, { tick: 0, rules });
  assert.equal(hash(initial), before);
  const first = confirmIntent(initial, intent, { tick: 0, rules });
  const second = confirmIntent(first, { ...intent, commandId: 'second' }, { tick: 0, rules });
  assert.equal(second.signalReceipts[0]?.executedAt, null);
  // When
  const next = stepBattle(second, 1, rules);
  // Then
  assert.equal(next.currentOrders['squad']?.intent.commandId, 'second');
  assert.equal(next.signalReceipts[0]?.replacedBy, 'second');
  assert.equal(next.signalReceipts[0]?.executedAt, null);
  assert.equal(next.signalReceipts[1]?.executedAt, 1);
  assert.equal(next.appliedCursor, 2);
});
test('confirmation rechecks expiry and melee lock after a pure preview', () => {
  // Given
  const state = startBattle(context); previewIntent(state, intent, { tick: 0, rules });
  const locked = { ...state, squads: state.squads.map(s => ({ ...s, meleeLocked: true })) };
  // When / Then
  assert.throws(() => confirmIntent(state, intent, { tick: 20, rules }), BattleConflict);
  assert.throws(() => confirmIntent(locked, intent, { tick: 0, rules }), BattleConflict);
  assert.throws(() => stepBattle(state, 1, null), MissingRuleInput);
});
for (const [kind, targetId] of [['hp', lord], ['equipment', lord], ['population', 'squad'], ['supply', 'squad']] as const) {
  test('one owner applies ' + kind + ' once across steps and rejects another channel', () => {
    // Given
    const effect = { attackId: 'attack', targetId, kind, owner: 'personal', amount: 2 } as const;
    const effectsRules = { ...rules, resolve: () => ({ ...resolution, effects: [effect, effect] }) };
    const first = stepBattle(startBattle(context), 1, effectsRules);
    // When
    const second = stepBattle(first, 2, effectsRules);
    // Then
    assert.deepEqual(second.persons, first.persons); assert.deepEqual(second.squads, first.squads);
    assert.equal(Object.keys(second.attackApplications).length, 1);
    assert.throws(() => stepBattle(second, 3, { ...rules, resolve: () => ({ ...resolution, effects: [{ ...effect, owner: 'aggregate' }] }) }), BattleConflict);
  });
}
test('terminal outcome is immutable and delivery does not resolve twice', () => {
  // Given
  const terminal = { resultId: id('ResultId', 'TESTINPUT:result'), terminalKind: 'ordered-retreat', individualAndHeroFacts: {}, squadLosses: {}, resourceFacts: {}, commandEvaluationFacts: {} } as const;
  const ended = stepBattle(startBattle(context), 1, { ...rules, resolve: () => ({ ...resolution, terminal }) });
  // When / Then
  assert.equal(stepBattle(ended, integer('WorldTick', 2), rules), ended);
  assert.throws(() => Object.assign(ended.outcome ?? {}, { terminalKind: 'ordinary-victory' }), TypeError);
  assert.throws(() => Object.assign(context.navigation ?? {}, { changed: true }), TypeError);
});
