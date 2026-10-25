import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0, rejects } from './testFixtures.ts';
import { active, received, emptyOrder, reserved, revisionState, noticeState, disputeState, resultState, foodState, safeReturnState, ledgerOrder, edit } from './guardFixtures.ts';
import { parseCampaignState, readReceivedReport, receivedReports } from './state.ts';
import { nodeLocation } from './locations.ts';
import { id } from '../domain/ids.ts';
import type { CampaignErrorCode } from './errors.ts';

const cases: readonly [string, unknown, readonly (string | number)[], unknown, CampaignErrorCode][] = [
  ['shape', e0, ['schema'], 'other', 'shape'],
  ['duplicate person', e0, ['people', 0], e0.people[1], 'duplicate-id'],
  ['future close', e0, ['clock', 'closedAt'], 1, 'clock'],
  ['missing grant', e0, ['grants'], [], 'authority-source'],
  ['unknown grant', e0, ['grants', 0, 'id'], 'unknown', 'authority-source'],
  ['first revision', e0, ['grants', 0, 'revisions', 0, 'causeId'], 'not-e0', 'grant-version'],
  ['future revision', revisionState, ['grants', 0, 'revisions', 1, 'effectiveAt'], 2000000, 'clock'],
  ['revision chain', revisionState, ['grants', 0, 'revisions', 1, 'previousVersion'], '0'.repeat(64), 'grant-version'],
  ['order issuer', emptyOrder, ['mandates', 0, 'issuerPersonId'], 'K568', 'authority-source'],
  ['composite members', emptyOrder, ['mandates', 0, 'authority', 1], emptyOrder.mandates[0]?.authority[0], 'authority-source'],
  ['issue authority', emptyOrder, ['mandates', 0, 'authority', 0, 'version'], '0'.repeat(64), 'grant-version'],
  ['composite digest', emptyOrder, ['mandates', 0, 'compositeVersion'], '0'.repeat(64), 'grant-version'],
  ['issue after clock', emptyOrder, ['mandates', 0, 'issuedAt'], 2000000, 'clock'],
  ['receipt before issue', emptyOrder, ['mandates', 0, 'receivedAt'], 0, 'clock'],
  ['acceptance before receipt', emptyOrder, ['mandates', 0, 'acceptedAt'], 1, 'clock'],
  ['return consent for observation', emptyOrder, ['mandates', 0, 'returnAcceptedAt'], 1400000, 'clock'],
  ['execution without consent', emptyOrder, ['mandates', 0, 'acceptedAt'], null, 'cross-link'],
  ['target scope', emptyOrder, ['mandates', 0, 'target'], nodeLocation('s01:townhall:locker', content), 'location-scope'],
  ['disconnected route', emptyOrder, ['mandates', 0, 'route'], ['s01:townhall:desk', 's01:townhall:tap'], 'location-scope'],
  ['dangling reservation', emptyOrder, ['mandates', 0, 'reservationIds'], ['missing'], 'cross-link'],
  ['dangling order result', emptyOrder, ['mandates', 0, 'pendingResultIds'], ['missing'], 'cross-link'],
  ['missing body', e0, ['bodies'], [], 'person-scope'],
  ['missing region', e0, ['bodies', 0, 'regions'], [], 'cross-link'],
  ['invented coverage', e0, ['bodies', 0, 'foodCoveredUntil'], 123, 'inventory'],
  ['key transfer', e0, ['duty', 'keyHolder'], 'K568', 'custody'],
  ['custody owner', e0, ['custody', 0, 'owner'], 'K002', 'custody'],
  ['original in yard', e0, ['custody', 0, 'location'], nodeLocation('s01:townhall:yard', content), 'custody'],
  ['stored outside locker', e0, ['custody', 0, 'location'], nodeLocation('s01:townhall:desk', content), 'custody'],
  ['stored unsealed', e0, ['custody', 0, 'seal'], 'opened', 'custody'],
  ['missing inventory', e0, ['inventories'], [], 'inventory'],
  ['paper creation', e0, ['inventories', 1, 'paperSheets'], 2, 'inventory'],
  ['missing tools', e0, ['tools'], [], 'cross-link'],
  ['tool owner', e0, ['tools', 0, 'owner'], 'K002', 'cross-link'],
  ['reservation interval', reserved, ['reservations', 0, 'until'], 1, 'cross-link'],
  ['reservation body', reserved, ['reservations', 0, 'resource', 'entityId'], 'K999', 'cross-link'],
  ['reservation asset', reserved, ['reservations', 0, 'resource'], { kind: 'asset', assetId: 'unknown' }, 'cross-link'],
  ['notice revision', noticeState, ['notices', 0, 'version'], '0'.repeat(64), 'cross-link'],
  ['notice time', noticeState, ['notices', 0, 'receivedAt'], 1, 'clock'],
  ['dispute order', disputeState, ['disputes', 0, 'orderId'], 'unknown', 'cross-link'],
  ['result registry', resultState, ['appliedResultIds'], [], 'cross-link'],
  ['result before consent', resultState, ['results', 0, 'at'], 1, 'cross-link'],
  ['work with return payload', resultState, ['results', 0, 'safeReturn'], safeReturnState.results[1]?.safeReturn, 'cross-link'],
  ['report result without receipt', resultState, ['results', 0, 'kind'], 'report', 'report-link'],
  ['safe return wrong asset', safeReturnState, ['results', 1, 'safeReturn', 'assetId'], 'unknown', 'custody'],
  ['safe return without custody', safeReturnState, ['results', 1, 'safeReturn', 'priorCustodyResultId'], 'missing', 'custody'],
  ['safe return unsupported body', safeReturnState, ['results', 1, 'safeReturn', 'custodian'], 'K999', 'custody'],
  ['safe handover away from threshold', safeReturnState, ['results', 1, 'safeReturn', 'location'], nodeLocation('s01:townhall:desk', content), 'custody'],
  ['safe restock away from locker', safeReturnState, ['results', 1, 'safeReturn', 'action'], 'restock', 'custody'],
  ['consumption unknown body', foodState, ['consumption', 0, 'entityId'], 'K999', 'inventory'],
  ['consumption too short', foodState, ['consumption', 0, 'startedAt'], 1, 'inventory'],
  ['fact wrong order', active, ['facts', 0, 'orderId'], 'missing', 'report-link'],
  ['future observation', active, ['facts', 0, 'observedAt'], 2000000, 'clock'],
  ['reading node mismatch', active, ['facts', 0, 'evidence', 'nodeId'], 's01:townhall:cistern', 'report-link'],
  ['reading invented', active, ['facts', 0, 'evidence', 'rawText'], '25', 'report-link'],
  ['report source mismatch', active, ['reports', 0, 'source'], 'K568', 'report-link'],
  ['report without fact', active, ['facts'], [], 'report-link'],
  ['same version mismatch', active, ['reports', 0, 'fact', 'observedAt'], 1463000, 'report-link'],
  ['created before observation', active, ['reports', 0, 'createdAt'], 1, 'clock'],
  ['delivered before creation', active, ['reports', 0, 'deliveredAt'], 1, 'clock'],
  ['receipt before delivery', received, ['reports', 0, 'receivedAt'], 1, 'report-unreceived'],
  ['missing knowledge person', e0, ['knowledge'], [], 'person-scope'],
  ['knowledge fake person', e0, ['knowledge', 0, 'personId'], 'K999', 'person-scope'],
  ['knowledge wrong fact', received, ['knowledge', 1, 'records', 0, 'factId'], 'wrong', 'report-unreceived'],
];
for (const [name, state, path, value, code] of cases) test(`rejects ${name} when restoring a single corrupted field`, () => {
  // Given one independently corrupted field on a valid fixture.
  const candidate = edit(state, path, value);
  // When restoring the boundary. Then the named typed error must reject it.
  rejects(() => parseCampaignState(candidate, content), code);
});
test('rejects overlapping reservations without changing either existing order', () => {
  // Given two individually linked reservations for the same body.
  const candidate = { ...reserved, mandates: reserved.mandates.map(m => ({ ...m, reservationIds: ['reservation:1', 'reservation:2'] })),
    reservations: [...reserved.reservations, ...reserved.reservations.map(r => ({ ...r, id: 'reservation:2' }))] };
  // When restoring. Then the resource collision rejects.
  rejects(() => parseCampaignState(candidate, content), 'cross-link');
});
test('rejects received stage without receipt independently of acceptance', () => {
  // Given a received order with no later stage to mask the receipt check.
  const candidate = { ...emptyOrder, mandates: emptyOrder.mandates.map(m => ({ ...m, stage: 'received', receivedAt: null, acceptedAt: null })) };
  // When restoring. Then receipt is mandatory.
  rejects(() => parseCampaignState(candidate, content), 'cross-link');
});
test('rejects duplicate knowledge receipts', () => {
  // Given two copies of the same received record.
  const candidate = { ...received, knowledge: received.knowledge.map(k => ({ ...k, records: [...k.records, ...k.records] })) };
  // When restoring. Then multiplicity rejects before any read.
  rejects(() => parseCampaignState(candidate, content), 'report-unreceived');
});
test('rejects duplicate consumption receipts', () => {
  // Given duplicated physical consumption identity.
  const candidate = { ...foodState, consumption: [...foodState.consumption, ...foodState.consumption] };
  // When restoring. Then one ration cannot pay twice.
  rejects(() => parseCampaignState(candidate, content), 'duplicate-id');
});
test('rejects unknown inbox readers and inherited read requests', () => {
  // Given no knowledge owner or an inherited selector input.
  // When selecting the inbox. Then the boundary refuses both.
  rejects(() => receivedReports(e0, id('PersonId', 'unknown')), 'person-scope');
  rejects(() => readReceivedReport(received, Object.create({ personId: 'K002', reportId: 'report:observation' })), 'inherited-option');
});
test('keeps all parsed state subtrees frozen', () => {
  // Given an active received state with nested collections.
  const state = received;
  // When attempting writes at the state and report levels.
  assert.throws(() => Object.assign(state.clock, { speed: 4 }), TypeError);
  assert.throws(() => Object.assign(state.reports[0]?.fact ?? {}, { observedAt: 0 }), TypeError);
  // Then the receipt snapshot remains unchanged.
  assert.equal(state.reports[0]?.fact.observedAt, 1476000);
});
test('rejects a ledger comparison with an invented document row', () => {
  // Given valid ledger authority with a fabricated approved-row payload.
  const row = content.data.operations.evidence.ledgerRows[0]; assert.ok(row);
  const candidate = { ...ledgerOrder, facts: [{ id: 'comparison', version: 0, orderId: 'order:observation', sourcePersonId: 'K568', observedAt: 1464000,
    location: nodeLocation('s01:townhall:desk', content), causeId: 'compare', evidence: { kind: 'ledger-comparison', rows: [{ ...row, atSeconds: -301 }] } }] };
  // When restoring. Then row evidence is limited to the admitted appendix.
  rejects(() => parseCampaignState(candidate, content), 'report-link');
});
