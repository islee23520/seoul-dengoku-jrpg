import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'engine/package.json'));
const { PNG } = require('pngjs');
const directory = path.join(root, 'game/assets/sampling');
const spec = JSON.parse(readFileSync(path.join(directory, 'signage-original-layer.json'), 'utf8'));
const atlas = PNG.sync.read(readFileSync(path.join(root, 'game/assets/tilesets/seoul_station/seoul_station.png')));
const source = PNG.sync.read(readFileSync(path.join(root, 'game/assets/tilesets/seoul_station/kenney-source.png')));
for (const [index, cell] of spec.atlasCells.entries()) {
  const left = cell % 8 * 16, top = Math.floor(cell / 8) * 16;
  const pixel = (x, y, color) => atlas.data.set(color, ((top + y) * atlas.width + left + x) * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const offset = ((spec.base.rect[1] + y) * source.width + spec.base.rect[0] + x) * 4;
    pixel(x, y, source.data.subarray(offset, offset + 4));
  }
  const [x, y, width, height] = spec.panel;
  for (let dy = y; dy < y + height; dy++) for (let dx = x; dx < x + width; dx++) pixel(dx, dy, spec.panelColor);
  for (const [x1, y1, x2, y2] of spec.glyphs[index]) {
    for (let dy = y1; dy <= y2; dy++) for (let dx = x1; dx <= x2; dx++) pixel(dx, dy, spec.inkColor);
  }
}
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'station-signage.png'), PNG.sync.write(atlas));
console.log('Generated 128x48 atlas; only cells 19/20 replaced by original 구로 panel over exact Kenney crop.');
