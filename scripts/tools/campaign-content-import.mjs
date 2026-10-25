import { createHash } from 'node:crypto';
import { readFile, realpath, lstat, mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildManifest } from './campaign-source-manifest.mjs';
import { readSource, consumeRail, selectDependencies, railPath } from './campaign-source-selectors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => `${JSON.stringify(value)}\n`;
const mapId = id => `station-${Buffer.from(id).toString('hex')}`;
export class ImportError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; }
}
const fail = (code, detail) => { throw new ImportError(code, detail); };
function unique(rows, key) {
  const values = rows.map(row => row[key]);
  if (values.some(id => typeof id !== 'string' || !id) || new Set(values).size !== values.length) fail('E_IMPORT_DUPLICATE', key);
  return new Set(values);
}

export function projectContent(input) {
  const { manifest, snapshot, legacy, rail, regularLineGraph } = input;
  const regions = snapshot.regions.map(({ id, name, district, path, polities, currentHegemons, status, stationCount, areaM2 }) => ({ id, name, district, path, polities, currentHegemons, status, stationCount, areaM2 }));
  const projection = { geography: snapshot.geography, regions, stations: snapshot.stations, edges: snapshot.edges, hegemons: snapshot.hegemons, width: snapshot.width, height: snapshot.height };
  if (digest(JSON.stringify(projection)) !== manifest.parity.sha256) fail('E_IMPORT_PARITY', 'selected map fields');
  const stationIds = unique(projection.stations, 'id'), regionIds = unique(regions, 'id');
  unique(projection.edges, 'id'); unique(manifest.selection.persons, 'id');
  const titleIds = unique(projection.geography.titles, 'id');
  const canonicalIds = unique(manifest.identityMap, 'canonical'), publicIds = unique(manifest.identityMap, 'public');
  if (!isDeepStrictEqual([...publicIds].sort(), [...titleIds].sort())) fail('E_IMPORT_TITLE', 'canonical/public bijection');
  for (const title of projection.geography.titles) {
    if (title.parentId !== null && !titleIds.has(title.parentId)) fail('E_IMPORT_TITLE', title.id);
    if (title.countyIds.some(id => !titleIds.has(id))) fail('E_IMPORT_TITLE', title.id);
  }
  if (!canonicalIds.size) fail('E_IMPORT_TITLE', 'missing canonical mapping');
  const aliases = new Map();
  for (const group of manifest.parity.aliases) {
    if (!stationIds.has(group.id) || !group.source) fail('E_IMPORT_ALIAS', group.id);
    for (const alias of group.aliases) {
      if (aliases.has(alias) || stationIds.has(alias) || !Object.hasOwn(group.observed_lines, alias)) fail('E_IMPORT_ALIAS', alias);
      aliases.set(alias, group.id);
    }
    const station = projection.stations.find(s => s.id === group.id);
    if (!isDeepStrictEqual(station.memberIds, [group.id, ...group.aliases])) fail('E_IMPORT_ALIAS', group.id);
  }
  const excluded = new Set(manifest.parity.excludedStationIds);
  if ([...excluded].some(id => stationIds.has(id) || aliases.has(id))) fail('E_IMPORT_EXCLUDED', 'selected excluded station');
  const regular = regularLineGraph(rail, [...stationIds], { excludedStationIds: [...excluded] });
  const edgeFields = edges => edges.map(({ a, b, lineIds, sourceCodes }) => ({ a, b, lineIds, sourceCodes }));
  if (!isDeepStrictEqual(edgeFields(projection.edges), edgeFields(regular.edges))) fail('E_IMPORT_EDGE', 'source-code adjacency mismatch');
  for (const edge of projection.edges) if (!stationIds.has(edge.a) || !stationIds.has(edge.b)) fail('E_IMPORT_EDGE', edge.id);
  for (const ref of manifest.selection.holding.adminRefs) if (!regionIds.has(ref.id)) fail('E_IMPORT_HOLDING', ref.id);
  if (!regionIds.has(manifest.selection.site.regionId)) fail('E_IMPORT_HOLDING', 'site region');
  unique(legacy.stations, 'id');
  const stations = legacy.stations.map(({ id }) => {
    const oldMapId = legacy.mapIds[id];
    if (oldMapId !== mapId(id)) fail('E_IMPORT_LEGACY', id);
    if (excluded.has(id)) return { oldId: id, oldMapId, status: 'excluded', newId: null, reason: 'outside-seoul', placement: 'unsupported' };
    const newId = stationIds.has(id) ? id : aliases.get(id);
    if (!newId) fail('E_IMPORT_ALIAS', id);
    return { oldId: id, oldMapId, status: id === newId ? 'exact' : 'authenticated-alias', newId, newMapId: mapId(newId), placement: id === newId ? 'station-identity-only' : 'unsupported' };
  });
  const source = { manifestSha256: input.manifestSha256, ...manifest.source };
  // Public client provenance needs source pins, not the complete document-head inventory.
  delete source.heads;
  const edition = `campaign-${source.head}-${manifest.parity.sha256}`;
  const atlas = { schema: 'campaign-atlas.v1', edition, source, ...projection,
    mapIds: Object.fromEntries(projection.stations.map(s => [s.id, mapId(s.id)])),
    selection: manifest.selection, semantics: manifest.parity.semantics,
    transport: { executionAdmission: false, omittedPairs: regular.omitted, physicalRail: { included: false, executable: false } },
    rights: { licenses: manifest.rights.licenses, playStartAdmission: false, changed: true } };
  const identityMap = { schema: 'campaign-identity-map.v1', edition, source,
    legacyEdition: { schema: legacy.schema, graphSha256: input.legacySha256, path: 'game/data/world/graph.json', immutable: true },
    titles: manifest.identityMap, stations, persons: manifest.selection.persons.map(p => ({ oldId: p.id, newId: p.id, status: 'exact' })),
    references: [manifest.selection.holding.id, ...manifest.selection.holding.adminRefs.map(r => r.id), manifest.selection.site.id].map(id => ({ oldId: id, newId: id, status: 'exact' })),
    unsupported: ['local-tile-placement', 'route-progress', 'combat-state', 'unknown-identity'].map(kind => ({ kind, action: 'preserve-checkpoint-and-quarantine-export' })) };
  return { atlas, identityMap };
}

export async function loadContent(options) {
  const manifestBytes = await readFile(options.manifest), manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'campaign-source-manifest.v1') fail('E_IMPORT_MANIFEST', 'schema');
  const wikiRoot = await realpath(options.wikiRoot);
  const source = await readSource(wikiRoot);
  if (source.provenance.head !== manifest.source.head || source.provenance.databaseSha256 !== manifest.source.databaseSha256) fail('E_IMPORT_SOURCE', 'source pins');
  const railRefs = manifest.rights.allowlist.flatMap(entry => entry.sources).filter(ref => ref.path === railPath);
  if (!railRefs.length) fail('E_IMPORT_DEPENDENCY', railPath);
  for (const ref of railRefs) {
    consumeRail(source.rail, ref.selectors);
    const resolved = selectDependencies(source.rail, ref.selectors).map(row => ({ path: row.path, sha256: digest(JSON.stringify(row.value)) }));
    if (!isDeepStrictEqual(resolved, ref.resolved)) fail('E_IMPORT_DEPENDENCY', railPath);
  }
  const authenticated = await buildManifest({ wikiRoot, exportDb: join(wikiRoot, 'data/canonical/wiki-cast.sqlite') });
  if (!isDeepStrictEqual(manifest, authenticated)) fail('E_IMPORT_MANIFEST', 'authenticated manifest differs');
  const snapshotBytes = await readFile(join(wikiRoot, 'public/opening-territories.json'));
  if (digest(snapshotBytes) !== manifest.source.generatedSha256) fail('E_IMPORT_SOURCE', 'generated snapshot');
  const legacyBytes = await readFile(join(ROOT, 'game/data/world/graph.json'));
  const { regularLineGraph } = await import(new URL('scripts/regular-line-graph.mjs', `file://${wikiRoot}/`).href);
  return projectContent({ manifest, snapshot: JSON.parse(snapshotBytes), legacy: JSON.parse(legacyBytes),
    rail: consumeRail(source.rail), regularLineGraph, manifestSha256: digest(manifestBytes), legacySha256: digest(legacyBytes) });
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log('Usage: campaign-content-import.mjs --manifest <source-manifest.json> --out <directory> [--wiki-root <readonly-wiki>]'); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!['--manifest', '--out', '--wiki-root'].includes(key) || options.has(key) || !value || value.startsWith('--')) fail('E_IMPORT_USAGE', 'unknown, duplicate or missing option');
    options.set(key, value);
  }
  if (!options.has('--manifest') || !options.has('--out')) fail('E_IMPORT_USAGE', '--manifest and --out required');
  const wikiRoot = await realpath(options.get('--wiki-root') ?? process.env.WIKI_ROOT ?? resolve(ROOT, '../../seoul-dengoku-wiki'));
  const output = resolve(options.get('--out'));
  const parent = await realpath(dirname(output));
  const target = join(parent, output.slice(dirname(output).length + 1));
  if (!relative(wikiRoot, target).startsWith('..')) fail('E_IMPORT_OUTPUT', 'read-only wiki');
  try { if (!(await lstat(target)).isDirectory()) fail('E_IMPORT_OUTPUT', 'plain directory required'); }
  catch (error) { if (!(error instanceof Error) || error.code !== 'ENOENT') throw error; }
  const paths = ['atlas.json', 'identity-map.json'].map(name => join(target, name));
  for (const path of paths) {
    try { await lstat(path); fail('E_IMPORT_OUTPUT', 'output must be absent'); }
    catch (error) { if (!(error instanceof Error) || error.code !== 'ENOENT') throw error; }
  }
  const result = await loadContent({ manifest: resolve(options.get('--manifest')), wikiRoot });
  await mkdir(target, { recursive: true });
  const published = [];
  try {
    for (const [index, value] of [result.atlas, result.identityMap].entries()) {
      const temp = `${paths[index]}.${process.pid}.tmp`, file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(encode(value)); await file.close(); await link(temp, paths[index]); published.push(paths[index]); }
      finally { await file.close(); await unlink(temp); }
    }
  } catch (error) { for (const path of published) await unlink(path); throw error; }
  console.log(JSON.stringify({ status: 'PASS', edition: result.atlas.edition, stations: result.atlas.stations.length, edges: result.atlas.edges.length, atlasSha256: digest(encode(result.atlas)), identityMapSha256: digest(encode(result.identityMap)) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { if (!(error instanceof Error)) throw error; console.error(error.message); process.exitCode = 1; }
}
