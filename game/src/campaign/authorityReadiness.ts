import { z } from '../../../engine/node_modules/zod/index.js';
import { assertNever } from '../domain/errors.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { count, digest, milliseconds, nodeId, ref } from './contentSchemas.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { assertComposedAuthority } from './authorityBasis.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';

const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('walk'), to: nodeId }),
  z.strictObject({ kind: z.literal('carry-original'), to: nodeId }),
  z.strictObject({ kind: z.literal('archive-check') }),
  z.strictObject({ kind: z.literal('pickup-original') }),
  z.strictObject({ kind: z.literal('deliver-original') }),
  z.strictObject({ kind: z.literal('compare-ledger') }),
  z.strictObject({ kind: z.literal('observe-cistern') }),
  z.strictObject({ kind: z.literal('observe-tap') }),
]);
const readinessSchema = z.strictObject({ orderId: ref, expectedRevision: count, expectedCompositeVersion: digest,
  until: milliseconds, action: actionSchema }).readonly();
type Resource = CampaignState['reservations'][number]['resource'];

/** Check one planned effect/reservation window. Does not accept, schedule, move or transfer anything. */
export function checkCampaignReadiness(state: CampaignState, input: unknown, content: CampaignContent) {
  ownInput(input);
  const parsed = readinessSchema.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const current = parseCampaignState(state, content), request = parsed.data;
  requireBoundary(request.expectedRevision === current.revision, 'stale-version');
  const order = current.mandates.find(m => m.orderId === request.orderId);
  requireBoundary(order !== undefined, 'cross-link');
  assertComposedAuthority(current, order, { content, at: current.clock.worldMilliseconds });
  requireBoundary(request.expectedCompositeVersion === order.compositeVersion, 'grant-version');
  requireBoundary(order.acceptedAt !== null && ['consent', 'reserved', 'executing'].includes(order.stage), 'consent-required');
  const { operations: o, scenario: s } = content.data;
  requireBoundary(s.policies.scheduleConflictPolicy === 'reject-conflict' && o.responses.conflict === 'rejected-conflict' && !o.responses.automaticQueue, 'content-link');
  const from = current.clock.worldMilliseconds, until = request.until;
  requireBoundary(until > from && until < Math.min(current.clock.closedAt ?? Infinity, o.clock.scheduledCloseSeconds * 1000), 'authority-expired');
  const actor = current.bodies.find(b => b.entityId === order.recipientId);
  requireBoundary(actor !== undefined, 'body-unavailable');
  const resources: Resource[] = [{ kind: 'body', entityId: actor.entityId }];
  let activity: 'walking' | 'carrying' | 'stationary' = 'stationary';
  let minimumSeconds = 0;
  let dutyRequired = false;
  let records = false;
  const location = actor.location;
  const action = request.action;
  switch (action.kind) {
    case 'walk': case 'carry-original': {
      activity = action.kind === 'walk' ? 'walking' : 'carrying';
      requireBoundary(actor.location.kind === 'node', 'action-scope');
      const node = actor.location.nodeId;
      const edge = o.routes.edges.find(e => (e.from === node && e.to === action.to) || (e.to === node && e.from === action.to));
      requireBoundary(edge !== undefined && s.actors.find(a => a.id === actor.entityId)?.access.includes(action.to) === true, 'location-scope');
      minimumSeconds = edge.metres / (activity === 'walking' ? o.routes.walkingMetresPerSecond : o.routes.ledgerMetresPerSecond);
      switch (action.kind) {
        case 'carry-original':
          requireBoundary(order.operation === 'S01-L' && edge.ledgerAllowed && current.custody.some(c => c.custodian === actor.entityId && c.assetId === s.ledger.id && summaryHash(c.location) === summaryHash(actor.location)), 'custody');
          resources.push({ kind: 'asset', assetId: s.ledger.id });
          dutyRequired = true;
          break;
        case 'walk':
          requireBoundary(!current.custody.some(c => c.custodian === actor.entityId), 'custody');
          dutyRequired = order.operation === 'S01-L' && [node, action.to].some(n => n === 's01:townhall:archive' || n === s.ledger.container);
          break;
        default: assertNever(action);
      }
      break;
    }
    case 'archive-check': case 'pickup-original': case 'deliver-original': case 'compare-ledger': {
      requireBoundary(order.operation === 'S01-L', 'action-scope');
      const at = action.kind === 'pickup-original' ? s.ledger.container : o.authority.actorPlacements[o.authority.designator];
      requireBoundary(actor.location.kind === 'node' && actor.location.nodeId === at, 'location-scope');
      resources.push({ kind: 'asset', assetId: s.ledger.id });
      const original = current.custody.find(c => c.assetId === s.ledger.id);
      requireBoundary(original !== undefined, 'custody');
      switch (action.kind) {
        case 'archive-check': minimumSeconds = o.durations.archiveCheck; dutyRequired = true; break;
        case 'pickup-original':
          minimumSeconds = o.durations.pickup; dutyRequired = true;
          requireBoundary(original.custodian === o.authority.duty && original.returnState === 'stored' && summaryHash(original.location) === summaryHash(actor.location), 'custody'); break;
        case 'deliver-original':
          minimumSeconds = o.durations.deliverToK002;
          resources.push({ kind: 'body', entityId: o.authority.designator });
          requireBoundary(original.custodian === actor.entityId && summaryHash(original.location) === summaryHash(actor.location), 'custody'); break;
        case 'compare-ledger':
          minimumSeconds = o.durations.compareRow; records = true;
          resources.push({ kind: 'body', entityId: o.authority.designator }, { kind: 'asset', assetId: o.provisions.writingKit });
          requireBoundary(original.custodian === o.authority.designator && summaryHash(original.location) === summaryHash(actor.location), 'custody'); break;
        default: assertNever(action);
      }
      break;
    }
    case 'observe-cistern': case 'observe-tap': {
      requireBoundary(order.operation === 'S01-O', 'action-scope');
      const index = action.kind === 'observe-cistern' ? 0 : 1;
      const observation = o.evidence.observations[index];
      requireBoundary(observation !== undefined && actor.location.kind === 'node' && actor.location.nodeId === observation.siteId, 'location-scope');
      minimumSeconds = action.kind === 'observe-cistern' ? o.durations.cisternObservation : o.durations.tapObservation;
      records = true;
      for (const tool of s.availability.tools.filter(t => t.at === observation.siteId || t.id === o.provisions.lights)) resources.push({ kind: 'asset', assetId: tool.id });
      requireBoundary(until <= o.provisions.lightsUntilSeconds * 1000, 'tool-unavailable');
      break;
    }
    default: assertNever(action);
  }
  if (dutyRequired) {
    requireBoundary(current.duty.available && current.duty.keyHolder === o.authority.duty, 'duty-unavailable');
    const duty = current.bodies.find(b => b.entityId === o.authority.duty);
    requireBoundary(duty !== undefined && summaryHash(duty.location) === summaryHash(location), 'duty-unavailable');
    resources.push({ kind: 'body', entityId: duty.entityId });
  }
  const required = o.body.required[activity];
  let tired = false;
  for (const resource of resources) {
    switch (resource.kind) {
      case 'body': {
        const body = current.bodies.find(b => b.entityId === resource.entityId);
        requireBoundary(body !== undefined && summaryHash(body.location) === summaryHash(location), 'body-unavailable');
        requireBoundary(required.every(region => body.regions.some(r => r.region === region && r.effortMilliseconds < o.body.restRequiredAtEffortSeconds * 1000)), 'body-unavailable');
        requireBoundary(until <= body.foodCoveredUntil && until <= body.waterCoveredUntil && until < o.clock.supportUntilSeconds * 1000, 'support-unavailable');
        tired ||= body.regions.some(r => required.includes(r.region) && r.effortMilliseconds >= o.body.tiredAtEffortSeconds * 1000);
        break;
      }
      case 'asset':
        requireBoundary(resource.assetId === s.ledger.id || current.tools.some(t => t.id === resource.assetId && t.available), 'tool-unavailable'); break;
      default: assertNever(resource);
    }
  }
  requireBoundary(until - from >= minimumSeconds * 1000 / (tired ? o.routes.tiredMultiplier : 1), 'action-scope');
  if (records) requireBoundary(current.inventories.some(i => i.entityId === actor.entityId && i.paperSheets + i.consumedPaperSheets > 0), 'tool-unavailable');
  requireBoundary(!current.reservations.some(r => r.orderId !== order.orderId && r.from < until && from < r.until && resources.some(resource => summaryHash(resource) === summaryHash(r.resource))), 'rejected-conflict');
  return { from, until, resources, compositeVersion: order.compositeVersion, conflictPolicy: s.policies.scheduleConflictPolicy };
}
