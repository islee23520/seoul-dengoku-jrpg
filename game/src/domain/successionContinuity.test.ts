import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id } from './ids.ts';
import type { Grant } from './authority.ts';
import type { Relations } from './relation.ts';
import type { SuccessionRules } from './succession.ts';
import { assertSuccessorStartsWithOwnRelations } from './succession.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import { beginSuccessionContinuity, transferSuccessionControl } from './successionContinuity.ts';
import type { ContinuityInput } from './successionContinuity.ts';
import { character, retainerCharacter, specialistCharacter, lord, retainer, specialist, liege,
  cause, grant, services, tick } from './fixtures/opening.ts';

const relations: Relations = {
  trust: [{ from: specialist, to: retainer, value: 25 }, { from: retainer, to: specialist, value: -50 }],
  facts: [{ from: specialist, to: lord, kind: 'oath', causeId: cause },
    { from: specialist, to: retainer, kind: 'family', causeId: cause }],
};
const input: ContinuityInput = {
  trigger: { kind: 'death', causeId: cause }, predecessor: { ...character, alive: false,
    traits: [{ name: 'TESTINPUT:predecessor-trait', causeId: cause }], skills: { 'TESTINPUT:old-skill': 99 } },
  control: { ...grant, grantee: lord, scope: ['control-person', 'TESTINPUT:old-right'] },
  candidates: [retainerCharacter, specialistCharacter], services, relations,
};
const rules: SuccessionRules = { eligibleCandidates: [retainer, specialist], procedureApproved: true,
  ratifiedCandidate: retainer, transferableItemIds: ['TESTINPUT:property'],
  legitimacyByCandidate: { [retainer]: 7, [specialist]: 9 } };
const control: Grant = { ...grant, id: id('GrantId', 'TESTINPUT:new-control'), grantor: liege,
  grantee: retainer, basis: { kind: 'right', id: 'control-person:' + retainer, causeId: cause },
  scope: ['control-person'], assets: [], roster: [], budget: {}, subdelegation: false };

test('death opens candidate competition before a ratified fresh control grant transfers the person', () => {
  // Given
  const event = beginSuccessionContinuity(input, rules);
  // When
  const result = transferSuccessionControl(event, control, { rules, now: tick });
  // Then
  assert.equal(event.stage, 'candidates');
  assert.deepEqual(event.candidates.map(candidate => [candidate.person.id, candidate.legitimacy]), [[retainer, 7], [specialist, 9]]);
  assert.equal(result.controlledPerson.id, retainer);
  assert.equal(result.control.id, control.id);
  assert.equal(result.previousControl.state, 'revoked');
  assert.equal(input.control.state, 'valid');
});

test('successor retains own traits abilities skills and relations rather than predecessor values', () => {
  // Given
  const event = beginSuccessionContinuity(input, rules);
  // When
  const result = transferSuccessionControl(event, control, { rules, now: tick });
  // Then
  assert.deepEqual(result.controlledPerson, retainerCharacter);
  assert.notDeepEqual(result.controlledPerson.traits, input.predecessor.traits);
  assert.notDeepEqual(result.controlledPerson.skills, input.predecessor.skills);
  assert.notDeepEqual(result.controlledPerson.baseAbilities, input.predecessor.baseAbilities);
  assert.notDeepEqual(result.controlledPerson.finalAbilities, input.predecessor.finalAbilities);
  assert.deepEqual(result.competition.candidates[0]?.support.find(opinion => opinion.from === specialist)?.facts,
    [relations.facts[1]]);
});

test('predecessor trait inheritance fails the existing successor invariant', () => {
  // Given
  const inherited = { traits: input.predecessor.traits.map(trait => trait.name), skills: {}, relations: { facts: [], trust: [] } };
  // When / Then
  assert.throws(() => assertSuccessorStartsWithOwnRelations(retainerCharacter, inherited),
    (error: unknown) => error instanceof InvariantViolation && error.code === 'succession-person-copy');
});

test('property stays pending even when separate succession rules list transferable assets', () => {
  // Given
  const event = beginSuccessionContinuity(input, rules);
  // When
  const result = transferSuccessionControl(event, control, { rules, now: tick });
  // Then
  assert.deepEqual(result.property, { state: 'pending-rule', granted: [] });
  assert.deepEqual(result.control.assets, []);
  assert.deepEqual(result.control.roster, []);
  assert.deepEqual(result.control.budget, {});
});

test('missing succession rules or candidate legitimacy fail closed', () => {
  // Given
  const incomplete = { ...rules, legitimacyByCandidate: { [retainer]: 7 } };
  // When / Then
  assert.throws(() => beginSuccessionContinuity(input), MissingRuleInput);
  assert.throws(() => beginSuccessionContinuity(input, incomplete),
    (error: unknown) => error instanceof MissingRuleInput && error.ruleKey === 'SuccessionRules.legitimacyByCandidate.' + specialist);
});

test('support classification and unresolved predecessor bonds feed structural stability facts', () => {
  // Given / When
  const event = beginSuccessionContinuity(input, rules);
  // Then
  assert.equal(event.candidates[0]?.support.find(opinion => opinion.from === specialist)?.classification, 'friend');
  assert.equal(event.candidates[1]?.support.find(opinion => opinion.from === retainer)?.classification, 'rival');
  assert.equal(event.candidates[0]?.support.find(opinion => opinion.from === retainer)?.classification, null);
  assert.deepEqual(event.stability.facts, [relations.facts[0]]);
  assert.ok(event.stability.retainers.includes(specialist));
  assert.deepEqual(input.relations, relations);
});

test('departure produces deterministic competition and transfer without mutating inputs', () => {
  // Given
  const departure: ContinuityInput = { ...input, trigger: { kind: 'departure', causeId: cause }, predecessor: character };
  const before = JSON.stringify(departure);
  const first = transferSuccessionControl(beginSuccessionContinuity(departure, rules), control, { rules, now: tick });
  // When
  const second = transferSuccessionControl(beginSuccessionContinuity(departure, rules), control, { rules, now: tick });
  // Then
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(departure), before);
});

test('unratified candidates cannot receive control', () => {
  // Given
  const event = beginSuccessionContinuity(input, rules);
  // When / Then
  assert.throws(() => transferSuccessionControl(event, control,
    { rules: { ...rules, ratifiedCandidate: specialist }, now: tick }), InvariantViolation);
});

test('reused grants and copied predecessor rights are rejected', () => {
  // Given
  const event = beginSuccessionContinuity(input, rules);
  const invalid = [{ ...control, id: input.control.id }, { ...control, scope: input.control.scope },
    { ...control, assets: input.control.assets }, { ...control, roster: input.control.roster },
    { ...control, parentAuthorityId: input.control.id }];
  // When / Then
  for (const copied of invalid) assert.throws(() => transferSuccessionControl(event, copied, { rules, now: tick }), InvariantViolation);
});

test('living predecessor death and unavailable successors cannot open competition', () => {
  // Given
  const living = { ...input, predecessor: character };
  const unavailable = { ...input, candidates: [{ ...retainerCharacter, alive: false }] };
  // When / Then
  assert.throws(() => beginSuccessionContinuity(living, rules), InvariantViolation);
  assert.throws(() => beginSuccessionContinuity(unavailable, rules), InvariantViolation);
});
