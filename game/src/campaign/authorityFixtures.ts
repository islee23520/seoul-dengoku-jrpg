import { id, integer } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { content, e0 } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { nodeLocation } from './locations.ts';
import { parseCampaignState } from './state.ts';
import type { CampaignState } from './state.ts';

export function acceptedOrder(operation: 'S01-L' | 'S01-O', orderId: string = operation): CampaignState['mandates'][number] {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(e0, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: 0 }, content);
  return {
    origin: 'legacy-boundary',
    orderId: id('OrderId', orderId), causeId: id('CauseId', orderId), operation,
    issuerPersonId: basis.issuerPersonId, recipientId: basis.recipientId, authority: basis.authority, compositeVersion: basis.compositeVersion,
    target: nodeLocation('s01:townhall:desk', content), issuerLocation: nodeLocation('s01:townhall:desk', content),
    recipientLocation: nodeLocation('s01:townhall:desk', content), route: [id('CampaignNodeId', 's01:townhall:desk')],
    stage: 'consent', issuedAt: integer('WorldMilliseconds', 0), receivedAt: integer('WorldMilliseconds', 30000),
    acceptedAt: integer('WorldMilliseconds', 60000), returnAcceptedAt: null, workMilliseconds: 0,
    reservationIds: [], pendingResultIds: [], appliedResultIds: [],
  };
}
export function readyState(orders: readonly CampaignState['mandates'][number][] = [acceptedOrder('S01-L')]): CampaignState {
  return parseCampaignState({ ...e0, clock: { ...e0.clock, worldMilliseconds: 66000 }, mandates: orders,
    bodies: e0.bodies.map(b => ({ ...b, location: nodeLocation('s01:townhall:desk', content) })),
  }, content);
}
export function changedGrant(state: CampaignState, status: 'revoked' | 'expired'): CampaignState {
  return parseCampaignState({ ...state, grants: state.grants.map(g => {
    if (g.id !== 'grant:townhall-s01-archive-r1') return g;
    const event = { previousVersion: g.sourceVersion, state: status, effectiveAt: state.clock.worldMilliseconds,
      causeId: id('CauseId', status), issuer: content.data.operations.authority.issuer };
    return { ...g, revisions: [...g.revisions, { ...event, version: summaryHash({ grantId: g.id, ...event }) }] };
  }) }, content);
}
export function checkRequest(state: CampaignState) {
  const order = state.mandates[0];
  if (!order) throw new RangeError('test fixture needs one mandate');
  return { orderId: order.orderId, expectedRevision: state.revision, expectedCompositeVersion: order.compositeVersion,
    until: 96000, action: { kind: 'archive-check' } };
}
