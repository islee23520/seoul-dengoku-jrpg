import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthStatRows } from '../../ui/growthStats.ts';
import { parseGrowthFocus, projectGrowth } from './growth.ts';
import type { GrowthState } from './growth.ts';
import { id, integer } from './ids.ts';

test('stat rows preserve actual growth state and the missing-rule block', () => {
  // Given: TESTINPUT values, never production defaults.
  const state: GrowthState = { person: id('PersonId', 'TESTINPUT:actor'), xp: 17, level: 2,
    parameters: { maxHp: 21, maxMp: 22, attack: 23, defense: 24, mind: 25, agility: 26 },
    focus: parseGrowthFocus({ focus: 'TESTINPUT:focus', perks: ['TESTINPUT:perk'] }), appliedResults: [] };
  const growth = projectGrowth(state, { schemaVersion: integer('SchemaVersion', 1), ruleVersion: 'test', contentVersion: 'test', entries: [], pendingResultIds: [] });
  // When
  const rows = new Map(growthStatRows(growth).map(row => [row.key, row]));
  // Then
  assert.equal(rows.get('status')?.blocked, true);
  assert.match(rows.get('status')?.value ?? '', /GrowthRules/);
  assert.equal(rows.get('xp')?.value, '17'); assert.equal(rows.get('level')?.value, '2');
  assert.deepEqual(['maxHp', 'maxMp', 'attack', 'defense', 'mind', 'agility'].map(key => rows.get(key)?.value), ['21', '22', '23', '24', '25', '26']);
  assert.equal(rows.get('focus')?.value, state.focus.focus);
  assert.equal(rows.get('perk-0')?.value, state.focus.perks[0]);
  assert.equal([...rows.keys()].filter(key => key.startsWith('perk-')).length, 3);
  assert.equal(rows.get('appliedResults')?.value, '0');
});

test('uninitialized opening growth renders blocked numeric fields instead of invented defaults', () => {
  // Given / When
  const rows = growthStatRows(null);
  // Then
  for (const key of ['focus', 'perk-0', 'perk-1', 'perk-2', 'xp', 'level', 'appliedResults', 'maxHp', 'maxMp', 'attack', 'defense', 'mind', 'agility']) {
    const row = rows.find(row => row.key === key);
    assert.equal(row?.blocked, true); assert.match(row?.value ?? '', /GrowthState.*GrowthRules/);
  }
  assert.equal(rows.filter(row => row.key.startsWith('perk-')).length, 3);
});
