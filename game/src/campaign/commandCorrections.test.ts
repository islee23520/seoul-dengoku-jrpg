import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects } from './testFixtures.ts';
import { submitCampaignCommand as submit, advanceCampaignCommands } from './application.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { parseCampaignState as parse } from './state.ts';
import { settleCampaignBoundary as settle } from './scheduler.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './state.ts';
import { edit } from './guardFixtures.ts';

function issue(state = e0, operation: 'S01-L' | 'S01-O' = 'S01-L', commandId = 'ledger') {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
  return { kind: 'issue', commandId, operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion };
}
const advance = (state: CampaignState, at: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', at), content);
const start = () => submit(e0, issue(), content).state;
const cancellation = (state: CampaignState) => ({ kind: 'request-cancellation', commandId: 'cancel', orderId: 'ledger', issuerPersonId: 'K002', expectedRevision: state.revision });

test('F1 cancellation rejects occupied notice participants without double effort or retry', () => {
  let state = advance(start(), 100000);
  state = submit(state, issue(state, 'S01-O', 'observation'), content).state;
  state = advance(state, 200000);
  rejects(() => submit(state, cancellation(state), content), 'rejected-conflict');
  const head = (s: CampaignState) => s.bodies.find(b => b.entityId === 'K002')?.regions.find(r => r.region === 'head')?.effortMilliseconds ?? 0;
  const after = advance(state, 210000);
  assert.equal(head(after) - head(state), 10000);
  assert.equal(after.commands.executions[0]?.cancellation, null);
});

test('F1 an accepted notice reserves both bodies and excludes a later incompatible contact', () => {
  const before = advance(start(), 101111);
  const requested = submit(before, cancellation(before), content).state;
  for (const person of ['K002', 'K568']) assert.ok(requested.reservations.some(r => r.orderId === 'ledger' && r.resource.kind === 'body' &&
    r.resource.entityId === person && r.from <= 101111 && r.until >= 131111));
  rejects(() => submit(requested, issue(requested, 'S01-O', 'observation'), content), 'rejected-conflict');
  const mid = advance(requested, 117123);
  const done = advance(parse(JSON.parse(JSON.stringify(mid)), content), 131111);
  assert.equal(done.commands.executions[0]?.cancellation?.receivedAt, 131111);
  assert.deepEqual(done, advance(requested, 131111));
});

test('F2 physical handler identity survives checkpoint restore and prevents double application', () => {
  const event = { id: 'physical-segment:1', at: 0, phase: 0 as const, predecessorId: null, acceptanceSequence: 0,
    apply: (state: CampaignState): CampaignState => ({ ...state, bodies: state.bodies.map(b => b.entityId === 'K568' ? {
      ...b, regions: b.regions.map(r => r.region === 'head' ? { ...r, effortMilliseconds: r.effortMilliseconds + 1000 } : r),
    } : b) }) };
  const once = settle(e0, [event], content);
  assert.deepEqual(settle(once, [event], content), once);
  const restored = parse(JSON.parse(JSON.stringify(once)), content);
  assert.deepEqual(settle(restored, [event], content), once);
  rejects(() => settle(restored, [{ ...event, phase: 1 }], content), 'command-conflict');
  const later = parse({ ...restored, clock: { ...restored.clock, worldMilliseconds: 1000 } }, content);
  assert.deepEqual(settle(later, [event], content), later);
});

test('F3 missing executions, receipts and stripped journals reject rather than lose replay or expiry', () => {
  const state = advance(start(), 66000);
  for (const [field, value] of [['executions', []], ['receipts', []], ['events', []]] as const) {
    assert.throws(() => parse(edit(state, ['commands', field], value), content));
  }
  const { commands: _commands, ...stripped } = state;
  assert.throws(() => parse(stripped, content));
  assert.throws(() => parse({ ...state, commands: e0.commands }, content));
  assert.throws(() => parse(edit(state, ['mandates', 0, 'origin'], undefined), content));
  assert.throws(() => parse({ ...state, clock: { ...state.clock, worldMilliseconds: 4000000 } }, content));
  const restored = parse(JSON.parse(JSON.stringify(state)), content);
  assert.deepEqual(submit(restored, issue(), content).receipt, submit(e0, issue(), content).receipt);
  assert.equal(advance(restored, 4000000).mandates[0]?.stage, 'interrupted');
});

test('F4 restored cancellation notice cannot be instantaneous', () => {
  const before = advance(start(), 6000);
  const state = advance(submit(before, cancellation(before), content).state, 36000);
  const forged = { ...state, commands: { ...state.commands,
    events: state.commands.events.map(e => ['notice-received', 'cancelled'].includes(e.kind) ? { ...e, at: 6000 } : e),
    executions: state.commands.executions.map(e => ({ ...e, cancellation: e.cancellation ? { ...e.cancellation, receivedAt: 6000 } : null })),
  } };
  assert.throws(() => parse(forged, content));
  const noticeIndex = state.commands.events.findIndex(e => e.kind === 'notice-received');
  assert.throws(() => parse(edit(state, ['commands', 'events', noticeIndex, 'physical'], null), content));
  assert.throws(() => parse(edit(state, ['commands', 'events', noticeIndex, 'physical', 'participants'], ['K568']), content));
});

test('F4 restored delivery cannot overlap physical approach', () => {
  const state = advance(start(), 66000);
  const forged = { ...state, mandates: state.mandates.map(m => ({ ...m, receivedAt: 30000, acceptedAt: 60000 })), commands: { ...state.commands,
    events: state.commands.events.map(e => ({ ...e,
      at: ['delivered', 'received'].includes(e.kind) ? 30000 : ['accepted', 'reserved', 'executing'].includes(e.kind) ? 60000 : e.at,
      physical: e.physical === null ? null : e.kind === 'delivered' ? { ...e.physical, startedAt: 0, completedAt: 30000 } :
        e.kind === 'accepted' ? { ...e.physical, startedAt: 30000, completedAt: 60000 } : e.physical,
    })),
  } };
  assert.throws(() => parse(forged, content));
});
