import { test } from 'node:test';
import assert from 'node:assert/strict';
import { order, grant, retainerCharacter } from '../domain/fixtures/opening.ts';
import { integer } from '../domain/ids.ts';
import { executionSchema, mandateSchema, stepOrder } from './orderExecution.ts';
import type { Execution, ExecutionRules } from './orderExecution.ts';

function fixture(stage: Execution['mandate']['stage'], conflictPolicy: ExecutionRules['conflictPolicy'] = 'reject-conflict') {
  const mandate = { ...mandateSchema.unwrap().strip().parse(order), stage, issuedAt: 0, receivedAt: 1,
    acceptedAt: stage === 'held' ? null : 2, effectiveAt: 0, expiresAt: 1000 };
  const execution = executionSchema.parse({ mandate, serial: 0, journey: { path: [mandate.recipientLocation], leg: 0, elapsed: 0 },
    workPath: [mandate.recipientLocation], reportPath: [mandate.recipientLocation], workElapsed: 0, reservationKeys: ['body:one'] });
  const rules: ExecutionRules = { provenance: 'TESTINPUT', ruleVersion: 'counterexample', conflictPolicy,
    travelSteps: () => 1, workSteps: () => 1, acceptance: () => 'accept', admission: () => true, ready: () => null };
  return { execution, input: { now: 3, authority: { ...grant, effectiveAt: integer('WorldTick', 0), expiresAt: integer('WorldTick', 1000) },
    graph: { stations: [{ id: mandate.recipientLocation }], edges: [] }, cut: [], rules, occupied: [], deliveryReady: true } };
}
const ready: ExecutionRules['ready'] = mandate => ({ targetId: mandate.targetId, targetVersion: mandate.targetVersion,
  recipient: retainerCharacter, resourcesFeasible: true, procedureApproved: true });

for (const stage of ['held', 'consent', 'reserved', 'executing'] as const) test('reject-conflict terminates unavailable ' + stage + ' without implicit retry', () => {
  // Given the verifier's unavailable order, including restored held states.
  const { execution, input } = fixture(stage);
  // When availability changes only after an unavailable boundary.
  const rejected = stepOrder(execution, input);
  const retried = stepOrder(rejected, { ...input, now: 4, rules: { ...input.rules, ready } });
  // Then the same command cannot reserve, move or complete after that change.
  assert.equal(rejected.mandate.stage, 'refused');
  assert.equal(rejected.mandate.refusalReason, 'recipient-unavailable');
  assert.equal(retried, rejected);
  assert.deepEqual(retried.mandate.reservations, []);
  assert.equal(retried.workElapsed, execution.workElapsed);
});

test('reject-conflict refuses a consent order whose effective time has not arrived', () => {
  // Given a valid grant but an instruction not yet effective.
  const { execution, input } = fixture('consent');
  const pending = { ...execution, mandate: { ...execution.mandate, effectiveAt: integer('WorldTick', 4) } };
  // When the reservation boundary arrives early.
  const rejected = stepOrder(pending, { ...input, rules: { ...input.rules, ready } });
  // Then advancing time alone cannot activate a previously unavailable instruction.
  assert.equal(rejected.mandate.stage, 'refused');
  assert.equal(stepOrder(rejected, { ...input, now: 4, rules: { ...input.rules, ready } }), rejected);
});

for (const stage of ['held', 'consent', 'reserved', 'executing'] as const) test('explicit wait policy preserves generic ' + stage + ' behavior', () => {
  // Given an explicitly selected generic waiting contract.
  const { execution, input } = fixture(stage, 'wait-for-availability');
  // When readiness is unavailable.
  const next = stepOrder(execution, input);
  // Then only this contract retains its prior waiting/retry behavior.
  assert.equal(next.mandate.stage, stage === 'held' ? 'received' : stage);
});

test('a fresh command and independent acceptance can reserve after an unavailable command is refused', () => {
  // Given a newly admitted command with a different identity, not the rejected order.
  const { execution, input } = fixture('proposed');
  const fresh = executionSchema.parse({ ...execution, mandate: { ...execution.mandate, orderId: 'fresh-command', causeId: 'fresh-cause', receivedAt: null, acceptedAt: null } });
  // When the explicit new command follows delivery, receipt and acceptance.
  const readyInput = { ...input, rules: { ...input.rules, ready } };
  const reserved = Array.from({ length: 5 }).reduce<Execution>(state => stepOrder(state, readyInput), fresh);
  // Then reservation follows this command's own acceptance.
  assert.equal(reserved.mandate.stage, 'reserved');
  assert.equal(reserved.mandate.orderId, 'fresh-command');
  assert.equal(reserved.mandate.acceptedAt, input.now);
});
