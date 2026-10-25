import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import { applyRelationFact, applyTrustDelta, classifyOpinion, constructExtraAffectionAxis, assertNoSymmetricCopy, assertSuccessorTrustNotInherited } from './relation.ts';
import { lord, retainer, cause } from './fixtures/opening.ts';

for (const [value, classification] of [[25,'friend'],[-25,'enemy'],[-50,'rival'],[24,'neutral'],[-24,'neutral'],[-49,'enemy']] as const) test('T12-07 classifies trust at ' + value, () => {
  // Given / When / Then
  assert.equal(classifyOpinion(value), classification);
});
test('T12-07 event fact changes no numeric trust without approved delta rules', () => {
  // Given
  const state = { trust: [{ from: lord, to: retainer, value: 25 }, { from: retainer, to: lord, value: -25 }], facts: [] };
  const fact = { from: lord, to: retainer, kind: 'service', causeId: cause } as const;
  // When
  const next = applyRelationFact(state, fact);
  // Then
  assert.equal(next.trust, state.trust); assert.deepEqual(next.facts, [fact]);
  assert.throws(() => applyTrustDelta(state, fact), MissingRuleInput);
  assert.doesNotThrow(() => assertNoSymmetricCopy(state, next, fact));
});
test('T12-07 injected delta affects only its direction and requires a cause', () => {
  // Given
  const state = { trust: [{ from: retainer, to: lord, value: -25 }], facts: [] };
  const fact = { from: lord, to: retainer, kind: 'service', causeId: cause } as const;
  // When
  const next = applyTrustDelta(state, fact, { deltas: { service: 3 } });
  // Then
  assert.deepEqual(next.trust, [...state.trust, { from: lord, to: retainer, value: 3 }]);
  assert.doesNotThrow(() => assertNoSymmetricCopy(state, next, fact));
  assert.throws(() => applyRelationFact(state, Object.assign({}, fact, { causeId: '' })), InvariantViolation);
  assert.throws(() => constructExtraAffectionAxis('fear'), MissingRuleInput);
  assert.throws(() => constructExtraAffectionAxis('loyalty'), MissingRuleInput);
  assert.throws(() => assertSuccessorTrustNotInherited(next.trust), InvariantViolation);
});
