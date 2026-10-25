#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { DEFAULT_SOURCE, engineParser, hash, validateSource, mapInventory, stationPackage } from './seoul-map-convert.mjs';
const load = path => JSON.parse(readFileSync(path, 'utf8'));
// Deliberately do not use converter adjacency, map-ID construction, or graph.mapIds
// to discover connections. Only engine commands and actual target maps are authoritative.
export async function check(sourcePath, output, proofMap = process.env.ASSET_PROOF_MAP) {
  const bytes = readFileSync(sourcePath);
  const source = validateSource(JSON.parse(bytes));
  const project = load(join(output, 'project.json'));
  const graph = load(join(output, 'data/world/graph.json'));
  assert.equal(graph.sourceSha256, hash(bytes), 'Stale source hash');
  for (const key of Object.keys(source)) assert.deepEqual(graph[key], source[key], 'Source field changed: ' + key);
  const atlas = graph.atlas;
  assert(atlas && [atlas.width, atlas.height].every(n => Number.isSafeInteger(n) && n > 0), 'Invalid atlas dimensions');
  const lats = source.stations.map(s => s.lat), lons = source.stations.map(s => s.lon);
  const bbox = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
  // Recompute from original coordinates, independently of converter projection code.
  const positions = Object.fromEntries(source.stations.map(s => [s.id, {
    x: bbox.maxLon === bbox.minLon ? 0 : Math.round((s.lon - bbox.minLon) * (atlas.width - 1) / (bbox.maxLon - bbox.minLon)),
    y: bbox.maxLat === bbox.minLat ? 0 : Math.round((bbox.maxLat - s.lat) * (atlas.height - 1) / (bbox.maxLat - bbox.minLat)),
  }]));
  assert.deepEqual(atlas, { method: 'source-bbox-linear-v1', width: atlas.width, height: atlas.height, bbox, xAxis: 'east', yAxis: 'south', rounding: 'nearest', zeroSpanCell: 0, positions }, 'Atlas projection mismatch');
  const { validateProjectV4, canMove, isPassableLanding } = await engineParser();
  const pack = stationPackage(undefined, proofMap);
  assert.deepEqual(project.tilesets.seoul_station, pack.tileset, 'Station tileset changed');
  assert.deepEqual(project.assets.uploaded[pack.uploaded.id], pack.uploaded, 'Station atlas image changed');
  const parsed = validateProjectV4(structuredClone(project));
  assert.equal(Object.keys(parsed.maps).length, source.stations.length, 'Engine map count changed');
  assert.equal(Object.keys(project.maps).length, source.stations.length, 'Wrong map count');
  const stationByMap = new Map();
  const seen = new Set();
  const sourceStations = new Map(source.stations.map(s => [s.id, s]));
  const filenames = mapInventory(output);
  assert.deepEqual(filenames, Object.keys(project.maps).map(id => id + '.json').sort(), 'Stale map file inventory');
  for (const [id, map] of Object.entries(project.maps)) {
    assert(/^station-[a-f0-9]+$/.test(id), 'Unsafe map ID');
    assert.equal(id, map.id, 'Map ID mismatch');
    assert.deepEqual(map, load(join(output, 'maps', id + '.json')), 'Stale project/map copies');
    assert(sourceStations.has(map.station?.id) && !seen.has(map.station.id), 'Unknown or duplicate station mapping');
    seen.add(map.station.id);
    assert.deepEqual(map.station, sourceStations.get(map.station.id), 'Station metadata changed');
    assert.equal(map.name, map.station.nameKo, 'Map name changed');
    assert.equal(map.tilesetId, 'seoul_station');
    assert.equal(map.transit, undefined, 'Station adjacency must not use local transit');
    stationByMap.set(id, map.station.id);
    assert.equal(graph.mapIds[map.station.id], id, 'Graph map registration mismatch');
  }
  const tree = [];
  function walk(node) { assert(node && Array.isArray(node.children), 'Malformed mapTree'); tree.push(node.mapId); node.children.forEach(walk); }
  walk(project.mapTree);
  assert.deepEqual(tree.sort(), Object.keys(project.maps).sort(), 'mapTree must register each map once');
  assert.equal(stationByMap.get(project.startMapId), 'Yeongdeungpo', 'Wrong POC start');
  const key = (a, b) => JSON.stringify([a, b]);
  const expected = new Set(source.edges.flatMap(({ a, b }) => [key(a, b), key(b, a)]));
  const actual = new Set();
  for (const [id, map] of Object.entries(project.maps)) {
    const layout = pack.templates[pack.application.overrides[map.station.id] ?? pack.application.defaultTemplate];
    for (const field of ['width', 'height', 'tileSize', 'lowerTiles', 'upperTiles']) assert.deepEqual(map[field], layout[field], 'Station layout changed: ' + field);
    const start = layout.startPos;
    assert(isPassableLanding(project, map, start.x, start.y), 'Unsafe arrival');
    // Independent flood fill uses the engine's directional movement, not converter cells.
    const reached = new Set([start.y * map.width + start.x]), queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i];
      for (const [nx, ny] of [[x - 1, y], [x, y - 1], [x + 1, y], [x, y + 1]]) {
        const cell = ny * map.width + nx;
        if (!reached.has(cell) && canMove(project, map, x, y, nx, ny)) { reached.add(cell); queue.push({ x: nx, y: ny }); }
      }
    }
    const positions = new Set();
    const eventIds = new Set();
    for (const event of map.events) {
      assert(isPassableLanding(project, map, event.x, event.y) && reached.has(event.y * map.width + event.x), 'Unsafe or unreachable exit');
      assert(event.x !== start.x || event.y !== start.y, 'Exit overlaps arrival');
      assert(!eventIds.has(event.id), 'Duplicate event ID'); eventIds.add(event.id);
      assert(Number.isSafeInteger(event.x) && event.x >= 0 && event.x < map.width && Number.isSafeInteger(event.y) && event.y >= 0 && event.y < map.height, 'Exit outside map');
      assert(!positions.has(key(event.x, event.y)), 'Overlapping exits'); positions.add(key(event.x, event.y));
      assert.equal(event.trigger.kind, 'action', 'Exit trigger changed');
      assert.deepEqual(event.commands, [], 'Unexpected legacy commands');
      assert.equal(event.pages?.length, 1, 'Exit must have one unconditional page');
      const page = event.pages[0];
      assert.deepEqual(page.conditions, [], 'Conditional exit');
      assert.equal(page.trigger.kind, 'action', 'Inactive exit');
      assert.equal(page.commands.length, 1, 'Unexpected exit commands');
      const command = page.commands[0];
      assert.equal(command.kind, 'transfer', 'Not an engine transfer command');
      assert(stationByMap.has(command.mapId), 'Unknown transfer target');
      const target = project.maps[command.mapId];
      assert(Number.isSafeInteger(command.x) && command.x >= 0 && command.x < target.width && Number.isSafeInteger(command.y) && command.y >= 0 && command.y < target.height, 'Invalid transfer position');
      assert(!target.events.some(e => e.x === command.x && e.y === command.y), 'Arrival overlaps exit');
      assert(isPassableLanding(project, target, command.x, command.y), 'Unsafe transfer destination');
      const edge = key(stationByMap.get(id), stationByMap.get(command.mapId));
      assert(!actual.has(edge), 'Duplicate directed transfer');
      actual.add(edge);
    }
  }
  const missing = [...expected].filter(edge => !actual.has(edge));
  const extra = [...actual].filter(edge => !expected.has(edge));
  assert(!missing.length && !extra.length, 'EDGE SET MISMATCH missing=' + JSON.stringify(missing.slice(0, 4)) + ' extra=' + JSON.stringify(extra.slice(0, 4)));
  for (const [a, b] of [['Yeongdeungpo', 'Sindorim'], ['Sindorim', 'Guro']]) assert(actual.has(key(a, b)) && actual.has(key(b, a)), 'Missing POC link');
  assert(!actual.has(key('Yeongdeungpo', 'Guro')) && !actual.has(key('Guro', 'Yeongdeungpo')), 'Forbidden POC shortcut');
  const isolates = source.stations.filter(s => !source.edges.some(e => e.a === s.id || e.b === s.id)).map(s => s.id);
  assert.deepEqual(graph.isolates, isolates, 'Isolates changed');
  for (const id of isolates) assert(![...actual].some(edge => JSON.parse(edge).includes(id)), 'Isolate connected');
  assert.equal(source.stations.length, 334, 'Expected 334 stations');
  assert.equal(source.edges.length, 409, 'Expected 409 source edges');
  assert.equal(source.districts.length, 25, 'Expected 25 districts');
  assert.equal(isolates.length, 8, 'Expected 8 isolates');
  assert.deepEqual(project.startPos, pack.templates['Yeongdeungpo.json'].startPos, 'Start position changed');
  assert.deepEqual(graph.presentation, { layoutsApplied: true, visualAcceptancePending: true, playable: false }, 'Presentation status changed');
  return { stations: seen.size, edges: actual.size / 2, directedTransfers: actual.size, districts: source.districts.length, isolates: isolates.length, pocLinks: 2, directShortcut: false, engineSchema: 4, sourceSha256: hash(bytes), defaultLayouts: 331, overrides: 3, atlasSha256: hash(Buffer.from(pack.uploaded.dataUrl.split(',')[1], 'base64')), safeExits: actual.size, visualAcceptancePending: true, playable: false };
}
export async function main(args = process.argv.slice(2)) {
  let source = DEFAULT_SOURCE, output = resolve('game'), proofMap = process.env.ASSET_PROOF_MAP;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert(['--source', '--generated', '--proof-map'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown or incomplete option: ' + flag);
    if (flag === '--source') source = args[++i];
    else if (flag === '--proof-map') proofMap = args[++i];
    else output = args[++i];
  }
  assert(source, 'Missing graph source: supply --source or SEOUL_WORLD_GRAPH_SOURCE');
  console.log(JSON.stringify(await check(source, output, proofMap)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
