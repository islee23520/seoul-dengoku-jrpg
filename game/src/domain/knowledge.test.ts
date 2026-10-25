import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvariantViolation } from './errors.ts';
import { receiveReport, assertCameraExposureGrantsNothing, assertUnreportedFactNotActionable, inheritDocument, assertDocumentInheritanceIsNotSkillCopy } from './knowledge.ts';
import type { PersonKnowledge } from './knowledge.ts';
import { preflightMandate } from './mandate.ts';
import { revokeGrant } from './authority.ts';
import { lord, retainer, cause, revision, tick, order, grant, retainerCharacter } from './fixtures/opening.ts';

const knowledge: PersonKnowledge = { personId: retainer, records: [], understanding: {}, practiceProgress: {}, skills: {}, qualifications: [] };
const fact = { id: 'TESTINPUT:fire', version: revision, content: 'TESTINPUT:fire-observed', causeId: cause };
const report = { id: 'TESTINPUT:report', fact, recipient: retainer, observedAt: tick, createdAt: tick, deliveredAt: tick, source: 'TESTINPUT:witness', omission: [], uncertainty: 'TESTINPUT:uncertain', causeId: cause };
test('T12-11 camera and world facts cannot create actionable knowledge', () => {
  // Given / When / Then
  assert.throws(() => assertCameraExposureGrantsNothing({ kind: 'camera', factId: fact.id }), InvariantViolation);
  assert.throws(() => assertUnreportedFactNotActionable(knowledge, fact), InvariantViolation);
  assert.deepEqual(knowledge.records, []);
  assert.throws(() => receiveReport(knowledge, { ...report, deliveredAt: null }, tick), InvariantViolation);
});
test('T12-11 delivered report enables knowledge exactly once but grants no authority', () => {
  // Given / When
  const informed = receiveReport(knowledge, report, tick);
  const repeated = receiveReport(informed, report, tick);
  // Then
  assert.equal(repeated, informed);
  assert.equal(informed.records.length, 1);
  assert.doesNotThrow(() => assertUnreportedFactNotActionable(informed, fact));
  const input = { now: tick, targetId: order.targetId, targetVersion: revision, recipient: retainerCharacter, authority: grant, routeDelivered: true, resourcesFeasible: true, procedureApproved: true };
  assert.doesNotThrow(() => preflightMandate(order, input));
  assert.throws(() => preflightMandate(order, { ...input, authority: revokeGrant(grant, cause) }), InvariantViolation);
});

test('changed truth remains unknown when an older observation arrives later', () => {
  const newer = { ...fact, version: fact.version + 1 as typeof fact.version, content: 'TESTINPUT:fire-extinguished' };
  const informed = receiveReport(knowledge, report, tick);
  assert.doesNotThrow(() => assertUnreportedFactNotActionable(informed, fact));
  assert.throws(() => assertUnreportedFactNotActionable(informed, newer), InvariantViolation);
  assert.equal(informed.records[0]?.version, fact.version);
});
test('T12-11 document handover transfers medium and read rights, not practice or skills', () => {
  // Given
  const document = { id: 'TESTINPUT:manual', content: 'TESTINPUT:manual', version: revision, source: 'TESTINPUT:source', authenticity: 'TESTINPUT:unverified', confidentiality: 'TESTINPUT:private', ownership: lord, readRights: [lord] };
  // When
  const inherited = inheritDocument(document, retainer);
  // Then
  assert.equal(inherited.ownership, retainer); assert.ok(inherited.readRights.includes(retainer));
  assert.doesNotThrow(() => assertDocumentInheritanceIsNotSkillCopy(knowledge, knowledge));
  assert.throws(() => assertDocumentInheritanceIsNotSkillCopy(knowledge, { ...knowledge, skills: { repair: 3 } }), InvariantViolation);
});
