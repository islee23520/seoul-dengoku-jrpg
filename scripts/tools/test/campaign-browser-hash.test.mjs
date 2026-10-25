import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from '../../../engine/node_modules/esbuild/lib/main.js';
import { canonicalJson, summaryHash } from '../../../game/src/domain/eventLedger.ts';
import { vectors } from '../../qa/campaign-browser-hash.mjs';

test('browser bundle preserves old Node hash vectors when importing the production ledger', async () => {
  // Given: browser resolution rejects Node built-ins, unlike a Node-target bundle.
  const bundle = await build({ entryPoints: [new URL('../../../game/src/domain/eventLedger.ts', import.meta.url).pathname], bundle: true, platform: 'browser', format: 'esm', write: false });
  // When
  const browserModule = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  // Then: this runs the browser-target artifact in Node; actual native browser QA is separate.
  for (const { value, hash } of vectors) {
    assert.equal(createHash('sha256').update(canonicalJson(value)).digest('hex'), hash);
    assert.equal(summaryHash(value), hash);
    assert.equal(browserModule.summaryHash(value), hash);
    assert.equal(browserModule.canonicalJson(value), canonicalJson(value));
  }
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => browserModule.summaryHash({ nested: [value] }), { name: 'CheckpointCorrupt' });
  assert.notEqual(browserModule.summaryHash({ 영주: '이서담' }), browserModule.summaryHash({ 영주: '백산석' }));
});
