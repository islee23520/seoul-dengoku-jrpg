import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects } from './testFixtures.ts';
import { submitCampaignCommand, advanceCampaignCommands } from './application.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { parseCampaignState } from './state.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './stateSchemas.ts';

function issue(operation: 'S01-L' | 'S01-O') {
  const basis = composeCampaignAuthority(e0, { operation, issuerPersonId: 'K002', recipientId: operation === 'S01-L' ? 'K568' : 'K616', expectedRevision: 0 }, content);
  return submitCampaignCommand(e0, { kind: 'issue', commandId: 'order', operation, issuerPersonId: 'K002',
    recipientId: basis.recipientId, expectedRevision: 0, expectedCompositeVersion: basis.compositeVersion }, content).state;
}
const advance = (state: CampaignState, at: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', at), content, true);

test('downstream work and delivered report results settle once after restore, not on every clock frame', () => {
  // Task 10 requires physical provenance, so use real effects instead of injected receipts.
  let state = advance(issue('S01-O'), 474000);
  const result = state.results.find(r => r.kind === 'work'); assert.ok(result);
  const request = { orderId: 'order', resultId: result.id, transition: 'work-completed' };
  state = acknowledgeCommandEffect(state, request, content);
  assert.equal(state.mandates[0]?.stage, 'result-applied');
  state = advance(state, 600000);
  const report = state.results.find(r => r.kind === 'report'); assert.ok(report);
  state = acknowledgeCommandEffect(state, { orderId: 'order', resultId: report.id, transition: 'report-received' }, content);
  assert.equal(state.mandates[0]?.stage, 'receipt');
  const restored = parseCampaignState(JSON.parse(JSON.stringify(state)), content);
  assert.deepEqual(acknowledgeCommandEffect(restored, request, content), state);
  assert.equal(advance(restored, 700000).commands.events.filter(e => e.kind === 'work-completed').length, 1);
  rejects(() => acknowledgeCommandEffect(restored, { ...request, transition: 'report-received' }, content), 'command-conflict');
});

test('ledger report leaves custody intact and starts an independently timed return response', () => {
  const state = advance(issue('S01-L'), 684000);
  assert.equal(state.mandates[0]?.returnAcceptedAt, null);
  assert.equal(state.custody[0]?.custodian, 'K002');
  assert.ok(state.reports.every(r => r.receivedAt === 684000));
  const pending = advance(state, 713999);
  assert.equal(pending.mandates[0]?.returnAcceptedAt, null);
  const accepted = advance(parseCampaignState(JSON.parse(JSON.stringify(pending)), content), 714000);
  assert.equal(accepted.mandates[0]?.returnAcceptedAt, 714000);
  assert.equal(accepted.custody[0]?.custodian, 'K002');
  assert.equal(accepted.custody[0]?.returnState, 'return-required');
  assert.equal(accepted.mandates[0]?.stage, 'result-applied');
});
