import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects } from './testFixtures.ts';
import { CampaignApplication, advanceCampaignCommands, submitCampaignCommand } from './application.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { parseCampaignState } from './state.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './state.ts';
import { orderCausalEvents } from './commands.ts';
import { settleCampaignBoundary } from './scheduler.ts';
import { changedGrant, readyState, checkRequest } from './authorityFixtures.ts';
import { checkCampaignReadiness } from './authorityReadiness.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import { edit } from './guardFixtures.ts';

function issue(state: CampaignState = e0, operation: 'S01-L' | 'S01-O' = 'S01-L', commandId = 'command:ledger') {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
  return { kind: 'issue' as const, commandId, issuerPersonId: 'K002', recipientId, operation,
    expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion };
}
const advance = (state: CampaignState, until: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', until), content);

test('one immutable command returns its original receipt after progress and restore', () => {
  const command = issue();
  const first = submitCampaignCommand(e0, command, content);
  const progressed = advance(first.state, 66000);
  const restored = parseCampaignState(JSON.parse(JSON.stringify(progressed)), content);
  const replay = submitCampaignCommand(restored, command, content);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.deepEqual(replay.state, restored);
  assert.equal(replay.state.mandates.length, 1);
  rejects(() => submitCampaignCommand(restored, { ...command, recipientId: 'K616' }, content), 'command-conflict');
  assert.deepEqual(restored, progressed);
});

test('physical approach, delivery, response and reservation have distinct causal receipts without invented ticks', () => {
  let state = submitCampaignCommand(e0, issue(), content).state;
  state = advance(state, 3000);
  const body = state.bodies.find(b => b.entityId === 'K568');
  assert.equal(body?.location.kind, 'edge-progress');
  if (body?.location.kind === 'edge-progress') assert.equal(body.location.travelledMillimetres, 3000);
  assert.equal(state.mandates[0]?.receivedAt, null);
  state = advance(state, 36000);
  assert.equal(state.mandates[0]?.stage, 'received');
  assert.equal(state.mandates[0]?.receivedAt, 36000);
  assert.equal(state.mandates[0]?.acceptedAt, null);
  state = advance(state, 66000);
  assert.equal(state.mandates[0]?.stage, 'executing');
  assert.equal(state.mandates[0]?.acceptedAt, 66000);
  const events = state.commands.events;
  assert.deepEqual(events.filter(e => ['delivered', 'received', 'accepted', 'reserved', 'executing'].includes(e.kind)).map(e => [e.kind, e.at]),
    [['delivered', 36000], ['received', 36000], ['accepted', 66000], ['reserved', 66000], ['executing', 66000]]);
  assert.ok(events.every((e, i) => e.sequence === i + 1));
  assert.equal(state.results.length, 0, 'administrative progress is not completed work');
  assert.deepEqual(state.custody, e0.custody);
});

test('K616 must be physically summoned before command delivery and independent response', () => {
  let state = submitCampaignCommand(e0, issue(e0, 'S01-O'), content).state;
  state = advance(state, 30000);
  assert.equal(state.mandates[0]?.receivedAt, null);
  assert.equal(state.bodies.find(b => b.entityId === 'K616')?.location.kind, 'node');
  state = advance(state, 90000);
  assert.equal(state.mandates[0]?.receivedAt, null);
  state = advance(state, 150000);
  assert.equal(state.mandates[0]?.receivedAt, 120000);
  assert.equal(state.mandates[0]?.acceptedAt, 150000);
  assert.equal(state.mandates[0]?.stage, 'executing');
});

test('different frame partitions preserve exact event IDs, causes, sequence and physical progress', () => {
  const initial = submitCampaignCommand(e0, issue(), content).state;
  const whole = advance(initial, 66000);
  let split = initial;
  for (const at of [1, 2999, 3000, 5999, 6000, 6001, 35999, 36000, 36001, 65999, 66000]) split = advance(split, at);
  assert.deepEqual(split, whole);
  assert.deepEqual(advance(whole, 66000), whole);
  rejects(() => advance(whole, 65999), 'clock');
});

test('stale versions, forged scope and inherited options cannot mutate command ingress', () => {
  const command = issue();
  for (const input of [{ ...command, expectedRevision: 1 }, { ...command, expectedCompositeVersion: '0'.repeat(64) },
    { ...command, issuerPersonId: 'K001' }, { ...command, recipientId: 'K999' },
    Object.assign(Object.create({ confirmed: true }), command), { ...command, authority: [] }]) {
    assert.throws(() => submitCampaignCommand(e0, input, content));
  }
  assert.equal(e0.mandates.length, 0);
});

test('occupied resources reject without changing the accepted instruction or queueing retries', () => {
  const first = submitCampaignCommand(e0, issue(), content).state;
  rejects(() => submitCampaignCommand(first, issue(first, 'S01-L', 'second'), content), 'rejected-conflict');
  const after = advance(first, 66000);
  assert.equal(after.mandates.length, 1);
  assert.equal(after.mandates[0]?.stage, 'executing');
});

test('cancellation requests retain elapsed effort and cannot teleport or physically cancel immediately', () => {
  for (const at of [0, 3000, 6000, 36000, 66000]) {
    const state = advance(submitCampaignCommand(e0, issue(), content).state, at);
    const cancellation = { kind: 'request-cancellation', commandId: 'cancel:' + at, orderId: 'command:ledger',
      issuerPersonId: 'K002', expectedRevision: state.revision };
    const requested = submitCampaignCommand(state, cancellation, content);
    assert.deepEqual(requested.state.bodies, state.bodies);
    assert.deepEqual(requested.state.custody, state.custody);
    assert.notEqual(requested.state.mandates[0]?.stage, 'cancelled');
    assert.equal(requested.state.commands.executions[0]?.cancellation?.receivedAt, null);
    assert.deepEqual(submitCampaignCommand(requested.state, cancellation, content).receipt, requested.receipt);
  }
});

test('the application uses the existing session clock and readonly observer projection', () => {
  let now = 0;
  const app = new CampaignApplication({ content, state: e0, now: () => now });
  const command = issue(app.checkpoint());
  app.submit(command);
  app.setSpeed(1);
  now = 11000; app.reconcile();
  const view = app.view('K002');
  assert.equal(view.orders[0]?.stage, 'executing');
  assert.equal(view.worldMilliseconds, 66000);
  assert.equal('facts' in view, false);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.orders), true);
  assert.equal(app.view('K001').orders.length, 0);
  app.close();
  assert.throws(() => app.submit(command));
});

test('same-time arrival precedes reservation, work and consumption regardless of submission order', () => {
  const names: string[] = [];
  const event = (name: string, phase: 0 | 1 | 2 | 3 | 4 | 5, predecessorId: string | null) => ({
    id: name, at: 0, phase, predecessorId, acceptanceSequence: 1,
    apply: (state: CampaignState) => { names.push(name); return state; },
  });
  settleCampaignBoundary(e0, [event('consume', 4, 'work'), event('reserve', 2, 'arrive'),
    event('work', 3, 'reserve'), event('arrive', 1, 'revoke'), event('revoke', 0, null), event('save', 5, 'consume')], content);
  assert.deepEqual(names, ['revoke', 'arrive', 'reserve', 'work', 'consume', 'save']);
  rejects(() => settleCampaignBoundary(e0, [{ ...event('late', 1, null), at: 1 }], content), 'event-order');
});

test('causal event input rejects duplicates, unknown predecessors, backward phases and cycles', () => {
  const event = { id: 'arrival', at: 10, phase: 1, predecessorId: null, acceptanceSequence: 1 };
  rejects(() => orderCausalEvents([event, event], []), 'duplicate-id');
  rejects(() => orderCausalEvents([event], ['arrival']), 'duplicate-id');
  rejects(() => orderCausalEvents([{ ...event, predecessorId: 'unknown' }], []), 'event-order');
  rejects(() => orderCausalEvents([{ ...event, predecessorId: 'work' }, { ...event, id: 'work', phase: 3 }], []), 'event-order');
  rejects(() => orderCausalEvents([{ ...event, predecessorId: 'b' }, { ...event, id: 'b', predecessorId: 'arrival' }], []), 'event-order');
  const tied = orderCausalEvents([{ ...event, id: 'b' }, { ...event, id: 'a' }], []);
  assert.deepEqual(tied.map(e => e.id), ['a', 'b']);
});

test('revoked authority and failed independent readiness cannot acquire new work reservations', () => {
  const issued = submitCampaignCommand(e0, issue(), content).state;
  const delivered = advance(issued, 36000);
  const revoked = changedGrant(delivered, 'revoked');
  const rejected = advance(revoked, 66000);
  assert.equal(rejected.mandates[0]?.stage, 'refused');
  assert.equal(rejected.mandates[0]?.acceptedAt, null);
  assert.equal(rejected.reservations.length, 0);
  const exhausted = parseCampaignState({ ...delivered, bodies: delivered.bodies.map(b => b.entityId === 'K568' ? {
    ...b, regions: b.regions.map(r => r.region === 'head' ? { ...r, effortMilliseconds: 1800000 } : r),
  } : b) }, content);
  assert.equal(advance(exhausted, 66000).mandates[0]?.stage, 'refused');
  const declined = parseCampaignState({ ...delivered, commands: { ...delivered.commands,
    executions: delivered.commands.executions.map(e => ({ ...e, declineRequested: true })) } }, content);
  assert.equal(advance(declined, 66000).mandates[0]?.stage, 'refused');
});

test('physical cancellation notice takes thirty seconds after actual meeting and survives restore', () => {
  for (const at of [0, 3000, 6000, 36000, 66000]) {
    const before = advance(submitCampaignCommand(e0, issue(), content).state, at);
    const requested = submitCampaignCommand(before, { kind: 'request-cancellation', commandId: 'c', orderId: 'command:ledger',
      issuerPersonId: 'K002', expectedRevision: before.revision }, content).state;
    const expected = Math.max(at, 6000) + 30000;
    const pending = advance(requested, expected - 1);
    assert.equal(pending.commands.executions[0]?.cancellation?.receivedAt, null);
    const restored = parseCampaignState(JSON.parse(JSON.stringify(pending)), content);
    const completed = advance(restored, expected);
    assert.equal(completed.commands.executions[0]?.cancellation?.receivedAt, expected);
    assert.equal(completed.mandates[0]?.stage, at < 66000 ? 'cancelled' : 'interrupted');
    assert.deepEqual(completed, advance(requested, expected));
    assert.deepEqual(completed.custody, e0.custody);
  }
});

test('a restored command cannot skip response, forge delivery or duplicate an event', () => {
  const state = advance(submitCampaignCommand(e0, issue(), content).state, 66000);
  for (const corrupted of [edit(state, ['commands', 'executions', 0, 'step'], 0),
    edit(state, ['commands', 'events', 1, 'at'], 0), edit(state, ['commands', 'events', 2, 'predecessorId'], 'missing'),
    edit(state, ['commands', 'events', 2, 'id'], state.commands.events[1]?.id),
    edit(state, ['commands', 'events', 2, 'physical', 'durationMilliseconds'], 0),
    edit(state, ['mandates', 0, 'acceptedAt'], 36000)]) {
    assert.throws(() => parseCampaignState(corrupted, content));
  }
});

test('work, report and physical return cannot be completed by a client command or stage-only receipt', () => {
  const state = advance(submitCampaignCommand(e0, issue(), content).state, 66000);
  for (const transition of ['work-completed', 'report-received', 'return-completed']) {
    rejects(() => acknowledgeCommandEffect(state, { orderId: 'command:ledger', resultId: 'absent', transition }, content), 'cross-link');
    rejects(() => submitCampaignCommand(state, { kind: transition, commandId: 'forged', issuerPersonId: 'K002', expectedRevision: state.revision }, content), 'shape');
  }
});

test('tired contact rate changes at the threshold, independent of frame partitions', () => {
  const tired = parseCampaignState({ ...e0, bodies: e0.bodies.map(b => b.entityId === 'K568' ? {
    ...b, regions: b.regions.map(r => r.region === 'left-leg' ? { ...r, effortMilliseconds: 1197000 } : r),
  } : b) }, content);
  const initial = submitCampaignCommand(tired, issue(tired), content).state;
  const whole = advance(initial, 9000);
  let split = initial;
  for (const at of [1000, 2999, 3000, 3001, 6000, 8999, 9000]) split = advance(split, at);
  assert.deepEqual(split, whole);
  assert.equal(whole.commands.events.find(e => e.kind === 'arrival')?.at, 9000);
});

test('another issuer cannot cancel the lord mandate and missing tools cannot start contact', () => {
  const state = submitCampaignCommand(e0, issue(), content).state;
  rejects(() => submitCampaignCommand(state, { kind: 'request-cancellation', commandId: 'other', orderId: 'command:ledger',
    issuerPersonId: 'K001', expectedRevision: state.revision }, content), 'authority-source');
  const noKit = parseCampaignState({ ...e0, tools: e0.tools.map(t => ({ ...t, available: false })) }, content);
  rejects(() => submitCampaignCommand(noKit, issue(noKit), content), 'tool-unavailable');
});

test('a still-active mandate cannot be resubmitted after its first work reservation interval', () => {
  const state = advance(submitCampaignCommand(e0, issue(), content).state, 100000);
  rejects(() => submitCampaignCommand(state, issue(state, 'S01-L', 'again'), content), 'rejected-conflict');
});

test('a pending contact and independent execution preserve chronological events under frame partition', () => {
  const ledger = advance(submitCampaignCommand(e0, issue(), content).state, 100000);
  const both = submitCampaignCommand(ledger, issue(ledger, 'S01-O', 'observation'), content).state;
  const whole = advance(both, 250000);
  let split = both;
  for (const at of [100001, 111999, 112000, 130000, 160000, 190000, 220000, 249999, 250000]) split = advance(split, at);
  assert.deepEqual(split, whole);
  assert.equal(whole.mandates[1]?.acceptedAt, 250000);
});

test('same-time physical arrival is available to actual task seven reservation readiness', () => {
  const arrived = readyState();
  const before = parseCampaignState({ ...arrived, bodies: arrived.bodies.map(b => b.entityId === 'K568' ?
    { ...b, location: e0.bodies.find(p => p.entityId === 'K568')?.location } : b) }, content);
  let reservationChecked = false;
  const at = before.clock.worldMilliseconds;
  settleCampaignBoundary(before, [
    { id: 'reserve', at, phase: 2, predecessorId: 'arrival', acceptanceSequence: 1, apply: state => {
      const ready = checkCampaignReadiness(state, checkRequest(state), content);
      assert.ok(ready.resources.some(r => r.kind === 'body' && r.entityId === 'K568'));
      reservationChecked = true; return state;
    } },
    { id: 'arrival', at, phase: 1, predecessorId: null, acceptanceSequence: 1, apply: state => ({ ...state, bodies: arrived.bodies }) },
  ], content);
  assert.equal(reservationChecked, true);
  rejects(() => checkCampaignReadiness(before, checkRequest(before), content), 'location-scope');
});

test('expiry has an exact event timestamp rather than the next frame timestamp', () => {
  const start = advance(submitCampaignCommand(e0, issue(), content).state, 66000);
  const whole = advance(start, 3601000);
  const split = advance(advance(start, 3600000), 3601000);
  assert.deepEqual(whole, split);
  assert.equal(whole.commands.events.at(-1)?.at, 3600000);
  assert.equal(whole.commands.events.at(-1)?.reason, 'authority-expired');
});
