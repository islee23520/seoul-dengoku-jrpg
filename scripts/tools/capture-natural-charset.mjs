// Bun-only disposable-build capture. No server or engine source survives this run.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { naturalCharset } from '../../game/src/assets/naturalCharset.mjs';

const evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Absolute evidence directory required');
const require = createRequire(new URL('../../engine/package.json', import.meta.url));
const { PNG } = require('pngjs');
const source = PNG.sync.read(await Bun.file(new URL('../../' + naturalCharset.url, import.meta.url)).arrayBuffer().then(Buffer.from));
const output = await mkdtemp(path.join(tmpdir(), 'seoul-natural-charset-'));
let server, view;
try {
  process.env.NATURAL_CHARSET_QA = '1';
  // The pinned TypeScript native sync API requires Node pipe internals; Bun owns only the browser.
  await mkdir(path.join(evidence, 'receipts'), { recursive: true });
  const { stdout } = await promisify(execFile)('node', [fileURLToPath(new URL('./build-realtime-game.mjs', import.meta.url)), output], { env: process.env, maxBuffer: 16 * 1024 * 1024, timeout: 1800000 });
  await writeFile(path.join(evidence, 'receipts', 'capture-build.log'), stdout + '\nEXIT_CODE=0\n');
  const build = JSON.parse(stdout.trim().split('\n').at(-1));
  await mkdir(path.join(evidence, 'receipts'), { recursive: true });
  await mkdir(path.join(evidence, 'QA'), { recursive: true });
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const name = new URL(request.url).pathname;
    if (name === '/') return new Response('<!doctype html><meta charset="utf-8"><title>TESTINPUT natural charset engine proof</title><style>body{margin:0;background:#172331;color:white;font:16px sans-serif}canvas{display:block}p{margin:12px}</style><p>TESTONLY / TESTINPUT person. Not canonical art approval. Fixed-resolution engine capture.</p><main id="fixture"></main><script>window.proofReady=import("/natural-charset-qa.js").then(({bootNaturalCharsetQa})=>bootNaturalCharsetQa(document.querySelector("#fixture"))).then(api=>{window.proof=api;return true;});</script>', { headers: { 'content-type': 'text/html' } });
    const file = Bun.file(path.join(output, name.slice(1)));
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
  } });
  view = new Bun.WebView({ width: 1440, height: 1000 });
  await view.navigate(server.url.href);
  assert.equal(await view.evaluate('window.proofReady'), true);
  const pixelRatio = await view.evaluate('window.devicePixelRatio');
  const receipts = [];
  const capture = async (receipt, name) => {
    const bytes = Buffer.from(await (await view.screenshot()).arrayBuffer());
    await Bun.write(path.join(evidence, 'QA', name), bytes);
    const shot = PNG.sync.read(bytes);
    assert.equal(shot.width, 1440 * pixelRatio); assert.equal(shot.height, 1000 * pixelRatio);
    assert.equal(receipt.canvas.cssWidth, receipt.canvas.width);
    assert.equal(receipt.canvas.cssHeight, receipt.canvas.height);
    const frame = receipt.slices[receipt.frame];
    let visible = 0, covered = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
      const offset = ((frame.y + y) * source.width + frame.x + x) * 4;
      const px = Math.round((receipt.canvas.left + 120 + x * 3 + 1) * pixelRatio);
      const py = Math.round((receipt.canvas.top + 120 + y * 3 + 1) * pixelRatio);
      const actual = (py * shot.width + px) * 4;
      if (receipt.occluded && y >= 32) {
        assert.deepEqual([...shot.data.subarray(actual, actual + 3)], [86, 124, 104]); covered++;
      } else if (source.data[offset + 3] === 255) {
        assert.deepEqual([...shot.data.subarray(actual, actual + 3)], [...source.data.subarray(offset, offset + 3)]); visible++;
      }
    }
    assert(visible > 0); if (receipt.occluded) assert.equal(covered, 512);
    return { visiblePixelAssertions: visible, foregroundPixelAssertions: covered };
  };
  for (const direction of Object.keys(naturalCharset.animations)) {
    for (const phase of [-1, 0, 1, 2, 3]) {
      const receipt = await view.evaluate(`window.proof.show(${JSON.stringify(direction)}, ${phase})`);
      assert.equal(receipt.slices.length, 12);
      for (const [index, slice] of receipt.slices.entries()) {
        assert.deepEqual(slice, { index, x: index % 3 * 32, y: Math.floor(index / 3) * 48, width: 32, height: 48 });
      }
      const mapping = naturalCharset.animations[direction];
      assert.equal(receipt.frame, phase < 0 ? mapping.stand : mapping.walk[phase]);
      const frame = receipt.slices[receipt.frame];
      assert.equal(frame.width, 32); assert.equal(frame.height, 48);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
        const a = (y * 32 + x) * 4;
        const b = ((frame.y + y) * source.width + frame.x + x) * 4;
        // Canvas normalizes RGB of fully transparent source pixels to zero.
        assert.equal(receipt.pixels[a + 3], source.data[b + 3]);
        if (source.data[b + 3]) for (let c = 0; c < 3; c++) assert.equal(receipt.pixels[a + c], source.data[b + c]);
      }
      delete receipt.pixels;
      const name = `${direction}-${phase < 0 ? 'stand' : 'walk-' + phase}.png`;
      const renderedPixels = await capture(receipt, name);
      receipts.push({ ...receipt, ...renderedPixels, screenshot: 'QA/' + name, exactSourcePixels: 1536 });
    }
    const receipt = await view.evaluate(`window.proof.show(${JSON.stringify(direction)}, 0, true)`);
    assert(receipt.coverDepth > receipt.sprite.depth);
    delete receipt.pixels;
    const renderedPixels = await capture(receipt, direction + '-occluded.png');
    receipts.push({ ...receipt, ...renderedPixels, screenshot: 'QA/' + direction + '-occluded.png' });
  }
  await writeFile(path.join(evidence, 'receipts', 'engine-render.json'), JSON.stringify({ build, frames: receipts }, null, 2) + '\n');
  console.log('PASS: 20 exact source-pixel frame checks and 24 engine render captures: ' + evidence);
  await view.evaluate('window.proof.close()');
} finally {
  view?.close(); server?.stop(true); await rm(output, { recursive: true, force: true });
}
