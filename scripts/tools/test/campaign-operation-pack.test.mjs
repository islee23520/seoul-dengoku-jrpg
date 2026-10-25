import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validateOperationPack } from '../campaign-operation-pack.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scenario = join(root, 'game/data/scenarios/townhall-s01-r2');
const manifest = join(root, 'game/data/campaign/source-manifest.json');
const cli = join(root, 'scripts/tools/campaign-operation-pack.mjs');
const receipts = [];
test('contains no private source paths when the scenario pack ships', async () => {
  // Given every file in the production scenario pack.
  const files = await readdir(scenario, { recursive: true, withFileTypes: true });
  const forbidden = [['.omo', '/'], ['/', 'Users', '/'], ['drafts', '/']].map(parts => parts.join(''));
  // When inspecting the bytes that will ship.
  const contents = await Promise.all(files.filter(file => file.isFile()).map(file => readFile(join(file.parentPath, file.name), 'utf8')));
  // Then no private source reference is exposed by any pack file.
  for (const content of contents) for (const path of forbidden) assert.equal(content.includes(path), false, 'private source path in scenario pack');
});
const run = args => new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, [cli, ...args], { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.once('error', reject);
  child.once('close', code => resolveResult({ code, stdout, stderr }));
});

test('recomputes the sequential baseline and finite accounting when the approved pack is loaded', async () => {
  // Given the production r2 pack and source manifest.
  const input = { scenario, manifest };
  // When validating the operational content independently of start admission.
  const result = await validateOperationPack(input);
  // Then durations, individual effort and finite inventory follow the approved tables.
  assert.deepEqual(result.baseline, {
    provisional: true, decision: 'section2-route-r2-pending-ratification',
    ledgerReceivedAt: 684, handoverAt: 858, ledgerFinishedAt: 1002,
    cisternObservedAt: 1332, tapObservedAt: 1476, observationReceivedAt: 1602,
    K568: { walkingSeconds: 54, carryingSeconds: 96, stationarySeconds: 720, activeSeconds: 870,
      effort: { 'left-arm': 912, 'right-arm': 912, 'left-leg': 246, 'right-leg': 246, head: 720, torso: 246 } },
    accounting: { originalCount: 1, newSpending: 0, prepaymentCount: 4, initialFoodPacks: 8,
      emergencyFoodPacks: 4, initialWaterMl: 2000, paperUsed: 2,
      foodConsumedAtSequentialReceipt: 0, waterConsumedMlAtSequentialReceipt: 0, afterExtensionFoodPacks: 4,
      afterExtensionWaterMl: 0, payRemainingAtDutyReturn: 4398, coverageRemainingAtDutyReturn: 2598 },
  });
});

test('validates data through the real CLI when no start is requested', async () => {
  // Given the production command and data-only mode.
  const args = ['--scenario', scenario, '--manifest', manifest, '--validate-data'];
  // When the real CLI validates the pack.
  const result = await run(args);
  // Then data validation returns the authenticated start record.
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).startAuthorization.receiptSha256, 'a9cc766895f9afefc6796dc76ae26df0d8eeb158bec55bd40c8c340df2bd6d96');
});

test('admits exact S01 start scope when the separate owner receipt is authenticated', async () => {
  // Given an exact valid production pack and exact requested scope.
  const args = ['--scenario', scenario, '--manifest', manifest, '--check', '--start-scope', 'S01-L,S01-O'];
  // When the real admission CLI checks start eligibility.
  const result = await run(args);
  // Then the scoped data is admitted without creating a host.
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.operationsValid, true);
  assert.equal(receipt.status, 'admitted');
});

test('rejects invalid inputs without output when authority or approved content changes', async t => {
  // Given owned fixture copies, never modified source or production data.
  const dir = await mkdtemp(join(tmpdir(), 'campaign-operation-negative-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    { name: 'out-of-appendix-value', file: 'r2/operations.json', change: value => { value.durations.compare = 301; } },
    { name: 'candidate-hash-mismatch', file: 'r2/operations.json', change: value => { value.approval.candidateSha256 = '0'.repeat(64); } },
    { name: 'missing-actor', file: 'manifest.json', change: value => { value.selection.persons = value.selection.persons.filter(person => person.id !== 'K568'); } },
    { name: 'missing-site', file: 'manifest.json', change: value => { value.selection.site.id = 'absent'; } },
    { name: 'unknown-authority', file: 'r2/operations.json', change: value => { value.authority.issuer = 'unknown'; } },
    { name: 'changed-canon-issuer', file: 'townhall-s01-r1/scenario.json', change: value => { value.rights.grants[0].issuer = 'K002'; } },
    { name: 'start-boolean-without-receipt', file: 'r2/operations.json', change: value => { value.executionAllowed = true; value.startAuthorization = { status: 'absent', receipt: null }; } },
    { name: 'fake-start-receipt', file: 'r2/operations.json', change: value => { value.startAuthorization = { status: 'approved', receipt: { approved: true } }; } },
    { name: 'receipt-removed', file: 'r2/operations.json', change: value => { delete value.startAuthorization.receipt; } },
    { name: 'receipt-hash-mismatch', file: 'r2/operations.json', change: value => { value.startAuthorization.receiptSha256 = '0'.repeat(64); } },
    { name: 'receipt-appendix-mismatch', file: 'r2/operations.json', change: value => { value.startAuthorization.receipt.appendixSha256 = '0'.repeat(64); } },
    { name: 'receipt-scope-expanded', file: 'r2/operations.json', change: value => { value.startAuthorization.receipt.scope.includes.push('general-combat'); } },
    { name: 'schema-self-rewrite', file: 'r2/operations.schema.json', change: value => { value.const.durations.compare = 301; } },
    { name: 'appendix-bytes-mismatch', appendix: true },
    { name: 'unknown-start-scope', scope: 'general-combat' },
    { name: 'unknown-argument', extra: ['--executionAllowed', 'true'] },
  ];
  for (const item of cases) {
    const fixture = join(dir, item.name);
    await cp(scenario, join(fixture, 'r2'), { recursive: true });
    await cp(join(root, 'game/data/scenarios/townhall-s01-r1'), join(fixture, 'townhall-s01-r1'), { recursive: true });
    await cp(manifest, join(fixture, 'manifest.json'));
    if (item.file) {
      const file = join(fixture, item.file), value = JSON.parse(await readFile(file, 'utf8'));
      item.change(value);
      await writeFile(file, JSON.stringify(value, null, 2) + '\n');
    }
    if (item.appendix) await writeFile(join(fixture, 'appendix.md'), 'not the approved appendix');
    const before = await readdir(fixture);
    const args = ['--scenario', join(fixture, 'r2'), '--manifest', join(fixture, 'manifest.json'), '--check',
      ...(item.appendix ? ['--appendix', join(fixture, 'appendix.md')] : []),
      ...(item.scope ? ['--start-scope', item.scope] : []), ...(item.extra ?? [])];
    // When the same real CLI receives the malformed input.
    const result = await run(args);
    // Then it rejects before start, without stdout or new artifacts.
    assert.equal(result.code, 1, `${item.name}: ${result.stderr}`);
    assert.equal(result.stdout, '', item.name);
    assert.deepEqual(await readdir(fixture), before);
    receipts.push({ name: item.name, ...result, outputAbsent: true });
  }
});

test.after(async () => {
  if (process.env.CAMPAIGN_NEGATIVE_RECEIPT) await writeFile(resolve(process.env.CAMPAIGN_NEGATIVE_RECEIPT), JSON.stringify(receipts, null, 2) + '\n');
});
