import test from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects } from '../src/campaign/testFixtures.ts';
import { submitCampaignCommand, advanceCampaignCommands } from '../src/campaign/application.ts';
import { parseCampaignState } from '../src/campaign/state.ts';
import { CampaignBoundaryError } from '../src/campaign/errors.ts';
import { integer } from '../src/domain/ids.ts';
import type { CampaignState } from '../src/campaign/stateSchemas.ts';
import {
  authorityNow, buildOrdersCatalog, cancellationDraft, issueDraft, orderRows, reasonText, stageText,
} from './campaignOrdersModel.ts';

function issue(state: CampaignState = e0, operation: 'S01-L' | 'S01-O' = 'S01-L', commandId = 'command:ui-ledger') {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = authorityNow(state, operation, content);
  assert.equal(basis.ok, true);
  if (!basis.ok) throw new Error('unreachable');
  const brief = buildOrdersCatalog(content).operations.find(o => o.id === operation)!;
  return issueDraft({ commandId, issuerPersonId: 'K002', brief, expectedRevision: state.revision, expectedCompositeVersion: basis.basis.compositeVersion });
}
const advance = (state: CampaignState, until: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', until), content);

test('roster shows the whole court with active/retired status and exactly the two named executors', () => {
  const catalog = buildOrdersCatalog(content);
  assert.equal(catalog.court.length, 13);
  assert.deepEqual([catalog.court.filter(r => r.status === 'active').length, catalog.court.filter(r => r.status === 'retired-current').length], [9, 4]);
  const eligible = catalog.court.filter(r => r.eligible);
  assert.deepEqual(eligible.map(r => [r.personId, r.operationId]), [['K568', 'S01-L'], ['K616', 'S01-O']]);
  // Every active non-named and retired member carries a readable unavailability reason, not silence.
  for (const row of catalog.court.filter(r => !r.eligible)) {
    assert.ok(row.reason && row.reason.length > 5, row.personId + ' needs a reason');
    assert.ok(!/[A-Za-z]{3}/.test(row.reason ?? ''), 'reason is player copy, not an engine code: ' + row.reason);
  }
  assert.equal(catalog.personalLiege?.name, '한재목');
  assert.equal(catalog.designator.name, '이서담');
  const ledger = catalog.operations.find(o => o.id === 'S01-L')!;
  assert.equal(ledger.original?.count, 1);
  assert.equal(ledger.original?.containerName, '원장 보관함 갑');
  assert.deepEqual(ledger.grants.map(g => g.grantId), ['grant:townhall-s01-reception-r1', 'grant:townhall-s01-archive-r1']);
  const inspect = catalog.operations.find(o => o.id === 'S01-O')!;
  assert.equal(inspect.observations.length, 2);
});

test('an unrelated or retired court member cannot be the recipient of any composed draft', () => {
  const retired = buildOrdersCatalog(content).court.find(r => r.status === 'retired-current')!;
  assert.throws(() => submitCampaignCommand(e0, { ...JSON.parse(JSON.stringify(issue())), recipientId: retired.personId } as object, content),
    (error: unknown) => error instanceof CampaignBoundaryError && (error.code === 'recipient-unavailable' || error.code === 'authority-source'));
  const activeOther = buildOrdersCatalog(content).court.find(r => r.status === 'active' && !r.eligible)!;
  assert.throws(() => submitCampaignCommand(e0, { ...JSON.parse(JSON.stringify(issue())), recipientId: activeOther.personId } as object, content),
    (error: unknown) => error instanceof CampaignBoundaryError && (error.code === 'recipient-unavailable' || error.code === 'authority-source'));
  assert.match(reasonText('recipient-unavailable'), /지정 수신자/);
});

test('one intent one immutable id: rapid retries and replays return one order, changed payload conflicts', () => {
  const command = issue();
  const first = submitCampaignCommand(e0, command, content);
  // The composer reuses the same commandId on a retry in the same frame; replay is idempotent.
  const retry = submitCampaignCommand(first.state, command, content);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.state.mandates.length, 1);
  rejects(() => submitCampaignCommand(first.state, { ...JSON.parse(JSON.stringify(command)), recipientId: 'K616' } as object, content), 'command-conflict');
});

test('stale composite grant version is refused before any reservation, with a readable reason', () => {
  const basis = authorityNow(e0, 'S01-L', content);
  assert.equal(basis.ok, true);
  if (!basis.ok) return;
  const brief = buildOrdersCatalog(content).operations.find(o => o.id === 'S01-L')!;
  const draft = issueDraft({ commandId: 'command:stale', issuerPersonId: 'K002', brief, expectedRevision: e0.revision,
    expectedCompositeVersion: basis.basis.compositeVersion });
  const issued = submitCampaignCommand(e0, draft, content).state;
  const orderId = issued.mandates[0]!.orderId;
  // A second order composed against the pre-issue composite version must not reserve anything.
  let code: string | null = null;
  try { submitCampaignCommand(issued, { ...JSON.parse(JSON.stringify(draft)), commandId: 'command:stale-2' } as object, content); }
  catch (error) { code = error instanceof CampaignBoundaryError ? error.code : null; }
  // Same revision is now stale (world moved) or the composite changed; either way no silent queue.
  assert.ok(code === 'stale-version' || code === 'rejected-conflict' || code === 'grant-version', 'expected typed refusal, got ' + code);
  assert.ok(issued.reservations.every(r => r.orderId === orderId), 'only the first order holds reservations');
  assert.equal(issued.reservations.length, 5);
  assert.ok(reasonText(code ?? '').length > 5);
});

test('order rows show delivery -> receipt -> acceptance as distinct states with not-yet nulls, not invented ticks', () => {
  let state = submitCampaignCommand(e0, issue(), content).state;
  const early = orderRows(lordView(state));
  assert.equal(early[0]?.stage, 'proposed');
  assert.equal(early[0]?.receivedAt, null);
  state = advance(state, 36000);
  const received = orderRows(lordView(state));
  assert.equal(received[0]?.stageLabel, '수신됨');
  assert.equal(received[0]?.receivedAt, '36');
  assert.equal(received[0]?.acceptedAt, null);
  assert.equal(received[0]?.terminal, false);
  state = advance(state, 66000);
  const executing = orderRows(lordView(state));
  assert.equal(executing[0]?.stageLabel, '집행 중');
  assert.equal(executing[0]?.acceptedAt, '66');
  assert.equal(stageText('cancelled'), '철회됨');
  assert.equal(stageText('interrupted'), '중단됨');
});

test('K616 observation order issues through the same boundary and conflict rejects readably', () => {
  const observation = issue(e0, 'S01-O', 'command:ui-observe');
  const state = submitCampaignCommand(e0, observation, content).state;
  assert.equal(state.mandates[0]?.recipientId, 'K616');
  assert.equal(state.mandates[0]?.operation, 'S01-O');
  // An incompatible K568 order over the same shared duty/people window is rejected, never queued.
  const ledgerDraft = issue(state, 'S01-L', 'command:ui-conflict');
  rejects(() => submitCampaignCommand(state, ledgerDraft, content), 'rejected-conflict');
  assert.match(reasonText('rejected-conflict'), /같은 시간/);
});

test('cancellation draft is a request, not a stage assignment', () => {
  const issued = submitCampaignCommand(e0, issue(), content).state;
  const orderId = issued.mandates[0]!.orderId;
  const request = cancellationDraft({ commandId: 'command:ui-cancel', issuerPersonId: 'K002', orderId, expectedRevision: issued.revision });
  const cancelled = submitCampaignCommand(issued, request, content).state;
  const order = cancelled.mandates.find(m => m.orderId === orderId)!;
  assert.notEqual(order.stage, 'cancelled', 'cancellation is delivered as a notice, not assigned');
  assert.equal(cancelled.commands.executions[0]?.cancellation !== null, true);
  const rows = orderRows(lordView(cancelled));
  assert.equal(rows[0]?.cancellationPending, true);
});

test('atomic composed issue works while the clock is running and replays one receipt', async () => {
  const { CampaignApplication } = await import('../src/campaign/application.ts');
  const app = new CampaignApplication({ content, state: e0, now: () => performance.now() });
  app.setSpeed(4);
  await new Promise(r => setTimeout(r, 30));
  const receipt = app.submitComposed({ kind: 'issue', commandId: 'command:atomic', issuerPersonId: 'K002', recipientId: 'K568', operation: 'S01-L' });
  assert.ok(receipt.orderId.length > 0);
  const state = app.checkpoint();
  assert.equal(state.mandates.length, 1);
  assert.equal(state.mandates[0]?.orderId, receipt.orderId);
  assert.equal(state.mandates[0]?.recipientId, 'K568');
  await new Promise(r => setTimeout(r, 30));
  const replay = app.submitComposed({ kind: 'issue', commandId: 'command:atomic', issuerPersonId: 'K002', recipientId: 'K568', operation: 'S01-L' });
  assert.deepEqual(replay, receipt);
  assert.equal(app.checkpoint().mandates.length, 1, 'rapid retries cannot mint two orders');  app.close();
});

test('lawful-unavailable reason text exists for every typed code and leaks no hidden values', () => {
  const codes = ['shape', 'content-hash', 'content-link', 'location-scope', 'person-scope', 'authority-source', 'grant-version', 'custody', 'inventory', 'cross-link', 'report-unreceived', 'report-link', 'clock', 'stale-version', 'inherited-option', 'duplicate-id', 'content-admission', 'effect-authority', 'authority-expired', 'authority-revoked', 'recipient-unavailable', 'rejected-conflict', 'body-unavailable', 'tool-unavailable', 'duty-unavailable', 'support-unavailable', 'action-scope', 'consent-required', 'command-conflict', 'event-order'] as const;
  for (const code of codes) assert.ok(reasonText(code).length > 3, code);
  assert.equal(reasonText('made-up'), '지금은 이 명령을 낼 수 없다.');
});

/** Same projection CampaignApplication.view() produces, computed directly for the pure reducer. */
function lordView(state: CampaignState) {
  const view = { orders: state.mandates.filter(m => m.issuerPersonId === 'K002').map(m => ({
    orderId: m.orderId, operation: m.operation, recipientId: m.recipientId,
    stage: m.stage === 'result-applied' && !state.knowledge.find(k => k.personId === 'K002')?.records.some(r =>
      state.reports.some(report => report.id === r.reportId && report.fact.orderId === m.orderId)) ? 'executing' : m.stage,
    receivedAt: m.receivedAt, acceptedAt: m.acceptedAt,
    cancellationPending: state.commands.executions.some(e => e.orderId === m.orderId && e.cancellation !== null && e.cancellation.receivedAt === null),
  })) };
  return view;
}
