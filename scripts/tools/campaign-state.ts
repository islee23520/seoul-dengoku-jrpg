import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { createCampaignE0, parseCampaignState, receivedReports } from '../../game/src/campaign/state.ts';
import { CampaignBoundaryError } from '../../game/src/campaign/errors.ts';
import { summaryHash } from '../../game/src/domain/eventLedger.ts';
import { id } from '../../game/src/domain/ids.ts';

export async function checkCampaignState(args: readonly string[]) {
  if (args.length === 1 && args[0] === '--help') return { usage: 'node scripts/tools/campaign-state.ts --check [--state FILE]', writes: false };
  if (!(args.length === 1 && args[0] === '--check') && !(args.length === 3 && args[0] === '--check' && args[1] === '--state' && args[2] && !args[2].startsWith('--'))) throw new CampaignBoundaryError('shape');
  const data = new URL('../../game/data/', import.meta.url);
  const content = CampaignContent.parse({
    manifest: await readFile(new URL('campaign/source-manifest.json', data), 'utf8'),
    atlas: await readFile(new URL('campaign/atlas.json', data), 'utf8'),
    identities: await readFile(new URL('campaign/identity-map.json', data), 'utf8'),
    scenario: await readFile(new URL('scenarios/townhall-s01-r1/scenario.json', data), 'utf8'),
    projection: await readFile(new URL('scenarios/townhall-s01-r1/projection.json', data), 'utf8'),
    operations: await readFile(new URL('scenarios/townhall-s01-r2/operations.json', data), 'utf8'),
  });
  const file = args[2];
  const state = file === undefined ? createCampaignE0(content) : parseCampaignState(JSON.parse(await readFile(resolve(file), 'utf8')), content);
  const restored = parseCampaignState(JSON.parse(JSON.stringify(state)), content);
  return { status: 'valid-boundary', stateHash: summaryHash(restored), packages: restored.packages,
    people: restored.people.length, bodies: restored.bodies.length, grants: restored.grants.length,
    originalCount: restored.custody.length, receivedReportCount: receivedReports(restored, id('PersonId', 'K002')).length,
    hostCreated: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await checkCampaignState(process.argv.slice(2)))); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ name: error.name, code: error instanceof CampaignBoundaryError ? error.code : 'input-unreadable' }));
    process.exitCode = 1;
  }
}
