import { z } from '../../../engine/node_modules/zod/index.js';
import { count, digest, personId } from './contentSchemas.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import { campaignAuthorityAt } from './authorityBasis.ts';

const requestSchema = z.strictObject({
  operation: z.enum(['S01-L', 'S01-O']), issuerPersonId: personId, recipientId: personId,
  expectedRevision: count, expectedCompositeVersion: digest.optional(),
}).readonly();

/** Draft/confirm boundary. Scope and terms come only from the admitted pack. */
export function composeCampaignAuthority(state: CampaignState, input: unknown, content: CampaignContent) {
  ownInput(input);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const current = parseCampaignState(state, content), request = parsed.data;
  requireBoundary(request.expectedRevision === current.revision, 'stale-version');
  const basis = campaignAuthorityAt(current, request.operation, { content, at: current.clock.worldMilliseconds });
  requireBoundary(request.issuerPersonId === basis.issuerPersonId && request.recipientId === basis.recipientId, 'authority-source');
  requireBoundary(request.expectedCompositeVersion === undefined || request.expectedCompositeVersion === basis.compositeVersion, 'grant-version');
  return basis;
}
