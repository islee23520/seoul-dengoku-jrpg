import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertServedOutputPrivacy } from '../served-output-privacy.mjs';

test('served output rejects filesystem paths in nested files including binary assets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'served-privacy-'));
  try {
    await mkdir(path.join(directory, 'assets'));
    for (const value of ['/private/var/folders/run/source.ts', '/tmp/build/source.ts', '/Users/builder/source.ts', '/home/builder/source.ts', 'C:\\build\\source.ts', 'RUN_TMP']) {
      // Given: a path leak embedded in a binary file, not just a JSON manifest.
      await writeFile(path.join(directory, 'assets/data.bin'), Buffer.concat([Buffer.from([0, 255]), Buffer.from(value)]));
      // When / Then: scanning the whole output refuses the leak.
      await assert.rejects(assertServedOutputPrivacy(directory), /Private filesystem path/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

if (process.env.SERVED_OUTPUT) test('deployed output contains no private filesystem paths', async () => {
  // Given: the complete built output. When / Then: every file passes the privacy guard.
  await assert.doesNotReject(assertServedOutputPrivacy(process.env.SERVED_OUTPUT));
});
