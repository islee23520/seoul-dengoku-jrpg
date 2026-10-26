import { readFile, mkdir, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { packFiles } from '../../hosting/campaign-content.ts';
import { buildWebGame, assertServedFileSizes } from './build-web-game.mjs';
import { assertServedOutputPrivacy } from './served-output-privacy.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function buildCampaignGame(output) {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output must be empty');
  const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => [key, await readFile(path.join(root, 'game', file), 'utf8')]));
  const content = CampaignContent.parse(Object.fromEntries(entries));
  const digest = createHash('sha256');
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
  await assertServedFileSizes(output);
  await assertServedOutputPrivacy(output);
  return { mode: 'admitted-s01-campaign', buildId, content: content.hashes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('Usage: node scripts/tools/build-campaign-game.mjs --out <empty-directory>');
  else if (args.length !== 2 || args[0] !== '--out' || !args[1]) { console.error('Required: --out <empty-directory>'); process.exitCode = 2; }
  else console.log(JSON.stringify(await buildCampaignGame(path.resolve(args[1]))));
}
