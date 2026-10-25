import { z } from '../../../engine/node_modules/zod/index.js';
import { summaryHash } from '../domain/eventLedger.ts';
import { CheckpointCorrupt } from '../save/campaignCheckpoint.ts';
import type { CheckpointStorage } from '../save/campaignCheckpoint.ts';
import { readCheckpoint, writeCheckpoint } from '../save/checkpointStorage.ts';
import { campaignStateSchema } from './stateSchemas.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import type { CampaignContent } from './content.ts';
import { ownInput, CampaignBoundaryError } from './errors.ts';
import { digest } from './contentSchemas.ts';
import { json } from '../battle/realtime.ts';

export const CAMPAIGN_SAVE_NAMESPACE = 'seoul-composed-campaign-v2';
const saveSchema = z.strictObject({
  namespace: z.literal(CAMPAIGN_SAVE_NAMESPACE), envelopeVersion: z.literal(2),
  timeline: z.literal('section2-route-r2-pending-ratification'),
  state: campaignStateSchema, checksum: digest,
}).readonly();
export type CampaignSave = z.infer<typeof saveSchema>;

export function parseCampaignSave(input: unknown, content: CampaignContent): CampaignSave {
  try {
    ownInput(input);
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) throw new CheckpointCorrupt('campaign-envelope-shape');
    if (summaryHash(json.parse(input)) !== summaryHash(parsed.data)) throw new CheckpointCorrupt('incomplete-campaign-envelope');
    const { checksum, ...payload } = parsed.data;
    if (summaryHash(payload) !== checksum) throw new CheckpointCorrupt('checksum');
    const state = parseCampaignState(payload.state, content);
    return { ...payload, state, checksum };
  } catch (error) {
    if (error instanceof CampaignBoundaryError) throw new CheckpointCorrupt('campaign-' + error.code);
    throw error;
  }
}
export function createCampaignSave(input: CampaignState, content: CampaignContent): CampaignSave {
  const payload = { namespace: CAMPAIGN_SAVE_NAMESPACE, envelopeVersion: 2 as const,
    timeline: 'section2-route-r2-pending-ratification' as const, state: parseCampaignState(input, content) };
  return parseCampaignSave({ ...payload, checksum: summaryHash(payload) }, content);
}
export function persistCampaignSave(storage: CheckpointStorage, input: unknown, content: CampaignContent): CampaignSave {
  return writeCheckpoint(storage, input, { namespace: CAMPAIGN_SAVE_NAMESPACE,
    parse: value => parseCampaignSave(value, content), checksum: value => value.checksum });
}
export function loadCampaignSave(storage: CheckpointStorage, content: CampaignContent): CampaignSave {
  return readCheckpoint(storage, { namespace: CAMPAIGN_SAVE_NAMESPACE,
    parse: value => parseCampaignSave(value, content), checksum: value => value.checksum });
}
