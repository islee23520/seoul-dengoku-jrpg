import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventLedger, JsonValue } from './eventLedger.ts';
import { applyResult, summaryHash, restoreLedger } from './eventLedger.ts';
import { id } from './ids.ts';
import { MissingRuleInput, InvariantViolation } from './errors.ts';
import { projectGrowth, parseGrowthFocus, delegationCapacity, parameterKeys } from './growth.ts';
import type { GrowthRules, GrowthState } from './growth.ts';
import { lord, retainer, grant, order, tick, cause, schemaVersion } from './fixtures/opening.ts';

// All numbers below are TESTINPUT, not approved GP growth data.
const versions = { schemaVersion, ruleVersion: 'TESTINPUT:rule', contentVersion: 'TESTINPUT:content' };
const empty: EventLedger = { ...versions, entries: [], pendingResultIds: [] };
const initial: GrowthState = { person: lord, xp: 0, level: 1,
  parameters: { maxHp: 10, maxMp: 10, attack: 10, defense: 10, mind: 10, agility: 10 },
  focus: parseGrowthFocus({ focus: 'TESTINPUT:steward', perks: [] }), appliedResults: [] };
const rules: GrowthRules = {
  curves: { maxLevel: 3, expCurve: { base: 10, extra: 0, acceleration: 0 },
    parameterCurves: { maxHp: [10, 20, 30], maxMp: [10, 12, 14], attack: [10, 11, 12],
      defense: [10, 13, 16], mind: [10, 14, 18], agility: [10, 15, 20] } },
  xp: { victory: 6, 'work-resolution': 4 },
  threshold: (curve, level) => curve.base * (level - 1),
  parameters: (curves, level) => {
    const parameters = { ...initial.parameters };
    for (const key of parameterKeys) {
      const value = curves[key][level - 1];
      if (value === undefined) throw new MissingRuleInput('TESTINPUT:curve.' + key);
      parameters[key] = value;
    }
    return parameters;
  },
  perkEffects: { 'TESTINPUT:care': { mind: 2 } },
};
function append(ledger: EventLedger, command: string, payload: JsonValue = null): EventLedger {
  return applyResult(ledger, { ...versions, command, payload, actor: lord, target: retainer, causeId: cause,
    worldTime: tick, resultId: id('ResultId', 'TESTINPUT:' + ledger.entries.length),
    beforeHash: ledger.entries.at(-1)?.afterHash ?? summaryHash(null), afterHash: summaryHash(payload) }).ledger;
}

test('XP reflects parameters when victory and resolved work cross the injected threshold', () => {
  // Given
  const won = append(empty, 'victory');
  const before = projectGrowth(initial, won, rules);
  assert.equal(before.kind, 'applied');
  assert.equal(before.state.level, 1); assert.equal(before.state.xp, 6);
  const ledger = append(won, 'work-resolution');
  // When
  const result = projectGrowth(before.state, ledger, rules);
  // Then
  assert.equal(result.kind, 'applied'); assert.equal(result.state.xp, 10); assert.equal(result.state.level, 2);
  assert.deepEqual(result.state.parameters, { maxHp: 20, maxMp: 12, attack: 11, defense: 13, mind: 14, agility: 15 });
});

test('missing rules block growth without changing XP, level or parameters', () => {
  // Given
  const ledger = append(empty, 'victory');
  // When
  const result = projectGrowth(initial, ledger);
  // Then
  assert.equal(result.kind, 'blocked'); assert.strictEqual(result.state, initial);
  if (result.kind === 'blocked') assert.ok(result.error instanceof MissingRuleInput);
});

test('missing parameter reflection blocks a crossed threshold atomically', () => {
  // Given
  const ledger = append(append(empty, 'victory'), 'work-resolution');
  const incomplete = { ...rules, curves: { ...rules.curves,
    parameterCurves: { ...rules.curves.parameterCurves, agility: [10] } } };
  // When
  const result = projectGrowth(initial, ledger, incomplete);
  // Then
  assert.equal(result.kind, 'blocked'); assert.strictEqual(result.state, initial);
});

test('task13 order lifecycle awards work XP only at result application', () => {
  // Given
  const ledger = ['executing', 'result-applied', 'receipt'].reduce((state, stage) =>
    append(state, 'order-step', { mandate: { stage } }), empty);
  // When
  const result = projectGrowth(initial, ledger, rules);
  // Then
  assert.equal(result.state.xp, 4); assert.equal(result.state.appliedResults.length, 1);
});

test('replay and restored ledger produce deterministic growth without duplicate awards', () => {
  // Given
  const ledger = append(append(empty, 'victory'), 'work-resolution');
  const restored = restoreLedger(JSON.parse(JSON.stringify(ledger)), versions);
  const first = projectGrowth(initial, ledger, rules);
  // When
  const replay = projectGrowth(first.state, restored, rules);
  // Then
  assert.deepEqual(replay, first); assert.deepEqual(projectGrowth(initial, restored, rules), first);
});

test('focus boundary rejects multiple trees, excess perks and perks without a focus', () => {
  // Given
  const invalid = [{ focus: ['a', 'b'], perks: [] }, { focus: 'a', perks: ['a', 'b', 'c', 'd'] },
    { focus: null, perks: ['a'] }, { focus: 'a', perks: ['a', 'a'] }];
  // When / Then
  for (const value of invalid) assert.throws(() => parseGrowthFocus(value));
});

test('perk effects reflect only injected parameter effects', () => {
  // Given
  const state = { ...initial, focus: parseGrowthFocus({ focus: 'TESTINPUT:steward', perks: ['TESTINPUT:care'] }) };
  // When
  const result = projectGrowth(state, empty, rules);
  // Then
  assert.equal(result.state.parameters.mind, 12);
});

test('missing perk effects block rather than invent an effect', () => {
  // Given
  const state = { ...initial, focus: parseGrowthFocus({ focus: 'TESTINPUT:steward', perks: ['TESTINPUT:unknown'] }) };
  // When
  const result = projectGrowth(state, empty, rules);
  // Then
  assert.equal(result.kind, 'blocked'); assert.strictEqual(result.state, state);
});

test('non-finite XP input fails rather than reflecting an invalid level', () => {
  // Given
  const ledger = append(empty, 'victory');
  // When / Then
  assert.throws(() => projectGrowth(initial, ledger, { ...rules, xp: { ...rules.xp, victory: Infinity } }), InvariantViolation);
});

const capacityContext = { grant, mandate: order, now: tick };
const service = { principal: lord, personId: retainer, role: 'household-retainer', disposition: 'active' } as const;
test('recruited and retained ledger facts enable only existing granted delegation', () => {
  // Given
  const ledger = append(append(empty, 'service-recruited', service), 'service-retained', service);
  // When
  const capacity = delegationCapacity(ledger, capacityContext);
  // Then
  assert.deepEqual(capacity, [retainer]);
});

test('release removes delegation capacity despite personal XP and retained history', () => {
  // Given
  const ledger = append(append(append(empty, 'service-recruited', service), 'victory'),
    'service-released', { ...service, disposition: 'retired-current' });
  // When
  const capacity = delegationCapacity(ledger, capacityContext);
  // Then
  assert.deepEqual(capacity, []);
});

test('personal XP cannot create service or grant rights', () => {
  // Given
  const ledger = append(empty, 'victory');
  // When
  const capacity = delegationCapacity(ledger, capacityContext);
  // Then
  assert.deepEqual(capacity, []);
});

test('service facts cannot bypass revoked mandate authority', () => {
  // Given
  const ledger = append(empty, 'service-recruited', service);
  // When / Then
  assert.throws(() => delegationCapacity(ledger, { ...capacityContext, grant: { ...grant, state: 'revoked' } }), InvariantViolation);
});
