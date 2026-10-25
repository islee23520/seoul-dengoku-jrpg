import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0, rejects } from './testFixtures.ts';
import { emptyOrder, active, received, foodState, safeReturnState, edit } from './guardFixtures.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { summaryHash } from '../domain/eventLedger.ts';

test('rejects fact-only reading mismatch without report equality masking it', () => {
  // Given an observation with no report snapshot yet.
  const candidate = { ...active, reports: [], facts: active.facts.map(f => ({ ...f, evidence: { ...f.evidence, rawText: '25' } })) };
  // When restoring. Then the approved raw reading is enforced independently.
  rejects(() => parseCampaignState(candidate, content), 'report-link');
});
test('rejects a fact-only location mismatch without a second snapshot', () => {
  // Given a valid tap reading placed at the cistern.
  const candidate = { ...active, reports: [], facts: active.facts.map(f => ({ ...f, location: nodeLocation('s01:townhall:cistern', content) })) };
  // When restoring. Then source node and physical observation site must agree.
  rejects(() => parseCampaignState(candidate, content), 'report-link');
});
test('rejects premature receipt even when its payload hash is consistent', () => {
  // Given an internally hashed but causally impossible formal receipt.
  const reports = received.reports.map(r => ({ ...r, receivedAt: 1 }));
  const report = reports[0]; assert.ok(report);
  const candidate = { ...received, reports, knowledge: received.knowledge.map(k => ({ ...k, records: k.records.map(r => ({ ...r, receivedAt: 1, payloadHash: summaryHash(report) })) })) };
  // When restoring. Then receipt timing is independently enforced.
  rejects(() => parseCampaignState(candidate, content), 'report-unreceived');
});
test('rejects an invented roster member with otherwise coherent knowledge', () => {
  // Given replacement rather than duplicate membership.
  const prior = e0.people[0]; assert.ok(prior);
  const candidate = { ...e0, people: e0.people.map(p => p.id === prior.id ? { id: 'K999' } : p), knowledge: e0.knowledge.map(k => k.personId === prior.id ? { ...k, personId: 'K999' } : k) };
  // When restoring. Then source membership, not merely cardinality, is required.
  rejects(() => parseCampaignState(candidate, content), 'person-scope');
});
test('rejects fabricated source versions even when the first revision agrees', () => {
  // Given a forged source version and matching initial history.
  const candidate = { ...e0, grants: e0.grants.map(g => ({ ...g, sourceVersion: '0'.repeat(64), revisions: g.revisions.map(r => ({ ...r, version: '0'.repeat(64) })) })) };
  // When restoring. Then source grant bytes are the actual version anchor.
  rejects(() => parseCampaignState(candidate, content), 'grant-version');
});
test('rejects stale at-issue authority with an internally valid composite hash', () => {
  // Given an order with a forged grant reference, no work effects to mask it.
  const mandates = emptyOrder.mandates.map(m => {
    const authority = m.authority.map(a => ({ ...a, version: '0'.repeat(64) }));
    return { ...m, authority, compositeVersion: summaryHash({ operation: m.operation, authority }) };
  });
  // When restoring. Then the actual history at issue must match.
  rejects(() => parseCampaignState({ ...emptyOrder, mandates }, content), 'grant-version');
});
test('rejects a future issue without later timestamps masking it', () => {
  // Given a proposed order with no receipt or acceptance.
  const candidate = { ...emptyOrder, mandates: emptyOrder.mandates.map(m => ({ ...m, stage: 'proposed', issuedAt: 2000000, receivedAt: null, acceptedAt: null })) };
  // When restoring. Then it cannot predate the current clock boundary.
  rejects(() => parseCampaignState(candidate, content), 'clock');
});
test('rejects original custody in the yard even with a colocated duty holder', () => {
  // Given duty legally in the yard but the original not authorized there.
  const location = nodeLocation('s01:townhall:yard', content);
  const candidate = { ...e0, bodies: e0.bodies.map(b => b.entityId === content.data.operations.authority.duty ? { ...b, location } : b),
    custody: e0.custody.map(c => ({ ...c, location, returnState: 'return-required', seal: 'opened' })) };
  // When restoring. Then original route scope is enforced independently of holder location.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects handover received by the carrier rather than duty', () => {
  // Given otherwise consistent carrier custody at the bench.
  const candidate = { ...e0, custody: e0.custody.map(c => ({ ...c, location: nodeLocation('s01:townhall:bench', content), custodian: 'K568', returnState: 'handover-received', seal: 'opened' })) };
  // When restoring. Then only duty can have received the return.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects safe-return protection outside the original route', () => {
  // Given a valid safe-return chain but a yard protection target.
  const candidate = edit(edit(safeReturnState, ['results', 1, 'safeReturn', 'action'], 'protect'), ['results', 1, 'safeReturn', 'location'], nodeLocation('s01:townhall:yard', content));
  // When restoring. Then the exception grants no new original movement scope.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects an unrelated forged consumption entity without altering valid stock', () => {
  // Given valid food accounting plus a receipt for no physical entity.
  const receipt = foodState.consumption[0]; assert.ok(receipt);
  const candidate = { ...foodState, consumption: [...foodState.consumption, { ...receipt, id: 'unknown-meal', entityId: 'K999' }] };
  // When restoring. Then orphan consumption cannot be admitted.
  rejects(() => parseCampaignState(candidate, content), 'inventory');
});
test('rejects overlapping meals and drinks despite conserved inventory', () => {
  // Given both finite items consumed in the same 60 seconds.
  const candidate = { ...foodState,
    bodies: foodState.bodies.map(b => b.entityId === 'K002' ? { ...b, waterCoveredUntil: 5400000 } : b),
    inventories: foodState.inventories.map(i => i.entityId === 'K002' ? { ...i, waterMl: 0, consumedWaterMl: 500 } : i),
    consumption: [...foodState.consumption, { id: 'drink:K002', entityId: 'K002', kind: 'water', startedAt: 0, completedAt: 60000, causeId: 'drink' }] };
  // When restoring. Then one body cannot perform both activities concurrently.
  rejects(() => parseCampaignState(candidate, content), 'inventory');
});
