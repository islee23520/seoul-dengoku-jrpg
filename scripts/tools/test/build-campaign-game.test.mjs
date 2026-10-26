import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, cp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCampaignGame, verifyCampaignInputs, verifyCampaignArtifact, classifyCampaignArtifactFile, campaignArtifactAllowlist } from '../build-campaign-game.mjs';
import { ENGINE_REVISION as PINNED_REVISION } from '../build-realtime-game.mjs';
import { CampaignContent } from '../../../game/src/campaign/content.ts';
import { packFiles } from '../../../hosting/campaign-content.ts';

const root = new URL('../../../', import.meta.url).pathname;
const git = args => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_MASTER: '1' }, encoding: 'utf8' });

test('engine pin and patch isolation resolve for the admitted tree', async () => {
  const admitted = await verifyCampaignInputs();
  assert.equal(admitted.engineRevision, PINNED_REVISION);
  assert.match(admitted.patchSha256, /^[0-9a-f]{64}$/);
  assert.equal(admitted.content.hashes.manifest, admitted.content.hashes.manifest);
});

test('artifact allowlist classifies exactly the campaign surface', () => {
  for (const name of ['index.html', 'campaign.html', 'campaign-build.json', 'fonts/NotoSansKR-OFL.txt', ...Object.values(packFiles)]) {
    assert.equal(classifyCampaignArtifactFile(name), 'declared');
  }
  assert.equal(classifyCampaignArtifactFile('assets/campaign-entry-D2Aq5dJY.js'), 'entry-chunk');
  assert.equal(classifyCampaignArtifactFile('assets/NotoSansKR-Bold-e8gRwB7o.otf'), 'font');
  assert.equal(classifyCampaignArtifactFile('legacy/player.js'), 'legacy-preview');
  for (const rejected of ['../escape.txt', 'private/soul.json', 'game.sqlite', 'assets/evil.js', 'credentials.env', 'legacy/../../etc']) {
    assert.equal(classifyCampaignArtifactFile(rejected), null, rejected);
  }
  assert.ok(campaignArtifactAllowlist.includes('data/campaign/source-manifest.json'));
});

test('packaging rejects an unknown campaign data input before producing output', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'campaign-neg-'));
  try {
    const rogue = path.join(root, 'game/data/campaign/uncommitted-private-note.json');
    await writeFile(rogue, '{"private":true}');
    try {
      await assert.rejects(buildCampaignGame(output), /Unknown or modified campaign data input[\s\S]*uncommitted-private-note\.json/);
      assert.deepEqual(await readdir(output), [], 'no byte may be packaged after the rejection');
    } finally { await rm(rogue); }
    assert.equal(git(['status', '--porcelain', '--', 'game/data/campaign', 'game/data/scenarios']).trim(), '', 'test restores the clean data trees');
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('a changed approved pack input is rejected by the hash-bound admission', async () => {
  // The shared pack files are never mutated on disk here: the parallel suite imports them.
  const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => [key, await readFile(path.join(root, 'game', file), 'utf8')]));
  const admitted = Object.fromEntries(entries);
  CampaignContent.parse(admitted);
  const edited = { ...admitted, identities: admitted.identities.replace('"edition"', '"edition-x"') };
  assert.throws(() => CampaignContent.parse(edited), /content-hash|boundary|shape/);
  assert.equal(git(['status', '--porcelain', '--', 'game/data/campaign', 'game/data/scenarios']).trim(), '', 'data trees stay untouched');
});


test('packaging refuses a stale non-empty output directory', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'campaign-neg-'));
  try {
    await writeFile(path.join(output, 'previous.txt'), 'stale');
    await assert.rejects(buildCampaignGame(output), /Output must be empty/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('artifact admission re-verifies a real build and rejects rogue or edited bytes', async () => {
  const built = process.env.CAMPAIGN_GAME_OUTPUT;
  assert.ok(built, 'CAMPAIGN_GAME_OUTPUT must name the built campaign artifact');
  const admitted = await verifyCampaignArtifact(built, { campaignManifest: path.join(root, 'game', packFiles.manifest) });
  assert.ok(admitted.receipt.buildId && admitted.receipt.sourceSha256 === admitted.content.hashes.manifest);
  const copy = await mkdtemp(path.join(tmpdir(), 'campaign-verify-'));
  try {
    await cp(built, copy, { recursive: true });
    await verifyCampaignArtifact(copy, { campaignManifest: path.join(root, 'game', packFiles.manifest) });
    await writeFile(path.join(copy, 'rogue-secret.json'), '{"soul":true}');
    await assert.rejects(verifyCampaignArtifact(copy), /Unknown artifact file[\s\S]*rogue-secret\.json/);
    await rm(path.join(copy, 'rogue-secret.json'));
    const pack = path.join(copy, packFiles.operations);
    const edited = JSON.parse(await readFile(pack, 'utf8'));
    edited.clock.worldSecondsPerRealSecond += 1;
    await writeFile(pack, JSON.stringify(edited));
    await assert.rejects(verifyCampaignArtifact(copy), /boundary|content-hash|shape/);
    await mkdir(path.join(copy, 'fonts'), { recursive: true });
    const ofl = await readFile(path.join(copy, 'fonts/NotoSansKR-OFL.txt'), 'utf8');
    await writeFile(path.join(copy, 'fonts/NotoSansKR-OFL.txt'), ofl + '/private/var/folders/leak');
    await assert.rejects(verifyCampaignArtifact(copy), /Private filesystem path/);
  } finally { await rm(copy, { recursive: true, force: true }); }
});
