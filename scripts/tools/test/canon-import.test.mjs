import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSource, encode, hash } from '../canon-import.mjs';

const importer = fileURLToPath(new URL('../canon-import.mjs', import.meta.url));
const checker = fileURLToPath(new URL('../canon-manifest-check.mjs', import.meta.url));
const source = resolve(process.env.CANON_SOURCE || defaultSource);
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
function passes(result) { assert.equal(result.status, 0, result.stderr); }
function rejects(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
}
test('actual readonly document CLI corpus and adversarial output checks', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'canon-import-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = resolve(root, 'output with spaces');
  mkdirSync(output); writeFileSync(resolve(output, '.gitkeep'), '');
  const manifestPath = resolve(output, 'canon-manifest.json');
  const importArgs = ['--source', source, '--output', output];
  const checkArgs = ['--source', source, '--manifest', manifestPath];
  const sourceCli = resolve(source, 'scripts/cast-sqlite/document-cli.mjs');
  const db = resolve(source, 'data/canonical/wiki-cast.sqlite');
  const before = hash(readFileSync(db));
  const listed = run(sourceCli, ['list', '--db', db, '--corpus', 'current']);
  passes(listed);
  const list = JSON.parse(listed.stdout);
  const approved = list.filter(row => row.status === 'approved' && !row.excluded && row.corpus_kind === 'current');
  await t.test('real importer and checker execute successfully', () => {
    passes(run(importer, importArgs));
    passes(run(checker, checkArgs));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.imported_count, approved.length);
    assert.equal(readdirSync(output).filter(name => name.endsWith('.json')).length, approved.length + 1);
    assert.equal(readFileSync(resolve(output, '.gitkeep'), 'utf8'), '');
    for (const row of approved) {
      const entry = manifest.entries.find(entry => entry.domain === row.domain && entry.document_id === row.document_id);
      assert.equal(entry.revision, row.revision);
      assert.equal(entry.source_sha256, row.sha256);
      assert.equal(entry.status, row.status);
      assert.equal(entry.sha256, hash(readFileSync(resolve(output, row.slug + '.json'))));
    }
    const states = JSON.parse(readFileSync(resolve(output, 'sixteen-states.json'), 'utf8'));
    assert.equal(states.tense.ko, 'past'); assert.equal(states.tense.en, 'past');
    assert.equal(states.locales.ko.tense, 'past'); assert.equal(states.locales.en.tense, 'past');
  });
  const manifestBytes = readFileSync(manifestPath, 'utf8');
  for (const [name, mutate, pattern] of [
    ['draft manifest', m => { m.entries[0].status = 'draft'; }, /approved/],
    ['stale revision', m => { m.entries[0].revision = 'stale'; }, /Stale/],
    ['source hash tamper', m => { m.entries[0].source_sha256 = '0'.repeat(64); }, /Stale/],
    ['output hash tamper', m => { m.entries[0].sha256 = '0'.repeat(64); }, /hash/],
    ['manifest path traversal', m => { m.entries[0].slug = '../outside'; }, /Unsafe/],
    ['duplicate entry', m => { m.entries[1] = m.entries[0]; }, /duplicate/],
    ['missing approved document', m => { m.entries.pop(); m.imported_count--; }, /inventory/],
  ]) {
    await t.test(name, () => {
      const manifest = JSON.parse(manifestBytes); mutate(manifest);
      writeFileSync(manifestPath, encode(manifest));
      try { rejects(run(checker, checkArgs), pattern); }
      finally { writeFileSync(manifestPath, manifestBytes); }
    });
  }
  await t.test('tampered output remains rejected even with a recomputed manifest hash', () => {
    const manifest = JSON.parse(manifestBytes), entry = manifest.entries[0];
    const file = resolve(output, entry.slug + '.json'), bytes = readFileSync(file);
    const document = JSON.parse(bytes); document.status = 'draft';
    const tampered = encode(document); entry.sha256 = hash(tampered);
    writeFileSync(file, tampered); writeFileSync(manifestPath, encode(manifest));
    try { rejects(run(checker, checkArgs), /Stale/); }
    finally { writeFileSync(file, bytes); writeFileSync(manifestPath, manifestBytes); }
  });
  await t.test('symlink output is rejected', () => {
    const entry = JSON.parse(manifestBytes).entries[0], file = resolve(output, entry.slug + '.json');
    const bytes = readFileSync(file), target = resolve(root, 'outside.json');
    writeFileSync(target, bytes); unlinkSync(file); symlinkSync(target, file);
    try { rejects(run(checker, checkArgs), /regular/); }
    finally { unlinkSync(file); writeFileSync(file, bytes); }
  });
  await t.test('actual draft ID and slug cannot be forced into import', () => {
    const draft = list.find(row => row.status === 'draft'); assert.ok(draft);
    for (const id of [draft.document_id, draft.slug]) rejects(run(importer, [...importArgs, '--id', id]), /not approved/);
    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBytes);
  });
  await t.test('unsafe ID and malformed options fail closed', () => {
    rejects(run(importer, [...importArgs, '--id', '../outside']), /Unsafe/);
    rejects(run(importer, ['--unknown', 'x']), /option/);
    rejects(run(checker, ['--manifest']), /option/);
  });
  await t.test('malformed JSON and unexpected output are rejected', () => {
    writeFileSync(manifestPath, '{');
    try { rejects(run(checker, checkArgs), /JSON|property/); }
    finally { writeFileSync(manifestPath, manifestBytes); }
    const extra = resolve(output, 'unlisted.json'); writeFileSync(extra, '{}');
    try { rejects(run(checker, checkArgs), /inventory/); rejects(run(importer, importArgs), /Unexpected/); }
    finally { unlinkSync(extra); }
  });
  assert.equal(hash(readFileSync(db)), before, 'readonly import/check must preserve SQLite bytes');
});
