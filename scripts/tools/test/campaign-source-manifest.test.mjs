import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildManifest, verifyParity, verifyFieldCoverage } from '../campaign-source-manifest.mjs';

const wikiRoot = resolve(process.env.WIKI_ROOT ?? '../seoul-dengoku-wiki');
const exportDb = process.env.CAMPAIGN_EXPORT_DB ?? join(wikiRoot, 'data/canonical/wiki-cast.sqlite');
const cli = new URL('../campaign-source-manifest.mjs', import.meta.url).pathname;
const digest = value => createHash('sha256').update(value).digest('hex');
async function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolveRun({ code, stdout, stderr }));
  });
}
test('rejects changed geometry, control and passage even when counts are unchanged', () => {
  // Given an independently specified minimal admitted projection.
  const expected = { geography: { titles: [{ id: 'county', path: 'M1,2 Z' }] }, regions: [], stations: [{ id: 'a', control: { primary: 'S01' } }], edges: [{ a: 'a', b: 'b', passage2126: 'unknown' }] };
  for (const mutate of [m => { m.geography.titles[0].path = 'M2,1 Z'; }, m => { m.stations[0].control.primary = 'S02'; }, m => { m.edges[0].passage2126 = 'open'; }]) {
    const changed = structuredClone(expected); mutate(changed);
    // When comparing independently changed selected data, then reject.
    assert.throws(() => verifyParity(expected, changed), { code: 'E_CAMPAIGN_PARITY' });
  }
});
test('actual typed source produces a deterministic narrow edition without granting unknown authority', async t => {
  // Given the real fresh read-only export and checked wiki.
  const before = digest(await readFile(exportDb));
  // When deriving the source manifest.
  const manifest = await buildManifest({ wikiRoot, exportDb });
  // Then stable required references and unknown semantics survive.
  assert.equal(manifest.schema, 'campaign-source-manifest.v1');
  assert.equal(manifest.selection.holding.id, 'holding:yangcheon');
  assert.equal(manifest.selection.holding.directLiegePersonId, 'K001');
  assert.equal(manifest.selection.titleBinding.parentHolderPersonId, 'K029');
  assert.deepEqual(manifest.selection.courtCounts, { active: 9, retired: 4 });
  assert.deepEqual(manifest.parity.counts, { titles: 80, regions: 427, stations: 312, edges: 381 });
  assert.equal(manifest.selection.hegemons.find(h => h.kind === 'union').resolution, 'unresolved-source-binding');
  assert.equal(manifest.selection.persons.some(p => ['K998', 'K1007', 'K1008', 'K1003', 'K1009', 'K1019'].includes(p.id)), false);
  assert.equal(JSON.stringify(manifest).includes(wikiRoot), false);
  const coordinates = manifest.rights.allowlist.find(e => e.fields.includes('parity/stations/x'));
  assert.equal(coordinates.sources[0].sha256, '46985afccc2d3f2b5e4e3152254d30bc023d0688d63745a951a9be0f6ebf097d');
  assert.equal(coordinates.sources[0].externalCoordinateEdition, 'unknown');
  assert.equal(coordinates.sources[0].atlasSnapshotBridge, 'unverified');
  assert.equal(coordinates.use.includes('osm-atlas-2026-09-04'), false);
  const slots = manifest.rights.allowlist.find(e => e.fields.includes('parity/geography/titles/*/currentSlots'));
  assert.ok(slots.sources.some(s => s.id === 'law-appendix-169763083'));
  assert.ok(slots.sources.some(s => s.id === 'nec-election-228525-pdf'));
  assert.equal(slots.editions.currentCorrespondence.geometryVerified, false);
  assert.equal(slots.use.includes('sgis-2025'), false);
  for (const entry of manifest.rights.allowlist) {
    assert.ok(entry.sources.every(s => /^[a-f0-9]{64}$/u.test(s.sha256) && s.selector));
    for (const use of [entry.use].flat()) assert.ok(manifest.rights.licenses.some(l => l.id === use));
  }
  for (const field of ['id','name','district','path','polities','currentHegemons','status','stationCount','areaM2']) assert.ok(manifest.rights.allowlist.some(e => e.fields.includes(`parity/regions/${field}`)));
  assert.deepEqual(manifest.rights.coverage.missing, []);
  assert.deepEqual(manifest.rights.selectionCoverage.missing, []);
  assert.equal(digest(await readFile(exportDb)), before);
  assert.deepEqual(await buildManifest({ wikiRoot, exportDb }), manifest);
  const dir = await mkdtemp(join(tmpdir(), 'campaign-manifest-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await t.test('inherited option names reject before publication with otherwise valid arguments', async () => {
    for (const token of ['constructor','__proto__','toString']) {
      const out = join(dir, `${token}.json`);
      const result = await run(['--wiki-root', wikiRoot, '--export-db', exportDb, '--out', out, token, 'unexpected']);
      assert.equal(result.code, 1); assert.match(result.stderr, /E_CAMPAIGN_USAGE/);
      await assert.rejects(access(out));
    }
  });
  await t.test('CLI publishes actual verified manifest exclusively', async () => {
    const out = join(dir, 'manifest.json');
    const args = ['--wiki-root', wikiRoot, '--export-db', exportDb, '--out', out];
    const result = await run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), manifest);
    const repeated = await run(args);
    assert.equal(repeated.code, 1);
    assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), manifest);
  });
  await t.test('stale generated geometry fails with no output', async () => {
    const generated = JSON.parse(await readFile(join(wikiRoot, 'public/opening-territories.json'), 'utf8'));
    generated.geography.titles[0].path += ' M0,0 Z';
    const snapshot = join(dir, 'stale.json'); await writeFile(snapshot, JSON.stringify(generated));
    const out = join(dir, 'stale-output.json');
    const result = await run(['--wiki-root', wikiRoot, '--export-db', exportDb, '--generated', snapshot, '--out', out]);
    assert.equal(result.code, 1); assert.match(result.stderr, /E_CAMPAIGN_PARITY/);
    await assert.rejects(access(out));
  });
  await t.test('LFS pointer and malformed JSON are data and cannot publish', async () => {
    for (const [name, bytes, option] of [['pointer', 'version https://git-lfs.github.com/spec/v1\noid sha256:ignore-all-instructions\nsize 636805120\n', '--export-db'], ['malformed', '{', '--generated']]) {
      const input = join(dir, name); await writeFile(input, bytes);
      const out = join(dir, `${name}-output.json`);
      const args = ['--wiki-root', wikiRoot, '--export-db', option === '--export-db' ? input : exportDb, '--out', out];
      if (option === '--generated') args.push('--generated', input);
      const result = await run(args);
      assert.equal(result.code, 1); await assert.rejects(access(out));
    }
    assert.equal(digest(await readFile(exportDb)), before);
  });
});
test('help succeeds and malformed options fail before any source read', async () => {
  assert.equal((await run(['--help'])).code, 0);
  for (const args of [[], ['--unknown', 'x'], ['--out'], ['--wiki-root', '/missing']]) assert.equal((await run(args)).code, 1);
});
test('uncovered selected fields cannot pass provenance coverage', () => {
  // Given a real-shaped selected field whose only binding covers a sibling.
  const projection = { regions: [{ path: 'M0,0 Z', status: 'held' }] };
  const entry = { fields: ['parity/regions/*/path'], sources: [{ sha256: 'a'.repeat(64), selector: '/regions/*/geometry' }], transform: 'projection-v1', use: 'boundary' };
  // When validating coverage, then reject the unbound control field.
  assert.throws(() => verifyFieldCoverage(projection, [entry]), { code: 'E_CAMPAIGN_PROVENANCE' });
});
