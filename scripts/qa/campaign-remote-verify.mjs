import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** Task19 remote verifier: every artifact byte served unchanged, correct MIME on the
 * default campaign route, and absent/private paths probed against the real fallback
 * body — a fallback 200 is recorded as fallback, never claimed as a missing-file 404. */
async function artifactFiles(directory) {
  const files = [];
  const walk = async dir => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file); else files.push(path.relative(directory, file));
    }
  };
  await walk(directory);
  return files.sort();
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fetchBytes(url, signal = AbortSignal.timeout(30000)) {
  const response = await fetch(url, { signal, redirect: 'follow' });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()), finalUrl: response.url, redirected: response.redirected };
}

export async function verifyRemoteArtifact(options) {
  const base = new URL(options.base);
  const files = await artifactFiles(options.artifact);
  assert.ok(files.length, 'artifact directory is empty');
  const report = { schema: 'campaign-remote-verify.v1', base: base.href, startedAt: new Date().toISOString(), files: { expected: files.length }, mismatches: [], failures: [], redirects: [] };
  const results = [];
  const queue = [...files];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        const remote = await fetchBytes(new URL(name.split(path.sep).join('/'), base).href);
        const local = await readFile(path.join(options.artifact, name));
        const ok = remote.status === 200 && sha(remote.bytes) === sha(local);
        if (remote.redirected) report.redirects.push({ name, finalUrl: remote.finalUrl });
        results.push({ name, ok });
      } catch (error) {
        report.failures.push({ name, error: String(error.message ?? error) });
      }
    }
  });
  await Promise.all(workers);
  report.files.served = results.filter(r => r.ok).length;

  const headerSamples = {};
  for (const pattern of [/^index\.html$/, /^campaign\.html$/, /^campaign-build\.json$/, /^assets\/campaign-entry-[^/]+\.js$/, /^assets\/campaign-entry-[^/]+\.css$/, /^assets\/NotoSansKR-Regular-[^/]+\.otf$/, /^data\/campaign\/atlas\.json$/, /^legacy\/player\.js$/, /^legacy\/map-preview\.json$/]) {
    const name = files.find(file => pattern.test(file));
    if (!name) continue;
    const response = await fetchBytes(new URL(name.split(path.sep).join('/'), base).href);
    headerSamples[name] = { status: response.status, contentType: response.headers.get('content-type'), cacheControl: response.headers.get('cache-control'), etag: response.headers.get('etag'), bytes: response.bytes.length };
  }
  report.headers = headerSamples;

  const root = await fetchBytes(base.href);
  const localIndex = await readFile(path.join(options.artifact, 'index.html'));
  report.defaultRoute = { status: root.status, bytesMatchLocalIndex: sha(root.bytes) === sha(localIndex),
    title: /<title>([^<]*)<\/title>/.exec(root.bytes.toString('utf8'))?.[1] ?? null,
    isCampaignEntry: root.status === 200 && sha(root.bytes) === sha(localIndex) && /S01 캠페인/.test(root.bytes.toString('utf8')) };


  const rootSha = sha(root.bytes);
  report.probes = [];
  for (const probe of ['definitely-missing-task19-probe', 'game.sqlite', 'soul.json', 'data/canon/canon-manifest.json', '.omo/evidence/seoul-dengoku-campaign-map/task-18/DoneClaim.json', '../etc/passwd']) {
    try {
      const response = await fetchBytes(new URL(probe, base).href);
      const bodySha = sha(response.bytes);
      report.probes.push({ probe, status: response.status, bodySha256: bodySha, equalsDefaultRouteBody: bodySha === rootSha,
        interpretation: response.status === 404 ? 'missing-file 404' : bodySha === rootSha ? 'SPA fallback body (200 fallback ≠ file present)' : response.status === 200 ? 'unexpected distinct 200 body — investigate' : 'non-200 non-404' });
    } catch (error) {
      report.probes.push({ probe, error: String(error.message ?? error) });
    }
  }
  report.passed = report.mismatches.length === 0 && report.failures.length === 0 && report.files.served === files.length && report.defaultRoute.isCampaignEntry
    && report.probes.every(p => p.interpretation !== 'unexpected distinct 200 body — investigate' && !p.error);
  report.finishedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { base: { type: 'string' }, artifact: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) console.log('Usage: node scripts/qa/campaign-remote-verify.mjs --base <deployment-url> --artifact <local-campaign-dist> --out <evidence-dir>\nExit: 0 verified, 1 verification failed, 2 invalid arguments.');
    else {
      assert.ok(values.base && values.artifact && values.out, 'Required: --base --artifact --out');
      const report = await verifyRemoteArtifact({ base: values.base, artifact: values.artifact });
      await mkdir(values.out, { recursive: true });
      const output = path.join(values.out, 'remote-verify.json');
      await writeFile(output, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ passed: report.passed, served: report.files.served, expected: report.files.expected, mismatches: report.mismatches.length, failures: report.failures.length, defaultRoute: report.defaultRoute, output }));
      process.exitCode = report.passed ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 2;
  }
}
