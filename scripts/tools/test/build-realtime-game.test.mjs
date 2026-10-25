import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ENGINE_REVISION, verifyEngine, prepareRealtimeSource, buildRealtimeGame } from '../build-realtime-game.mjs';
import { createMapPreview } from '../../../hosting/preview.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const engine = path.join(root, 'engine');
const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = JSON.parse(await readFile(path.join(root, 'hosting/engine-inputs.json'), 'utf8'));

test('engine admission rejects a wrong inventory base, checkout base and input hash', async () => {
  await assert.rejects(verifyEngine(engine, { ...inventory, revision: '0'.repeat(40) }), /Engine revision mismatch/);
  await assert.rejects(verifyEngine(root, inventory), /Engine revision mismatch/);
  await assert.rejects(verifyEngine(engine, {
    revision: ENGINE_REVISION, files: { 'src/player/createPlayGame.ts': '0'.repeat(64) },
  }), /Engine input hash mismatch: src\/player\/createPlayGame.ts/);
});

test('preparation applies the exact receipted patch only to disposable source', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'realtime-source-test-'));
  try {
    const prepared = await prepareRealtimeSource(scratch);
    assert.equal(prepared.engine, path.join(scratch, 'engine'));
    assert.equal(prepared.provenance.engineRevision, ENGINE_REVISION);
    assert.equal(prepared.provenance.productionAdmission, false);
    assert.equal(prepared.provenance.patchSha256, sha(await readFile(path.join(root, 'patches/realtime-battle-host.patch'))));
    // Reversibility proves every patch hunk is present, not merely copied nearby.
    await exec('git', ['apply', '--reverse', '--check', path.join(scratch, 'realtime-battle-host.patch')], {
      cwd: scratch, env: { ...process.env, GIT_MASTER: '1' },
    });
    for (const [name, hash] of Object.entries(prepared.provenance.patched)) {
      const relative = 'src/player/' + name;
      assert.equal(sha(await readFile(path.join(prepared.engine, relative))), hash);
      if (name === 'runtimeSimulationPort.ts') {
        await assert.rejects(readFile(path.join(engine, relative)), { code: 'ENOENT' });
      } else {
        assert.notEqual(hash, inventory.files[relative]);
        assert.equal(sha(await readFile(path.join(engine, relative))), inventory.files[relative]);
      }
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('realtime build retains the patched API and isolates map preview inputs', async () => {
  const sourceBytes = await readFile(path.join(root, 'game/project.json'));
  const previewBuilder = await readFile(path.join(root, 'hosting/preview.mjs'));
  const previewConfig = await readFile(path.join(root, 'hosting/vite.player.config.mjs'));
  const source = JSON.parse(sourceBytes);
  const preview = createMapPreview(source);
  const output = process.env.REALTIME_GAME_OUTPUT
    ? path.resolve(process.env.REALTIME_GAME_OUTPUT)
    : await mkdtemp(path.join(tmpdir(), 'realtime-build-test-'));
  try {
    const receipt = await buildRealtimeGame(output);
    assert.equal(receipt.entryTypecheck.file, 'hosting/realtime-entry.ts');
    assert.equal(receipt.entryTypecheck.diagnostics, 0);
    const names = await readdir(output);
    assert(names.includes('realtime.html'));
    assert(names.includes('realtime.js'));
    for (const name of ['preview.html', 'player.js', 'map-preview.json', 'project.json']) assert(!names.includes(name), name);
    const manifest = JSON.parse(await readFile(path.join(output, 'player-manifest.json'), 'utf8'));
    assert.equal(manifest['realtime-entry.ts'].file, 'realtime.js');
    assert.equal(manifest['realtime-entry.ts'].isEntry, true);
    const entry = await readFile(path.join(output, 'realtime.js'), 'utf8');
    assert.match(entry, /\bbootRealtime\b/);
    const javascript = (await Promise.all((await readdir(path.join(output, 'assets')))
      .filter(name => name.endsWith('.js'))
      .map(name => readFile(path.join(output, 'assets', name), 'utf8')))).join('\n') + entry;
    assert.match(javascript, /simulationPort/);
    assert.deepEqual(await readFile(path.join(root, 'game/project.json')), sourceBytes);
    assert.deepEqual(await readFile(path.join(root, 'hosting/preview.mjs')), previewBuilder);
    assert.deepEqual(await readFile(path.join(root, 'hosting/vite.player.config.mjs')), previewConfig);
    assert.deepEqual(createMapPreview(source), preview);
    assert.equal(source.database.actors.length, 0);
    assert.equal(preview.database.actors[0].id, 'public-map-navigation-marker');
    assert.equal(receipt.productionAdmission, false);
    console.log('Realtime build receipt: ' + JSON.stringify({ output, ...receipt }));
  } finally {
    if (!process.env.REALTIME_GAME_OUTPUT) await rm(output, { recursive: true, force: true });
  }
});
