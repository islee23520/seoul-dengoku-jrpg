import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id } from './ids.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import { advanceSuccession, transferSuccessionItem, computeLegitimacy, personalActionsDuringVacancy, assertSuccessorStartsWithOwnRelations } from './succession.ts';
import type { SuccessionState, SuccessionRules } from './succession.ts';
import { character, retainerCharacter, lord, retainer, specialist, cause } from './fixtures/opening.ts';

const state: SuccessionState = { event: { kind: 'body', previous: lord, successor: retainer, causeId: cause }, basis: 'death', stage: 'vacancy', office: id('OfficeId', 'TESTINPUT:office'), officePowersHalted: false, candidates: [retainer, specialist], selected: retainer, ratificationCause: null, items: [{ id: 'TESTINPUT:title', kind: 'title', holder: lord, institutional: false }, { id: 'TESTINPUT:property', kind: 'property', holder: lord, institutional: false }, { id: 'TESTINPUT:institutional', kind: 'property', holder: 'TESTINPUT:institution', institutional: true }], transferredItemIds: [], contracts: ['TESTINPUT:valid-contract'], disputeRecords: [] };
const rules: SuccessionRules = { eligibleCandidates: [retainer], procedureApproved: true, ratifiedCandidate: retainer, transferableItemIds: ['TESTINPUT:title', 'TESTINPUT:property'], legitimacyByCandidate: { [retainer]: 7 } };
test('T12-04 pre-ratification stages preserve rights and unchosen candidates', () => {
  // Given / When
  const candidates = ['office-halted', 'snapshot', 'lookup', 'candidates'].reduce<SuccessionState>((s, stage) => {
    switch (stage) {
      case 'office-halted': return advanceSuccession(s, 'office-halted');
      case 'snapshot': return advanceSuccession(s, 'snapshot');
      case 'lookup': return advanceSuccession(s, 'lookup');
      case 'candidates': return advanceSuccession(s, 'candidates');
      default: throw new InvariantViolation('TESTINPUT:stage');
    }
  }, state);
  // Then
  assert.equal(candidates.officePowersHalted, true);
  assert.deepEqual(candidates.items, state.items); assert.deepEqual(candidates.candidates, [retainer, specialist]);
  assert.deepEqual(candidates.contracts, state.contracts);
  assert.throws(() => transferSuccessionItem(candidates, 'TESTINPUT:title', rules), InvariantViolation);
  assert.throws(() => advanceSuccession(candidates, 'procedure'), MissingRuleInput);
  assert.throws(() => computeLegitimacy(retainer), MissingRuleInput);
});
test('T12-04 ratification transfers one item while institutional assets and claims remain', () => {
  // Given
  const candidates = { ...state, stage: 'candidates' } as const;
  const procedure = advanceSuccession(candidates, 'procedure', rules);
  const ratified = advanceSuccession({ ...procedure, ratificationCause: cause }, 'ratified', rules);
  // When
  const transferred = transferSuccessionItem(ratified, 'TESTINPUT:title', rules);
  // Then
  assert.equal(transferred.items.find(i => i.id === 'TESTINPUT:title')?.holder, retainer);
  assert.equal(transferred.items.find(i => i.id === 'TESTINPUT:property')?.holder, lord);
  assert.equal(transferred.items.find(i => i.id === 'TESTINPUT:institutional')?.holder, 'TESTINPUT:institution');
  assert.ok(transferred.candidates.includes(specialist));
  assert.throws(() => transferSuccessionItem(ratified, 'TESTINPUT:institutional', rules), InvariantViolation);
  assert.throws(() => advanceSuccession(procedure, 'ratified', rules), InvariantViolation);
  assert.equal(computeLegitimacy(retainer, rules), 7);
});
test('T12-04 successor keeps own capabilities but rejects copied predecessor traits skills and trust', () => {
  // Given
  const empty = { traits: [], skills: {}, relations: { trust: [], facts: [] } };
  // When / Then
  assert.doesNotThrow(() => assertSuccessorStartsWithOwnRelations(retainerCharacter, empty));
  assert.throws(() => assertSuccessorStartsWithOwnRelations(retainerCharacter, { ...empty, traits: ['TESTINPUT:old-trait'] }), InvariantViolation);
  assert.throws(() => assertSuccessorStartsWithOwnRelations(retainerCharacter, { ...empty, skills: { repair: 50 } }), InvariantViolation);
  assert.throws(() => assertSuccessorStartsWithOwnRelations(retainerCharacter, { ...empty, relations: { trust: [{ from: lord, to: specialist, value: 25 }], facts: [] } }), InvariantViolation);
  assert.deepEqual(character.skills, {}); assert.deepEqual(character.traits, []);
});
test('vacancy, death and imprisonment have distinct personal-action branches', () => {
  // Given / When
  const vacancy = personalActionsDuringVacancy(character, 'vacancy');
  const death = personalActionsDuringVacancy({ ...character, alive: false }, 'death');
  const captive = personalActionsDuringVacancy({ ...character, captive: true }, 'imprisonment');
  // Then
  assert.deepEqual(vacancy, { privateLife: true, movement: true, contractsContinue: true });
  assert.deepEqual(death, { privateLife: false, movement: false, contractsContinue: false });
  assert.deepEqual(captive, { privateLife: true, movement: false, contractsContinue: true });
});
