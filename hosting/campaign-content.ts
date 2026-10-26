/** Browser-side construction of the admitted campaign runtime (task13 local-first proof).
 * Fetches the exact admitted pack files from the served output and parses them through the same
 * hash-bound CampaignContent boundary the CLI uses; nothing here can admit edited data. */
import { CampaignContent } from '../game/src/campaign/content.ts';
import { createCampaignE0 } from '../game/src/campaign/state.ts';
import { CampaignApplication } from '../game/src/campaign/application.ts';

const packFiles = {
  manifest: 'data/campaign/source-manifest.json',
  atlas: 'data/campaign/atlas.json',
  identities: 'data/campaign/identity-map.json',
  scenario: 'data/scenarios/townhall-s01-r1/scenario.json',
  projection: 'data/scenarios/townhall-s01-r1/projection.json',
  operations: 'data/scenarios/townhall-s01-r2/operations.json',
} as const;

export interface CampaignRuntime { readonly content: CampaignContent; readonly app: CampaignApplication }

let runtime: Promise<CampaignRuntime> | null = null;

export function loadCampaignRuntime(): Promise<CampaignRuntime> {
  runtime ??= (async () => {
    const entries = await Promise.all(Object.entries(packFiles).map(async ([name, path]) => {
      const response = await fetch(new URL(path, document.baseURI), { cache: 'force-cache' });
      if (!response.ok) throw new Error('campaign-pack-unreadable:' + name + ':' + response.status);
      return [name, await response.text()] as const;
    }));
    const content = CampaignContent.parse(Object.fromEntries(entries));
    const app = new CampaignApplication({ content, state: createCampaignE0(content), now: () => performance.now() });
    return { content, app };
  })();
  return runtime;
}
