import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCampaignSave, assertRestore } from '../../qa/campaign-assertions.mjs';
import { campaignOrigin } from '../../qa/campaign-origin.mjs';
import { content, e0 } from '../../../game/src/campaign/testFixtures.ts';
import { createCampaignSave } from '../../../game/src/campaign/saveCheckpoint.ts';
import { summaryHash } from '../../../game/src/domain/eventLedger.ts';
import { CampaignApplication } from '../../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../../game/src/campaign/authorityComposition.ts';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('completion assertion rejects a valid save with no completed investigation', () => {
  // Given a structurally valid admitted E0 checkpoint.
  const saved = createCampaignSave(e0, content);
  // When it is presented as a completed campaign.
  const verify = () => assertCampaignSave(saved, content, 'complete');
  // Then the runner fails rather than trusting a label or success marker.
  assert.throws(verify, assert.AssertionError);
});

test('completion assertion accepts physical sequential effects from the real application', () => {
  // Given the admitted application with a deterministic monotonic clock.
  let now = 0;
  const app = new CampaignApplication({ content, state: e0, now: () => now });
  try {
    app.submitComposed({ kind: 'issue', commandId: 'qa:ledger', issuerPersonId: 'K002', recipientId: 'K568', operation: 'S01-L' });
    app.setSpeed(4); now = 43000; app.reconcile(); app.setSpeed(0);
    app.submitComposed({ kind: 'issue', commandId: 'qa:observation', issuerPersonId: 'K002', recipientId: 'K616', operation: 'S01-O' });
    app.setSpeed(4); now = 70000; app.reconcile(); app.setSpeed(0);
    const saved = createCampaignSave(app.checkpoint(), content);
    // When the same assertions used by the browser runner inspect the checkpoint.
    const proof = assertCampaignSave(saved, content, 'complete');
    // Then all six received facts and two work outcomes are accepted.
    assert.equal(proof.reportIds.length, 6);
  } finally { app.close(); }
});

test('reload assertion rejects altered effect IDs even when time is unchanged', () => {
  // Given a saved boundary and a changed restored effect identity.
  const before = createCampaignSave(e0, content);
  const after = structuredClone(before); after.state.appliedResultIds.push('invented-effect');
  // When the runner compares the reload.
  const verify = () => assertRestore(before, after);
  // Then a time-only false positive is impossible.
  assert.throws(verify, assert.AssertionError);
});

test('boundary assertion rejects wrong custody even when the envelope is rehashed', () => {
  // Given a copied checkpoint with an invented original holder and a valid outer checksum.
  const saved = structuredClone(createCampaignSave(e0, content));
  saved.state.custody[0].custodian = 'K616';
  const { checksum: _checksum, ...payload } = saved;
  saved.checksum = summaryHash(payload);
  // When the runner parses that adversarial boundary.
  const verify = () => assertCampaignSave(saved, content, 'boundary');
  // Then the production custody proof fails, rather than accepting a rehashed lie.
  assert.throws(verify);
});

test('wrong-custody and stale command challenges preserve the live application', () => {
  const app = new CampaignApplication({ content, state: e0, now: () => 0 });
  try {
    const before = structuredClone(app.checkpoint());
    const forged = structuredClone(createCampaignSave(before, content));
    forged.state.custody[0].custodian = 'K616';
    const { checksum: _checksum, ...payload } = forged;
    forged.checksum = summaryHash(payload);
    assert.throws(() => assertCampaignSave(forged, content, 'boundary'));
    assert.deepEqual(app.checkpoint(), before);
    const basis = composeCampaignAuthority(before, { issuerPersonId: 'K002', recipientId: 'K568',
      operation: 'S01-L', expectedRevision: before.revision }, content);
    assert.throws(() => app.submit({ kind: 'issue', commandId: 'qa:stale', issuerPersonId: 'K002',
      recipientId: 'K568', operation: 'S01-L', expectedRevision: before.revision + 1,
      expectedCompositeVersion: basis.compositeVersion }), error => error.code === 'stale-version');
    assert.deepEqual(app.checkpoint(), before);
  } finally { app.close(); }
});

test('owned origin forwards bytes unchanged and isolates tampering on a second port', async () => {
  // Given an ephemeral upstream and two independently owned QA origins.
  const bytes = JSON.stringify({ clock: { worldSecondsPerRealSecond: 6 } });
  const upstream = createServer((_request, response) => response.end(bytes));
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const normal = await campaignOrigin(url), tampered = await campaignOrigin(url, { tamper: true });
  try {
    // When fetching the same pack path through each origin.
    const actual = await Promise.all([normal, tampered].map(async origin => (await fetch(origin.url + 'data/operations.json')).text()));
    // Then only the explicit adversarial origin alters the operational scalar.
    assert.equal(actual[0], bytes);
    assert.equal(JSON.parse(actual[1]).clock.worldSecondsPerRealSecond, 7);
    assert.notEqual(normal.url, tampered.url);
  } finally {
    await normal.close(); await tampered.close();
    const closed = once(upstream, 'close'); upstream.close(); upstream.closeAllConnections(); await closed;
  }
});
