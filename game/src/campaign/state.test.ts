import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CampaignContent, assertContentLinks } from './content.ts';
import { CampaignBoundaryError } from './errors.ts';
import type { CampaignErrorCode } from './errors.ts';
import { createCampaignE0, parseCampaignState, readReceivedReport, receivedReports, assertExpectedRevision } from './state.ts';
import { nodeLocation } from './locations.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { id } from '../domain/ids.ts';
import { checkCampaignState } from '../../../scripts/tools/campaign-state.ts';

const data = new URL('../../data/', import.meta.url);
const packages = {
  manifest: await readFile(new URL('campaign/source-manifest.json', data), 'utf8'),
  atlas: await readFile(new URL('campaign/atlas.json', data), 'utf8'),
  identities: await readFile(new URL('campaign/identity-map.json', data), 'utf8'),
  scenario: await readFile(new URL('scenarios/townhall-s01-r1/scenario.json', data), 'utf8'),
  projection: await readFile(new URL('scenarios/townhall-s01-r1/projection.json', data), 'utf8'),
  operations: await readFile(new URL('scenarios/townhall-s01-r2/operations.json', data), 'utf8'),
};
const content = CampaignContent.parse(packages);
const e0 = createCampaignE0(content);
const rejects = (run: () => unknown, code: CampaignErrorCode) => assert.throws(run, (error: unknown) => error instanceof CampaignBoundaryError && error.code === code);

test('restores the admitted E0 when serialized through the complete boundary', () => {
  // Given production admitted bytes, not a synthetic actor pack.
  const serialized = JSON.stringify(e0);
  // When a checkpoint consumer parses the serialized boundary.
  const restored = parseCampaignState(JSON.parse(serialized), content);
  // Then the same data-derived people, physical bodies, original and grants survive.
  assert.deepEqual(restored, e0);
  assert.deepEqual(restored.people.map(p => p.id), content.data.manifest.selection.persons.map(p => p.id));
  assert.equal(restored.bodies.length, 4);
  assert.equal(restored.custody[0]?.custodian, content.data.operations.authority.duty);
  assert.equal(content.data.manifest.selection.court.filter(p => p.status === 'active').length, 9);
  assert.equal(content.data.manifest.selection.court.filter(p => p.status === 'retired-current').length, 4);
  assert.notEqual(content.data.manifest.selection.holding.directLiegePersonId, content.data.manifest.selection.titleBinding.parentHolderPersonId);
});

const negativeStates = [
  { name: 'forged issuer', code: 'authority-source', change: () => ({ ...e0, grants: e0.grants.map(g => ({ ...g, revisions: g.revisions.map(r => ({ ...r, issuer: 'K002' })) })) }) },
  { name: 'out-of-scope location', code: 'location-scope', change: () => ({ ...e0, bodies: e0.bodies.map(b => b.entityId === 'K616' ? { ...b, location: nodeLocation('s01:townhall:locker', content) } : b) }) },
  { name: 'designator leaves fixed reception', code: 'location-scope', change: () => ({ ...e0, bodies: e0.bodies.map(b => b.entityId === 'K002' ? { ...b, location: nodeLocation('s01:townhall:threshold', content) } : b) }) },
  { name: 'station ID used for room', code: 'location-scope', change: () => ({ ...e0, bodies: e0.bodies.map(b => ({ ...b, location: { kind: 'station', stationId: 's01:townhall:desk' } })) }) },
  { name: 'duplicated original custody', code: 'custody', change: () => ({ ...e0, custody: [...e0.custody, ...e0.custody] }) },
  { name: 'custody location differs from holder', code: 'custody', change: () => ({ ...e0, custody: e0.custody.map(c => ({ ...c, custodian: 'K568', seal: 'opened', returnState: 'return-required' })) }) },
  { name: 'unknown grant revision', code: 'grant-version', change: () => ({ ...e0, grants: e0.grants.map(g => ({ ...g, sourceVersion: '0'.repeat(64) })) }) },
  { name: 'fabricated person', code: 'person-scope', change: () => ({ ...e0, people: [...e0.people, { id: 'K999999' }] }) },
  { name: 'stale rules version', code: 'stale-version', change: () => ({ ...e0, rulesRevision: '0'.repeat(64) }) },
  { name: 'minted finite inventory', code: 'inventory', change: () => ({ ...e0, inventories: e0.inventories.map(i => ({ ...i, foodPacks: i.foodPacks + 1 })) }) },
  { name: 'inherited option names', code: 'inherited-option', change: () => Object.assign(Object.create({ executionAllowed: true }), e0) },
  { name: 'dangling report knowledge', code: 'report-unreceived', change: () => ({ ...e0, knowledge: e0.knowledge.map(k => ({ ...k, records: [{ reportId: 'absent', factId: 'absent', version: 0, receivedAt: 0 }] })) }) },
] satisfies readonly { readonly name: string; readonly code: CampaignErrorCode; readonly change: () => unknown }[];

for (const probe of negativeStates) test(`rejects atomically when ${probe.name} enters the boundary`, () => {
  // Given an isolated malformed candidate and an unchanged valid state.
  const before = JSON.stringify(e0), candidate = probe.change();
  // When parsing the complete candidate.
  rejects(() => parseCampaignState(candidate, content), probe.code);
  // Then no source state or host was mutated.
  assert.equal(JSON.stringify(e0), before);
});

test('rejects graph endpoints when an authenticated-content link is absent', () => {
  // Given the actual content graph with one referenced node removed.
  const [edge] = content.data.operations.routes.edges;
  assert.ok(edge);
  const changed = { ...content.data, projection: { ...content.data.projection, nodes: content.data.projection.nodes.filter(n => n.id !== edge.from) } };
  // When cross-linking the content before admission.
  const run = () => assertContentLinks(changed);
  // Then a missing endpoint is not promoted into a host graph.
  rejects(run, 'content-link');
});

test('rejects edited approval bytes when a caller self-approves content', () => {
  // Given operation bytes with an altered issuer.
  const altered = packages.operations.replace('s01:townhall:ration-community', 'K002');
  // When the caller attempts package admission.
  const run = () => CampaignContent.parse({ ...packages, operations: altered });
  // Then the authenticated artifact anchor rejects it.
  rejects(run, 'content-hash');
});

function reportedState(received: boolean) {
  const operation = content.data.operations.authority.mandates.find(m => m.id === 'S01-O');
  assert.ok(operation);
  const authority = operation.grants.map(grantId => {
    const grant = e0.grants.find(g => g.id === grantId);
    assert.ok(grant);
    return { grantId, version: grant.sourceVersion };
  });
  const fact = { id: 'observation:tap', version: 0, orderId: 'order:observation', sourcePersonId: 'K616', observedAt: 1464000,
    location: nodeLocation('s01:townhall:tap', content), causeId: 'cause:observation', evidence: { kind: 'raw-observation', nodeId: 's01:townhall:tap', measurementValue: null, calibrationReceipt: null } };
  return parseCampaignState({ ...e0, revision: 1, clock: { ...e0.clock, worldMilliseconds: 1590000 },
    mandates: [{ orderId: fact.orderId, causeId: fact.causeId, operation: operation.id, issuerPersonId: 'K002', recipientId: operation.recipient, authority,
      compositeVersion: summaryHash({ operation: operation.id, authority }), target: fact.location,
      issuerLocation: nodeLocation('s01:townhall:desk', content), recipientLocation: nodeLocation('s01:townhall:yard', content),
      route: ['s01:townhall:desk', 's01:townhall:entry', 's01:townhall:yard', 's01:townhall:cistern', 's01:townhall:tap'],
      stage: received ? 'receipt' : 'executing', issuedAt: 990000, receivedAt: 1110000, acceptedAt: 1140000, returnAcceptedAt: null,
      workMilliseconds: 240000, reservationIds: [], pendingResultIds: [], appliedResultIds: [] }],
    facts: [fact], reports: [{ id: 'report:observation', fact, recipient: 'K002', carrier: 'K616', createdAt: 1464000,
      deliveredAt: received ? 1530000 : null, receivedAt: received ? 1590000 : null, source: 'K616', omission: ['uncalibrated'], uncertainty: 'partial-evidence', causeId: fact.causeId }],
    knowledge: e0.knowledge.map(k => ({ ...k, records: received && k.personId === 'K002' ? [{ reportId: 'report:observation', factId: fact.id, version: fact.version, receivedAt: 1590000 }] : [] })),
  }, content);
}

test('rejects a report read when the report has not been received', () => {
  // Given a valid in-transit report in the real boundary.
  const state = reportedState(false);
  // When a lord-visible selector asks for the hidden report.
  const run = () => readReceivedReport(state, { personId: 'K002', reportId: 'report:observation' });
  // Then no payload is exposed and the inbox remains empty.
  rejects(run, 'report-unreceived');
  assert.deepEqual(receivedReports(state, id('PersonId', 'K002')), []);
});

test('preserves the observed payload when newer world facts exist', () => {
  // Given a received old report and a later version of its world fact.
  const received = reportedState(true);
  const next = parseCampaignState({ ...received, facts: received.facts.map(f => ({ ...f, version: 1, observedAt: 1590000 })) }, content);
  // When the recipient opens the report.
  const visible = readReceivedReport(next, { personId: 'K002', reportId: 'report:observation' });
  // Then receipt references the old payload, not privileged current truth.
  assert.equal(visible.fact.version, 0);
  assert.equal(visible.fact.observedAt, 1464000);
  assert.equal(visible.receivedAt, 1590000);
});

test('rejects receipt forgery when delivered time lacks formal receipt', () => {
  // Given a report that has not been received.
  const pending = reportedState(false), received = reportedState(true);
  // When only the knowledge side is forged.
  const run = () => parseCampaignState({ ...pending, knowledge: received.knowledge }, content);
  // Then the checkpoint fails at the report cross-link.
  rejects(run, 'report-unreceived');
});

test('rejects stale callers when the expected revision differs', () => {
  // Given E0 and an older or unrelated caller revision.
  const expected = 1;
  // When command ingress checks its expected revision.
  const run = () => assertExpectedRevision(e0, expected);
  // Then the typed stale-version error prevents mutation.
  rejects(run, 'stale-version');
});

test('preserves partial edge progress when a coherent physical snapshot is restored', () => {
  // Given K568 on the approved 12 metre corridor, 3 metres from the desk.
  const next = { ...e0, bodies: e0.bodies.map(b => b.entityId === 'K568' ? { ...b, activity: 'walking', location: { kind: 'edge-progress', siteId: content.data.operations.authority.siteId, from: 's01:townhall:desk', to: 's01:townhall:threshold', travelledMillimetres: 3000 } } : b) };
  // When restored through the save-facing boundary.
  const restored = parseCampaignState(next, content);
  // Then its edge fraction survives without becoming a station or arrival.
  assert.deepEqual(restored.bodies.find(b => b.entityId === 'K568')?.location, next.bodies.find(b => b.entityId === 'K568')?.location);
});

test('rejects inherited option names when passed as CLI flags', async () => {
  // Given an Object.prototype name masquerading as an option.
  const args = ['--check', '--constructor', 'true'];
  // When the real CLI argument boundary parses it.
  const run = () => checkCampaignState(args);
  // Then no inherited property can select a command option.
  await assert.rejects(run, (error: unknown) => error instanceof CampaignBoundaryError && error.code === 'shape');
});
