import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignContent, assertContentLinks } from './content.ts';
import { content, packages, rejects, e0 } from './testFixtures.ts';
import { assertLocation, nodeLocation } from './locations.ts';
import { locationSchema } from './stateSchemas.ts';
import { edit } from './guardFixtures.ts';
import { parseCampaignState } from './state.ts';

const edits: readonly [string, readonly (string | number)[], unknown, 'content-link' | 'person-scope' | 'authority-source'][] = [
  ['edition', ['atlas', 'edition'], 'unrecognized', 'content-link'],
  ['selection', ['atlas', 'selection', 'site', 'name'], 'different', 'content-link'],
  ['rail endpoint', ['atlas', 'edges', 0, 'a'], 'missing', 'content-link'],
  ['holding scope', ['operations', 'authority', 'holdingId'], 'other', 'content-link'],
  ['scenario binding', ['projection', 'scenarioId'], 'other', 'content-link'],
  ['site anchor', ['scenario', 'sites', 0, 'anchorRef'], 'other', 'content-link'],
  ['actor placement', ['operations', 'authority', 'actorPlacements', 'K568'], 'other', 'person-scope'],
  ['communal owner', ['scenario', 'ledger', 'owner'], 'K002', 'authority-source'],
  ['grant issuer', ['scenario', 'rights', 'grants', 0, 'issuer'], 'K002', 'authority-source'],
];
for (const [name, path, value, code] of edits) test(`rejects content ${name} before creating a capability`, () => {
  // Given one corrupted typed link from production content.
  const candidate = edit(content.data, path, value);
  // When the internal content linker inspects it. Then its invariant rejects.
  rejects(() => Reflect.apply(assertContentLinks, null, [candidate]), code);
});
const locations = [
  { kind: 'station', stationId: 'missing' },
  { kind: 'site', siteId: 'missing' },
  { kind: 'scene', siteId: content.data.operations.authority.siteId, sceneId: 'missing' },
  { kind: 'node', siteId: content.data.operations.authority.siteId, sceneId: 'missing', nodeId: 's01:townhall:desk' },
  { kind: 'edge-progress', siteId: content.data.operations.authority.siteId, from: 's01:townhall:desk', to: 's01:townhall:threshold', travelledMillimetres: 12000 },
];
for (const input of locations) test(`rejects invalid ${input.kind} namespace or endpoint`, () => {
  // Given a structurally valid location with a bad content reference.
  const location = locationSchema.parse(input);
  // When resolving it. Then no room/scene/station namespace is interchangeable.
  rejects(() => assertLocation(location, content), 'location-scope');
});
test('rejects missing node construction', () => {
  // Given an absent node. When resolving it. Then the typed location error is retained.
  rejects(() => nodeLocation('missing', content), 'location-scope');
});
test('rejects malformed and inherited content envelopes', () => {
  // Given absent bytes and inherited source fields.
  // When parsing either envelope. Then neither reaches the admitted registry.
  rejects(() => CampaignContent.parse({}), 'shape');
  rejects(() => CampaignContent.parse(Object.create(packages)), 'inherited-option');
});
test('rejects accessor-backed state without evaluating the accessor', () => {
  // Given an enumerable getter masquerading as a snapshot value.
  let reads = 0;
  const candidate = { ...e0 };
  Object.defineProperty(candidate, 'revision', { enumerable: true, get() { reads++; return 0; } });
  // When parsing. Then property descriptors reject before invoking user code.
  rejects(() => parseCampaignState(candidate, content), 'inherited-option');
  assert.equal(reads, 0);
});
