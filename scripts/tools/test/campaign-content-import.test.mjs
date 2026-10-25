import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { digest, encode, loadContent, projectContent } from '../campaign-content-import.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(root, 'scripts/tools/campaign-content-import.mjs');
const manifestPath = join(root, 'game/data/campaign/source-manifest.json');
const wikiRoot = process.env.WIKI_ROOT;
assert.ok(wikiRoot, 'WIKI_ROOT must name the real readonly source');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const snapshot = JSON.parse(await readFile(join(wikiRoot, 'public/opening-territories.json'), 'utf8'));
const legacy = JSON.parse(await readFile(join(root, 'game/data/world/graph.json'), 'utf8'));
const { readSource, consumeRail } = await import('../campaign-source-selectors.mjs');
const { regularLineGraph } = await import(new URL('scripts/regular-line-graph.mjs', `file://${wikiRoot}/`).href);
const source = await readSource(wikiRoot);
const input = { manifest, snapshot, legacy, rail: consumeRail(source.rail), regularLineGraph };
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
test('imports every authenticated map reference when the current manifest is supplied', async () => {
  // Given the real pinned manifest and readonly typed source.
  const before = digest(await readFile(join(root, 'game/data/world/graph.json')));
  // When the importer consumes that boundary.
  const { atlas, identityMap } = await loadContent({ manifest: manifestPath, wikiRoot });
  // Then all permitted source fields survive, without granting execution or rewriting the old edition.
  assert.deepEqual(atlas.stations, snapshot.stations);
  assert.deepEqual(atlas.edges, snapshot.edges);
  assert.deepEqual(atlas.geography, snapshot.geography);
  assert.deepEqual(atlas.selection, manifest.selection);
  assert.deepEqual(identityMap.titles, manifest.identityMap);
  assert.equal(identityMap.stations.filter(s => s.status === 'authenticated-alias').length, 20);
  assert.deepEqual(identityMap.stations.filter(s => s.status === 'excluded').map(s => s.oldId).sort(), ['광명사거리', '석수']);
  for (const id of ['Guro', 'Sindorim', 'Yeongdeungpo']) assert.equal(identityMap.stations.find(s => s.oldId === id).newId, id);
  assert.deepEqual(atlas.selection.courtCounts, { active: 9, retired: 4 });
  assert.equal(atlas.transport.executionAdmission, false);
  assert.equal(before, digest(await readFile(join(root, 'game/data/world/graph.json'))));
});
test('regenerates identical bytes when source inputs are unchanged', () => {
  // Given fixed authenticated inputs.
  const first = projectContent(input);
  // When projecting again.
  const second = projectContent(input);
  // Then both packs are byte identical.
  assert.equal(encode(first), encode(second));
});
test('rejects ambiguous aliases when one member is assigned twice', () => {
  // Given a duplicate authenticated alias member.
  const changed = structuredClone(input.manifest);
  changed.parity.aliases[1].aliases.push(changed.parity.aliases[0].aliases[0]);
  // When resolving identity migration, then ambiguity rejects.
  assert.throws(() => projectContent({ ...input, manifest: changed }), { code: 'E_IMPORT_ALIAS' });
});
test('rejects unknown aliases when a legacy ID has no authenticated mapping', () => {
  // Given a station name that merely resembles a real station.
  const changed = structuredClone(legacy);
  changed.stations.push({ id: '서울역-unknown-alias' });
  changed.mapIds['서울역-unknown-alias'] = `station-${Buffer.from('서울역-unknown-alias').toString('hex')}`;
  // When migrating identities, then no substring fallback is used.
  assert.throws(() => projectContent({ ...input, legacy: changed }), { code: 'E_IMPORT_ALIAS' });
});
test('rejects duplicate station IDs when the projection has repeated identities', () => {
  // Given a projection with a duplicated station and a consistent projection hash.
  const changed = structuredClone(snapshot), admitted = structuredClone(manifest);
  changed.stations.push(changed.stations[0]);
  const regions = changed.regions.map(({ id, name, district, path, polities, currentHegemons, status, stationCount, areaM2 }) => ({ id, name, district, path, polities, currentHegemons, status, stationCount, areaM2 }));
  admitted.parity.sha256 = digest(JSON.stringify({ geography: changed.geography, regions, stations: changed.stations, edges: changed.edges, hegemons: changed.hegemons, width: changed.width, height: changed.height }));
  // When importing, then duplicate IDs are rejected independently of the hash.
  assert.throws(() => projectContent({ ...input, manifest: admitted, snapshot: changed }), { code: 'E_IMPORT_DUPLICATE' });
});
test('rejects invented title mappings when the public ID is not in the source', () => {
  // Given an invented canonical/public reference.
  const changed = structuredClone(manifest);
  changed.identityMap[0].public = 'geography:county:invented';
  // When building the bijection, then the importer rejects it.
  assert.throws(() => projectContent({ ...input, manifest: changed }), { code: 'E_IMPORT_TITLE' });
});
test('rejects shortcuts when an excluded intermediate stop is removed', () => {
  // Given the real graph builder with a three-stop path and an excluded middle stop.
  const rail = { stationIdsByCode: { a: 'A', x: 'X', b: 'B' }, lines: [{ id: 'L', paths: [[{ code: 'a' }, { code: 'x' }, { code: 'b' }]] }] };
  // When rebuilding source-code adjacency.
  const result = regularLineGraph(rail, ['A', 'B'], { excludedStationIds: ['X'] });
  // Then both pairs are omitted and no replacement edge exists.
  assert.deepEqual(result.edges, []);
  assert.equal(result.omitted.length, 2);
});
test('CLI rejects invalid inputs before publishing either pack', async t => {
  // Given an owned empty destination and adversarial CLI inputs.
  const dir = await mkdtemp(join(tmpdir(), 'campaign-content-negative-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    ['missing-manifest', ['--manifest', join(dir, 'absent.json')]],
    ...['constructor', '__proto__', 'toString', '--manifest', '--unknown'].map(key => [key, [key, 'x']]),
  ];
  const mutations = [
    ['unknown-alias', value => { value.parity.aliases[0].aliases.push('서울역-unknown'); }],
    ['ambiguous-alias', value => { value.parity.aliases[1].aliases.push(value.parity.aliases[0].aliases[0]); }],
    ['duplicate-ID', value => { value.selection.persons.push(value.selection.persons[0]); }],
    ['invented-title', value => { value.identityMap[0].public = 'invented'; }],
    ['excluded-pair', value => { value.parity.excludedStationIds = []; }],
    ['missing-dependency', value => { for (const entry of value.rights.allowlist) for (const ref of entry.sources) if (ref.path === 'lore/places/regular-line-adjacency.json') ref.selectors = ['/lines/*/id', '/lines/*/paths']; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(manifest); mutate(changed);
    const path = join(dir, `${name}.json`);
    await writeFile(path, JSON.stringify(changed));
    cases.push([name, ['--manifest', path]]);
  }
  const receipts = [];
  for (const [name, extra] of cases) {
    const out = join(dir, name.replaceAll('-', 'x'));
    // When invoking the actual CLI with an invalid request.
    const replacement = name === 'missing-manifest' || mutations.some(([key]) => key === name);
    const result = await run([...(replacement ? [] : ['--manifest', manifestPath]), '--out', out, ...extra]);
    // Then rejection is nonzero with no stdout or output files.
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, '');
    await assert.rejects(access(out), { code: 'ENOENT' });
    receipts.push({ name, ...result, outputAbsent: true });
  }
  if (process.env.CAMPAIGN_NEGATIVE_RECEIPT) await writeFile(process.env.CAMPAIGN_NEGATIVE_RECEIPT, `${JSON.stringify(receipts, null, 2)}\n`);
});
