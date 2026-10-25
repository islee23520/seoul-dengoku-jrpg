import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  decodeHash, encodeHash, geometryBounds, hitTest, initialViewState, lordScope, railOverlay, regionFills, resolveSelection,
  rankOutline, select, setRank,
} from './campaignMapModel.ts';
import type { IdentityMap, MapView } from './campaignMapModel.ts';
// @ts-expect-error untyped generator module
import { buildMapView, serialize } from '../../scripts/tools/campaign-map-view.mjs';

const atlasBytes = readFileSync(new URL('../data/campaign/atlas.json', import.meta.url));
const viewBytes = readFileSync(new URL('../data/campaign/map-view.json', import.meta.url), 'utf8');
const view = JSON.parse(viewBytes) as MapView;
const identity = JSON.parse(readFileSync(new URL('../data/campaign/identity-map.json', import.meta.url), 'utf8')) as IdentityMap;
const atlas = JSON.parse(atlasBytes.toString('utf8'));
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); } return value; };
freeze(view); freeze(identity);
const k002 = lordScope(view, 'K002', '신정2동 주민센터');

test('map view is the byte-identical projection of the admitted atlas', () => {
  // Given: the committed atlas. When: regenerating. Then: same bytes and the source hash is bound.
  assert.equal(serialize(buildMapView(atlasBytes)), viewBytes);
  assert.equal(view.atlasSha256, createHash('sha256').update(atlasBytes).digest('hex'));
  assert.equal(view.edition, atlas.edition);
  assert.deepEqual([view.regions.length, view.stations.length, view.edges.length, view.titles.length], [427, 312, 381, 80]);
  assert.equal(view.executionAdmission, false);
});

test('county minimum polygons cover every current region exactly once', () => {
  const counties = view.titles.filter(title => title.rank === 'county');
  const members = counties.flatMap(title => title.regionIds);
  assert.equal(members.length, new Set(members).size);
  assert.deepEqual(new Set(members), new Set(view.regions.map(region => region.id)));
  assert.equal(view.titles.some(title => title.rank === 'barony'), false, 'barony detail slots are empty in this atlas');
});

test('measured source geometry bounds stay inside the atlas canvas', () => {
  const bounds = geometryBounds(view.regions.map(region => region.path));
  assert(bounds.minX >= 0 && bounds.minY >= 0 && bounds.maxX <= view.width && bounds.maxY <= view.height, JSON.stringify(bounds));
  assert(bounds.maxX - bounds.minX > view.width / 2, 'geometry is not collapsed');
});

test('pointer hit-test resolves a point inside 신정2동 to its region and outside Seoul to nothing', () => {
  const region = view.regions.find(r => r.name === '신정2동')!;
  const nums = (region.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  // Scan the bounding box for an interior point owned by exactly this region.
  let found: [number, number] | null = null;
  for (let x = Math.min(...xs); x <= Math.max(...xs) && !found; x += 0.5)
    for (let y = Math.min(...ys); y <= Math.max(...ys) && !found; y += 0.5) if (hitTest(view, x, y) === region.id) found = [x, y];
  assert(found, 'interior point found');
  assert.equal(hitTest(view, 1, 1), null);
});

test('K002 scope is the 18 sourced Yangcheon dong, not seven assumed stations', () => {
  assert.equal(k002.jurisdiction.size, 18);
  for (const id of k002.jurisdiction) assert.equal(view.regions.find(r => r.id === id)?.district, '양천구');
  assert.deepEqual(k002.holdingIds, ['holding:yangcheon']);
  assert.deepEqual(k002.titleIds, ['title:duchy-gu-11470-S01']);
  assert.equal(k002.basis, 'interim-admitted-holding-record');
  const retainer = lordScope(view, 'K568', '신정2동 주민센터');
  assert.equal(retainer.jurisdiction.size, 0);
  assert.deepEqual([...retainer.known], [view.selection.site.regionId]);
  assert.equal(lordScope(view, 'K568', '다른 장소').known.size, 0);
});

test('selection maps to canonical targets through the explicit identity map', () => {
  const title = resolveSelection(view, identity, k002, 'title:duchy-gu-11470-S01');
  assert.deepEqual(title, { ok: true, selection: { kind: 'title', id: 'title:duchy-gu-11470-S01', geographyId: 'geography:duchy:11470', canonicalId: 'geography:duchy:11470' } });
  const site = resolveSelection(view, identity, k002, 'osm:node:368899387');
  assert(site.ok && site.selection.kind === 'site' && site.selection.canonicalId === 'osm:node:368899387');
  const region = resolveSelection(view, identity, k002, 'region:1147063000');
  assert(region.ok && region.selection.canonicalId === 'region:1147063000');
  const holding = resolveSelection(view, identity, k002, 'holding:yangcheon');
  assert(holding.ok && holding.selection.kind === 'holding');
});

test('out-of-scope, unknown and injected targets are refused without changing view state', () => {
  const jongno = view.regions.find(r => r.district === '종로구')!.id;
  assert.deepEqual(resolveSelection(view, identity, k002, jongno), { ok: false, reason: 'out-of-scope' });
  const retainer = lordScope(view, 'K568', '신정2동 주민센터');
  assert.deepEqual(resolveSelection(view, identity, retainer, 'holding:yangcheon'), { ok: false, reason: 'out-of-scope' });
  for (const raw of ['', 'region:0', 'holding:mapo', 'title:kingdom-s02', 'geography:duchy:11470', '__proto__', null, 7, { id: 'region:1147063000' }, 'x'.repeat(500)])
    assert.equal(resolveSelection(view, identity, k002, raw).ok, false, String(raw));
  const before = initialViewState;
  assert.equal(select(before, resolveSelection(view, identity, k002, jongno)), before);
});

test('selecting only replaces view state and leaves every input untouched', () => {
  const viewHash = createHash('sha256').update(JSON.stringify(view)).digest('hex');
  let state = initialViewState;
  for (const id of ['title:duchy-gu-11470-S01', 'osm:node:368899387', 'region:1147051000', 'holding:yangcheon'])
    state = select(state, resolveSelection(view, identity, k002, id));
  assert.equal(state.selection?.id, 'holding:yangcheon');
  assert.equal(state.tab, 'sites');
  assert.equal(createHash('sha256').update(JSON.stringify(view)).digest('hex'), viewHash);
  assert.deepEqual(initialViewState, { mode: 'political', rank: 'county', rail: false, tab: 'titles', expanded: false, selection: null });
});

test('unknown regions never carry source control colours or labels', () => {
  const fills = regionFills(view, k002, initialViewState);
  const unknown = fills.filter(fill => fill.cls === 'unknown');
  assert.equal(unknown.length, 427 - 18);
  assert(unknown.every(fill => fill.color === null && fill.label === null));
  assert(fills.filter(fill => fill.cls === 'jurisdiction').every(fill => fill.color !== null && fill.label));
  const rail = railOverlay(view, k002, { ...initialViewState, rail: true });
  assert.equal(rail.executable, false);
  assert.equal(rail.segments.length, 381);
  const labelled = rail.stations.filter(s => s.label).map(s => s.label).sort();
  // Labels follow the station's surface region, not its district name: 등촌 sits in a Yangcheon dong, 양평 does not.
  assert.deepEqual(labelled, ['등촌', '목동', '신목동', '신정', '신정네거리', '양천구청', '오목교'].sort());
  assert(!labelled.includes('양평'));
  assert.equal(railOverlay(view, k002, initialViewState).segments.length, 0);
});

test('title layer draws the chosen rank and refuses an empty rank', () => {
  const titles = setRank(view, initialViewState, 'duchy');
  assert.equal(titles.mode, 'titles');
  const duchy = rankOutline(view, titles)!, county = rankOutline(view, setRank(view, initialViewState, 'county'))!;
  const empire = rankOutline(view, setRank(view, initialViewState, 'empire'))!;
  // Dissolving keeps fewer segments at coarser ranks; the empire is the outer boundary only.
  assert(empire.length < duchy.length && duchy.length < county.length * 1.2 && empire.length > 0);
  assert.equal(setRank(view, initialViewState, 'barony'), initialViewState);
  assert.equal(rankOutline(view, initialViewState), null);
  // Duchies partition the 427 dong by administrative code; 양천구 is exactly the 18-dong K002 holding.
  const duchies = view.titles.filter(t => t.rank === 'duchy').flatMap(t => t.regionIds);
  assert.equal(duchies.length, 427); assert.equal(new Set(duchies).size, 427);
  assert.deepEqual(new Set(view.titles.find(t => t.id === 'geography:duchy:11470')!.regionIds), k002.jurisdiction);
});

test('deep links round-trip valid state and drop invalid fields', () => {
  const state = select(setRank(view, { ...initialViewState, rail: true }, 'kingdom'), resolveSelection(view, identity, k002, 'region:1147063000'));
  const decoded = decodeHash(view, identity, k002, encodeHash(state));
  assert.deepEqual(decoded.rejected, []);
  assert.deepEqual(decoded.state, state);
  const bad = decodeHash(view, identity, k002, '#map=evil.barony.9.' + encodeURIComponent(view.regions[0]!.id) + '.x');
  assert.deepEqual(bad.rejected, ['mode', 'rank', 'rail', 'extra', 'selection:out-of-scope']);
  assert.deepEqual(bad.state, initialViewState);
  assert.deepEqual(decodeHash(view, identity, k002, '#map=political.county.0.%E0%A4%A').rejected, ['selection']);
  assert.deepEqual(decodeHash(view, identity, k002, '#other').state, initialViewState);
});
