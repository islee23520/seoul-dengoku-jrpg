import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { naturalCharset } from '../../../game/src/assets/naturalCharset.mjs';

const require = createRequire(new URL('../../../engine/package.json', import.meta.url));
const { PNG } = require('pngjs');
const parse = require(fileURLToPath(new URL('../../../engine/node_modules/phaser/src/textures/parsers/SpriteSheet.js', import.meta.url)));
const image = PNG.sync.read(readFileSync(new URL('../../../' + naturalCharset.url, import.meta.url)));

test('actual engine Phaser parser slices all twelve native frames without clipping', () => {
  const frames = new Map();
  const texture = { source: [image], add(name, source, x, y, width, height) { frames.set(name, { source, x, y, width, height }); } };
  parse(texture, 0, 0, 0, image.width, image.height, naturalCharset.frameConfig);
  assert.equal(frames.size, 13); // twelve slices plus Phaser __BASE
  for (const [direction, row] of Object.entries({ down: 0, up: 1, right: 2, left: 3 })) {
    const mapping = naturalCharset.animations[direction];
    assert.equal(mapping.stand, row * 3 + 1);
    for (const index of [mapping.stand, ...mapping.walk]) {
      const frame = frames.get(index);
      assert.deepEqual(frame, { source: 0, x: index % 3 * 32, y: row * 48, width: 32, height: 48 });
      const pixels = [];
      for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
        const offset = ((frame.y + y) * image.width + frame.x + x) * 4;
        pixels.push(...image.data.subarray(offset, offset + 4));
      }
      assert.equal(pixels.length, 32 * 48 * 4);
      assert(pixels.some((value, i) => i % 4 === 3 && value > 0), `${direction}/${index} must contain visible source pixels`);
      // The frame boundary is transparent: no adjacent body's pixels bleed in.
      for (let x = 0; x < 32; x++) assert.equal(pixels[x * 4 + 3], 0);
    }
  }
});
