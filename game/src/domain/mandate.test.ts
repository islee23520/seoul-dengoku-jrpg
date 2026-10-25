import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integer } from './ids.ts';
import { InvariantViolation, VersionMismatch } from './errors.ts';
import { advanceMandate, preflightMandate, receiveBattleSignal } from './mandate.ts';
import { revokeGrant } from './authority.ts';
import { applyResult, restoreLedger, summaryHash } from './eventLedger.ts';
import { order, grant, tick, cause, retainerCharacter, schemaVersion, retainer } from './fixtures/opening.ts';
import { id } from './ids.ts';

const context = { now: tick, authority: grant };
const preflight = { ...context, targetId: order.targetId, targetVersion: order.targetVersion, recipient: retainerCharacter, routeDelivered: true, resourcesFeasible: true, procedureApproved: true };
test('T12-03 delivered order cannot execute before receipt and acceptance', () => {
  // Given
  const delivered = { ...order, stage: 'delivered' } as const;
  // When / Then
  assert.throws(() => advanceMandate(delivered, 'executing', context), InvariantViolation);
  assert.throws(() => advanceMandate({ ...order, stage: 'reserved' }, 'executing', context), InvariantViolation);
});
test('T12-03 lifecycle records receipt and acceptance before execution', () => {
  // Given
  const stages = ['eligible', 'delivered', 'received', 'consent', 'reserved', 'executing', 'result-applied', 'receipt'] as const;
  // When
  const completed = stages.reduce((state, stage) => advanceMandate(state, stage, context), order);
  // Then
  assert.equal(completed.stage, 'receipt');
  assert.equal(completed.receivedAt, tick); assert.equal(completed.acceptedAt, tick);
});
test('T12-02 revoked-before-receipt refusal and grant revision survive ledger restore', () => {
  // Given
  const revoked = revokeGrant(grant, cause);
  const delivered = { ...order, stage: 'delivered' } as const;
  // When
  const refused = advanceMandate(delivered, 'received', { now: tick, authority: revoked });
  const versions = { schemaVersion, ruleVersion: 'TESTINPUT:rule', contentVersion: 'TESTINPUT:content' };
  const payload = { refusal: refused.refusalReason, grantRevision: revoked.version, stage: refused.stage };
  const result = applyResult({ ...versions, entries: [], pendingResultIds: [] }, { causeId: cause, command: 'TESTINPUT:deliver', worldTime: tick, actor: retainer, target: order.orderId, beforeHash: summaryHash(null), afterHash: summaryHash(payload), ...versions, resultId: id('ResultId', 'TESTINPUT:refusal'), payload });
  const loaded = restoreLedger(JSON.parse(JSON.stringify(result.ledger)), versions);
  // Then
  assert.equal(refused.stage, 'refused'); assert.equal(refused.receivedAt, null);
  assert.deepEqual(loaded.entries[0]?.payload, payload);
  assert.equal(grant.state, 'valid'); assert.equal(revoked.version, grant.version + 1);
});
test('preflight fails in SP b12 order rather than later feasibility checks', () => {
  // Given / When / Then
  assert.throws(() => preflightMandate(order, { ...preflight, targetVersion: integer('Revision', 9), recipient: { ...retainerCharacter, alive: false }, authority: revokeGrant(grant, cause), routeDelivered: false }), VersionMismatch);
  assert.throws(() => preflightMandate(order, { ...preflight, recipient: { ...retainerCharacter, captive: true }, authority: revokeGrant(grant, cause) }), { code: 'recipient-unavailable' });
  assert.throws(() => preflightMandate(order, { ...preflight, authority: revokeGrant(grant, cause), routeDelivered: false }), { code: 'mandate-authority-invalid' });
  assert.throws(() => preflightMandate(order, { ...preflight, routeDelivered: false, resourcesFeasible: false }), { code: 'delivery-unavailable' });
  assert.throws(() => preflightMandate(order, { ...preflight, resourcesFeasible: false, procedureApproved: false }), { code: 'resource-infeasible' });
  assert.throws(() => preflightMandate(order, { ...preflight, procedureApproved: false }), { code: 'procedure-unapproved' });
  assert.doesNotThrow(() => preflightMandate(order, preflight));
});
test('mandate expiry and interruption do not invent execution', () => {
  // Given / When
  const expired = advanceMandate(order, 'eligible', { now: grant.expiresAt, authority: grant });
  const interrupted = advanceMandate({ ...order, stage: 'executing', receivedAt: tick, acceptedAt: tick }, 'interrupted', context);
  // Then
  assert.equal(expired.stage, 'expired'); assert.equal(expired.receivedAt, null);
  assert.equal(interrupted.stage, 'interrupted');
});
test('battle immediate signal executes with command authority without generic consent', () => {
  // Given
  const battleOrder = { ...order, stage: 'eligible', titleOrOfficeOrCommandBasis: { ...order.titleOrOfficeOrCommandBasis, kind: 'command' } } as const;
  const signal = { battleId: 'TESTINPUT:battle', recipientBattleId: 'TESTINPUT:battle', commander: order.issuerPersonId, commandBasisId: battleOrder.titleOrOfficeOrCommandBasis.id, causeId: cause };
  const battleContext = { ...context, authority: { ...grant, basis: battleOrder.titleOrOfficeOrCommandBasis } };
  // When
  const received = receiveBattleSignal(battleOrder, signal, battleContext);
  const executing = advanceMandate(advanceMandate(received, 'reserved', battleContext), 'executing', battleContext);
  // Then
  assert.equal(executing.stage, 'executing');
  assert.equal(executing.receivedAt, tick); assert.equal(executing.acceptedAt, tick);
});
test('battle immediate signal rejects a command-labelled order backed by a right-only grant', () => {
  // Given
  const battleOrder = { ...order, stage: 'eligible', titleOrOfficeOrCommandBasis: { ...order.titleOrOfficeOrCommandBasis, kind: 'command' } } as const;
  const signal = { battleId: 'TESTINPUT:battle', recipientBattleId: 'TESTINPUT:battle', commander: order.issuerPersonId, commandBasisId: battleOrder.titleOrOfficeOrCommandBasis.id, causeId: cause };
  // When / Then
  assert.throws(() => receiveBattleSignal(battleOrder, signal, context), InvariantViolation);
});
test('battle immediate signal remains local and bound to its command grant', () => {
  // Given
  const battleOrder = { ...order, stage: 'eligible', titleOrOfficeOrCommandBasis: { ...order.titleOrOfficeOrCommandBasis, kind: 'command' } } as const;
  const signal = { battleId: 'TESTINPUT:battle', recipientBattleId: 'TESTINPUT:battle', commander: order.issuerPersonId, commandBasisId: battleOrder.titleOrOfficeOrCommandBasis.id, causeId: cause };
  const battleContext = { ...context, authority: { ...grant, basis: battleOrder.titleOrOfficeOrCommandBasis } };
  // When / Then
  assert.throws(() => receiveBattleSignal(battleOrder, { ...signal, recipientBattleId: 'TESTINPUT:remote' }, battleContext), InvariantViolation);
  assert.throws(() => receiveBattleSignal({ ...order, stage: 'eligible' }, signal, battleContext), InvariantViolation);
  assert.throws(() => receiveBattleSignal(battleOrder, signal, { ...battleContext, authority: { ...battleContext.authority, basis: { ...battleContext.authority.basis, id: 'TESTINPUT:other-command' } } }), InvariantViolation);
});
test('non-battle command orders still require receipt and acceptance', () => {
  // Given
  const commandBasis = { ...grant.basis, kind: 'command' } as const;
  const commandOrder = { ...order, titleOrOfficeOrCommandBasis: commandBasis, stage: 'reserved', receivedAt: tick } as const;
  const commandContext = { ...context, authority: { ...grant, basis: commandBasis } };
  // When / Then
  assert.throws(() => advanceMandate(commandOrder, 'executing', commandContext), InvariantViolation);
  assert.throws(() => advanceMandate({ ...commandOrder, receivedAt: null, acceptedAt: tick }, 'executing', commandContext), InvariantViolation);
});
test('terminal receipt cannot be resurrected by later revocation', () => {
  // Given / When / Then
  assert.throws(() => advanceMandate({ ...order, stage: 'receipt' }, 'received', { now: tick, authority: revokeGrant(grant, cause) }), InvariantViolation);
});
