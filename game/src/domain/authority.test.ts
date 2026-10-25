import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, integer } from './ids.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import { ownershipOf, commandOf, grantCommandFromOffice, assertGrantWithinGrantorRights, revokeGrant, assertCustodianIsNotOwner, assertKeyPossessionIsNotRight, executableRetainers, assertTransferableAsset } from './authority.ts';
import { assertCurrentFactionInSeoul, ingestWorldRelationLedgerFacts } from './faction.ts';
import { awardTitle, assertGeographicParentIsNotPersonalLiege, assertNoAutoAuthorityFromTitle } from './title.ts';
import { deriveOwnershipFromHolding, assertPossessionIsNotControl } from './holding.ts';
import { assertAbilityRanges, composeFinalAbility } from './character.ts';
import { applyStressEvent, recoverStress, assertStressState } from './stress.ts';
import { character, retainerCharacter, specialistCharacter, lord, retainer, specialist, grant, tick, cause, title, holding, services, applicability } from './fixtures/opening.ts';

test('T12-01 office appointment does not create ownership or command', () => {
  // Given
  const office = { officeId: id('OfficeId', 'TESTINPUT:office'), personId: lord, causeId: cause };
  const facts = { offices: [office], ownership: [], commands: [] };
  // When / Then
  assert.deepEqual(ownershipOf(facts, lord), []);
  assert.deepEqual(commandOf(facts, lord), []);
  assert.throws(() => grantCommandFromOffice(office), InvariantViolation);
});
test('T12-01 explicit command facts are queryable without an office', () => {
  // Given
  const command = { commander: lord, roster: [retainer], actions: ['TESTINPUT:operate'], causeId: cause };
  // When
  const actual = commandOf({ offices: [], ownership: [], commands: [command] }, lord);
  // Then
  assert.deepEqual(actual, [command]);
});
const child = { ...grant, id: id('GrantId', 'TESTINPUT:child'), grantor: retainer, grantee: specialist, parentAuthorityId: grant.id };
for (const [name, mutation] of [
  ['asset', { assets: ['TESTINPUT:unrelated-holding-asset'] }],
  ['action', { scope: ['TESTINPUT:foreign-action'] }],
  ['roster', { roster: [specialist] }],
  ['budget', { budget: { water: 8 } }],
  ['period', { expiresAt: integer('WorldTick', 21) }],
] as const) test('T12-02 rejects broader child ' + name, () => {
  // Given / When / Then
  assert.throws(() => assertGrantWithinGrantorRights({ ...child, ...mutation }, { parent: grant, now: tick }), InvariantViolation);
});
test('T12-02 permits bounded child and rejects prohibited subdelegation', () => {
  // Given / When / Then
  assert.doesNotThrow(() => assertGrantWithinGrantorRights(child, { parent: grant, now: tick }));
  assert.throws(() => assertGrantWithinGrantorRights(child, { parent: { ...grant, subdelegation: false }, now: tick }), InvariantViolation);
  assert.throws(() => assertGrantWithinGrantorRights(child, { parent: revokeGrant(grant, cause), now: tick }), InvariantViolation);
});
test('T12-05 rejects current outside-Seoul faction but preserves past tense', () => {
  // Given
  const faction = { id: id('FactionId', 'TESTINPUT:outside'), kind: 'kingdom', applicability, scope: [id('RegionCode', 'TESTINPUT:outside')] } as const;
  const scope = new Set(holding.territoryScope);
  // When / Then
  assert.throws(() => assertCurrentFactionInSeoul(faction, scope), InvariantViolation);
  assert.throws(() => assertCurrentFactionInSeoul(faction), MissingRuleInput);
  const past = { ...faction, applicability: { ...applicability, tense: 'past' } } as const;
  assert.doesNotThrow(() => assertCurrentFactionInSeoul(past));
  assert.equal(past.applicability.tense, 'past');
  assert.doesNotThrow(() => assertCurrentFactionInSeoul({ ...faction, scope: holding.territoryScope }, scope));
});
test('T12-05 relation ledger ingestion preserves reason without granting rights', () => {
  // Given: approved World-Relation-Ledger source row, copied into TESTINPUT.
  const rows = [{ from: 'HC01', kind: 'operates_in', to: 'S01', reason: 'TESTINPUT:source-reason' }];
  // When
  const facts = ingestWorldRelationLedgerFacts(rows);
  // Then
  assert.deepEqual(facts, rows);
  assert.notEqual(facts[0], rows[0]);
});
test('T12-08 geographic parent never supplies personal liege or authority', () => {
  // Given / When
  const awarded = awardTitle(title, specialist, cause);
  // Then
  assert.equal(awarded.holder, specialist);
  assert.equal(awarded.personalLiegePerson, null);
  assert.equal(awarded.geographicParentTitle, title.geographicParentTitle);
  assert.throws(() => assertGeographicParentIsNotPersonalLiege(title, id('PersonId', 'K029')), InvariantViolation);
  assert.throws(() => assertNoAutoAuthorityFromTitle(title), InvariantViolation);
});
for (const [name, changed] of [
  ['base', { ...character, baseAbilities: { ...character.baseAbilities, leadership: 21 } }],
  ['final', { ...character, finalAbilities: { ...character.finalAbilities, leadership: 101 } }],
  ['skill', { ...character, skills: { TESTINPUT: 100 } }],
  ['trait cause', { ...character, traits: [{ name: 'TESTINPUT', causeId: id('CauseId', 'TESTINPUT:valid') }] }],
] as const) test('T12-09 validates ' + name + ' independently', () => {
  // Given / When / Then
  if (name === 'trait cause') assert.doesNotThrow(() => assertAbilityRanges(changed));
  else assert.throws(() => assertAbilityRanges(changed), InvariantViolation);
});
test('T12-09 narrative provenance permits above-20 effects with a hard final cap', () => {
  // Given
  const effect = { source: 'opening-narrative', key: 'TESTINPUT:opening', causeId: cause, amount: 200 } as const;
  // When
  const final = composeFinalAbility(12, [effect]);
  // Then
  assert.equal(final, 100);
  assert.throws(() => composeFinalAbility(12, [Object.assign({}, effect, { causeId: '' })]), InvariantViolation);
  assert.throws(() => composeFinalAbility(12, [{ ...effect, source: 'trait' }]), MissingRuleInput);
  assert.equal(composeFinalAbility(12, [{ ...effect, source: 'trait' }], { effects: { 'TESTINPUT:opening': 3 } }), 15);
});
test('T12-09 body damage, function and disease stay separate', () => {
  // Given
  const body = { ...character.body, damage: { ...character.body.damage, 'left-arm': 'TESTINPUT:damaged' } };
  // When
  const changed = { ...character, body };
  // Then
  assert.notEqual(changed.body.damage['left-arm'], changed.body.function['left-arm']);
  assert.deepEqual(changed.body.diseases, []);
  assert.doesNotThrow(() => assertAbilityRanges(retainerCharacter));
  assert.doesNotThrow(() => assertAbilityRanges(specialistCharacter));
});
test('T12-10 stress transitions fail closed and preserve structural state', () => {
  // Given
  const state = { value: 3, thresholds: [], recovery: [] };
  const event = { key: 'TESTINPUT:stress', causeId: cause, at: tick };
  // When / Then
  assert.throws(() => applyStressEvent(state, event), { name: 'MissingRuleInput', ruleKey: 'StressRules.eventDeltas' });
  assert.throws(() => recoverStress(state, event), MissingRuleInput);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.throws(() => assertStressState({ ...state, value: NaN }), InvariantViolation);
});
test('T12-10 injected TESTINPUT stress rules determine event and recovery', () => {
  // Given
  const rules = { thresholds: [{ key: 'TESTINPUT:threshold', value: 5 }], minimum: 0, eventDeltas: { test: 4 }, recoveryRates: { test: 2 } };
  const event = { key: 'test', causeId: cause, at: tick };
  // When
  const increased = applyStressEvent({ value: 3, thresholds: [], recovery: [] }, event, rules);
  const recovered = recoverStress(increased, event, rules);
  // Then
  assert.equal(increased.value, 7); assert.equal(recovered.value, 5);
  assert.deepEqual(recovered.recovery, [{ causeId: cause, at: tick, amount: 2 }]);
});
test('T12-12 holding, custody and keys cannot fabricate ownership or access', () => {
  // Given
  const custody = { custodian: retainer, lotId: id('LotId', 'TESTINPUT:lot'), asset: 'TESTINPUT:valve', causeId: cause };
  // When / Then
  assert.equal(holding.territoryScope.length, 18);
  assert.throws(() => deriveOwnershipFromHolding(holding), InvariantViolation);
  assert.throws(() => assertPossessionIsNotControl(holding, retainer, custody.asset), InvariantViolation);
  assert.throws(() => assertCustodianIsNotOwner(custody, []), InvariantViolation);
  assert.throws(() => assertKeyPossessionIsNotRight(retainer, custody.asset, []), InvariantViolation);
  assert.throws(() => assertTransferableAsset({ id: 'TESTINPUT:synthetic-person', recognizedPerson: true }), InvariantViolation);
});
test('S06 retention and explicit delegation expand capacity without stat changes', () => {
  // Given
  const expanded = { ...grant, roster: services.map(s => s.personId) };
  // When
  const before = executableRetainers(services, grant, tick);
  const after = executableRetainers(services, expanded, tick);
  // Then
  assert.deepEqual(before, [retainer]);
  assert.equal(after.length, 9);
  assert.equal(services.length, 13);
  assert.ok(services.filter(s => s.disposition === 'retired-current').every(s => !after.includes(s.personId)));
  assert.deepEqual(executableRetainers(services, revokeGrant(expanded, cause), tick), []);
  assert.equal(character.baseAbilities.administration, 13);
});
