import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignContent, assertAdmittedContent } from './content.ts';
import { createCampaignE0, parseCampaignState, readReceivedReport } from './state.ts';
import { content, e0, packages, rejects, reportedState } from './testFixtures.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { integer, id } from '../domain/ids.ts';
import type { CampaignState } from './state.ts';

for (const forged of [{ data: content.data, hashes: content.hashes }, Object.create(CampaignContent.prototype)]) test('rejects a hand-built admission capability', () => {
  // Given a structural or prototype impersonation, not a parser-created identity.
  // When checking the boundary capability.
  // Then both nominal-looking objects reject without reading their data.
  rejects(() => assertAdmittedContent(forged), 'content-admission');
  rejects(() => Reflect.apply(createCampaignE0, null, [forged]), 'content-admission');
  rejects(() => Reflect.apply(parseCampaignState, null, [e0, forged]), 'content-admission');
});
test('rejects direct constructor invocation without the private admission token', () => {
  // Given authentic data but no parser capability.
  // When JavaScript bypasses the private TypeScript constructor.
  // Then the runtime token remains mandatory.
  rejects(() => Reflect.construct(CampaignContent, [content.data, Symbol('forged')]), 'content-admission');
});
test('keeps anchors and nested operational tables immutable', () => {
  // Given admitted content, including nested arrays not independently frozen by object schemas.
  const before = content.hashes.operations;
  // When external callers try to rewrite approval anchors or finite inputs.
  assert.throws(() => Object.assign(content.hashes, { operations: '0'.repeat(64) }), TypeError);
  assert.throws(() => Object.assign(content.data.atlas.source, { manifestSha256: '0'.repeat(64) }), TypeError);
  // Then the parser still authenticates only the actual approved bytes.
  assert.equal(content.hashes.operations, before);
  rejects(() => CampaignContent.parse({ ...packages, operations: packages.operations.replace('ration-community', 'forged-issuer') }), 'content-hash');
});
test('preserves every execution group when the admitted operation pack is projected', () => {
  // Given the machine-consumed production input, independent of projected output.
  const source = JSON.parse(packages.operations);
  // When reading the typed execution inputs for downstream tasks.
  const actual = content.data.operations;
  // Then no approved execution group is discarded.
  for (const group of ['clock', 'durations', 'routes', 'authority', 'provisions', 'body', 'evidence', 'ordering', 'responses', 'closedScopes'] as const) assert.deepEqual(actual[group], source[group]);
});
test('rejects older received-payload tampering after current facts advance', () => {
  // Given a serialized received report and a newer world version.
  const state = reportedState(true);
  const candidate = { ...state, facts: state.facts.map(f => ({ ...f, version: 1 })), reports: state.reports.map(r => ({ ...r, fact: { ...r.fact, observedAt: 1463000 } })) };
  // When restoring with the original knowledge receipt.
  // Then the receipt digest rejects the changed historical snapshot.
  rejects(() => parseCampaignState(candidate, content), 'report-link');
});
test('renders approved readings using only a received report', () => {
  // Given a legitimately received production-backed raw observation.
  const state = reportedState(true);
  // When a report-only consumer reads its snapshot.
  const report = readReceivedReport(state, { personId: 'K002', reportId: 'report:observation' });
  // Then it has the admitted reading without a world lookup.
  const source = content.data.operations.evidence.observations.find(r => r.siteId === 's01:townhall:tap');
  assert.ok(source);
  assert.equal(report.fact.evidence.kind, 'raw-observation');
  if (report.fact.evidence.kind === 'raw-observation') assert.equal(report.fact.evidence.rawText, source.rawText);
});
export function revoked(state: CampaignState, at: number): CampaignState['grants'] {
  return state.grants.map(g => {
    const event = { previousVersion: g.sourceVersion, state: 'revoked' as const, effectiveAt: integer('WorldMilliseconds', at), causeId: id('CauseId', 'revoke'), issuer: content.data.operations.authority.issuer };
    return { ...g, revisions: [...g.revisions, { ...event, version: summaryHash({ grantId: g.id, ...event }) }] };
  });
}
test('rejects observations completed after a legal revocation', () => {
  // Given an old valid order, but authority revoked before its observation.
  const state = reportedState(true);
  // When the checkpoint includes post-revocation evidence.
  // Then no notice delay can authorize the effect.
  rejects(() => parseCampaignState({ ...state, grants: revoked(state, 1200000) }, content), 'effect-authority');
});
test('preserves pre-revocation evidence delivered after revocation', () => {
  // Given lawful observation followed by revocation during report transit.
  const state = reportedState(true);
  // When the unchanged historic observation is restored.
  const restored = parseCampaignState({ ...state, grants: revoked(state, 1500000) }, content);
  // Then the old report remains receivable, without authorizing new work.
  assert.equal(restored.reports[0]?.fact.observedAt, 1464000);
});
test('rejects work results under an old order after revocation', () => {
  // Given an issued/accepted order without observation facts to mask the result check.
  const state = reportedState(false), result = { id: 'work:1', orderId: 'order:observation', causeId: 'work', at: 1464000, kind: 'work', payloadHash: '1'.repeat(64), safeReturn: null };
  // When work is restored after revocation.
  const candidate = { ...state, facts: [], reports: [], grants: revoked(state, 1200000), results: [result], appliedResultIds: [result.id] };
  // Then the effect-time authority check rejects.
  rejects(() => parseCampaignState(candidate, content), 'effect-authority');
});
for (const kind of ['food', 'water'] as const) test(`rejects ${kind} coverage without its own consumption`, () => {
  // Given no consumption receipts and all original stock.
  const key = kind === 'food' ? 'foodCoveredUntil' : 'waterCoveredUntil';
  // When support alone is extended.
  const candidate = { ...e0, bodies: e0.bodies.map(b => ({ ...b, [key]: 5400000 })) };
  // Then the finite accounting cross-link rejects it.
  rejects(() => parseCampaignState(candidate, content), 'inventory');
});
test('extends only food coverage when food is consumed once', () => {
  // Given a complete 60-second early meal, not free additional support time.
  const candidate = { ...e0, clock: { ...e0.clock, worldMilliseconds: 60000 },
    bodies: e0.bodies.map(b => b.entityId === 'K002' ? { ...b, foodCoveredUntil: 5400000 } : b),
    inventories: e0.inventories.map(i => i.entityId === 'K002' ? { ...i, foodPacks: 1, consumedFoodPacks: 1, emergencyReservedPacks: 0 } : i),
    consumption: [{ id: 'eat:K002', entityId: 'K002', kind: 'food', startedAt: 0, completedAt: 60000, causeId: 'meal' }] };
  // When the complete boundary is restored.
  const restored = parseCampaignState(candidate, content);
  // Then water remains independent and the food deadline stays fixed.
  assert.equal(restored.bodies[0]?.foodCoveredUntil, 5400000);
  assert.equal(restored.bodies[0]?.waterCoveredUntil, 3600000);
});
