import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { packFiles } from '../../hosting/campaign-content.ts';
import { asideCommand, browserStep } from './campaign-aside.mjs';
import { campaignOrigin } from './campaign-origin.mjs';
import { campaignBrowserStep } from './campaign-browser-step.mjs';
import { assertCampaignSave, assertRestore } from './campaign-assertions.mjs';
import { negativeScenarios, runPrivateHarness } from './campaign-negative.mjs';

export const scenarios = ['campaign-entry', 's01-sequential', 'save-reload', 'clock-tabs', 'pack-tamper', 'layout', ...negativeScenarios];

export async function runCampaignSmoke(options) {
  const evidence = path.resolve(options.evidence);
  await mkdir(evidence, { recursive: true });
  const report = { schema: 'campaign-browser-qa.v1', scenario: options.scenario, upstream: options.url,
    startedAt: new Date().toISOString(), status: 'running', negativeProbe: options.negativeProbe ?? null, steps: [], incidents: [], assertions: [],
    harness: { browser: 'native Aside', freshSessionPerStep: true, stepTimeoutMs: 90000, transitionTimeoutMs: 35000,
      longStretchSpeed: 4, isolation: 'fresh loopback origin; existing profile storage untouched' } };
  try {
    const previous = JSON.parse(await readFile(path.join(evidence, options.runId + '.json'), 'utf8'));
    const { priorAttempts = [], ...attempt } = previous;
    report.priorAttempts = [...priorAttempts, attempt];
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const origins = [];
  let checkpoint;
  try {
    report.nativeGuide = await asideCommand(['guide']);
    report.nativeReplGuide = await asideCommand(['guide', 'repl']);
    const profiles = JSON.parse(await asideCommand(['host', 'profiles', '--host', 'local', '--json']));
    const connected = profiles.profiles.filter(p => p.connected);
    const profile = options.profile ?? (connected.length === 1 ? connected[0].profileId : null);
    assert.ok(profile && connected.some(p => p.profileId === profile), 'choose a connected --profile from aside-agent host profiles');
    const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => {
      const response = await fetch(new URL(file, options.url), { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, 'served pack ' + key);
      return [key, await response.text()];
    }));
    const content = CampaignContent.parse(Object.fromEntries(entries));
    report.content = content.hashes;
    const origin = await campaignOrigin(options.url); origins.push(origin);
    report.origin = origin.url;
    const step = async (label, config) => {
      const input = { url: origin.url, capturePrefix: options.runId + '-' + label,
        previousOwnedIds: report.steps.flatMap(step => step.cleanup?.ownedIds ?? []), ...config };
      const code = 'await (' + campaignBrowserStep.toString() + ')(' + JSON.stringify(input) + ')';
      const result = await browserStep({ profile, code, label, report, evidence });
      if (result.checkpoint) {
        const proof = assertCampaignSave(result.checkpoint, content, config.kind === 'complete' ? 'complete' : 'boundary');
        report.assertions.push({ label, ...proof });
        if (config.expectedChecksum) assert.equal(result.checkpoint.state.packages.operations, content.hashes.operations);
        checkpoint = result.checkpoint;
      }
      if (config.kind !== 'tamper' && config.kind !== 'second-tab') assert.deepEqual(result.errors, [], label + ' console/network errors');
      return result;
    };
    if (options.scenario === 'pack-tamper') {
      const tampered = await campaignOrigin(options.url, { tamper: true }); origins.push(tampered);
      await step('tamper', { kind: 'tamper', url: tampered.url });
    } else {
      await step('initial', { kind: 'initial' });
      assert.equal(checkpoint.state.clock.worldMilliseconds, options.negativeProbe === 'assertion' ? 1 : 0,
        'initial world time assertion' + (options.negativeProbe === 'assertion' ? ' (deliberately corrupted expectation)' : ''));
      assert.equal(checkpoint.state.mandates.length, 0);
      if (options.negativeProbe === 'timeout') {
        await step('shortened-timeout', { kind: 'advance', issue: 'K568', target: { time: 480000 },
          transitionTimeoutMs: 1, expectedChecksum: checkpoint.checksum });
        assert.fail('shortened transition timeout unexpectedly passed');
      }
      if (options.scenario !== 'campaign-entry') {
        if (options.scenario === 'clock-tabs') {
          for (const speed of [1, 2, 4]) {
            const target = checkpoint.state.clock.worldMilliseconds + 12000;
            const progressed = await step('speed-' + speed, { kind: 'advance', speed, target: { time: target }, expectedChecksum: checkpoint.checksum });
            assert.ok(progressed.checkpoint.state.clock.worldMilliseconds >= target);
            assert.equal(progressed.checkpoint.state.clock.speed, 0);
          }
          const saved = checkpoint;
          const reload = await step('clock-reload', { kind: 'reload', expectedChecksum: saved.checksum });
          assertRestore(saved, reload.checkpoint);
          await step('second-tab-takeover', { kind: 'second-tab', takeover: true, mutate: options.negativeProbe === 'offline-credit' });
        }
        else if (options.scenario === 'layout') {
          for (const [width, height] of [[1440, 900], [390, 844]]) {
            await step('layout-' + width, { kind: 'layout', url: origin.url + '__campaign_qa_frame?width=' + width, width, height });
          }
        } else {
          await step('ledger-first-leg', { kind: 'advance', issue: 'K568', unseen: true, target: { time: 480000 }, expectedChecksum: checkpoint.checksum });
          const halfway = checkpoint;
          const reload = await step('mid-flow-reload', { kind: 'reload', expectedChecksum: halfway.checksum });
          assertRestore(halfway, reload.checkpoint);
          await step('ledger-return', { kind: 'advance', target: { time: 1020000 }, expectedChecksum: checkpoint.checksum });
          assert.equal(checkpoint.state.s01.tracks.find(t => t.lane === 'duty-return')?.status, 'done');
          assert.equal(checkpoint.state.reports.filter(r => r.receivedAt !== null).length, 4);
          await step('observation', { kind: 'complete', issue: 'K616', target: { reports: 6 }, expectedChecksum: checkpoint.checksum });
          const complete = checkpoint;
          const restored = await step('final-reload', { kind: 'reload', expectedChecksum: complete.checksum });
          assertRestore(complete, restored.checkpoint);
          await step('second-tab', { kind: 'second-tab' });
          const tampered = await campaignOrigin(options.url, { tamper: true }); origins.push(tampered);
          await step('tamper', { kind: 'tamper', url: tampered.url });
          for (const [width, height] of [[1440, 900], [390, 844]]) {
            await step('layout-' + width, { kind: 'layout', url: origin.url + '__campaign_qa_frame?width=' + width, width, height });
          }
          report.final = assertCampaignSave(checkpoint, content, 'complete');
        }
      }
    }
    report.optionalAssetFailures = origin.requests.filter(r => r.path === '/favicon.ico' && r.status === 404);
    assert.ok(origin.requests.every(r => !r.error && (r.status < 400 || r.path === '/favicon.ico' && r.status === 404) && r.sourceHash === r.servedHash), 'happy origin serves unchanged required production bytes');
    report.status = 'passed';
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    report.status = 'failed'; report.error = error.stack ?? error.message;
  } finally {
    for (const origin of origins) await origin.close();
    report.requests = origins.map(origin => ({ url: origin.url, requests: origin.requests }));
    report.cleanup = { serversClosed: origins.map(origin => origin.url), storageCleared: false, profileModified: false,
      tabs: report.steps.map(step => step.cleanup), runTemporaryFiles: [] };
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(evidence, options.runId + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { url: { type: 'string' }, scenario: { type: 'string' }, evidence: { type: 'string' },
      profile: { type: 'string' }, 'negative-probe': { type: 'string' }, 'run-id': { type: 'string', default: 'run' }, help: { type: 'boolean' } } });
    if (values.help) console.log('Usage: node scripts/qa/campaign-smoke.mjs --url <production-url> --scenario <' + scenarios.join('|') + '> --evidence <directory> [--profile <id>] [--run-id <name>] [--negative-probe <assertion|timeout|offline-credit|observation>]\n'
      + 'Exit: 0 passed, 1 failed evidence, 2 invalid arguments. Browser scenarios use a new owned local origin.\n'
      + 'The adversarial scenarios ' + negativeScenarios.join('|') + ' run the production modules through the private\n'
      + 'loopback fixture harness (campaign-negative.mjs) against the actual served pack bytes; their mutated\n'
      + 'counterpart is --negative-probe observation, which corrupts one observation and must exit 1.');
    else {
      assert.ok(values.url && values.scenario && values.evidence, 'Required: --url --scenario --evidence');
      assert.ok(scenarios.includes(values.scenario), 'Unsupported scenario: ' + values.scenario);
      assert.ok(values['negative-probe'] === undefined || ['assertion', 'timeout', 'offline-credit', 'observation'].includes(values['negative-probe']), 'Unsupported negative probe');
      assert.ok(!values['negative-probe'] || (values['negative-probe'] === 'offline-credit' ? values.scenario === 'clock-tabs'
        : values['negative-probe'] === 'observation' ? negativeScenarios.includes(values.scenario) : values.scenario === 'campaign-entry'), 'Negative probe does not match scenario');
      assert.match(values['run-id'], /^[a-z0-9][a-z0-9-]*$/);
      const url = new URL(values.url);
      assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'URL must be HTTP(S) without credentials');
      if (negativeScenarios.includes(values.scenario)) {
        const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => {
          const response = await fetch(new URL(file, url), { signal: AbortSignal.timeout(15000) });
          assert.equal(response.status, 200, 'served pack ' + key);
          return [key, await response.text()];
        }));
        const result = await runPrivateHarness(values.scenario, CampaignContent.parse(Object.fromEntries(entries)), values['negative-probe'] === 'observation');
        await mkdir(values.evidence, { recursive: true });
        const output = path.resolve(values.evidence, values['run-id'] + '.json');
        await writeFile(output, JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify({ status: result.status, output, error: result.error }));
        process.exitCode = result.status === 'passed' ? 0 : 1;
      } else {
        const report = await runCampaignSmoke({ url: url.href, scenario: values.scenario, evidence: values.evidence, profile: values.profile, runId: values['run-id'], negativeProbe: values['negative-probe'] });
        console.log(JSON.stringify({ status: report.status, report: path.resolve(values.evidence, values['run-id'] + '.json'), error: report.error }));
        process.exitCode = report.status === 'passed' ? 0 : 1;
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error.message); process.exitCode = 2;
  }
}
