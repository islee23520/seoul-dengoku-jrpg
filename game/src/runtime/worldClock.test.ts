import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from '../../../engine/node_modules/zod/index.js';
import { id, integer } from '../domain/ids.ts';
import { order, grant, retainerCharacter, cause, schemaVersion } from '../domain/fixtures/opening.ts';
import { revokeGrant } from '../domain/authority.ts';
import { applyResult } from '../domain/eventLedger.ts';
import { MissingRuleInput } from '../battle/realtime.ts';
import { RealtimeHost, runtimeSchema } from './realtimeHost.ts';
import type { HostRules } from './realtimeHost.ts';
import { checkpoint, restoreCheckpoint } from '../save/campaignCheckpoint.ts';
import { mandateSchema, executionSchema, admitOrder, edgeKey, travel, arrived } from './orderExecution.ts';
import type { Execution } from './orderExecution.ts';
import { stationSchema, roleContribution, stationEntry, transitionStation, approveSupply } from './stationState.ts';
import { restoreWorld, stepWorld, worldAdvance, bindWorldClock, worldAtBoundary } from './worldClock.ts';
import type { WorldRules, WorldState } from './worldClock.ts';

// TESTINPUT: one scheduler step per edge/work unit is synthetic, not a speed approval.
const graph = z.object({ stations: z.array(z.object({ id: z.string() })), edges: z.array(z.object({ a: z.string(), b: z.string() })), isolates: z.array(z.string()) })
  .parse(JSON.parse(readFileSync(new URL('../../data/world/graph.json', import.meta.url), 'utf8')));
const edge = graph.edges[0];
assert.ok(edge);
const source = id('StationId', edge.a), destination = id('StationId', edge.b);
const versions = { schemaVersion, ruleVersion: 'TESTINPUT:world', contentVersion: 'TESTINPUT:content' };
const checkpointVersions = { rulesHash: 'TESTINPUT:battle', contentHash: 'TESTINPUT:content', approvedInputsHash: 'TESTINPUT:approval' };
const authority = { ...grant, expiresAt: integer('WorldTick', 1000) };
function execution(suffix = 'one', personId = order.recipientId): Execution {
  return executionSchema.parse({ mandate: { ...mandateSchema.unwrap().strip().parse(order), orderId: id('OrderId', 'TESTINPUT:' + suffix), recipientId: personId,
    roster: [personId], expiresAt: authority.expiresAt, issuerLocation: source, recipientLocation: destination,
    physicalLocation: destination, communicationRoute: [source, destination], pendingResultIds: [id('ResultId', 'TESTINPUT:pending')] },
    serial: 0, journey: { path: [source, destination], leg: 0, elapsed: 0 },
    workPath: [destination], reportPath: [destination, source], workElapsed: 0, reservationKeys: [] });
}
function rules(): WorldRules {
  return { versions, graph, cut: [], authority: o => ({ ...authority, grantee: o.mandate.recipientId, roster: [o.mandate.recipientId] }), acceptSupply: () => true,
    execution: { provenance: 'TESTINPUT', ruleVersion: versions.ruleVersion, conflictPolicy: 'wait-for-availability', travelSteps: () => 1, workSteps: () => 2,
      acceptance: () => 'accept', admission: () => true,
      ready: o => ({ targetId: o.targetId, targetVersion: o.targetVersion, recipient: { ...retainerCharacter, id: o.recipientId }, resourcesFeasible: true, procedureApproved: true }) } };
}
function initial(orders: readonly Execution[] = [execution()]): WorldState {
  return { watermark: 0, ruleVersion: versions.ruleVersion, orders, receipts: [], ledger: { ...versions, entries: [], pendingResultIds: [] },
    stations: [stationSchema.parse({ id: destination, population: 0, supply: {}, infrastructure: {}, threat: [], controlFaction: null, roles: [], appliedResultIds: [] })], shipments: [] };
}
function advance(state: WorldState, until: number, inputs = rules()): WorldState {
  let next = state;
  for (let tick = state.watermark + 1; tick <= until; tick += 1) next = stepWorld(next, tick, inputs);
  return next;
}
function host(state: WorldState, inputs = rules()): RealtimeHost {
  const hostRules: HostRules = { intervalMs: 10, worldUnitsPerStep: 1, provenance: 'TESTINPUT', approvedInputsHash: checkpointVersions.approvedInputsHash,
    validateApproval: () => true, battle: { rulesHash: checkpointVersions.rulesHash, authorize: () => { throw new Error('TESTINPUT:unused'); },
      resolve: () => { throw new Error('TESTINPUT:unused'); } }, encounter: () => { throw new Error('TESTINPUT:unused'); }, advanceWorld: worldAdvance(inputs, 'TESTINPUT') };
  return new RealtimeHost({ state: runtimeSchema.parse({ worldTick: state.watermark, worldTime: state.watermark, clockCarry: 0,
    encounterAccumulator: 0, encounterSerial: 0, purposeRngStates: {}, battle: null,
    campaignState: { facts: { ...state }, settlementReceipts: [], ledgerCursor: 0 } }), rules: hostRules, mode: 'TESTINPUT', settle: s => s });
}

test('orders progress concurrently with deterministic receipts and same-step replay has no effect', () => {
  // Given two independent retainers under one host.
  const current = host(initial([execution(), execution('two', id('PersonId', 'TESTINPUT:second'))]));
  // When the existing scheduler receives continuous elapsed time.
  bindWorldClock(current).elapsed(100);
  const state = worldAtBoundary(current.state, rules());
  // Then both complete at identical causal boundaries, without duplicate effects.
  assert.deepEqual(state.orders.map(o => [o.mandate.stage, o.mandate.receivedAt, o.mandate.acceptedAt, o.mandate.reportDeliveredAt]), [['receipt', 3, 4, 9], ['receipt', 3, 4, 9]]);
  assert.equal(stepWorld(state, 10, rules()), state);
  assert.equal(new Set(state.receipts.map(r => r.resultId)).size, state.receipts.length);
  assert.deepEqual(state.receipts.filter(r => r.orderId === 'TESTINPUT:one').map(r => [r.tick, r.stage]), [[1, 'eligible'], [2, 'delivered'], [3, 'received'], [4, 'consent'], [5, 'reserved'], [6, 'executing'], [7, 'executing'], [8, 'result-applied'], [9, 'receipt']]);
});

test('shared physical labor is reserved once while separate supervision can proceed', () => {
  // Given two jobs for one porter and separate supervision.
  const state = initial([execution(), execution('competing'), execution('supervision', id('PersonId', 'TESTINPUT:supervisor'))]);
  // When readiness tries to reserve all jobs at the same boundary.
  const next = advance(state, 6);
  // Then the shared person is held while the independent supervisor executes.
  assert.deepEqual(next.orders.map(o => o.mandate.stage), ['executing', 'consent', 'executing']);
});

test('reject-conflict refuses the second request without retrying or replacing the first reservation', () => {
  // Given incompatible requests and an independently compatible job.
  const state = initial([execution(), execution('competing'), execution('supervision', id('PersonId', 'TESTINPUT:supervisor'))]);
  const base = rules();
  const inputs = { ...base, execution: { ...base.execution, conflictPolicy: 'reject-conflict' as const } };
  // When both requests reach the same reservation boundary and time continues.
  const next = advance(state, 12, inputs);
  // Then the loser remains refused rather than starting after the winner finishes.
  assert.deepEqual(next.orders.map(o => o.mandate.stage), ['receipt', 'refused', 'receipt']);
  assert.equal(next.orders[1]?.mandate.refusalReason, 'rejected-conflict');
  assert.deepEqual(next.orders[1]?.mandate.reservations, []);
  assert.equal(next.orders[0]?.mandate.acceptedAt, 4);
});

test('reject-conflict does not convert an unavailable response into automatic held retries', () => {
  // Given a recipient whose response is currently unavailable.
  const base = rules();
  const inputs: WorldRules = { ...base, execution: { ...base.execution, conflictPolicy: 'reject-conflict', acceptance: () => 'hold' } };
  // When the response boundary is reached and time continues.
  const next = advance(initial(), 12, inputs);
  // Then the instruction is refused without a reservation or a later retry.
  assert.equal(next.orders[0]?.mandate.stage, 'refused');
  assert.equal(next.orders[0]?.mandate.refusalReason, 'recipient-unavailable');
  assert.deepEqual(next.orders[0]?.mandate.reservations, []);
});

test('physical travel rechecks current body readiness before advancing', () => {
  // Given an executing retainer with a remaining physical leg.
  const base = rules(), current = advance(initial(), 6), first = current.orders[0]; assert.ok(first);
  const state = { ...current, orders: [{ ...first, journey: { path: [source, destination], leg: 0, elapsed: 0 } }] };
  const inputs: WorldRules = { ...base, execution: { ...base.execution,
    ready: o => ({ targetId: o.targetId, targetVersion: o.targetVersion, recipient: { ...retainerCharacter, captive: true }, resourcesFeasible: true, procedureApproved: true }) } };
  // When / Then the next physical effect rejects instead of moving first.
  assert.throws(() => stepWorld(state, 7, inputs), { code: 'recipient-unavailable' });
  assert.equal(state.orders[0]?.journey.leg, 0);
});

test('cut graph edge and all eight isolates cannot deliver an order or supply', () => {
  // Given the actual 409-edge graph and its original isolates.
  assert.equal(graph.edges.length, 409); assert.equal(graph.isolates.length, 8);
  const inputs = { ...rules(), cut: [edgeKey(source, destination)] };
  // When time advances along a cut route.
  const next = advance(initial(), 15, inputs);
  // Then no receipt or stock arrival is fabricated, including disconnected isolate routes.
  assert.equal(next.orders[0]?.mandate.receivedAt, null);
  assert.deepEqual(next.stations[0]?.supply, {});
  for (const isolate of graph.isolates) {
    const journey = { path: [source, id('StationId', isolate)], leg: 0, elapsed: 0 };
    assert.equal(arrived(travel(journey, { graph, cut: [], rules: inputs.execution })), false);
  }
});

test('supply becomes available only after traversal and approved intake and is never duplicated', () => {
  // Given an accepted carrying job and source-held cargo.
  const base = initial();
  const shipment = { id: 'TESTINPUT:cargo', orderId: execution().mandate.orderId, resource: 'TESTINPUT:food', quantity: 3,
    source, destination, custodian: order.recipientId, owner: 'TESTINPUT:institution', journey: { path: [source, destination], leg: 0, elapsed: 0 }, acceptedResultId: null };
  const state = { ...base, shipments: [shipment] };
  // When route traversal and intake happen after execution starts.
  const before = advance(state, 5), after = advance(before, 10);
  // Then a purchase alone grants nothing and one arrival grants exactly its quantity.
  assert.deepEqual(before.stations[0]?.supply, {});
  assert.equal(after.stations[0]?.supply['TESTINPUT:food'], 3);
  assert.equal(after.ledger.entries.filter(e => e.command === 'supply-arrival').length, 1);
  const cut = advance(state, 15, { ...rules(), cut: [edgeKey(source, destination)] });
  assert.equal(cut.shipments[0]?.acceptedResultId, null);
  assert.deepEqual(cut.stations[0]?.supply, {});
});

test('cut during carrying blocks intake and report without erasing cargo custody', () => {
  // Given an already executing job with a shipment traversing the actual graph.
  const state = advance(initial(), 6);
  const shipment = { id: 'TESTINPUT:cut-cargo', orderId: execution().mandate.orderId, resource: 'food', quantity: 3,
    source, destination, custodian: order.recipientId, owner: 'institution', journey: { path: [source, destination], leg: 0, elapsed: 0 }, acceptedResultId: null };
  // When the route is cut after acceptance.
  const next = advance({ ...state, shipments: [shipment] }, 15, { ...rules(), cut: [edgeKey(source, destination)] });
  // Then cargo remains undelivered and reporting cannot imply completion.
  assert.deepEqual(next.shipments[0], shipment);
  assert.equal(next.orders[0]?.mandate.reportDeliveredAt, null);
  assert.deepEqual(next.stations[0]?.supply, {});
});

test('revocation during carrying prevents new commits and preserves completed progress and custody', () => {
  // Given carried cargo and partially completed work.
  const state = advance(initial(), 7), first = state.orders[0]; assert.ok(first);
  const custody = [{ custodian: order.recipientId, lotId: id('LotId', 'TESTINPUT:lot'), asset: 'food', causeId: cause }];
  const carrying = { ...state, orders: [{ ...first, mandate: { ...first.mandate, custody } }] };
  // When authority is revoked before the next asset commitment.
  const next = advance(carrying, 9, { ...rules(), authority: () => revokeGrant(authority, cause) });
  // Then unused reservations release, physical state remains and no completion is forged.
  assert.equal(next.orders[0]?.mandate.stage, 'refused');
  assert.deepEqual(next.orders[0]?.mandate.custody, custody);
  assert.equal(next.orders[0]?.workElapsed, first.workElapsed);
  assert.deepEqual(next.orders[0]?.mandate.reservations, []);
  assert.equal(next.orders[0]?.mandate.reportDeliveredAt, null);
});

test('every causal boundary restores named fields and host generation without a second clock', () => {
  // Given one continuous host and checkpoints at every stage.
  const current = host(initial());
  for (let tick = 1; tick <= 10; tick += 1) {
    current.elapsed(10);
    const snapshot = checkpoint(current.state, { versions: checkpointVersions, engineProjection: null });
    const restored = host(initial()), stale = bindWorldClock(restored);
    // When a serialized checkpoint replaces the host boundary.
    restored.replace(restoreCheckpoint(JSON.parse(JSON.stringify(snapshot)), checkpointVersions).runtime);
    stale.elapsed(100);
    // Then all order, route, authority reference, pending/applied results and receipts survive exactly.
    assert.deepEqual(worldAtBoundary(restored.state, rules()), worldAtBoundary(current.state, rules()));
    assert.deepEqual(restored.state, current.state);
    const left = host(worldAtBoundary(current.state, rules()));
    left.elapsed(10); restored.elapsed(10);
    assert.deepEqual(restored.state, left.state);
  }
});

test('missing cadence, travel, acceptance, readiness, work and role rules fail closed', () => {
  // Given undecided numeric/decision inputs.
  const inputs = rules(), pending = execution();
  // When commands or execution require an absent rule, then no fallback budget or speed is invented.
  assert.throws(() => admitOrder([], pending, { ...inputs.execution, admission: null }), MissingRuleInput);
  assert.throws(() => travel(pending.journey, { graph, cut: [], rules: { ...inputs.execution, travelSteps: null } }), MissingRuleInput);
  for (const [tick, field] of [[4, 'acceptance'], [5, 'ready'], [7, 'workSteps']] as const) {
    const state = advance(initial(), tick - 1);
    assert.throws(() => stepWorld(state, tick, { ...inputs, execution: { ...inputs.execution, [field]: null } }), MissingRuleInput);
  }
  assert.throws(() => roleContribution({ role: 'supply', personId: order.recipientId, orderId: order.orderId }, { skill: 9, loyalty: 7, rules: null }), MissingRuleInput);
  assert.throws(() => worldAdvance(inputs, 'production')({ facts: { ...initial() }, settlementReceipts: [], ledgerCursor: 0 }, 1), MissingRuleInput);
});

test('station transitions require committed ResultIds and preserve exactly-once effects', () => {
  // Given a structural station change with an explicit ledger entry.
  const state = initial(), station = state.stations[0]; assert.ok(station);
  const resultId = id('ResultId', 'TESTINPUT:station-change');
  const next = { ...station, population: 4, appliedResultIds: [resultId] };
  const entry = stationEntry(station, next, { causeId: cause, command: 'TESTINPUT:population', actor: order.recipientId,
    worldTime: integer('WorldTick', 1), resultId, ruleVersion: versions.ruleVersion, contentVersion: versions.contentVersion });
  // When the committed result is applied and replayed.
  const ledger = applyResult(state.ledger, entry).ledger;
  const applied = transitionStation(station, next, { ledger, resultId });
  // Then replay is inert and absent or conflicting result proof fails.
  assert.equal(transitionStation(applied, applied, { ledger, resultId }), applied);
  assert.equal(applied.population, 4);
  assert.throws(() => transitionStation(station, next, { ledger: state.ledger, resultId }));
  assert.throws(() => transitionStation(station, { ...next, population: 5 }, { ledger, resultId }));
});

test('corrupt cursors and incompatible rules fail restoration rather than creating a new campaign', () => {
  // Given a valid in-flight boundary.
  const state = advance(initial(), 4);
  // When named checkpoint fields or versions are inconsistent, then restore rejects.
  assert.throws(() => restoreWorld({ ...state, ruleVersion: 'other' }, rules()));
  assert.throws(() => restoreWorld({ ...state, watermark: 0 }, rules()));
  assert.throws(() => restoreWorld({ ...state, orders: state.orders.map(o => ({ ...o, serial: 99 })) }, rules()));
  assert.throws(() => stepWorld(state, 6, rules()));
});

test('premature intake and unapproved arrival never create stock', () => {
  // Given a shipment that has not arrived at the destination.
  const station = initial().stations[0]; assert.ok(station);
  const shipment = { id: 'cargo', orderId: order.orderId, resource: 'food', quantity: 3, source, destination,
    custodian: order.recipientId, owner: 'institution', journey: { path: [source, destination], leg: 0, elapsed: 0 }, acceptedResultId: null };
  // When intake is requested before arrival or without an approved acceptance rule, then it rejects.
  assert.throws(() => approveSupply(station, shipment, { resultId: id('ResultId', 'arrival'), approve: () => true }));
  assert.throws(() => approveSupply(station, { ...shipment, journey: { ...shipment.journey, leg: 1 } }, { resultId: id('ResultId', 'arrival'), approve: null }), MissingRuleInput);
  assert.deepEqual(station.supply, {});
});
