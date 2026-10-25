import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects, reportedState } from './testFixtures.ts';
import { submitCampaignCommand, advanceCampaignCommands } from './application.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { id, integer } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';

function contact(operation: 'S01-L' | 'S01-O') {
  const basis = composeCampaignAuthority(e0, { operation, issuerPersonId: 'K002', recipientId: operation === 'S01-L' ? 'K568' : 'K616', expectedRevision: 0 }, content);
  const issued = submitCampaignCommand(e0, { kind: 'issue', commandId: 'order', operation, issuerPersonId: 'K002',
    recipientId: basis.recipientId, expectedRevision: 0, expectedCompositeVersion: basis.compositeVersion }, content).state;
  return advanceCampaignCommands(issued, integer('WorldMilliseconds', operation === 'S01-L' ? 66000 : 150000), content);
}

test('downstream work and delivered report results settle once after restore, not on every clock frame', () => {
  const initial = contact('S01-O');
  const source = reportedState(true), sourceFact = source.facts[0], sourceReport = source.reports[0];
  assert.ok(sourceFact && sourceReport);
  const fact = { ...sourceFact, orderId: id('OrderId', 'order'), observedAt: integer('WorldMilliseconds', 474000) };
  const work = { id: id('ResultId', 'work'), orderId: fact.orderId, causeId: fact.causeId, at: fact.observedAt,
    kind: 'work' as const, payloadHash: summaryHash(fact), physical: null, safeReturn: null };
  let state = parseCampaignState({ ...initial, clock: { ...initial.clock, worldMilliseconds: 474000 }, facts: [fact], results: [work], appliedResultIds: ['work'] }, content);
  const request = { orderId: 'order', resultId: 'work', transition: 'work-completed' };
  state = acknowledgeCommandEffect(state, request, content);
  assert.equal(state.mandates[0]?.stage, 'result-applied');
  const report = { ...sourceReport, fact, createdAt: fact.observedAt, deliveredAt: integer('WorldMilliseconds', 540000), receivedAt: integer('WorldMilliseconds', 600000) };
  state = parseCampaignState({ ...state, clock: { ...state.clock, worldMilliseconds: 600000 }, reports: [report],
    knowledge: state.knowledge.map(k => ({ ...k, records: k.personId === 'K002' ? [{ reportId: report.id, factId: fact.id, version: fact.version, receivedAt: report.receivedAt, payloadHash: summaryHash(report) }] : [] })),
    results: [...state.results, { ...work, id: 'report', kind: 'report', at: report.receivedAt, payloadHash: summaryHash(report) }], appliedResultIds: ['work', 'report'],
  }, content);
  state = acknowledgeCommandEffect(state, { orderId: 'order', resultId: 'report', transition: 'report-received' }, content);
  assert.equal(state.mandates[0]?.stage, 'receipt');
  const restored = parseCampaignState(JSON.parse(JSON.stringify(state)), content);
  assert.deepEqual(acknowledgeCommandEffect(restored, request, content), state);
  assert.equal(advanceCampaignCommands(restored, integer('WorldMilliseconds', 700000), content).commands.events.filter(e => e.kind === 'work-completed').length, 1);
  rejects(() => acknowledgeCommandEffect(restored, { ...request, transition: 'report-received' }, content), 'command-conflict');
});

test('ledger report leaves custody intact and starts an independently timed return response', () => {
  const initial = contact('S01-L'), order = initial.mandates[0], original = e0.custody[0];
  assert.ok(order && original);
  const desk = nodeLocation('s01:townhall:desk', content), locker = nodeLocation('s01:townhall:locker', content);
  const picked = { ...original, custodian: id('PersonId', 'K568'), seal: 'opened' as const, returnState: 'return-required' as const, causeId: id('CauseId', 'pickup') };
  const pickup = { previousResultId: null, before: original, after: picked, dutyAvailable: true,
    bodies: initial.bodies.filter(b => b.entityId === 'K568' || b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location: locker })) };
  const delivered = { ...picked, custodian: id('PersonId', 'K002'), location: desk, causeId: id('CauseId', 'deliver') };
  const delivery = { previousResultId: id('ResultId', 'pickup'), before: { ...picked, location: desk }, after: delivered, dutyAvailable: true,
    bodies: initial.bodies.filter(b => b.entityId === 'K568' || b.entityId === 'K002').map(b => ({ ...b, location: desk })) };
  const fact = { id: 'fact', version: 0, orderId: order.orderId, sourcePersonId: order.recipientId, observedAt: 624000,
    location: desk, causeId: 'compare', evidence: { kind: 'ledger-comparison', rows: content.data.operations.evidence.ledgerRows } };
  let state = parseCampaignState({ ...initial, clock: { ...initial.clock, worldMilliseconds: 624000 }, custody: [delivered], facts: [fact],
    results: [
      { id: 'pickup', orderId: order.orderId, causeId: 'pickup', at: 192000, kind: 'custody', payloadHash: summaryHash(pickup), physical: pickup, safeReturn: null },
      { id: 'deliver', orderId: order.orderId, causeId: 'deliver', at: 324000, kind: 'custody', payloadHash: summaryHash(delivery), physical: delivery, safeReturn: null },
      { id: 'work', orderId: order.orderId, causeId: 'compare', at: 624000, kind: 'work', payloadHash: summaryHash(fact), physical: null, safeReturn: null },
    ], appliedResultIds: ['pickup', 'deliver', 'work'],
  }, content);
  state = acknowledgeCommandEffect(state, { orderId: 'order', resultId: 'work', transition: 'work-completed' }, content);
  const report = { id: 'report', fact, recipient: 'K002', carrier: 'K568', source: 'K568', createdAt: 624000, deliveredAt: 624000,
    receivedAt: 684000, omission: ['missing-annex', 'unsigned-slot'], uncertainty: 'partial-evidence', causeId: 'compare' };
  state = parseCampaignState({ ...state, clock: { ...state.clock, worldMilliseconds: 684000 }, reports: [report],
    knowledge: state.knowledge.map(k => ({ ...k, records: k.personId === 'K002' ? [{ reportId: 'report', factId: 'fact', version: 0, receivedAt: 684000, payloadHash: summaryHash(report) }] : [] })),
    results: [...state.results, { id: 'report-result', orderId: order.orderId, causeId: 'report', at: 684000, kind: 'report', payloadHash: summaryHash(report), safeReturn: null }],
    appliedResultIds: [...state.appliedResultIds, 'report-result'],
  }, content);
  state = acknowledgeCommandEffect(state, { orderId: 'order', resultId: 'report-result', transition: 'report-received' }, content);
  assert.equal(state.mandates[0]?.returnAcceptedAt, null);
  assert.equal(state.custody[0]?.custodian, 'K002');
  const pending = advanceCampaignCommands(state, integer('WorldMilliseconds', 713999), content);
  assert.equal(pending.mandates[0]?.returnAcceptedAt, null);
  const accepted = advanceCampaignCommands(parseCampaignState(JSON.parse(JSON.stringify(pending)), content), integer('WorldMilliseconds', 714000), content);
  assert.equal(accepted.mandates[0]?.returnAcceptedAt, 714000);
  assert.equal(accepted.custody[0]?.custodian, 'K002');
  assert.equal(accepted.custody[0]?.returnState, 'return-required');
  assert.equal(accepted.mandates[0]?.stage, 'result-applied');
});
