import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0 } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { advanceCampaignCommands, submitCampaignCommand } from './application.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { requestS01Care, interruptS01Rest } from './s01Care.ts';
import { revokeS01ForwardRoute } from './s01Effects.ts';
import { s01Progress } from './s01Steps.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import { s01VisibleState } from './s01View.ts';

// Sequential timeline expectations are provisional: section2-route-r2-pending-ratification.

export function issuePhysical(state = e0, operation: 'S01-L' | 'S01-O' = 'S01-L') {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
  return submitCampaignCommand(state, { kind: 'issue', commandId: operation, issuerPersonId: 'K002', recipientId, operation,
    expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion }, content).state;
}
export const advancePhysical = (state: CampaignState, until: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', until), content, true);

test('appendix ledger round trip really executes custody, four rows, separate return and duty return', () => {
  let state = issuePhysical();
  for (const at of [66000, 96000, 132000, 192000, 264000, 324000, 624000, 684000, 714000, 774000, 798000, 858000, 870000, 906000, 966000, 990000, 1002000]) {
    state = advancePhysical(state, at);
  }
  assert.equal(state.clock.worldMilliseconds, 1002000);
  assert.equal(state.custody[0]?.returnState, 'resealed');
  assert.equal(state.custody[0]?.owner, e0.custody[0]?.owner);
  assert.equal(state.custody.length, 1);
  assert.equal(state.facts.length, 4);
  assert.equal(state.reports.length, 4);
  assert.ok(state.reports.every(r => r.receivedAt === 684000));
  assert.equal(state.mandates[0]?.returnAcceptedAt, 714000);
  assert.deepEqual(state.bodies.find(b => b.entityId === content.data.operations.authority.duty)?.location, e0.bodies.find(b => b.entityId === 'K002')?.location);
  assert.deepEqual(state.bodies.find(b => b.entityId === 'K568')?.regions.map(r => r.effortMilliseconds), [912000, 912000, 246000, 246000, 720000, 246000]);
  assert.equal(state.inventories.find(i => i.entityId === 'K568')?.consumedPaperSheets, 1);
  assert.equal(state.consumption.length, 0);
});

test('sequential observation follows the complete duty route before reading and reporting', () => {
  const ledger = advancePhysical(issuePhysical(), 1002000);
  const issued = issuePhysical(ledger, 'S01-O');
  const before = advancePhysical(issued, 1601999);
  assert.deepEqual(before.facts.filter(f => f.orderId === 'S01-O').map(f => f.observedAt), [1332000, 1476000]);
  assert.equal(before.reports.filter(r => r.fact.orderId === 'S01-O' && r.receivedAt !== null).length, 0);
  const complete = advancePhysical(before, 1602000);
  const reports = complete.reports.filter(r => r.fact.orderId === 'S01-O');
  assert.equal(reports.length, 2);
  assert.ok(reports.every(r => r.receivedAt === 1602000 && r.fact.evidence.kind === 'raw-observation' && r.fact.evidence.measurementValue === null));
  assert.equal(complete.mandates.find(m => m.operation === 'S01-O')?.stage, 'receipt');
});

test('the old endpoint is still threshold and cannot start the next duty assignment', () => {
  const early = advancePhysical(issuePhysical(), 990000);
  const duty = early.bodies.find(b => b.entityId === content.data.operations.authority.duty);
  assert.equal(duty?.location.kind === 'node' && duty.location.nodeId, 's01:townhall:threshold');
  assert.throws(() => issuePhysical(early, 'S01-O'), /duty-unavailable/);
  const arrived = advancePhysical(early, 1002000);
  assert.doesNotThrow(() => issuePhysical(arrived, 'S01-O'));
  assert.equal((1002000 - 966000) / 1000, content.data.operations.routes.edges.filter(e => ['s01:townhall:locker', 's01:townhall:archive', 's01:townhall:threshold'].includes(e.to)).reduce((sum, e) => sum + e.metres, 0));
});

test('revocation at 780 preserves 3m, notice takes until810 and consented retreat finishes816', () => {
  const before = advancePhysical(issuePhysical(), 780000);
  const original = before.custody[0];
  assert.equal(original?.location.kind === 'edge-progress' && original.location.travelledMillimetres, 3000);
  assert.deepEqual(before.bodies.find(b => b.entityId === 'K568')?.regions.map(r => r.effortMilliseconds), [816000, 816000, 198000, 198000, 660000, 198000]);
  const request = { id: 'cut:780', orderId: 'S01-L', issuer: content.data.operations.authority.issuer,
    grantId: content.data.operations.authority.mandates[0]!.grants[1], expectedRevision: before.revision, backwardRouteSafe: true, returnConsent: true };
  const cut = revokeS01ForwardRoute(before, request, content);
  assert.equal(cut.notices[0]?.receivedAt, null);
  const pending = advancePhysical(cut, 809999);
  assert.equal(pending.notices[0]?.receivedAt, null);
  const notice = advancePhysical(pending, 810000);
  assert.equal(notice.notices[0]?.receivedAt, 810000);
  const returned = advancePhysical(parseCampaignState(JSON.parse(JSON.stringify(notice)), content), 816000);
  assert.equal(returned.custody[0]?.custodian, 'K568');
  assert.equal(returned.custody[0]?.location.kind === 'node' && returned.custody[0].location.nodeId, 's01:townhall:desk');
  assert.equal(returned.custody[0]?.unresolvedReturn, true);
  assert.equal(returned.reports.length, 4);
  assert.ok(returned.reports.every(r => r.receivedAt === 684000));
  assert.deepEqual(advancePhysical(cut, 816000), returned);
  for (const change of [{ backwardRouteSafe: false }, { returnConsent: false }]) {
    const blocked = advancePhysical(revokeS01ForwardRoute(before, { ...request, ...change }, content), 816000);
    assert.deepEqual(blocked.custody[0]?.location, original?.location);
    assert.equal(blocked.notices[0]?.receivedAt, 810000);
  }
});

test('finite food and water complete independently, replay cannot refill or extend support', () => {
  let state = advancePhysical(e0, 3480000);
  for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':meal', entityId: body.entityId, kind: 'food', expectedRevision: state.revision, consent: true }, content);
  state = advancePhysical(state, 3540000);
  assert.ok(state.bodies.every(b => b.foodCoveredUntil === 5400000 && b.waterCoveredUntil === 3600000));
  assert.equal(state.inventories.reduce((sum, i) => sum + i.foodPacks, 0), 4);
  for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':water', entityId: body.entityId, kind: 'water', expectedRevision: state.revision, consent: true }, content);
  state = advancePhysical(state, 3600000);
  assert.equal(state.consumption.length, 8);
  assert.equal(state.inventories.reduce((sum, i) => sum + i.waterMl, 0), 0);
  assert.ok(state.bodies.every(b => b.foodCoveredUntil === 5400000 && b.waterCoveredUntil === 5400000));
  const replay = requestS01Care(state, { id: 'K568:meal', entityId: 'K568', kind: 'food', expectedRevision: 0, consent: true }, content);
  assert.deepEqual(replay, state);
  assert.throws(() => requestS01Care(state, { id: 'extra', entityId: 'K568', kind: 'food', expectedRevision: state.revision, consent: true }, content));
  const expired = advancePhysical(state, 5400001);
  assert.equal(expired.clock.worldMilliseconds, 5400001);
  assert.deepEqual(expired.inventories, state.inventories);
  assert.throws(() => requestS01Care(expired, { id: 'late-rest', entityId: 'K568', kind: 'rest', expectedRevision: expired.revision, consent: true }, content), /support-unavailable/);
  assert.throws(() => parseCampaignState({ ...expired, bodies: expired.bodies.map(b => ({ ...b, foodCoveredUntil: 9999999 })) }, content), /inventory/);
});

test('rest preserves elapsed recovery and effort rates use action-specific regions', () => {
  const tired = parseCampaignState({ ...e0, bodies: e0.bodies.map(b => b.entityId === 'K568' ? { ...b, regions: b.regions.map(r => ({ ...r, effortMilliseconds: 1800000 })) } : b) }, content);
  const resting = requestS01Care(tired, { id: 'rest', entityId: 'K568', kind: 'rest', expectedRevision: tired.revision, consent: true }, content);
  const partial = interruptS01Rest(advancePhysical(resting, 123000), 'rest', content);
  assert.ok(partial.bodies.find(b => b.entityId === 'K568')?.regions.every(r => r.effortMilliseconds === 1677000));
  const complete = advancePhysical(resting, 300000);
  assert.ok(complete.bodies.find(b => b.entityId === 'K568')?.regions.every(r => r.effortMilliseconds === 1500000));
  const step = { kind: 'walk' as const, from: 'a', to: 'b', duration: 12000, people: [{ id: 'K568', activity: 'carrying' as const }] };
  const result = s01Progress(step, { K568: [1194000, 0, 0, 0, 0, 0] }, Infinity, content);
  assert.equal(result.elapsed, 21000);
  assert.deepEqual(result.effort['K568'], [1236000, 42000, 42000, 42000, 0, 42000]);
});

test('restore rejects physical forks, skipped progress, wrong region effort and unearned observations', () => {
  const halfway = advancePhysical(issuePhysical(), 200000);
  for (const mutate of [
    (s: any) => s.custody.push(s.custody[0]),
    (s: any) => { s.s01.tracks[0].step++; },
    (s: any) => { s.s01.tracks[0].progress++; },
    (s: any) => { s.bodies.find((b: any) => b.entityId === 'K568').regions[4].effortMilliseconds++; },
    (s: any) => { s.results[0].physical.previousResultId = s.results[0].id; },
    (s: any) => { s.s01 = { tracks: [], activities: [], care: [] }; },
  ]) {
    const candidate = JSON.parse(JSON.stringify(halfway)); mutate(candidate);
    assert.throws(() => parseCampaignState(candidate, content));
  }
  const restored = parseCampaignState(JSON.parse(JSON.stringify(halfway)), content);
  assert.deepEqual(advancePhysical(restored, 1002000), advancePhysical(halfway, 1002000));
  const complete = advancePhysical(restored, 1002000), result = complete.results.find(r => r.kind === 'work')!;
  assert.deepEqual(acknowledgeCommandEffect(complete, { orderId: 'S01-L', resultId: result.id, transition: 'work-completed' }, content), complete);
  const observing = advancePhysical(issuePhysical(complete, 'S01-O'), 1212000);
  const noKit = parseCampaignState({ ...observing, tools: observing.tools.map(t => t.id === content.data.operations.provisions.writingKit ? { ...t, available: false } : t) }, content);
  const stopped = advancePhysical(noKit, 1602000);
  assert.equal(stopped.facts.filter(f => f.orderId === 'S01-O').length, 0);
  assert.equal(stopped.mandates.find(m => m.operation === 'S01-O')?.stage, 'interrupted');
});

test('care and physical incident ingress reject inherited names without state mutation', () => {
  const inherited = Object.assign(Object.create({ consent: true }), { id: 'rest', entityId: 'K568', kind: 'rest', expectedRevision: 0 });
  assert.throws(() => requestS01Care(e0, inherited, content), /inherited-option/);
  assert.throws(() => revokeS01ForwardRoute(e0, Object.create({ id: 'cut' }), content), /inherited-option/);
  assert.equal(e0.s01.tracks.length, 0);
});

test('comparison custody, separate return consent and replayed cancellation retain physical costs', () => {
  const before = advancePhysical(issuePhysical(), 324000);
  const candidate = JSON.parse(JSON.stringify(before));
  candidate.custody[0].custodian = 'K568';
  assert.throws(() => parseCampaignState(candidate, content), /custody/);
  const accepted = advancePhysical(before, 714000);
  assert.throws(() => parseCampaignState({ ...accepted, mandates: accepted.mandates.map(m => ({ ...m, returnAcceptedAt: null })) }, content));
  const partial = advancePhysical(before, 400000);
  const command = { kind: 'request-cancellation', commandId: 'cancel-partial', orderId: 'S01-L', issuerPersonId: 'K002', expectedRevision: partial.revision };
  const cancelled = submitCampaignCommand(partial, command, content).state;
  const after = advancePhysical(cancelled, 430000);
  assert.equal(after.facts.length, 1);
  assert.equal(after.inventories.find(i => i.entityId === 'K568')?.consumedPaperSheets, 1);
  assert.equal(after.custody[0]?.custodian, 'K002');
  assert.equal(after.commands.executions[0]?.cancellation?.receivedAt, 430000);
  assert.deepEqual(submitCampaignCommand(after, command, content).state, after);
});

test('local projection shows no field reading until actual receipt and finite boundaries never stop time', () => {
  const ledger = advancePhysical(issuePhysical(), 1002000);
  const pending = advancePhysical(issuePhysical(ledger, 'S01-O'), 1476000);
  const view = s01VisibleState(pending, 'K002', content);
  assert.equal(view.reports.length, 4);
  assert.equal(view.actors.some(b => b.entityId === 'K616'), false);
  assert.equal('facts' in view, false);
  const complete = advancePhysical(pending, 1602000);
  assert.equal(s01VisibleState(complete, 'K002', content).reports.length, 6);
  const close = advancePhysical(complete, 3600000);
  assert.equal(s01VisibleState(close, 'K002', content).closed, true);
  assert.equal(s01VisibleState(close, 'K002', content).actors.find(b => b.entityId === 'K568')?.food, 'uncovered');
  const expired = advancePhysical(close, 5400001);
  assert.equal(s01VisibleState(expired, 'K002', content).support, 'expired');
  assert.equal(expired.clock.worldMilliseconds, 5400001);
  assert.equal(expired.custody[0]?.returnState, 'resealed');
});

test('frame partition and restored activity receipts preserve exactly one physical effect', () => {
  const issued = issuePhysical();
  const whole = advancePhysical(issued, 1002000);
  let split = issued;
  for (const at of [1, 65999, 66000, 96001, 191999, 192000, 200001, 323999, 399001, 623999, 684001, 774001, 857999, 906001, 965999, 990001, 1002000]) {
    split = advancePhysical(parseCampaignState(JSON.parse(JSON.stringify(split)), content), at);
  }
  assert.deepEqual(split, whole);
  assert.equal(new Set(split.results.map(r => r.id)).size, split.results.length);
});
