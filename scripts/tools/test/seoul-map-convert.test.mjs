import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, renameSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { convert, validateSource, DEFAULT_SOURCE, mapId, hash, engineParser, projectAtlas, stationPackage } from '../seoul-map-convert.mjs';
import { check } from '../seoul-map-check.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
assert(DEFAULT_SOURCE, 'Missing graph source: set SEOUL_WORLD_GRAPH_SOURCE to the licensed graph JSON before running this suite; see docs/gate-validation.md');
const bytes = readFileSync(DEFAULT_SOURCE);
const source = JSON.parse(bytes);
const baseline = convert(bytes);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'seoul-map-'));
  assert.equal(dirname(realpathSync(dir)), realpathSync(tmpdir()));
  assert.notEqual(realpathSync(dir), realpathSync(root));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'source.json'), output = join(dir, 'game');
  writeFileSync(input, bytes);
  return { dir, input, output };
}
function save(output, result) {
  mkdirSync(join(output, 'maps'), { recursive: true });
  mkdirSync(join(output, 'data/world'), { recursive: true });
  writeFileSync(join(output, 'project.json'), JSON.stringify(result.project));
  writeFileSync(join(output, 'data/world/graph.json'), JSON.stringify(result.graph));
  for (const [id, map] of Object.entries(result.project.maps)) writeFileSync(join(output, 'maps', id + '.json'), JSON.stringify(map));
}
function cli(script, args) {
  return spawnSync(process.execPath, [join(root, 'scripts/tools', script), ...args], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
}
function templates(output) {
  const directory = join(output, 'maps/templates/seoul_station');
  cpSync(join(root, 'game/maps/templates/seoul_station'), directory, { recursive: true });
  return directory;
}
function outputHashes(output) {
  return Object.fromEntries(['project.json', 'data/world/graph.json', ...readdirSync(join(output, 'maps'), { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => 'maps/' + entry.name)].map(path => [path, hash(readFileSync(join(output, path)))]));
}
test('real source CLI generation, independent checker, dry run, deterministic output, and full engine parsing', async t => {
  const { input, output, dir } = fixture(t);
  const dry = cli('seoul-map-convert.mjs', ['--source', input, '--output', join(dir, 'unwritten'), '--dry']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).stations, 334);
  assert(!readdirSync(dir).includes('unwritten'));
  const generated = cli('seoul-map-convert.mjs', ['--source', input, '--output', output]);
  assert.equal(generated.status, 0, generated.stderr);
  const checked = cli('seoul-map-check.mjs', ['--source', input, '--generated', output]);
  assert.equal(checked.status, 0, checked.stderr);
  const proof = JSON.parse(checked.stdout);
  assert.deepEqual([proof.stations, proof.edges, proof.districts, proof.isolates, proof.directedTransfers], [334, 409, 25, 8, 818]);
  assert.equal(proof.pocLinks, 2); assert.equal(proof.directShortcut, false);
  const before = outputHashes(output);
  const directory = templates(output);
  const templateHashes = Object.fromEntries(readdirSync(directory).map(name => [name, hash(readFileSync(join(directory, name)))]));
  assert.equal(cli('seoul-map-convert.mjs', ['--source', input, '--output', output]).status, 0);
  assert.equal((await check(input, output)).directedTransfers, 818);
  for (const [name, digest] of Object.entries(templateHashes)) assert.equal(hash(readFileSync(join(directory, name))), digest);
  assert.deepEqual(outputHashes(output), before);
  const project = json(join(output, 'project.json'));
  const { validateProjectV4 } = await engineParser();
  const parsed = validateProjectV4(structuredClone(project));
  assert.equal(Object.keys(parsed.maps).length, 334);
  for (const [id, map] of Object.entries(project.maps)) assert.deepEqual(parsed.maps[id].events, map.events);
  const invalid = structuredClone(project); delete invalid.database;
  assert.throws(() => validateProjectV4(invalid));
  const invalidCommand = structuredClone(project);
  invalidCommand.maps[mapId('Guro')].events[0].pages[0].commands[0] = { type: 'transfer', targetMapId: mapId('Sindorim') };
  assert.throws(() => validateProjectV4(invalidCommand));
});
test('source IDs, bilingual names, aliases, coordinates, edges, districts and all provenance are lossless', () => {
  for (const key of Object.keys(source)) assert.deepEqual(baseline.graph[key], source[key]);
  assert.equal(baseline.graph.sourceSha256, hash(bytes));
  for (const station of source.stations) assert.deepEqual(baseline.project.maps[mapId(station.id)].station, station);
  assert.notEqual(mapId('a-b'), mapId('a b'));
  assert.notEqual(mapId('../escape'), mapId('escape'));
  const reordered = convert(Buffer.from(JSON.stringify({ ...source, stations: [...source.stations].reverse() })));
  assert.deepEqual(reordered.graph.mapIds, baseline.graph.mapIds);
});
test('atlas bbox boundaries, differing extents, rounding, zero spans and stable IDs', () => {
  const stations = [{ id: 'NW', lat: 20, lon: 100 }, { id: 'SE', lat: 10, lon: 140 }, { id: 'mid', lat: 15, lon: 120 }];
  const atlas = projectAtlas(stations, { width: 11, height: 6 });
  assert.deepEqual(atlas.bbox, { minLat: 10, maxLat: 20, minLon: 100, maxLon: 140 });
  assert.deepEqual(atlas.positions, { NW: { x: 0, y: 0 }, SE: { x: 10, y: 5 }, mid: { x: 5, y: 3 } });
  assert.deepEqual(projectAtlas([...stations].reverse(), { width: 11, height: 6 }), atlas);
  assert.equal(projectAtlas(stations.map(s => ({ ...s, lat: 10 }))).positions.mid.y, 0);
  assert.equal(projectAtlas(stations.map(s => ({ ...s, lon: 100 }))).positions.mid.x, 0);
  assert.deepEqual(projectAtlas([stations[0]], { width: 1, height: 1 }).positions.NW, { x: 0, y: 0 });
});
test('projection config changes only atlas metadata and preserves isolate coordinates and all source facts', () => {
  const result = convert(bytes, undefined, { width: 73, height: 19 });
  assert.notDeepEqual(result.graph.atlas.positions, baseline.graph.atlas.positions);
  assert.deepEqual(result.project, baseline.project);
  const { atlas, ...facts } = result.graph;
  const { atlas: defaultAtlas, ...defaultFacts } = baseline.graph;
  assert.deepEqual(facts, defaultFacts);
  for (const id of result.graph.isolates) {
    const station = source.stations.find(s => s.id === id);
    assert.deepEqual(result.graph.stations.find(s => s.id === id), station);
    assert.deepEqual(result.project.maps[mapId(id)].station, station);
    assert.deepEqual(result.project.maps[mapId(id)].events, []);
    assert(Number.isSafeInteger(atlas.positions[id].x) && Number.isSafeInteger(atlas.positions[id].y));
  }
});
test('real source CLI accepts independent atlas flags and checker rejects corrupted positions', async t => {
  const { input, output } = fixture(t);
  const generated = cli('seoul-map-convert.mjs', ['--source', input, '--output', output, '--atlas-width', '73', '--atlas-height', '19']);
  assert.equal(generated.status, 0, generated.stderr);
  const graph = json(join(output, 'data/world/graph.json'));
  assert.deepEqual(graph.atlas, convert(bytes, undefined, { width: 73, height: 19 }).graph.atlas);
  assert.equal((await check(input, output)).directedTransfers, 818);
  graph.atlas.positions.Guro.x += 1;
  writeFileSync(join(output, 'data/world/graph.json'), JSON.stringify(graph));
  await assert.rejects(check(input, output), /Atlas projection mismatch/);
});
test('CLI rejects malformed projection options before writing output', t => {
  const { input, output, dir } = fixture(t);
  for (const args of [['--atlas-width'], ['--atlas-height', '--dry'], ...['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', '2x', ''].map(value => ['--atlas-width', value])]) {
    const result = cli('seoul-map-convert.mjs', ['--source', input, '--output', output, ...args]);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
    assert(!readdirSync(dir).includes('game'));
  }
});
test('template dimensions and layers are copied without sharing mutable arrays', () => {
  const template = { width: 30, height: 18, tileSize: 16, lowerTiles: Array(540).fill(0), upperTiles: Array(540).fill(-1) };
  const result = convert(bytes, template);
  const maps = Object.values(result.project.maps);
  assert.equal(maps[0].width, 30); assert.equal(maps[0].height, 18);
  assert.deepEqual(maps[0].lowerTiles, template.lowerTiles);
  maps[0].lowerTiles[0] = 1;
  assert.equal(template.lowerTiles[0], 0); assert.equal(maps[1].lowerTiles[0], 0);
  assert.throws(() => convert(bytes, { ...template, lowerTiles: [] }));
});
test('approved atlas bytes, full tileset and 331 default plus three overrides are applied', async () => {
  const pack = stationPackage();
  const { project } = baseline;
  assert.deepEqual(project.tilesets.seoul_station, json(join(root, 'game/assets/tilesets/seoul_station/tileset.json')));
  const asset = project.assets.uploaded[project.tilesets.seoul_station.image.id];
  assert.equal(project.tilesets.seoul_station.image.type, 'uploaded');
  assert.equal(hash(Buffer.from(asset.dataUrl.split(',')[1], 'base64')), hash(readFileSync(join(root, 'game/assets/tilesets/seoul_station/seoul_station.png'))));
  assert.deepEqual(asset.meta, { width: 128, height: 48, tileSize: 16 });
  let defaults = 0, overrides = 0;
  const { isPassable, canMove, isPassableLanding } = await engineParser();
  for (const map of Object.values(project.maps)) {
    const override = pack.application.overrides[map.station.id];
    override ? overrides++ : defaults++;
    const layout = pack.templates[override ?? pack.application.defaultTemplate];
    assert.deepEqual(map.lowerTiles, layout.lowerTiles);
    assert.deepEqual(map.upperTiles, layout.upperTiles);
    assert(map.lowerTiles.some(tile => tile >= 0) && map.upperTiles.some(tile => tile >= 0));
    assert.equal(isPassable(project, map, 0, 0), false);
    assert.equal(canMove(project, map, 0, 0, 1, 0), false);
    assert(isPassableLanding(project, map, layout.startPos.x, layout.startPos.y));
    const visited = new Set([layout.startPos.y * map.width + layout.startPos.x]), queue = [layout.startPos];
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i];
      for (const [nx, ny] of [[x, y + 1], [x + 1, y], [x, y - 1], [x - 1, y]]) {
        const key = ny * map.width + nx;
        if (!visited.has(key) && canMove(project, map, x, y, nx, ny)) { visited.add(key); queue.push({ x: nx, y: ny }); }
      }
    }
    for (const exit of map.events) {
      assert(visited.has(exit.y * map.width + exit.x));
      const transfer = exit.pages[0].commands[0], target = project.maps[transfer.mapId];
      assert(isPassableLanding(project, target, transfer.x, transfer.y));
      assert(!target.events.some(e => e.x === transfer.x && e.y === transfer.y));
    }
  }
  assert.deepEqual([defaults, overrides], [331, 3]);
});
test('station package rejects atlas hash tampering in an owned temporary tree', t => {
  const { dir } = fixture(t);
  cpSync(join(root, 'game/assets'), join(dir, 'game/assets'), { recursive: true });
  cpSync(join(root, 'game/maps/templates'), join(dir, 'game/maps/templates'), { recursive: true });
  const png = join(dir, 'game/assets/tilesets/seoul_station/seoul_station.png');
  writeFileSync(png, Buffer.concat([readFileSync(png), Buffer.from('tamper')]));
  assert.throws(() => stationPackage(dir), /derived_hash mismatch/);
});
test('station package cannot bypass acquisition or license denial with approval booleans', t => {
  const { dir } = fixture(t);
  cpSync(join(root, 'game/assets'), join(dir, 'game/assets'), { recursive: true });
  cpSync(join(root, 'game/maps/templates'), join(dir, 'game/maps/templates'), { recursive: true });
  assert.throws(() => stationPackage(dir, ''), /missing external proof map/);
  const ledgerPath = join(dir, 'game/assets/ledger/ledger.json');
  const ledger = json(ledgerPath);
  ledger.assets[0].commercial_game_allowed = false;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  assert.throws(() => stationPackage(dir), /permission denied/);
  ledger.assets[0].commercial_game_allowed = true;
  ledger.assets[0].license_name_version = 'CC-BY-NC-4.0';
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  assert.throws(() => stationPackage(dir), /unsupported license/);
});
test('converter and checker propagate explicit map and fail closed without it', t => {
  const { input, output } = fixture(t);
  const proofMap = process.env.ASSET_PROOF_MAP;
  assert(proofMap, 'test verification requires ASSET_PROOF_MAP');
  const env = { ...process.env, ASSET_PROOF_MAP: '', SEOUL_WORLD_GRAPH_SOURCE: '' };
  const run = (script, args) => spawnSync(process.execPath, [join(root, 'scripts/tools', script), ...args], { cwd: root, encoding: 'utf8', env, timeout: 60000 });
  const missingSource = run('seoul-map-convert.mjs', ['--dry']);
  assert.equal(missingSource.status, 1); assert.match(missingSource.stderr, /Missing graph source/);
  const denied = run('seoul-map-convert.mjs', ['--source', input, '--output', output]);
  assert.equal(denied.status, 1); assert.match(denied.stderr, /missing external proof map/);
  assert(!readdirSync(dirname(output)).includes('game'));
  const accepted = run('seoul-map-convert.mjs', ['--source', input, '--output', output, '--proof-map', proofMap]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const deniedCheck = run('seoul-map-check.mjs', ['--source', input, '--generated', output]);
  assert.equal(deniedCheck.status, 1); assert.match(deniedCheck.stderr, /missing external proof map/);
  const acceptedCheck = run('seoul-map-check.mjs', ['--source', input, '--generated', output, '--proof-map', proofMap]);
  assert.equal(acceptedCheck.status, 0, acceptedCheck.stderr);
  for (const file of ['project.json', 'data/world/graph.json', ...readdirSync(join(output, 'maps')).map(name => 'maps/' + name)]) {
    const text = readFileSync(join(output, file), 'utf8');
    assert(!text.includes(proofMap));
    for (const privateMarker of ['proof_id', 'proof_location', 'rights_holder_notice', '/Users/', '.omo/']) assert(!text.includes(privateMarker));
  }
  assert.deepEqual(readdirSync(output).sort(), ['data', 'maps', 'project.json']);
});
test('exit allocation preserves template furniture and existing events', () => {
  const layout = structuredClone(stationPackage().templates['platform.json']);
  layout.events.push({ id: 'furniture-event', x: 3, y: 5, trigger: { kind: 'action' }, commands: [] });
  const result = convert(bytes, layout);
  for (const map of Object.values(result.project.maps)) {
    assert.deepEqual(map.events[0], layout.events[0]);
    assert.equal(map.events.filter(e => e.x === 3 && e.y === 5).length, 1);
    assert.deepEqual(map.lowerTiles, layout.lowerTiles);
    assert.deepEqual(map.upperTiles, layout.upperTiles);
  }
});
for (const [name, mutate] of [
  ['duplicate ID', s => s.stations.push(s.stations[0])],
  ['unknown endpoint', s => { s.edges[0].b = '../missing'; }],
  ['duplicate reversed edge', s => s.edges.push({ a: s.edges[0].b, b: s.edges[0].a })],
  ['self edge', s => { s.edges[0].b = s.edges[0].a; }],
  ['bad coordinates', s => { s.stations[0].lat = null; }],
  ['bad alias', s => { s.aliases.invalid = 'missing'; }],
  ['bad district', s => { s.stations[0].district = 'missing'; }],
  ['missing bilingual name', s => { delete s.stations[0].nameEn; }],
  ['missing edges', s => { delete s.edges; }],
]) test('reject malformed graph: ' + name, () => {
  const data = structuredClone(source); mutate(data);
  assert.throws(() => validateSource(data));
});
test('CLI rejects malformed JSON, missing source and unknown flags without false success', t => {
  const { input, output } = fixture(t);
  writeFileSync(input, '{');
  for (const args of [['--source', input, '--output', output], ['--source', input + '.missing'], ['--wat'], ['--source']]) {
    const result = cli('seoul-map-convert.mjs', args);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  }
});
for (const [name, mutate, error] of [
  ['unresolved atlas image', r => { r.project.assets.uploaded = {}; }, /Station atlas image changed/],
  ['changed atlas bytes', r => { r.project.assets.uploaded['seoul_station-atlas'].dataUrl += 'AAAA'; }, /Station atlas image changed/],
  ['blocked exit', r => { r.project.maps[mapId('Guro')].events[0].x = 0; r.project.maps[mapId('Guro')].events[0].y = 0; }, /Unsafe or unreachable exit/],
  ['blocked landing', r => { const c = r.project.maps[mapId('Guro')].events[0].pages[0].commands[0]; c.x = 0; c.y = 0; }, /Unsafe transfer destination/],
  ['arrival collision', r => { const e = r.project.maps[mapId('Guro')].events[0]; e.x = 2; e.y = 5; }, /Exit overlaps arrival/],
  ['wrong override layout', r => { r.project.maps[mapId('Sindorim')].lowerTiles = [...r.project.maps[mapId('Guro')].lowerTiles]; }, /Station layout changed/],
  ['same-count rewire with forged station hint', r => {
    const map = r.project.maps[mapId('Yeongdeungpo')];
    const command = map.events.find(e => e.pages[0].commands[0].mapId === mapId('Sindorim')).pages[0].commands[0];
    command.mapId = mapId('Guro'); command.stationId = 'Sindorim';
  }, /EDGE SET MISMATCH/],
  ['missing reverse transfer', r => { r.project.maps[mapId('Guro')].events = r.project.maps[mapId('Guro')].events.filter(e => e.pages[0].commands[0].mapId !== mapId('Sindorim')); }, /EDGE SET MISMATCH/],
  ['conditional exit', r => { r.project.maps[mapId('Guro')].events[0].pages[0].conditions = [{ kind: 'gold', op: '>=', amount: 10 }]; }, /Conditional exit/],
  ['malformed command', r => { r.project.maps[mapId('Guro')].events[0].pages[0].commands[0].kind = 'bogus'; }, /./],
  ['bad tile layer', r => { r.project.maps[mapId('Guro')].lowerTiles.pop(); }, /./],
  ['stale source hash', r => { r.graph.sourceSha256 = '0'.repeat(64); }, /Stale source hash/],
  ['invented isolate', r => { r.graph.isolates[0] = 'Guro'; }, /Isolates changed/],
  ['lost aliases', r => { r.graph.aliases = {}; }, /Source field changed/],
  ['duplicate mapTree entry', r => { r.project.mapTree.children.push(r.project.mapTree.children[0]); }, /mapTree/],
]) test('independent checker rejects ' + name, async t => {
  const { input, output } = fixture(t);
  const result = structuredClone(baseline); mutate(result); save(output, result);
  await assert.rejects(check(input, output), error);
});
test('removed source edge cannot be hidden by stale output or patched provenance', async t => {
  const { input, output } = fixture(t);
  const changed = structuredClone(source); changed.edges.shift();
  const altered = Buffer.from(JSON.stringify(changed)); writeFileSync(input, altered);
  const result = structuredClone(baseline); save(output, result);
  await assert.rejects(check(input, output), /Stale source hash/);
  result.graph.edges = changed.edges; result.graph.sourceSha256 = hash(altered); save(output, result);
  await assert.rejects(check(input, output), /EDGE SET MISMATCH/);
});
test('checker rejects stale map copies and unregistered artifacts; converter preserves extra work', async t => {
  const { input, output } = fixture(t); save(output, baseline);
  writeFileSync(join(output, 'maps', mapId('Guro') + '.json'), '{}');
  await assert.rejects(check(input, output), /Stale project\/map copies/);
  save(output, baseline);
  writeFileSync(join(output, 'maps', 'foreign.json'), '{}');
  await assert.rejects(check(input, output), /Stale map file inventory/);
  const rejected = cli('seoul-map-convert.mjs', ['--source', input, '--output', output]);
  assert.notEqual(rejected.status, 0); assert.equal(readFileSync(join(output, 'maps', 'foreign.json'), 'utf8'), '{}');
});
for (const [name, mutate] of [
  ['extra template', directory => writeFileSync(join(directory, '../unexpected-map.json'), '{}')],
  ['nested unexpected file', directory => { mkdirSync(join(directory, 'nested')); writeFileSync(join(directory, 'nested/unexpected-map.json'), '{}'); }],
  ['renamed known template', directory => renameSync(join(directory, 'Guro.json'), join(directory, 'Guro-renamed.json'))],
  ['changed known template bytes', directory => writeFileSync(join(directory, 'Guro.json'), '{}')],
  ['malformed contract bytes', directory => writeFileSync(join(directory, 'application.json'), '{')],
  ['missing template', directory => rmSync(join(directory, 'platform.json'))],
  ['symlink template', directory => { renameSync(join(directory, 'Guro.json'), join(directory, '../../Guro-source.json')); symlinkSync('../../Guro-source.json', join(directory, 'Guro.json')); }],
  ['nested non-template file', directory => { mkdirSync(join(directory, '../../nested')); writeFileSync(join(directory, '../../nested/unexpected-map.json'), '{}'); }],
]) test('converter and checker reject ' + name + ' without overwriting output', async t => {
  const { input, output } = fixture(t);
  save(output, baseline);
  const directory = templates(output);
  mutate(directory);
  const before = outputHashes(output);
  await assert.rejects(check(input, output), /template|map file inventory/i);
  const rejected = cli('seoul-map-convert.mjs', ['--source', input, '--output', output]);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /template|map file inventory/i);
  assert.deepEqual(outputHashes(output), before);
});
