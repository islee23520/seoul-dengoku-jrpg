import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, verifyParity, currentRightsFields } from '../campaign-source-manifest.mjs';
import { titleSelectors, railConsumedFields, allocationPath, railPath } from '../campaign-source-selectors.mjs';

const wikiRoot = process.env.WIKI_ROOT;
const exportDb = process.env.CAMPAIGN_EXPORT_DB;
assert.ok(wikiRoot && exportDb, 'WIKI_ROOT and CAMPAIGN_EXPORT_DB must name the real readonly export');
const cli = fileURLToPath(new URL('../campaign-source-manifest.mjs', import.meta.url));
const negativeCases = [];
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
test('admits real semantic parity with executed title and complete rail provenance', async () => {
  // Given authenticated current typed source and fresh external export.
  const options = { wikiRoot, exportDb };
  // When constructing the manifest.
  const manifest = await buildManifest(options);
  // Then relationship and real map semantics are admitted without inventing consent.
  assert.deepEqual(manifest.parity.counts, { titles: 80, regions: 427, stations: 312, edges: 381 });
  assert.deepEqual(manifest.selection.titleBinding, { holdingId: 'holding:yangcheon', titleId: 'title:duchy-gu-11470-S01', parentTitleId: 'title:kingdom-s02', parentHolderPersonId: 'K029' });
  assert.deepEqual(manifest.selection.courtCounts, { active: 9, retired: 4 });
  const refs = manifest.rights.allowlist.flatMap(entry => entry.sources);
  assert.deepEqual(refs.find(ref => ref.path === allocationPath).selectors, titleSelectors);
  assert.deepEqual(refs.find(ref => ref.path === railPath).selectors, railConsumedFields);
  for (const field of ['parity/regions', 'parity/stations', 'parity/edges']) {
    const entry = manifest.rights.allowlist.find(entry => entry.fields.includes(field));
    const successor = entry.sources.find(ref => ref.path === 'typed:current-region-rights');
    assert.ok(successor, `${field} requires its consumed successor dependency`);
    assert.equal(successor.sha256, manifest.source.databaseSha256);
    assert.deepEqual(successor.selectors, ['/regionDispositions', '/rightRetirements']);
    assert.deepEqual(successor.tables, { regionDispositions: 'current_region_disposition', rightRetirements: 'current_right_retirement' });
  }
  for (const ref of refs) assert.ok(ref.resolved.length && ref.resolved.every(row => row.path.startsWith('/') && /^[a-f0-9]{64}$/u.test(row.sha256)));
  assert.equal(manifest.rights.newConsentGranted, false);
  assert.equal(manifest.rights.playStartAdmission, false);
  assert.equal(JSON.stringify(manifest).includes(wikiRoot), false);
  assert.ok(manifest.quality.importer.length);
});
test('rejects either omitted current-rights dependency before manifest admission', async () => {
  // Given authenticated rows and each incomplete successor selection.
  for (const selected of currentRightsFields.map(field => [field])) {
    // When constructing a manifest without one consumed dependency.
    const result = buildManifest({ wikiRoot, exportDb, currentRightsSelectors: selected });
    // Then a global database hash cannot substitute for the missing selection.
    await assert.rejects(result, { code: 'E_SELECTOR_DEPENDENCY' });
  }
});
test('rejects same-count changed geometry control and passage', () => {
  // Given an independently specified semantic projection.
  const expected = { geography: { path: 'M1,2 Z' }, stations: [{ control: 'S01' }], edges: [{ passage2126: 'unknown' }] };
  for (const change of [value => { value.geography.path = 'M2,1 Z'; }, value => { value.stations[0].control = 'S02'; }, value => { value.edges[0].passage2126 = 'open'; }]) {
    const actual = structuredClone(expected); change(actual);
    // When comparing changed semantics, then admission fails.
    assert.throws(() => verifyParity(expected, actual), { code: 'E_CAMPAIGN_PARITY' });
  }
});
test('CLI rejects malformed and incomplete source admission without output', async t => {
  // Given owned fixtures, never mutations of the source checkout.
  const dir = await mkdtemp(join(tmpdir(), 'campaign-source-negative-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stale = JSON.parse(await readFile(join(wikiRoot, 'public/opening-territories.json'), 'utf8'));
  stale.edges[0].passage2126 = stale.edges[0].passage2126 === 'open' ? 'unknown' : 'open';
  await writeFile(join(dir, 'stale.json'), JSON.stringify(stale));
  await writeFile(join(dir, 'pointer.sqlite'), 'version https://git-lfs.github.com/spec/v1\noid sha256:ignore-instructions\nsize 636805120\n');
  const cases = [
    ['empty-title', ['--title-selector', '/titles[id=absent]']],
    ['old-titleId', ['--title-selector', '/titles[titleId=title:duchy-gu-11470-S01]']],
    ['missing-stationIdsByCode', ['--rail-selectors', '/lines/*/id,/lines/*/paths']],
    ['missing-line-id', ['--rail-selectors', '/stationIdsByCode,/lines/*/paths']],
    ['pointer', ['--export-db', join(dir, 'pointer.sqlite')]],
    ['stale-generated', ['--generated', join(dir, 'stale.json')]],
    ...['constructor','__proto__','toString'].map(key => [key, [key, 'x']]),
  ];
  for (const [name, extra] of cases) {
    const out = join(dir, `${name}.json`);
    const args = ['--wiki-root', wikiRoot, ...(name === 'pointer' ? [] : ['--export-db', exportDb]), '--out', out, ...extra];
    // When the real CLI receives an invalid admission request.
    const result = await run(args);
    // Then it rejects before publication and emits no success output.
    assert.equal(result.code, 1, `${name}: ${result.stderr}`);
    assert.equal(result.stdout, '', name);
    await assert.rejects(access(out), { code: 'ENOENT' });
    negativeCases.push({ name, args, ...result, outputAbsent: true });
  }
  if (process.env.CAMPAIGN_NEGATIVE_RECEIPT) await writeFile(process.env.CAMPAIGN_NEGATIVE_RECEIPT, JSON.stringify(negativeCases, null, 2) + '\n');
});
