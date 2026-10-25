#!/usr/bin/env node
// Graph conversion with the approved licensed station layout package.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { validateLedger } from './asset-ledger-validate.mjs';

export const DEFAULT_SOURCE = process.env.SEOUL_WORLD_GRAPH_SOURCE;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const mapId = id => 'station-' + Buffer.from(id).toString('hex');
// Task-7 input package, pinned to 68870a6. application.json is a contract,
// not a map. Filename and byte identity are both required for this exception.
const TEMPLATE_HASHES = Object.freeze({
  'Guro.json': 'a739f7f611136590211f75af10a35b8e6de452884bc98aba1327adb29ff02a83',
  'Sindorim.json': 'd5b60a00cb3a97ca536d473a94f0b36dad03193632d782de62999c856da00a96',
  'Yeongdeungpo.json': 'a5ccca39985137db770b0c3484f89ee6263f673d12561ac00344cd450049ebfe',
  'application.json': 'ab154704b054dbe31444d481960deadff5bee3c865d7b09748952fecd49ce4cd',
  'corridor.json': '5d9aae04ac16ac40558424d5dd298ce0e759adc21dd00a9adc4f4a391a3aabf1',
  'platform.json': '64e7947081ff943d3cffd9ab7e2410566378160112cf96a9a599f0a4374e3c02',
});
export function mapInventory(output, allowMissing = false) {
  const maps = join(output, 'maps');
  let entries;
  try { entries = readdirSync(maps, { withFileTypes: true }); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return []; throw error; }
  const filenames = [];
  for (const entry of entries) {
    if (entry.name !== 'templates') {
      assert(entry.isFile(), 'Stale map file inventory: ' + entry.name);
      filenames.push(entry.name);
      continue;
    }
    assert(entry.isDirectory(), 'Invalid template inventory: templates');
    const templates = join(maps, 'templates');
    const packages = readdirSync(templates, { withFileTypes: true });
    assert(packages.length === 1 && packages[0].name === 'seoul_station' && packages[0].isDirectory(), 'Invalid template inventory: templates');
    const directory = join(templates, 'seoul_station');
    const files = readdirSync(directory, { withFileTypes: true });
    assert.deepEqual(files.map(file => file.name).sort(), Object.keys(TEMPLATE_HASHES).sort(), 'Invalid template inventory: seoul_station');
    for (const file of files) {
      assert(file.isFile(), 'Invalid template file: ' + file.name);
      assert.equal(hash(readFileSync(join(directory, file.name))), TEMPLATE_HASHES[file.name], 'Template bytes changed: ' + file.name);
    }
  }
  return filenames.sort();
}
const pair = (a, b) => JSON.stringify([a, b].sort());
// Atlas cells are presentation only: east is +x, south is +y. Each source
// bbox axis scales independently to [0, size - 1], rounded to the nearest cell.
// A zero-span axis maps to 0; coincident cells never imply movement links.
// CLI: --atlas-width N --atlas-height N (positive safe integers, default 256).
export const DEFAULT_PROJECTION = Object.freeze({ width: 256, height: 256 });
export function projectAtlas(stations, config = DEFAULT_PROJECTION) {
  const { width, height } = config;
  assert(Object.keys(config).every(key => ['width', 'height'].includes(key)), 'Unknown atlas projection option');
  assert([width, height].every(n => Number.isSafeInteger(n) && n > 0), 'Invalid atlas dimensions');
  const bbox = {
    minLat: Math.min(...stations.map(s => s.lat)), maxLat: Math.max(...stations.map(s => s.lat)),
    minLon: Math.min(...stations.map(s => s.lon)), maxLon: Math.max(...stations.map(s => s.lon)),
  };
  const cell = (value, min, max, size) => max === min ? 0 : Math.round((value - min) / (max - min) * (size - 1));
  return {
    method: 'source-bbox-linear-v1', width, height, bbox, xAxis: 'east', yAxis: 'south', rounding: 'nearest', zeroSpanCell: 0,
    positions: Object.fromEntries([...stations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(s => [s.id, {
      x: cell(s.lon, bbox.minLon, bbox.maxLon, width),
      y: cell(bbox.maxLat - s.lat, 0, bbox.maxLat - bbox.minLat, height),
    }])),
  };
}
export function validateSource(source) {
  assert.equal(source.schema, 'seoul-world-graph-v2', 'Invalid source schema');
  assert(Array.isArray(source.stations) && source.stations.length > 0, 'Missing stations');
  assert(Array.isArray(source.edges) && Array.isArray(source.districts), 'Missing graph arrays');
  const districts = new Set(source.districts);
  assert.equal(districts.size, source.districts.length, 'Duplicate district');
  assert(source.districts.every(d => typeof d === 'string' && d.length), 'Invalid district');
  const ids = new Set();
  for (const s of source.stations) {
    assert(typeof s.id === 'string' && s.id.length && !ids.has(s.id), 'Invalid or duplicate station ID');
    ids.add(s.id);
    assert(typeof s.nameKo === 'string' && typeof s.nameEn === 'string', 'Missing bilingual name');
    assert(districts.has(s.district), 'Unknown district');
    assert(Number.isFinite(s.lat) && s.lat >= -90 && s.lat <= 90 && Number.isFinite(s.lon) && s.lon >= -180 && s.lon <= 180, 'Invalid coordinates');
  }
  const edges = new Set();
  for (const e of source.edges) {
    assert(e && ids.has(e.a) && ids.has(e.b) && e.a !== e.b, 'Invalid edge endpoint');
    const key = pair(e.a, e.b);
    assert(!edges.has(key), 'Duplicate undirected edge');
    edges.add(key);
  }
  assert(source.aliases && typeof source.aliases === 'object' && !Array.isArray(source.aliases), 'Invalid aliases');
  for (const [alias, id] of Object.entries(source.aliases)) assert(alias.length && ids.has(id), 'Unknown alias target');
  assert(source.source && typeof source.source === 'object', 'Missing source provenance');
  return source;
}

// Use the actual engine parser, not a converter-owned approximation of Project.
let enginePromise;
export function engineParser() {
  return enginePromise ??= (async () => {
    const engine = join(ROOT, 'engine');
    const require = createRequire(join(engine, 'package.json'));
    const { build } = require('esbuild');
    const result = await build({ stdin: { contents: 'export { validateProjectV4 } from "./src/project/io/shape.ts"; export { canMove, isPassable, isPassableLanding } from "./src/project/collision.ts";', resolveDir: engine }, bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': join(engine, 'src') }, logLevel: 'silent' });
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  })();
}
const movement = await engineParser();
export function stationPackage(root = ROOT, proofMap = process.env.ASSET_PROOF_MAP) {
  const load = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const directory = 'game/maps/templates/seoul_station/';
  mapInventory(join(root, 'game'));
  const application = load(directory + 'application.json');
  const ledger = load('game/assets/ledger/ledger.json');
  const errors = validateLedger(ledger, root, proofMap);
  assert.equal(errors.length, 0, 'Station asset admission rejected: ' + errors.join('; '));
  const assetDirectory = 'game/assets/tilesets/seoul_station/';
  const files = readdirSync(join(root, assetDirectory));
  assert.equal(files.length, 7, 'Station asset inventory changed');
  for (const file of files) {
    const path = assetDirectory + file;
    const entry = ledger.assets.find(a => (a.derived_filename || a.source_filename) === path);
    assert(entry?.review_status === 'approved' && entry.commercial_game_allowed && entry.editing_allowed && entry.game_build_redistribution_allowed && entry.public_repo_derivative_allowed, 'Unapproved station asset: ' + file);
    assert.equal(hash(readFileSync(join(root, path))), entry.derived_hash || entry.source_hash, 'Station asset hash mismatch: ' + file);
  }
  const tileset = load(application.tileset);
  const png = readFileSync(join(root, assetDirectory, 'seoul_station.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid atlas PNG');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(width, tileset.tilesPerRow * tileset.tileSize);
  assert.equal(height * width, tileset.count * tileset.tileSize ** 2);
  const templates = Object.fromEntries([application.defaultTemplate, application.secondaryTemplate, ...Object.values(application.overrides)].map(file => [file, load(directory + file)]));
  return { application, tileset, templates, uploaded: { id: tileset.image.id, name: 'seoul_station.png', kind: 'tileset', dataUrl: 'data:image/png;base64,' + png.toString('base64'), meta: { width, height, tileSize: tileset.tileSize } } };
}
export function reachableCells(project, map, start) {
  assert(movement.isPassableLanding(project, map, start.x, start.y), 'Unsafe station arrival');
  const cells = [start], seen = new Set([start.y * map.width + start.x]);
  for (let i = 0; i < cells.length; i++) {
    const { x, y } = cells[i];
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      const key = ny * map.width + nx;
      if (!seen.has(key) && movement.canMove(project, map, x, y, nx, ny)) { seen.add(key); cells.push({ x: nx, y: ny }); }
    }
  }
  return cells;
}
export function convert(sourceBytes, template, projection = DEFAULT_PROJECTION, pack = stationPackage()) {
  const source = validateSource(JSON.parse(sourceBytes));
  const atlas = projectAtlas(source.stations, projection);
  const adjacency = new Map(source.stations.map(s => [s.id, []]));
  for (const { a, b } of source.edges) { adjacency.get(a).push(b); adjacency.get(b).push(a); }
  const layouts = new Map(source.stations.map(station => [station.id, template ?? pack.templates[pack.application.overrides[station.id] ?? pack.application.defaultTemplate]]));
  const arrivals = new Map([...layouts].map(([id, layout]) => [id, layout.startPos ?? { x: layout.width - 2, y: layout.height - 2 }]));
  const maps = {};
  for (const station of source.stations) {
    const layout = layouts.get(station.id);
    const { width, height, tileSize, lowerTiles, upperTiles } = layout;
    assert(Number.isSafeInteger(width) && width >= 4 && Number.isSafeInteger(height) && height >= 4 && width * height <= 1000000, 'Invalid template dimensions');
    assert(Number.isSafeInteger(tileSize) && tileSize > 0, 'Invalid tile size');
    for (const layer of [lowerTiles, upperTiles]) assert(Array.isArray(layer) && layer.length === width * height && layer.every(n => Number.isSafeInteger(n) && n >= -1 && n < pack.tileset.count), 'Invalid template layer');
    const map = { id: mapId(station.id), name: station.nameKo, station: structuredClone(station), tilesetId: 'seoul_station', width, height, tileSize, lowerTiles: [...lowerTiles], upperTiles: [...upperTiles], events: structuredClone(layout.events ?? []) };
    const projectView = { tilesets: { seoul_station: pack.tileset } };
    const arrival = arrivals.get(station.id);
    const reachable = reachableCells(projectView, map, arrival);
    const occupied = new Set([arrival, ...map.events].map(p => p.y * width + p.x));
    const reachableKeys = new Set(reachable.map(p => p.y * width + p.x));
    const candidates = [...(layout.exitAnchors ?? []), ...reachable].filter(p => reachableKeys.has(p.y * width + p.x));
    const exits = [];
    for (const p of candidates) {
      const key = p.y * width + p.x;
      if (!occupied.has(key) && movement.isPassableLanding(projectView, map, p.x, p.y)) { occupied.add(key); exits.push(p); }
    }
    const neighbors = adjacency.get(station.id).sort();
    assert(neighbors.length <= exits.length, 'Template has insufficient safe exit cells');
    const events = neighbors.map((id, index) => ({
      id: 'exit-' + mapId(id), name: 'Transfer to ' + id,
      ...exits[index],
      trigger: { kind: 'action' }, commands: [],
      pages: [{ id: 'exit', name: 'Exit', conditions: [], graphic: {}, trigger: { kind: 'action' }, priority: 'below', movement: { type: 'fixed', speed: 3, frequency: 3 }, commands: [{ kind: 'transfer', mapId: mapId(id), ...arrivals.get(id) }] }],
    }));
    map.events.push(...events);
    maps[map.id] = map;
  }
  const startMapId = mapId(source.stations.some(s => s.id === 'Yeongdeungpo') ? 'Yeongdeungpo' : source.stations[0].id);
  const project = {
    version: 4, meta: { title: 'Seoul Dengoku JRPG', author: '', terms: {} },
    assets: { sprites: {}, uploaded: { [pack.uploaded.id]: structuredClone(pack.uploaded) } }, resourceProfiles: [],
    tilesets: { seoul_station: structuredClone(pack.tileset) },
    switches: [], variables: [], commonEvents: [],
    database: { actors: [], classes: [], skills: [], items: [], equipment: [], enemies: [], troops: [], states: [], battleAnimations: [] },
    system: { startActorIds: [] }, session: { switches: {}, variables: {}, inventory: {}, partyActorIds: [] },
    maps, mapConnections: [], mapTree: { mapId: startMapId, children: Object.keys(maps).filter(id => id !== startMapId).map(mapId => ({ mapId, children: [] })) },
    startMapId, startPos: { ...arrivals.get(maps[startMapId].station.id) }, flags: {}, villageInfoDocuments: [],
  };
  const graph = { ...structuredClone(source), isolates: source.stations.filter(s => !adjacency.get(s.id).length).map(s => s.id), sourceSha256: hash(sourceBytes), presentation: { layoutsApplied: true, visualAcceptancePending: true, playable: false }, mapIds: Object.fromEntries(source.stations.map(s => [s.id, mapId(s.id)])) };
  graph.atlas = atlas;
  return { project, graph };
}
export function options(args, outputFlag = '--output') {
  const opts = { source: DEFAULT_SOURCE, output: join(ROOT, 'game'), dry: false, projection: { ...DEFAULT_PROJECTION } };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry' && outputFlag === '--output') opts.dry = true;
    else if (['--atlas-width', '--atlas-height'].includes(args[i])) {
      const flag = args[i], value = args[++i];
      assert(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)), 'Invalid atlas dimension: ' + flag);
      opts.projection[flag.slice(8)] = Number(value);
    }
    else if (['--source', outputFlag, '--template', '--proof-map'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      const key = args[i] === outputFlag ? 'output' : args[i].slice(2);
      opts[key] = args[++i];
    }
    else throw new Error('Unknown or incomplete option: ' + args[i]);
  }
  return opts;
}
export async function main(args = process.argv.slice(2)) {
  const opts = options(args);
  assert(opts.source, 'Missing graph source: supply --source or SEOUL_WORLD_GRAPH_SOURCE');
  const bytes = readFileSync(opts.source);
  const result = convert(bytes, opts.template ? JSON.parse(readFileSync(opts.template, 'utf8')) : undefined, opts.projection, stationPackage(ROOT, opts['proof-map']));
  const { validateProjectV4 } = await engineParser();
  validateProjectV4(structuredClone(result.project));
  const summary = { stations: Object.keys(result.project.maps).length, edges: result.graph.edges.length, districts: result.graph.districts.length, isolates: result.graph.isolates.length, sourceSha256: hash(bytes), layoutsApplied: true, visualAcceptancePending: true, playable: false };
  if (!opts.dry) {
    const files = { 'project.json': result.project, 'data/world/graph.json': result.graph, ...Object.fromEntries(Object.entries(result.project.maps).map(([id, map]) => ['maps/' + id + '.json', map])) };
    const output = resolve(opts.output);
    // Refuse stale extra maps rather than silently deleting user work.
    assert(mapInventory(output, true).every(name => Object.hasOwn(files, 'maps/' + name)), 'Stale extra map file');
    for (const [path, data] of Object.entries(files)) {
      const target = join(output, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(data) + '\n');
    }
  }
  console.log(JSON.stringify({ dry: opts.dry, ...summary }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
