import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, lstat, open, link, unlink, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

class CampaignError extends Error {
  constructor(code, field) { super(`${code}: ${field}`); this.code = code; }
}
const fail = (code, field) => { throw new CampaignError(code, field); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
async function fileHash(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
async function noSidecars(path) { for (const suffix of ['-wal', '-shm', '-journal']) { try { await lstat(path + suffix); } catch (e) { if (e instanceof Error && e.code === 'ENOENT') continue; throw e; } fail('E_CAMPAIGN_SIDECAR', suffix); } }
export function verifyParity(expected, generated) {
  for (const key of Object.keys(expected)) if (!isDeepStrictEqual(expected[key], generated[key])) fail('E_CAMPAIGN_PARITY', key);
}
export function verifyFieldCoverage(projection, allowlist, root = 'parity') {
  const leaves = (value, path) => value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}/${Array.isArray(value) ? '*' : key}`)) : [path];
  const paths = [...new Set(leaves(projection, root).map(path => path.replace(/^parity\/(regions|stations|edges)\/\*\//u, 'parity/$1/')))];
  for (const path of paths) if (!allowlist.some(entry => entry.fields.some(value => { const field = value.replace(/\/id=[^/]+\//u, '/*/'); return path === field || path.startsWith(`${field}/`); }))) fail('E_CAMPAIGN_PROVENANCE', path);
  for (const entry of allowlist) if (!entry.sources?.length || !entry.transform || !entry.use || entry.sources.some(s => !/^[a-f0-9]{64}$/u.test(s.sha256) || !s.selector)) fail('E_CAMPAIGN_PROVENANCE', entry.fields.join(','));
  return { covered: paths.length, missing: [] };
}
const rings = geometry => geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
const simplify = ring => { const step = Math.max(1, Math.floor(ring.length / 80)), points = ring.filter((_, i) => i % step === 0); if (points.at(-1) !== ring.at(-1)) points.push(ring.at(-1)); return points; };
const inside = ([x, y], points) => { let hit = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const [a, b] = points[i], [c, d] = points[j]; if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit; } return hit; };

async function projectMap(context) {
  const { db, load, wikiRoot, generated } = context;
  const { readRegionAtlasData, REGION_ATLAS_SOURCE_HASH } = await load('scripts/cast-sqlite/region-atlas-document.mjs');
  const { readRegionContentDocument, REGION_CONTENT_SOURCE_HASHES } = await load('scripts/cast-sqlite/region-content-documents.mjs');
  const { readGeographyStore } = await load('scripts/cast-sqlite/geography-store.mjs');
  const { readBoundaryGeometries } = await load('scripts/cast-sqlite/boundary-geometries.mjs');
  const { projectGeographicTitles, publicGeographicId } = await load('src/components/geographicTitleMap.mjs');
  const { readWorldGraphDocument, WORLD_GRAPH_SOURCE_HASH } = await load('scripts/cast-sqlite/world-graph-document.mjs');
  const { readRailSourceDocument, RAIL_SOURCE_HASHES } = await load('scripts/cast-sqlite/rail-source-documents.mjs');
  const { regularLineGraph } = await load('scripts/regular-line-graph.mjs');
  const { readDocument } = await load('scripts/cast-sqlite/document-read.mjs');
  const { currentAffiliations, hegemonsForHolders } = await load('scripts/current-affiliation.mjs');
  const { validateStationCatalogGeography, loadOutsideStationIds } = await load('scripts/station-catalog-geography.mjs');
  const atlas = readRegionAtlasData(db, { expectedSourceHash: REGION_ATLAS_SOURCE_HASH }), geography = readGeographyStore(db);
  const regionContent = new Map(Object.entries(REGION_CONTENT_SOURCE_HASHES).flatMap(([logicalPath, expectedSourceHash]) => readRegionContentDocument(db, { logicalPath, expectedSourceHash }).regions.map(r => [r.region_id, r.content])));
  const contract = readDocument(db, { documentId: 'DOC:Sixteen-States', domain: 'factions', corpusKind: 'current', visibility: 'public' })?.data.currentAffiliation;
  if (!contract) fail('E_CAMPAIGN_ADMISSION', 'Sixteen-States');
  const affiliations = currentAffiliations(contract, contract.states.map(s => ({ id: s.stateId, name: s.currentName }))), names = new Map(contract.states.map(s => [s.stateId, s.currentName]));
  const points = atlas.regions.flatMap(r => rings(r.map_geometry).flat()), bounds = points.reduce((b, [x, y]) => ({ minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x), minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const width = 1200, height = Math.round(width * (bounds.maxY - bounds.minY) / (bounds.maxX - bounds.minX));
  const mapPoint = ([x, y]) => [Number(((x - bounds.minX) / (bounds.maxX - bounds.minX) * width).toFixed(2)), Number(((bounds.maxY - y) / (bounds.maxY - bounds.minY) * height).toFixed(2))];
  const proj4 = createRequire(join(wikiRoot, 'package.json'))('proj4');
  proj4.defs('EPSG:5179', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs');
  const project = (lon, lat) => { const [x, y] = proj4('EPSG:4326', 'EPSG:5179', [lon, lat]); return [(x - bounds.minX) / (bounds.maxX - bounds.minX) * width, (bounds.maxY - y) / (bounds.maxY - bounds.minY) * height]; };
  const path = geometry => rings(geometry).map(r => simplify(r).map(mapPoint).map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + ' Z').join(' ');
  const selectedRegions = atlas.regions.map(r => { const c = regionContent.get(r.id), polities = c.territory.holders.map(h => h.polity); return { id: r.id, name: r.name, district: r.district_name, path: path(r.map_geometry), polities, currentHegemons: c.territory.authority ? [c.territory.authority] : hegemonsForHolders(polities, affiliations), status: c.territory.status ?? (polities.length === 0 ? 'vacant' : polities.length === 1 ? 'held' : 'contested'), stationCount: r.station_ids.length, areaM2: r.area_m2 }; });
  const graph = readWorldGraphDocument(db, { expectedSourceHash: WORLD_GRAPH_SOURCE_HASH });
  const catalog = readDocument(db, { documentId: 'DOC:Seoul-Station-Catalog', corpusKind: 'current', visibility: 'public' });
  if (!catalog) fail('E_CAMPAIGN_ADMISSION', 'station catalog');
  const boundary = await readFile(join(wikiRoot, 'data/geography/boundaries/admdongkor-20260701.geojson'));
  validateStationCatalogGeography(catalog, boundary);
  const excluded = await loadOutsideStationIds(wikiRoot, { stationAliases: catalog.data.station_aliases, readBytes: async () => boundary });
  const alias = new Map(catalog.data.station_aliases.flatMap(a => [a.id, ...a.aliases].map(id => [id, a.id]))), canonical = id => alias.get(id) ?? id;
  const rail = logicalPath => readRailSourceDocument(db, { logicalPath, expectedSourceHash: RAIL_SOURCE_HASHES[logicalPath] });
  const regular = regularLineGraph(rail('lore/places/regular-line-adjacency.json'), graph.stations.map(s => canonical(s.id)).filter(id => !excluded.includes(id)), { excludedStationIds: excluded });
  const ledger = rail('lore/places/station-control-overrides.json'), overrides = new Map(ledger.overrides.map(o => [o.stationId, o]));
  const neighbors = new Map(); for (const e of regular.edges) for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) { if (!neighbors.has(a)) neighbors.set(a, new Set()); neighbors.get(a).add(b); }
  const capital = new Map(contract.states.filter(s => s.currentBase.kind === 'station').map(s => [s.currentBase.stationId, s.stateId]));
  const sourceStations = graph.stations.map(s => {
    const [east, north] = proj4('EPSG:4326', 'EPSG:5179', [s.lon, s.lat]), [x, y] = mapPoint([east, north]);
    const r = atlas.regions.find(r => inside([x, y], simplify(rings(r.map_geometry)[0]).map(mapPoint))), c = r ? regionContent.get(r.id) : null;
    const surfacePolityIds = c?.territory.holders.map(h => h.polity) ?? [], delta = overrides.get(s.id), polityIds = delta?.polityIds ?? (capital.has(s.id) ? [capital.get(s.id)] : surfacePolityIds);
    return { id: s.id, name: s.nameKo, district: s.district, x, y, degree: neighbors.get(canonical(s.id))?.size ?? 0, lineIds: [...(regular.linesByStation.get(canonical(s.id)) ?? [])], surfacePolityIds, control: { source: delta ? 'control-delta' : r ? 'derived-from-surface' : 'outside-surface-atlas', deltaId: delta?.id ?? null, status: delta?.status ?? (!r ? 'unknown' : polityIds.length === 0 ? 'vacant' : polityIds.length === 1 ? 'held' : 'contested'), polityIds, polityNames: polityIds.map(id => names.get(id) ?? id), primary: delta?.primary ?? (polityIds.length === 1 ? polityIds[0] : null), surfaceRegionId: r?.id ?? null, surfaceRegionName: r?.name ?? null, hierarchy: { state: polityIds.map(id => names.get(id) ?? id).join(' · ') || (r ? '무주지' : '미확인'), regionalAuthority: delta?.regionalAuthority ?? (r ? `${r.district_name} 권역 책임자` : '서울 영토 원장 밖 · 미확인'), stationManager: delta?.stationManager ?? `${s.nameKo.replace(/역$/u, '')}역장` } } };
  });
  const stations = sourceStations.filter(s => canonical(s.id) === s.id && !excluded.includes(s.id)).map(s => {
    const group = catalog.data.station_aliases.find(a => a.id === s.id); if (!group) return s;
    const memberIds = [group.id, ...group.aliases], members = memberIds.map(id => sourceStations.find(s => s.id === id));
    const memberSurfaces = members.map(m => { const { source, deltaId, status, primary, surfaceRegionId, surfaceRegionName, polityIds } = m.control; return { id: m.id, source, deltaId, status, primary, surfaceRegionId, surfaceRegionName, polityIds, surfacePolityIds: m.surfacePolityIds }; });
    const disagree = new Set(memberSurfaces.map(m => `${m.status}:${m.primary}:${[...m.polityIds].sort().join(',')}`)).size > 1, regionsDiffer = new Set(memberSurfaces.map(m => m.surfaceRegionId)).size > 1, uncertain = disagree && s.control.source !== 'control-delta';
    return { ...s, memberIds, lineIds: [...new Set(sourceStations.filter(m => memberIds.includes(m.id)).flatMap(m => m.lineIds))], control: { ...s.control, memberSurfaces, ...(uncertain ? { status: 'unknown', polityIds: [], polityNames: [], primary: null, hierarchy: { ...s.control.hierarchy, state: '미확인', regionalAuthority: null } } : {}), ...(regionsDiffer ? { surfaceRegionId: null, surfaceRegionName: null, hierarchy: { ...s.control.hierarchy, ...(uncertain ? { state: '미확인' } : {}), regionalAuthority: s.control.source === 'control-delta' ? s.control.hierarchy.regionalAuthority : null } } : {}) } };
  });
  for (const s of stations) s.control.currentHegemons = hegemonsForHolders(s.control.polityIds, affiliations);
  const byId = new Map(stations.map(s => [s.id, s])), segments = new Map((ledger.segmentOverrides ?? []).map(e => [e.segmentId, e])), decisions = new Map((ledger.passageDecisions ?? []).map(e => [e.segmentId, e.passage2126]));
  const north = new Set(['종로구','중구','용산구','성동구','광진구','동대문구','중랑구','성북구','강북구','도봉구','노원구','은평구','서대문구','마포구']);
  const edges = regular.edges.filter(e => byId.has(e.a) && byId.has(e.b)).map(e => {
    const id = `segment:${e.a}~${e.b}`, a = byId.get(e.a), b = byId.get(e.b), delta = segments.get(id);
    const same = [...a.control.polityIds].sort().join('|') === [...b.control.polityIds].sort().join('|');
    const control = delta ? { source: 'control-delta', deltaId: delta.id, status: delta.status, polityIds: delta.polityIds, primary: delta.primary } : { source: 'derived-from-stations', deltaId: null, ...(a.control.status === 'unknown' || b.control.status === 'unknown' ? { status: 'unknown', polityIds: [], primary: null } : same ? { status: a.control.status, polityIds: a.control.polityIds, primary: a.control.primary } : { status: 'contested', polityIds: [...new Set([...a.control.polityIds, ...b.control.polityIds])].sort(), primary: null }) };
    return { a: e.a, b: e.b, lineIds: e.lineIds, sourceCodes: e.sourceCodes, id, control: { ...control, currentHegemons: hegemonsForHolders(control.polityIds, affiliations) }, passage2126: north.has(a.district) !== north.has(b.district) ? decisions.get(id) ?? 'unknown' : control.status === 'held' ? 'open' : control.status === 'contested' ? 'checkpoint' : 'unknown' };
  });
  const projection = { geography: projectGeographicTitles(geography, readBoundaryGeometries(db), (x, y) => project(x, y)), regions: selectedRegions, stations, edges, hegemons: contract.hegemons, width, height };
  const compared = { ...generated, regions: generated.regions.map(r => Object.fromEntries(Object.keys(selectedRegions[0]).map(k => [k, r[k]]))) };
  verifyParity(projection, compared);
  return { projection, atlas, geography, contract, excluded, aliases: catalog.data.station_aliases, publicGeographicId, regionContent };
}

export async function buildManifest(options) {
  const wikiRoot = await realpath(resolve(options.wikiRoot)), exportDb = await realpath(resolve(options.exportDb)), canonicalDb = join(wikiRoot, 'data/canonical/wiki-cast.sqlite');
  const load = path => import(pathToFileURL(join(wikiRoot, path)).href);
  for (const path of [canonicalDb, exportDb]) { if (!(await lstat(path)).isFile()) fail('E_CAMPAIGN_STORAGE', 'regular SQLite required'); await noSidecars(path); const f = await open(path, 'r'); try { const b = Buffer.alloc(16); await f.read(b, 0, 16, 0); if (b.toString() !== 'SQLite format 3\0') fail('E_CAMPAIGN_STORAGE', 'SQLite magic; LFS pointer is not data'); } finally { await f.close(); } }
  const dbHash = await fileHash(canonicalDb); if (await fileHash(exportDb) !== dbHash) fail('E_CAMPAIGN_STALE', 'export differs from canonical');
  const git = (...args) => execFileSync('git', ['-C', wikiRoot, ...args], { encoding: 'utf8', env: { ...process.env, GIT_MASTER: '1' } }).trim();
  const head = git('rev-parse', 'HEAD'), dirty = git('status', '--porcelain', '--untracked-files=no'); if (dirty) fail('E_CAMPAIGN_DIRTY_SOURCE', 'tracked wiki changes');
  const generatedPath = options.generated ?? join(wikiRoot, 'public/opening-territories.json'), generatedBytes = await readFile(generatedPath), generated = JSON.parse(generatedBytes);
  const { openReadOnly } = await load('scripts/cast-sqlite/db.mjs'), db = openReadOnly(exportDb);
  let manifest;
  try {
    const map = await projectMap({ db, load, wikiRoot, generated });
    const { readPersonalHoldingInputs } = await load('scripts/cast-sqlite/personal-holding-inputs.mjs'), { readRelationConfig } = await load('scripts/cast-sqlite/relation-inputs.mjs'), { readPersonDisposition } = await load('scripts/cast-sqlite/person-disposition.mjs'), { readParsedPermissionStore } = await load('scripts/cast-sqlite/permission-store.mjs'), { queryPerson } = await load('scripts/cast-sqlite/query.mjs');
    const { readAffiliationIdentityInputs } = await load('scripts/cast-sqlite/map-identity-inputs.mjs');
    const admitted = readAffiliationIdentityInputs(db);
    const holding = readPersonalHoldingInputs(db).holdings.find(h => h.id === 'holding:yangcheon'), relations = readRelationConfig(db, { expectedSha256: '6a0a48a6540c16a848de8e14caa1d8df628eeceab5465c454afdbfdb5fa8a3c2' }), disposition = readPersonDisposition(db), permissions = readParsedPermissionStore(db);
    const court = relations.directRetainers.filter(r => r.courtId === 'court:K002').map(r => ({ ...r, status: disposition.get(r.personId).status })), ids = [...new Set(['K001','K002','K029', ...court.map(r => r.personId)])];
    if (ids.some(id => permissions.has(id))) fail('E_CAMPAIGN_PERMISSION', 'selected real-person registry entry requires scoped permission');
    const persons = ids.map(id => { const p = queryPerson({ dbPath: exportDb, id }).person; return { id, name: p.name, stateId: p.state_id, disposition: disposition.get(id).status }; });
    const context = queryPerson({ dbPath: exportDb, id: 'K002' }).current.context, binding = context.bindings.find(b => b.holding_id === holding.id);
    const boundTitle = context.titles.find(t => t.title_id === binding.title_id);
    const parentTitle = queryPerson({ dbPath: exportDb, id: 'K029' }).current.context.titles.find(t => t.title_id === boundTitle.parent_title_id);
    const site = map.atlas.sites.find(s => s.id === 'osm:node:368899387'), region = map.regionContent.get('region:1147063000'), building = region.buildings.find(b => b.anchor_ref === site.id);
    const sources = db.prepare('SELECT source_id,logical_path,sha256 FROM source_file ORDER BY source_id').all();
    const sourceRef = path => { const s = sources.find(s => s.logical_path === path); if (!s) fail('E_CAMPAIGN_SOURCE', path); return { path, sha256: s.sha256 }; };
    const contentLicense = { id: 'wiki-owned-content', work: '서울전국', holder: 'Linalab.io', source: 'https://github.com/islee23520/seoul-dengoku-wiki', license: 'https://github.com/islee23520/seoul-dengoku-wiki/blob/main/LICENSE', changeNotice: 'Selected and transformed for the Seoul Dengoku campaign; no new ownership or play-start authority.' };
    const { WORLD_GRAPH_SOURCE_HASH } = await load('scripts/cast-sqlite/world-graph-document.mjs');
    const { REGION_ATLAS_SOURCE_HASH } = await load('scripts/cast-sqlite/region-atlas-document.mjs');
    const ref = (path, selector) => ({ ...sourceRef(path), selector });
    const atlasRef = selector => ({ path: 'typed:region_atlas_document', sha256: REGION_ATLAS_SOURCE_HASH, selector });
    const graphRef = { path: 'snapshots/build-inputs/SeoulWorldGraph.json', sha256: WORLD_GRAPH_SOURCE_HASH, selector: '/stations/*/{id,nameKo,district,lon,lat}', externalCoordinateEdition: 'unknown', atlasSnapshotBridge: 'unverified' };
    const geographyHash = db.prepare('SELECT sha256 FROM geography_archive').get().sha256;
    const geoRef = selector => ({ path: 'typed:geography_archive', sha256: geographyHash, selector });
    const affiliationRef = { ...ref(admitted.source.logical_path, '/data/currentAffiliation'), revision: admitted.source.revision_id, semanticSha256: admitted.source.semantic_sha256 };
    const { REGION_CONTENT_SOURCE_HASHES } = await load('scripts/cast-sqlite/region-content-documents.mjs');
    const regionRefs = Object.keys(REGION_CONTENT_SOURCE_HASHES).map(path => ref(path, '/regions/*/content/territory'));
    regionRefs.push({ sha256: dbHash, selector: 'table:current_region_disposition; key:region_id; columns:status; readCiaCurrentRights/currentRegionContent' });
    const controlRef = ref('lore/places/station-control-overrides.json', '/overrides,/segmentOverrides,/passageDecisions');
    const aliasRef = ref('lore/places/Seoul-Station-Catalog.json', '/data/station_aliases');
    const railRef = ref('lore/places/regular-line-adjacency.json', '/lines/*/paths');
    const allowlist = [];
    const bind = entry => allowlist.push(entry);
    bind({ fields: ['selection/holding'], sources: [ref('lore/relations/personal-holdings.json', '/holdings[id=holding:yangcheon]')], transform: 'yangcheon-only-v1', use: 'wiki-owned-content' });
    bind({ fields: ['selection/court','selection/courtCounts'], sources: [ref('lore/relations/relations.json', '/directRetainers[courtId=court:K002]'), { sha256: dbHash, selector: 'table:person_disposition; key:person_id; columns:status' }], transform: 'directed-court-disposition-count-v1', use: 'wiki-owned-content' });
    bind({ fields: ['selection/titleBinding'], sources: [ref('lore/relations/opening-feudal-allocation.json', '/existingTitleBindings[holdingId=holding:yangcheon],/titles[titleId=title:duchy-gu-11470-S01],/titles[titleId=title:kingdom-s02]')], transform: 'holding-binding-title-parent-holder-v1', use: 'wiki-owned-content' });
    bind({ fields: ['selection/hegemons','parity/hegemons'], sources: [affiliationRef], transform: 'source-grouping-not-sovereign-v1', use: 'wiki-owned-content' });
    bind({ fields: ['parity/stations/control','parity/stations/surfacePolityIds','parity/edges/control','parity/edges/passage2126','parity/regions/polities','parity/regions/currentHegemons','parity/regions/status'], sources: [affiliationRef, controlRef, ...regionRefs, graphRef, atlasRef('/regions/*/{id,name,district_name,map_geometry}'), aliasRef, railRef], transform: 'current-catalog-surface-alias-control-and-passage-v1', use: ['wiki-owned-content','osm-world-graph-unknown-edition','boundary-2026'] });
    bind({ fields: ['parity/geography/titles/*/path','parity/geography/spatialDate'], sources: [geoRef('/spatialSource/baseDate,/titles/*/{rank,jurisdictionRefs,countyTitleIds}'), { path: map.geography.spatialSource.geometry.path, sha256: map.geography.spatialSource.geometry.sha256, selector: '/features/*/geometry' }, atlasRef('/regions/*/map_geometry')], transform: 'projectGeographicTitles-EPSG5179-v1', use: ['sgis-2025','boundary-2026','wiki-owned-content'] });
    bind({ fields: ['identityMap','parity/geography/currentDate','parity/geography/titles/*/id','parity/geography/titles/*/rank','parity/geography/titles/*/name','parity/geography/titles/*/parentId','parity/geography/titles/*/countyIds','parity/geography/titles/*/holderPersonId','parity/geography/titles/*/datedSlots','parity/geography/titles/*/currentSlots'], sources: [geoRef('/titles,/countySlots,/currentCorrespondenceSlots,/editions'), ...map.geography.sourceRecords.map(r => ({ id: r.id, sha256: r.sha256, selector: `geography.sourceRecords[id=${r.id}]; role:${r.role}` }))], editions: map.geography.editions, transform: 'authored-hierarchy-NEC-law-community-correspondence-public-id-v1', use: ['wiki-owned-content','public-correspondence-facts','boundary-2026'] });
    bind({ fields: ['parity/regions/id','parity/regions/name','parity/regions/district','parity/regions/stationCount','parity/regions/areaM2'], sources: [atlasRef('/regions/*/{id,name,district_name,station_ids,area_m2}')], transform: 'atlas-selected-labels-count-and-area-v1', use: ['wiki-owned-content','boundary-2026'] });
    bind({ fields: ['parity/regions/path','parity/width','parity/height'], sources: [atlasRef('/regions/*/map_geometry'), { sha256: map.atlas.source_selection.selected_boundary.sha256, selector: 'source_selection.selected_boundary' }], transform: 'catalog-bounds-map-point-ring-v1', use: 'boundary-2026' });
    bind({ fields: ['parity/stations/id','parity/stations/name','parity/stations/district','parity/stations/x','parity/stations/y'], sources: [graphRef, atlasRef('/regions/*/map_geometry')], transform: 'world-graph-EPSG4326-to-EPSG5179-map-bounds-v1', use: ['osm-world-graph-unknown-edition','boundary-2026'] });
    bind({ fields: ['parity/stations/degree','parity/stations/lineIds','parity/stations/memberIds','parity/edges/a','parity/edges/b','parity/edges/id','parity/edges/lineIds','parity/edges/sourceCodes','parity/aliases','parity/excludedStationIds'], sources: [aliasRef, railRef, graphRef, { sha256: map.atlas.source_selection.selected_boundary.sha256, selector: 'authenticated-boundary/features[properties.sido=11]' }], transform: 'explicit-alias-regular-adjacency-boundary-filter-no-shortcut-v1', use: ['wiki-owned-content','public-correspondence-facts','osm-world-graph-unknown-edition','boundary-2026'] });
    bind({ fields: ['selection/site'], sources: [atlasRef('/sites[id=osm:node:368899387]'), { sha256: map.atlas.source_selection.osm.sha256, selector: 'OSM node 368899387' }], transform: 'one-site-anchor-v1', use: 'osm-atlas-2026-09-04' });
    bind({ fields: ['selection/building'], sources: [ref('lore/regions/content/11470.json', '/regions[region_id=region:1147063000]/content/buildings[anchor_ref=osm:node:368899387]')], transform: 'one-building-two-floors-v1', use: 'wiki-owned-content' });
    for (const person of persons) {
      const value = queryPerson({ dbPath: exportDb, id: person.id }).person;
      bind({ fields: [`selection/persons/id=${person.id}/id`, `selection/persons/id=${person.id}/name`, `selection/persons/id=${person.id}/stateId`], sources: [ref('lore/name-pools/values-cast.json', `/people/${value.values_source_ordinal}`)], transform: 'selected-issued-identity-v1', use: 'wiki-owned-content' });
    }
    bind({ fields: ['selection/persons/*/disposition'], sources: [{ sha256: dbHash, selector: 'table:person_disposition; key:person_id; columns:status' }], transform: 'current-disposition-v1', use: 'wiki-owned-content' });
    const coverage = verifyFieldCoverage(map.projection, allowlist);
    manifest = { schema: 'campaign-source-manifest.v1',
      source: { repository: contentLicense.source, head, databaseSha256: dbHash, schemaVersion: 5, applicationId: '0x57435351', authority: db.prepare('SELECT version,sequence FROM document_authority').get(), heads: db.prepare('SELECT d.document_id,h.revision_id,r.semantic_sha256 FROM document_head h JOIN text_document d USING(source_id) JOIN document_revision r USING(source_id,revision_id) ORDER BY d.document_id').all(), generatedSha256: hash(generatedBytes), licenseSha256: hash(await readFile(join(wikiRoot, 'LICENSE'))) },
      selection: { persons, holding: { id: holding.id, holderPersonId: holding.holderPersonId, directLiegePersonId: holding.directLiegePersonId, stateId: holding.stateId, adminRefs: holding.adminRefs, wholeSeoulControl: holding.wholeSeoulControl }, titleBinding: { holdingId: binding.holding_id, titleId: binding.title_id, parentTitleId: boundTitle.parent_title_id, parentHolderPersonId: parentTitle.holder_person_id }, court, courtCounts: { active: court.filter(c => c.status === 'active').length, retired: court.filter(c => c.status === 'retired-current').length }, hegemons: map.contract.hegemons.map((h, i) => ({ kind: h.kind, name: h.name, memberStateIds: h.memberStateIds, ...(h.kind === 'state' ? { stateId: h.stateId } : {}), sourcePointer: `/data/currentAffiliation/hegemons/${i}`, ...(h.kind === 'union' ? { resolution: 'unresolved-source-binding' } : {}) })), site: { id: site.id, name: site.name, regionId: site.primary_region_id }, building },
      identityMap: map.geography.titles.map(t => ({ canonical: t.titleId, public: t.rank === 'county' ? map.publicGeographicId(t.titleId, 'county') : t.titleId })),
      parity: { transform: 'typed-current-catalog-selected-fields-v1', counts: { titles: map.projection.geography.titles.length, regions: map.projection.regions.length, stations: map.projection.stations.length, edges: map.projection.edges.length }, sha256: hash(JSON.stringify(map.projection)), excludedStationIds: map.excluded, aliases: map.aliases, semantics: { geography: 'inspection-only; current slots retain unassigned/holder-null/geometryVerified-false', control: 'not ownership or a grant', passage2126: 'source decision, not campaign execution admission', union: 'unresolved-source-binding', physicalRail: 'not imported; geometry is not an executable edge' } },
      rights: { licenses: [contentLicense, { id: 'osm-world-graph-unknown-edition', date: null, edition: 'unknown', inputSha256: WORLD_GRAPH_SOURCE_HASH, attribution: 'OpenStreetMap contributors; preserved BBBike world-graph coordinates, external snapshot edition unverified', license: 'ODbL-1.0', source: 'https://www.openstreetmap.org/copyright' }, { id: 'public-correspondence-facts', basis: 'Factual IDs, statutory membership and dates selected from preserved NEC/law/community records; no third-party prose or document reproduction licensed by this manifest', attribution: 'National Election Commission; Korean public election law; administrative successor records; vuski/admdongkor for candidate name/code lookup', source: 'https://www.nec.go.kr', records: map.geography.sourceRecords }, { id: 'sgis-2025', date: '2025-06-30', sha256: '6a393cefb7cc257f001042acb8715e5d721b320e14eba723f15857197edaa5e4', attribution: 'SGIS', license: 'KOGL-Type-1' }, { id: 'boundary-2026', date: map.atlas.source_selection.selected_boundary.source_effective_date, sha256: map.atlas.source_selection.selected_boundary.sha256, attribution: map.atlas.source_selection.selected_boundary.attribution, license: 'CC-BY-4.0', source: map.atlas.source_selection.selected_boundary.source_url }, { id: 'osm-atlas-2026-09-04', date: map.atlas.source_selection.osm.snapshot_at, sha256: map.atlas.source_selection.osm.sha256, attribution: 'OpenStreetMap contributors', license: 'ODbL-1.0', source: 'https://www.openstreetmap.org/copyright' }], allowlist, coverage, excluded: ['portraits','real-person-permission-records','Soul','private-evidence','biographies','unrelated-persons','terrain','physical-rail'], selectedRealPersonRegistryMatches: [], newConsentGranted: false, playStartAdmission: false } };
    manifest.rights.selectionCoverage = verifyFieldCoverage(manifest.selection, allowlist, 'selection');
  } finally { db.close(); }
  if (await fileHash(canonicalDb) !== dbHash || await fileHash(exportDb) !== dbHash || git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=no') !== dirty) fail('E_CAMPAIGN_STALE', 'source changed during read');
  await noSidecars(canonicalDb); await noSidecars(exportDb); return JSON.parse(JSON.stringify(manifest));
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log('Usage: campaign-source-manifest.mjs --wiki-root <wiki> --export-db <fresh.sqlite> --out <new.json> [--generated <snapshot.json>]'); return; }
  const names = { '--wiki-root': 'wikiRoot', '--export-db': 'exportDb', '--out': 'out', '--generated': 'generated' }, options = {};
  for (let i = 0; i < args.length; i++) { const token = args[i], key = Object.hasOwn(names, token) ? names[token] : null, value = args[++i]; if (!key || options[key] || !value || value.startsWith('--')) fail('E_CAMPAIGN_USAGE', 'missing, duplicate or unknown option'); options[key] = value; }
  if (!options.wikiRoot || !options.exportDb || !options.out) fail('E_CAMPAIGN_USAGE', '--wiki-root, --export-db and --out required');
  const output = resolve(options.out), root = await realpath(options.wikiRoot), path = relative(root, output); if (!path.startsWith('..')) fail('E_CAMPAIGN_OUTPUT', 'cannot write inside wiki');
  try { await lstat(output); fail('E_CAMPAIGN_OUTPUT_EXISTS', 'output must be absent'); } catch (e) { if (!(e instanceof Error) || e.code !== 'ENOENT') throw e; }
  const manifest = await buildManifest(options), temp = join(dirname(output), `.campaign-source-${process.pid}.tmp`), file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(encode(manifest)); await file.close(); await link(temp, output); } finally { await file.close(); await unlink(temp); }
  console.log(JSON.stringify({ status: 'PASS', schema: manifest.schema, ...manifest.parity.counts, sha256: hash(encode(manifest)) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { if (!(error instanceof Error)) throw error; console.error(error.message); process.exitCode = 1; }
}
