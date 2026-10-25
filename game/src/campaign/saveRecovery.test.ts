import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0 } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { advanceCampaignCommands, submitCampaignCommand } from './application.ts';
import { integer } from '../domain/ids.ts';
import { createCampaignSave, parseCampaignSave, persistCampaignSave, loadCampaignSave, CAMPAIGN_SAVE_NAMESPACE } from './saveCheckpoint.ts';
import { CampaignSession } from './session.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { CheckpointCorrupt } from '../save/campaignCheckpoint.ts';
import { campaignWorkLedger } from './workResults.ts';
import { receiveCampaignReport } from './reports.ts';

const authority = composeCampaignAuthority(e0, { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: e0.revision }, content);
const issued = submitCampaignCommand(e0, { kind: 'issue', commandId: 'save-ledger', operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568',
  expectedRevision: e0.revision, expectedCompositeVersion: authority.compositeVersion }, content).state;
const midRoute = advanceCampaignCommands(issued, integer('WorldMilliseconds', 780000), content, true);

test('matches uninterrupted effects after a mid-route explicit save and repeated restore', () => {
  // Given the real production reducer carrying the original at 3/12 metres.
  const expected = advanceCampaignCommands(midRoute, integer('WorldMilliseconds', 1002000), content, true);
  const encoded = JSON.stringify(createCampaignSave(midRoute, content));
  let now = 900000;
  const session = new CampaignSession({ content, state: expected, now: () => now,
    advance: (state, until) => advanceCampaignCommands(state, until, content, true) });
  // When two loads rewind the later session and continuation reaches the same boundary.
  const saved = parseCampaignSave(JSON.parse(encoded), content);
  session.restore(saved.state); session.restore(saved.state);
  assert.deepEqual(session.state, midRoute);
  session.setSpeed(1); now += (1002000 - 780000) / 6; session.reconcile();
  const actual = session.state;
  // Then custody/report/event/result identities match the uninterrupted branch.
  assert.deepEqual(actual.custody, expected.custody);
  assert.deepEqual(actual.reports, expected.reports);
  assert.deepEqual(actual.commands.events, expected.commands.events);
  assert.deepEqual(actual.results, expected.results);
  assert.deepEqual(campaignWorkLedger(actual, content), campaignWorkLedger(expected, content));
  const report = actual.reports[0]; assert.ok(report);
  assert.deepEqual(receiveCampaignReport(actual, { reportId: report.id, recipient: report.recipient }, content), actual);
  session.close();
});

for (const kind of ['order', 'report', 'custody'] as const) test('rejects rehashed ' + kind + ' corruption with no half-applied session', () => {
  // Given a valid live state and an outer-checksum-consistent broken cross-link.
  const session = new CampaignSession({ content, state: e0, now: () => 0 });
  const saved = createCampaignSave(midRoute, content);
  let state = midRoute;
  switch (kind) {
    case 'order': state = { ...state, commands: { ...state.commands, receipts: [] } }; break;
    case 'report': state = { ...state, reports: state.reports.map(r => ({ ...r, recipient: r.source })) }; break;
    case 'custody': state = { ...state, custody: [] }; break;
    default: kind satisfies never;
  }
  const { checksum: _checksum, ...payload } = saved;
  const forged = { ...payload, state };
  // When complete validation happens before the host's commit point.
  assert.throws(() => session.restore(parseCampaignSave({ ...forged, checksum: summaryHash(forged) }, content).state), CheckpointCorrupt);
  // Then no world clock, origin or state replacement has occurred.
  assert.deepEqual(session.state, e0);
  session.close();
});

for (const kind of ['truncated', 'foreign', 'future', 'pointer'] as const) test('fails closed on stored ' + kind + ' input', () => {
  // Given an active current-edition checkpoint.
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const saved = createCampaignSave(e0, content);
  persistCampaignSave(storage, saved, content);
  const key = CAMPAIGN_SAVE_NAMESPACE + ':payload:' + saved.checksum;
  const bytes = values.get(key); assert.ok(bytes);
  switch (kind) {
    case 'truncated': values.set(key, bytes.slice(0, -2)); break;
    case 'foreign': values.set(key, bytes.replace(CAMPAIGN_SAVE_NAMESPACE, 'foreign-save')); break;
    case 'future': values.set(key, bytes.replace('"envelopeVersion":2', '"envelopeVersion":3')); break;
    case 'pointer': values.set(CAMPAIGN_SAVE_NAMESPACE + ':active', '{'); break;
    default: kind satisfies never;
  }
  const before = [...values];
  // When load rejects the corrupt/foreign input.
  assert.throws(() => loadCampaignSave(storage, content), CheckpointCorrupt);
  // Then recovery did not silently replace, delete or create a campaign.
  assert.deepEqual([...values], before);
});
