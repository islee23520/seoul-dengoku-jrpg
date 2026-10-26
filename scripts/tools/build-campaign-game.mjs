import { readFile, mkdir, readdir, cp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { packFiles } from '../../hosting/campaign-content.ts';
import { buildWebGame, assertServedFileSizes } from './build-web-game.mjs';
import { verifyEngine, ENGINE_REVISION } from './build-realtime-game.mjs';
import { assertServedOutputPrivacy } from './served-output-privacy.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (args, cwd) => exec('git', args, { cwd, env: { ...process.env, GIT_MASTER: '1' } });

/** Pages rejects any single served file at 25 MiB; assertServedFileSizes keeps the stricter 20 MiB guard. */
export const MAX_CAMPAIGN_FILE_BYTES = 25 * 1024 * 1024;
const patchName = 'patches/realtime-battle-host.patch';
const dataTrees = ['game/data/campaign', 'game/data/scenarios'];

/** Campaign-authored files the artifact may contain besides vite's hashed chunks and legacy/*. */
export const campaignArtifactAllowlist = Object.freeze([
  'index.html', 'campaign.html', 'campaign-build.json', 'fonts/NotoSansKR-OFL.txt', ...Object.values(packFiles),
]);
export function classifyCampaignArtifactFile(name) {
  if (name.includes('..')) return null;
  if (campaignArtifactAllowlist.includes(name)) return 'declared';
  if (/^assets\/campaign-entry-[A-Za-z0-9_-]+\.(js|css)$/.test(name)) return 'entry-chunk';
  if (/^assets\/NotoSansKR-(Bold|Medium|Regular)-[A-Za-z0-9_-]+\.otf$/.test(name)) return 'font';
  if (name.startsWith('legacy/')) return 'legacy-preview';
  return null;
}

/** Engine pin and patch isolation: the build toolchain must be the admitted revision with the
 * admitted patch still applying cleanly, and the campaign data trees must carry no unknown or
 * modified input. All of this rejects before any output byte is produced. */
export async function verifyCampaignInputs() {
  const inventory = JSON.parse(await readFile(path.join(root, 'hosting/engine-inputs.json'), 'utf8'));
  await verifyEngine(path.join(root, 'engine'), inventory);
  const patchSha256 = sha(await readFile(path.join(root, patchName)));
  await git(['apply', '--check', patchName], root);
  const { stdout } = await git(['status', '--porcelain', '--', ...dataTrees], root);
  if (stdout.trim()) throw new Error('Unknown or modified campaign data input; commit or remove it before packaging:\n' + stdout.trim());
  const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => [key, await readFile(path.join(root, 'game', file), 'utf8')]));
  return { content: CampaignContent.parse(Object.fromEntries(entries)), engineRevision: ENGINE_REVISION, patchSha256 };
}

async function artifactFiles(output) {
  const files = [];
  const walk = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await walk(file); else files.push(path.relative(output, file));
    }
  };
  await walk(output);
  return files.sort();
}

/** Admit an already built artifact: exact file allowlist, admitted pack hashes, the Pages
 * per-file limit, private-path privacy, no node-only runtime imports in the campaign chunks,
 * and a receipt bound to the bytes it describes. Used by the builder and gate-campaign.sh. */
export async function verifyCampaignArtifact(output, options = {}) {
  const files = await artifactFiles(output);
  if (!files.length) throw new Error('Campaign artifact is empty');
  const unknown = files.filter(name => !classifyCampaignArtifactFile(name));
  if (unknown.length) throw new Error('Unknown artifact file outside the campaign allowlist: ' + unknown.join(', '));
  for (const marker of ['index.html', 'campaign.html', 'campaign-build.json', 'legacy/index.html', 'legacy/preview.html', 'legacy/map-preview.json', ...Object.values(packFiles)]) {
    if (!files.includes(marker)) throw new Error('Missing required artifact file: ' + marker);
  }
  await assertServedFileSizes(output);
  let totalBytes = 0, largest = { name: null, bytes: 0 };
  for (const name of files) {
    const { size } = await stat(path.join(output, name));
    totalBytes += size;
    if (size > largest.bytes) largest = { name, bytes: size };
    if (size >= MAX_CAMPAIGN_FILE_BYTES) throw new Error('Artifact file at or above the 25 MiB Pages limit: ' + name + ' (' + size + ')');
  }
  await assertServedOutputPrivacy(output);
  for (const name of files.filter(file => /^assets\/campaign-entry-[A-Za-z0-9_-]+\.js$/.test(file))) {
    const code = await readFile(path.join(output, name), 'utf8');
    if (/(?:from|import|require\s*\()\s*["']node:/.test(code)) throw new Error('node-only runtime import in campaign chunk: ' + name);
  }
  const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => [key, await readFile(path.join(output, file), 'utf8')]));
  const content = CampaignContent.parse(Object.fromEntries(entries));
  if (options.campaignManifest) {
    const admitted = sha(await readFile(options.campaignManifest));
    if (admitted !== content.hashes.manifest) throw new Error('CAMPAIGN_MANIFEST is not the admitted artifact source manifest');
  }
  const receipt = JSON.parse(await readFile(path.join(output, 'campaign-build.json'), 'utf8'));
  if (receipt.mode !== 'admitted-s01-campaign' || receipt.sourceSha256 !== content.hashes.manifest || receipt.operationsSha256 !== content.hashes.operations) throw new Error('Build receipt does not bind the admitted pack');
  const entry = files.find(name => /^assets\/campaign-entry-[A-Za-z0-9_-]+\.js$/.test(name));
  if (!entry || !(await readFile(path.join(output, entry))).includes(Buffer.from(receipt.buildId))) throw new Error('Entry chunk does not carry the receipt build identity');
  return { fileCount: files.length, totalBytes, largest, content, receipt };
}

export async function buildCampaignGame(output) {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output must be empty; remove only your previous campaign-dist before rebuilding');
  const { content, engineRevision, patchSha256 } = await verifyCampaignInputs();
  const digest = createHash('sha256');
  for (const name of ['scripts/tools/build-campaign-game.mjs', 'hosting/vite.campaign.config.mjs']) digest.update(name).update('\0').update(await readFile(path.join(root, name))).update('\0');
  for (const directory of ['hosting', 'game/src', 'game/ui']) {
    for (const file of (await readdir(path.join(root, directory), { recursive: true })).sort()) {
      if (!/\.(ts|mjs|css|html)$/.test(file) || file.endsWith('.test.ts')) continue;
      digest.update(directory + '/' + file).update(await readFile(path.join(root, directory, file)));
    }
  }
  digest.update(JSON.stringify(content.hashes));
  const buildId = digest.digest('hex');
  await exec(process.execPath, [path.join(root, 'engine/node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root, 'hosting/vite.campaign.config.mjs'), '--configLoader', 'runner', '--outDir', path.resolve(output)], {
    cwd: root, env: { ...process.env, CAMPAIGN_BUILD_ID: buildId }, maxBuffer: 16 * 1024 * 1024,
  });
  for (const file of Object.values(packFiles)) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await cp(path.join(root, 'game', file), path.join(output, file));
  }
  await mkdir(path.join(output, 'fonts'), { recursive: true });
  await cp(path.join(root, 'hosting/fonts/LICENSE.txt'), path.join(output, 'fonts/NotoSansKR-OFL.txt'));
  await buildWebGame(path.join(output, 'legacy'));
  const rights = JSON.parse(await readFile(path.join(root, 'game', packFiles.manifest), 'utf8')).rights;
  const licenses = rights.licenses.map(license => ({ id: license.id, work: license.work ?? null, holder: license.holder ?? null, license: license.license, source: license.source }));
  const { fileCount, totalBytes, largest } = await (async () => {
    const files = (await artifactFiles(output)).filter(name => name !== 'campaign-build.json');
    let total = 0, biggest = { name: null, bytes: 0 };
    for (const name of files) {
      const { size } = await stat(path.join(output, name));
      total += size;
      if (size > biggest.bytes) biggest = { name, bytes: size };
    }
    return { fileCount: files.length, totalBytes: total, largest: biggest };
  })();
  const receipt = { mode: 'admitted-s01-campaign', buildId, engineRevision, patchSha256,
    sourceSha256: content.hashes.manifest, operationsSha256: content.hashes.operations, content: content.hashes,
    attribution: { dataLicenses: licenses, fonts: 'NotoSansKR under SIL OFL 1.1 (fonts/NotoSansKR-OFL.txt); engine runtime and asset notices under legacy/' },
    fileCount: fileCount + 1, totalBytes, largestFile: largest };
  await writeFile(path.join(output, 'campaign-build.json'), JSON.stringify(receipt, null, 2) + '\n');
  const verified = await verifyCampaignArtifact(output);
  console.log(JSON.stringify({ ...receipt, verified: { fileCount: verified.fileCount, totalBytes: verified.totalBytes } }));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('Usage: node scripts/tools/build-campaign-game.mjs --out <empty-directory>\nBundles the admitted S01 campaign entry, the exact pack files, fonts with license and the\nlabelled legacy map preview. Rejects before packaging on an unknown or modified campaign\ndata input, an engine/patch pin mismatch, or a non-empty output directory. Every served\nfile stays under the 25 MiB Pages limit (20 MiB builder guard).');
  else if (args.length !== 2 || args[0] !== '--out' || !args[1]) { console.error('Required: --out <empty-directory>'); process.exitCode = 2; }
  else await buildCampaignGame(path.resolve(args[1]));
}
