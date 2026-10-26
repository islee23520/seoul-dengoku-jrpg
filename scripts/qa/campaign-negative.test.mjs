import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { content, packages } from '../../game/src/campaign/testFixtures.ts';
import { packFiles } from '../../hosting/campaign-content.ts';
import { negativeScenarios, runPrivateHarness } from './campaign-negative.mjs';

for (const scenario of negativeScenarios) test(scenario + ' uses production boundaries and rejects its observation mutation', async () => {
  const result = await runPrivateHarness(scenario, content);
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.cleanup.userStorageTouched, false);
  const mutant = await runPrivateHarness(scenario, content, true);
  assert.equal(mutant.status, 'failed');
  assert.match(mutant.error, /AssertionError/);
});

test('campaign-smoke CLI dispatches adversarial scenarios against the served artifact and its observation mutant', async () => {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const key = Object.keys(packFiles).find(name => packFiles[name] === pathname.slice(1));
    if (!key) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }).end(packages[key]);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const evidence = await mkdtemp(path.join(tmpdir(), 'campaign-negative-cli-'));
  const smoke = path.join(path.dirname(fileURLToPath(import.meta.url)), 'campaign-smoke.mjs');
  const run = args => promisify(execFile)(process.execPath, [smoke, ...args], { timeout: 120000, signal: AbortSignal.timeout(120000) });
  try {
    const pass = await run(['--url', url, '--scenario', 'reject-conflict', '--evidence', evidence]);
    assert.equal(pass.stdout.trim().split('\n').at(-1), JSON.stringify({ status: 'passed', output: path.resolve(evidence, 'run.json'), error: undefined }));
    assert.equal(JSON.parse(await readFile(path.join(evidence, 'run.json'), 'utf8')).status, 'passed');
    const mutant = await run(['--url', url, '--scenario', 'reject-conflict', '--negative-probe', 'observation', '--run-id', 'mutant', '--evidence', evidence]).then(() => { throw new Error('observation mutant unexpectedly exited 0'); }, error => error);
    assert.equal(mutant.code, 1);
    assert.equal(JSON.parse(await readFile(path.join(evidence, 'mutant.json'), 'utf8')).status, 'failed');
  } finally {
    const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
    await rm(evidence, { recursive: true, force: true });
  }
});
