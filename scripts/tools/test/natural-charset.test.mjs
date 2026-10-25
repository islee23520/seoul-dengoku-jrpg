import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { naturalCharset, preloadNaturalCharset, createNaturalCharsetAnimations } from '../../../game/src/assets/naturalCharset.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ledger = JSON.parse(readFileSync(resolve(root, 'game/assets/ledger/ledger.json')));
const proofMap = process.env.ASSET_PROOF_MAP || resolve(homedir(), 'workspace/seoul-dengoku-jrpg/.omo/evidence/seoul-dengoku-jrpg/external-proof-fixtures/proof-map.json');

test('native 32x48 bytes match the reviewed acquisition hash', () => {
  const bytes = readFileSync(resolve(root, naturalCharset.url));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), naturalCharset.sheetWidth);
  assert.equal(bytes.readUInt32BE(20), naturalCharset.sheetHeight);
  assert.ok(naturalCharset.frameConfig.frameHeight / naturalCharset.frameConfig.frameWidth >= 1.4);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, 'b9bf362f1b1322fc457dcee15235255631e762f68cadf332065994b2a301a7c1');
  assert.equal(ledger.assets.find(asset => asset.asset_id === 'testinput-natural-base').source_hash, hash);
});

test('pure loader registers native dimensions and twelve-frame animation mappings', () => {
  let loaded;
  preloadNaturalCharset({ load: { spritesheet(...args) { loaded = args; } } });
  assert.deepEqual(loaded, [naturalCharset.key, naturalCharset.url, { frameWidth: 32, frameHeight: 48 }]);
  const columns = naturalCharset.sheetWidth / loaded[2].frameWidth;
  const rows = naturalCharset.sheetHeight / loaded[2].frameHeight;
  assert.equal(columns, 3);
  assert.equal(rows, 4);
  assert.equal(columns * rows, 12);
  preloadNaturalCharset({ load: { spritesheet(...args) { loaded = args; } } }, '/served/base.png');
  assert.equal(loaded[1], '/served/base.png');
  const animations = new Map();
  createNaturalCharsetAnimations({ anims: { create(config) { animations.set(config.key, config); } } });
  assert.equal(animations.size, 8);
  for (const [direction, row] of Object.entries({ down: 0, up: 1, right: 2, left: 3 })) {
    const stand = animations.get(`${naturalCharset.key}-stand-${direction}`);
    const walk = animations.get(`${naturalCharset.key}-walk-${direction}`);
    assert.deepEqual(stand.frames, [{ key: naturalCharset.key, frame: row * 3 + 1 }]);
    assert.equal(stand.repeat, 0);
    assert.deepEqual(walk.frames.map(frame => frame.frame), [row * 3, row * 3 + 1, row * 3 + 2, row * 3 + 1]);
    assert.equal(walk.repeat, -1);
    assert.equal(stand.frameRate, 1);
    assert.equal(walk.frameRate, 8);
    for (const frame of walk.frames) {
      assert.equal(frame.key, naturalCharset.key);
      assert.ok(Number.isInteger(frame.frame) && frame.frame >= 0 && frame.frame < columns * rows);
    }
  }
});

test('real ledger CLI admits the charset with external proof map', () => {
  const result = spawnSync(process.execPath, ['scripts/tools/asset-ledger-validate.mjs', '--ledger', 'game/assets/ledger/ledger.json', '--proof-map', proofMap], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`valid: ${ledger.assets.length} entries`));
});

test('real ledger CLI fails closed without external proof map', () => {
  const result = spawnSync(process.execPath, ['scripts/tools/asset-ledger-validate.mjs', '--ledger', 'game/assets/ledger/ledger.json'], { cwd: root, encoding: 'utf8', env: { ...process.env, ASSET_PROOF_MAP: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing external proof map/);
  assert.doesNotMatch(result.stdout, /valid:/);
});
