import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { applySampling } from '../../../game/src/assets/sampling.ts';
import { engineParser } from '../seoul-map-convert.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const proofMap = process.env.ASSET_PROOF_MAP || path.resolve(homedir(), 'workspace/seoul-dengoku-jrpg/.omo/evidence/seoul-dengoku-jrpg/external-proof-fixtures/proof-map.json');
const require = createRequire(path.join(root, 'engine/package.json'));
const { PNG } = require('pngjs');
const load = file => readFileSync(path.join(root, file));
const assets = {
  signageDataUrl: 'data:image/png;base64,' + load('game/assets/sampling/station-signage.png').toString('base64'),
  audioDataUrl: 'data:audio/mpeg;base64,' + load('game/assets/sampling/ui-open.mp3').toString('base64'),
};

test('Guro signage is admitted by engine parser without changing station adjacency or collision', async () => {
  // Given the actual converted station package and engine contracts.
  const source = JSON.parse(load('game/project.json'));
  const before = structuredClone(source);
  const { validateProjectV4, canMove } = await engineParser();
  // When the pure post-conversion application installs the pilot.
  const sampled = validateProjectV4(applySampling(source, assets));
  // Then Guro renders the new atlas while every movement edge and graph event remains exact.
  const id = 'station-4775726f', map = sampled.maps[id], original = before.maps[id];
  assert.equal(map.tilesetId, 'sampling-guro');
  assert.equal(sampled.tilesets[map.tilesetId].image.id, 'sampling-station-signage');
  assert(map.lowerTiles.includes(19) && map.lowerTiles.includes(20));
  assert.deepEqual(map, { ...original, tilesetId: 'sampling-guro' });
  assert.deepEqual(sampled.mapConnections, before.mapConnections);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      assert.equal(canMove(sampled, map, x, y, x + dx, y + dy), canMove(before, original, x, y, x + dx, y + dy));
    }
  }
  assert.deepEqual(source, before);
  assert.deepEqual(applySampling(sampled, assets), sampled);
});

test('signage exact pixels retain all unrelated atlas cells and source crop border', () => {
  // Given the registered original atlas and independent Kenney source.
  const original = PNG.sync.read(load('game/assets/tilesets/seoul_station/seoul_station.png'));
  const source = PNG.sync.read(load('game/assets/tilesets/seoul_station/kenney-source.png'));
  // When decoding the generated derivative.
  const sampled = PNG.sync.read(load('game/assets/sampling/station-signage.png'));
  // Then only the two intended cells differ; outer crop pixels remain byte-exact.
  assert.deepEqual([sampled.width, sampled.height], [128, 48]);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 128; x++) {
    const cell = Math.floor(y / 16) * 8 + Math.floor(x / 16), offset = (y * 128 + x) * 4;
    if (cell !== 19 && cell !== 20) assert.deepEqual(sampled.data.subarray(offset, offset + 4), original.data.subarray(offset, offset + 4));
    else if (x % 16 === 0 || x % 16 === 15 || y % 16 === 0 || y % 16 === 15) {
      const at = ((64 + y % 16) * source.width + 128 + x % 16) * 4;
      assert.deepEqual(sampled.data.subarray(offset, offset + 4), source.data.subarray(at, at + 4));
    }
  }
  assert.notDeepEqual(sampled.data, original.data);
});

test('registered short UI audio decodes as nonempty MP3 PCM', () => {
  // Given the shipped derivative used by the engine SE channel.
  const file = path.join(root, 'game/assets/sampling/ui-open.mp3');
  // When decoding through the real codec, rather than trusting a filename.
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-']);
  // Then real samples exist without a load or codec failure.
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert(decoded.stdout.length > 1000);
  assert(decoded.stdout.some(byte => byte !== 0));
});

test('ledger admits actual derivatives only with external proof map', () => {
  // Given the configured acquisition evidence.
  const args = ['scripts/tools/asset-ledger-validate.mjs', '--ledger', 'game/assets/ledger/ledger.json'];
  // When running both CLI boundary cases.
  const admitted = spawnSync(process.execPath, [...args, '--proof-map', proofMap], { cwd: root, encoding: 'utf8' });
  const denied = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ASSET_PROOF_MAP: '' } });
  // Then the complete real ledger succeeds and evidence omission fails closed.
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /missing external proof map/);
});

test('an unregistered injected derivative still fails the actual ledger gate', t => {
  // Given an isolated copy; never mutate the real asset tree.
  const owner = mkdtempSync(path.join(tmpdir(), 'sampling-ledger-'));
  t.after(() => rmSync(owner, { recursive: true, force: true }));
  cpSync(path.join(root, 'game/assets'), path.join(owner, 'game/assets'), { recursive: true });
  mkdirSync(path.join(owner, 'scripts/tools'), { recursive: true });
  cpSync(path.join(root, 'scripts/tools/asset-ledger-validate.mjs'), path.join(owner, 'scripts/tools/asset-ledger-validate.mjs'));
  writeFileSync(path.join(owner, 'game/assets/sampling/unregistered.png'), load('game/assets/sampling/station-signage.png'));
  // When the validator sees a derivative with no registration.
  const result = spawnSync(process.execPath, ['scripts/tools/asset-ledger-validate.mjs', '--ledger', 'game/assets/ledger/ledger.json', '--proof-map', proofMap], { cwd: owner, encoding: 'utf8' });
  // Then admission fails for that exact injected file.
  assert.equal(result.status, 1);
  assert(result.stderr.includes('unregistered asset: game/assets/sampling/unregistered.png'));
});
