import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import { sourceGrantVersion } from './content.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { assertLocation, physicalNodes } from './locations.ts';
import type { CampaignState } from './stateSchemas.ts';

export function assertAuthorityLinks(state: CampaignState, content: CampaignContent): void {
  const { scenario, operations } = content.data;
  const now = state.clock.worldMilliseconds;
  requireBoundary(state.grants.length === scenario.rights.grants.length, 'authority-source');
  for (const grant of state.grants) {
    const source = scenario.rights.grants.find(g => g.id === grant.id);
    requireBoundary(source !== undefined, 'authority-source');
    requireBoundary(grant.sourceVersion === sourceGrantVersion(source), 'grant-version');
    const first = grant.revisions[0];
    requireBoundary(first !== undefined && first.version === grant.sourceVersion && first.previousVersion === null && first.state === 'valid' && first.effectiveAt === 0 && first.causeId === 'S01:E0', 'grant-version');
    for (const [index, revision] of grant.revisions.entries()) {
      requireBoundary(revision.issuer === source.issuer, 'authority-source');
      requireBoundary(revision.effectiveAt <= now, 'clock');
      if (index === 0) continue;
      const previous = grant.revisions[index - 1];
      const { version, ...event } = revision;
      requireBoundary(previous !== undefined && previous.state === 'valid' && revision.state !== 'valid' && revision.previousVersion === previous.version && revision.effectiveAt >= previous.effectiveAt && version === summaryHash({ grantId: grant.id, ...event }), 'grant-version');
    }
  }
  for (const order of state.mandates) {
    const operation = operations.authority.mandates.find(m => m.id === order.operation);
    requireBoundary(operation !== undefined && order.recipientId === operation.recipient && order.issuerPersonId === operations.authority.designator, 'authority-source');
    requireBoundary(order.authority.length === operation.grants.length && new Set(order.authority.map(a => a.grantId)).size === operation.grants.length && operation.grants.every(id => order.authority.some(a => a.grantId === id)), 'authority-source');
    for (const basis of order.authority) {
      const history = state.grants.find(g => g.id === basis.grantId)?.revisions;
      const atIssue = history?.filter(r => r.effectiveAt <= order.issuedAt).at(-1);
      requireBoundary(atIssue !== undefined && atIssue.version === basis.version && atIssue.state === 'valid', 'grant-version');
    }
    requireBoundary(order.compositeVersion === summaryHash({ operation: order.operation, authority: order.authority }), 'grant-version');
    requireBoundary(order.issuedAt <= now && order.issuedAt < operations.clock.scheduledCloseSeconds * 1000, 'clock');
    requireBoundary(order.receivedAt === null || (order.receivedAt >= order.issuedAt && order.receivedAt <= now), 'clock');
    requireBoundary(order.acceptedAt === null || (order.receivedAt !== null && order.acceptedAt >= order.receivedAt && order.acceptedAt <= now), 'clock');
    requireBoundary(order.returnAcceptedAt === null || (order.operation === 'S01-L' && order.acceptedAt !== null && order.returnAcceptedAt >= order.acceptedAt && order.returnAcceptedAt <= now), 'clock');
    switch (order.stage) {
      case 'received': requireBoundary(order.receivedAt !== null, 'cross-link'); break;
      case 'consent': case 'reserved': case 'executing': case 'result-applied': case 'receipt': requireBoundary(order.acceptedAt !== null, 'cross-link'); break;
      case 'proposed': case 'delivered': case 'refused': case 'cancelled': case 'interrupted': case 'expired': break;
      default: assertNever(order.stage);
    }
    for (const location of [order.target, order.issuerLocation, order.recipientLocation]) assertLocation(location, content);
    requireBoundary(physicalNodes(order.target).length > 0 && physicalNodes(order.target).every(n => scenario.actors.find(a => a.id === order.recipientId)?.access.includes(n)), 'location-scope');
    requireBoundary(order.route.every(n => scenario.actors.find(a => a.id === order.recipientId)?.access.includes(n)) && order.route.slice(1).every((n, i) => operations.routes.edges.some(e => (e.from === order.route[i] && e.to === n) || (e.to === order.route[i] && e.from === n))), 'location-scope');
    requireBoundary(order.reservationIds.every(id => state.reservations.some(r => r.id === id && r.orderId === order.orderId)), 'cross-link');
    requireBoundary(order.pendingResultIds.every(id => state.pendingResultIds.includes(id)) && order.appliedResultIds.every(id => state.results.some(r => r.id === id && r.orderId === order.orderId)), 'cross-link');
  }
}

export function assertPhysicalLinks(state: CampaignState, content: CampaignContent): void {
  const { scenario, operations } = content.data;
  const expectedEntities = [...scenario.actors.map(a => a.id), operations.authority.duty];
  requireBoundary(state.bodies.length === expectedEntities.length && expectedEntities.every(id => state.bodies.some(b => b.entityId === id)), 'person-scope');
  for (const body of state.bodies) {
    assertLocation(body.location, content);
    const allowed = body.entityId === operations.authority.duty
      ? [...scenario.ledger.route.orderedNodes, ...scenario.rights.dutyWalk.section]
      : scenario.actors.find(a => a.id === body.entityId)?.access;
    const nodes = physicalNodes(body.location);
    requireBoundary(allowed !== undefined && nodes.length > 0 && nodes.every(n => allowed.includes(n)), 'location-scope');
    if (body.entityId === operations.authority.designator) requireBoundary(nodes.length === 1 && nodes[0] === operations.authority.actorPlacements[operations.authority.designator], 'location-scope');
    requireBoundary(body.regions.length === operations.body.regions.length && new Set(body.regions.map(r => r.region)).size === operations.body.regions.length && body.regions.every(r => operations.body.regions.includes(r.region)), 'cross-link');
    requireBoundary([body.foodCoveredUntil, body.waterCoveredUntil].every(t => t === operations.provisions.setup.coverageUntilSeconds * 1000 || t === operations.clock.supportUntilSeconds * 1000), 'inventory');
  }
  requireBoundary(state.duty.entityId === operations.authority.duty && state.duty.keyId === scenario.ledger.key.id && state.duty.keyHolder === operations.authority.duty, 'custody');
  requireBoundary(state.custody.length === 1, 'custody');
  for (const custody of state.custody) {
    requireBoundary(custody.assetId === scenario.ledger.id && custody.owner === scenario.ledger.owner && [operations.authority.duty, operations.authority.designator, ...operations.authority.mandates.filter(m => m.id === 'S01-L').map(m => m.recipient)].includes(custody.custodian), 'custody');
    assertLocation(custody.location, content);
    const nodes = physicalNodes(custody.location);
    requireBoundary(nodes.length > 0 && nodes.every(n => scenario.ledger.route.orderedNodes.includes(n)), 'custody');
    switch (custody.returnState) {
      case 'stored': case 'restocked': case 'resealed':
        requireBoundary(custody.custodian === operations.authority.duty && nodes.length === 1 && nodes[0] === scenario.ledger.container && !custody.unresolvedReturn, 'custody');
        requireBoundary(custody.seal === (custody.returnState === 'restocked' ? 'opened' : 'sealed'), 'custody'); break;
      case 'return-required': case 'handover-received': {
        const holder = state.bodies.find(b => b.entityId === custody.custodian);
        requireBoundary(holder !== undefined && summaryHash(holder.location) === summaryHash(custody.location) && custody.seal === 'opened', 'custody');
        if (custody.returnState === 'handover-received') requireBoundary(custody.custodian === operations.authority.duty, 'custody');
        break;
      }
      default: assertNever(custody.returnState);
    }
  }
  requireBoundary(state.inventories.length === operations.provisions.prepayments.length, 'inventory');
  for (const inventory of state.inventories) {
    const source = operations.provisions.prepayments.find(p => p.id === inventory.prepaymentId && p.recipient === inventory.entityId);
    requireBoundary(source !== undefined && inventory.foodPacks + inventory.consumedFoodPacks === source.preservedFoodPacks && inventory.waterMl + inventory.consumedWaterMl === source.waterMl && inventory.emergencyReservedPacks <= source.emergencyReservedPacks && inventory.emergencyReservedPacks <= inventory.foodPacks, 'inventory');
    const paper = operations.provisions.paper.find(p => p.recipient === inventory.entityId)?.sheets ?? 0;
    requireBoundary(inventory.paperSheets + inventory.consumedPaperSheets === paper, 'inventory');
  }
  requireBoundary(state.tools.length === scenario.availability.tools.length, 'cross-link');
  for (const tool of state.tools) {
    const source = scenario.availability.tools.find(t => t.id === tool.id);
    requireBoundary(source !== undefined && source.owner === tool.owner && physicalNodes(tool.location).length === 1 && physicalNodes(tool.location)[0] === source.at, 'cross-link');
    assertLocation(tool.location, content);
  }
}
