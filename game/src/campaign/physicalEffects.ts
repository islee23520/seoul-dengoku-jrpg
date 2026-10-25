import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { requireBoundary } from './errors.ts';
import { assertLocation, physicalNodes, nodeLocation } from './locations.ts';

export function assertPhysicalEffect(state: CampaignState, result: CampaignState['results'][number], content: CampaignContent): void {
  const { scenario: s, operations: o } = content.data;
  const history = result.physical;
  requireBoundary(history !== null && result.payloadHash === summaryHash(history), 'custody');
  const order = state.mandates.find(m => m.orderId === result.orderId);
  requireBoundary(order !== undefined && order.operation === 'S01-L', 'custody');
  const previous = state.results.find(r => r.id === history.previousResultId);
  const initial = { assetId: s.ledger.id, owner: s.ledger.owner, custodian: s.ledger.custodianAtE0, location: nodeLocation(s.ledger.container, content), causeId: 'S01:E0', seal: 'sealed', returnState: 'stored', unresolvedReturn: false };
  requireBoundary(history.previousResultId === null || (previous !== undefined && previous.at < result.at && previous.orderId === result.orderId && (previous.kind === 'custody' || previous.kind === 'safe-return') && previous.physical !== null), 'custody');
  const prior = previous?.physical?.after ?? initial;
  const { location: _priorLocation, ...priorIdentity } = prior;
  const { location: _beforeLocation, ...beforeIdentity } = history.before;
  requireBoundary(summaryHash(priorIdentity) === summaryHash(beforeIdentity), 'custody');
  for (const custody of [history.before, history.after]) {
    assertLocation(custody.location, content);
    requireBoundary(custody.assetId === s.ledger.id && custody.owner === s.ledger.owner && [o.authority.designator, order.recipientId, o.authority.duty].includes(custody.custodian) && physicalNodes(custody.location).length > 0 && physicalNodes(custody.location).every(n => s.ledger.route.orderedNodes.includes(n)), 'custody');
  }
  requireBoundary(history.after.causeId === result.causeId && new Set(history.bodies.map(b => b.entityId)).size === history.bodies.length, 'custody');
  const action = result.safeReturn?.action;
  if (history.before.custodian !== history.after.custodian) requireBoundary(summaryHash(history.before.location) === summaryHash(history.after.location), 'custody');
  if (result.kind === 'custody') {
    const from = history.before.custodian, to = history.after.custodian;
    const node = physicalNodes(history.after.location);
    requireBoundary(node.length === 1 && history.after.seal === 'opened' && history.after.returnState === 'return-required' &&
      ((from === o.authority.duty && to === order.recipientId && node[0] === s.ledger.container) ||
       (from === order.recipientId && to === o.authority.designator && node[0] === o.authority.actorPlacements[o.authority.designator]) ||
       (from === o.authority.designator && to === order.recipientId && node[0] === o.authority.actorPlacements[o.authority.designator])), 'custody');
  }
  if (result.kind === 'safe-return') {
    const safe = result.safeReturn;
    requireBoundary(safe !== null && previous !== undefined && prior.returnState !== 'stored' && prior.returnState !== 'resealed' && safe.priorCustodyResultId === history.previousResultId && safe.assetId === history.after.assetId && safe.custodian === history.after.custodian && summaryHash(safe.location) === summaryHash(history.after.location), 'custody');
    switch (safe.action) {
      case 'protect':
        requireBoundary(history.before.custodian === history.after.custodian && summaryHash(history.before.location) === summaryHash(history.after.location) && history.before.seal === history.after.seal && history.before.returnState === history.after.returnState, 'custody'); break;
      case 'carry-to-threshold':
        requireBoundary(history.after.custodian === order.recipientId && history.after.seal === 'opened' && history.after.returnState === 'return-required', 'custody'); break;
      case 'handover':
        requireBoundary(history.before.custodian === order.recipientId && history.after.custodian === o.authority.duty && physicalNodes(history.after.location)[0] === 's01:townhall:threshold' && history.after.returnState === 'handover-received' && history.after.seal === 'opened', 'custody'); break;
      case 'restock': case 'reseal':
        requireBoundary(history.before.custodian === o.authority.duty && history.after.custodian === o.authority.duty && physicalNodes(history.after.location)[0] === s.ledger.container && history.after.returnState === (safe.action === 'restock' ? 'restocked' : 'resealed') && history.after.seal === (safe.action === 'restock' ? 'opened' : 'sealed'), 'custody'); break;
      default: assertNever(safe.action);
    }
  }
  if (history.before.custodian === o.authority.designator && history.after.custodian !== o.authority.designator) {
    requireBoundary(history.after.custodian === order.recipientId && order.returnAcceptedAt !== null && order.returnAcceptedAt <= result.at, 'custody');
  }
  const participants = [...new Set([history.before.custodian, history.after.custodian])];
  for (const entity of participants) {
    const body = history.bodies.find(b => b.entityId === entity);
    requireBoundary(body !== undefined && summaryHash(body.location) === summaryHash(history.after.location), 'custody');
    requireBoundary(body.regions.length === o.body.regions.length && new Set(body.regions.map(r => r.region)).size === o.body.regions.length, 'inventory');
    if (action !== 'protect') {
      const required = action === 'carry-to-threshold' || action === 'restock' ? o.body.required.carrying : o.body.required.stationary;
      requireBoundary(result.at <= body.foodCoveredUntil && result.at <= body.waterCoveredUntil && result.at < o.clock.supportUntilSeconds * 1000 && required.every(region => body.regions.some(r => r.region === region && r.effortMilliseconds < o.body.restRequiredAtEffortSeconds * 1000)), 'inventory');
    }
  }
  if (participants.some(entity => entity === o.authority.duty) && action !== 'protect') requireBoundary(history.dutyAvailable, 'custody');
  const latest = state.results.filter(r => r.physical?.after.assetId === history.after.assetId).sort((a, b) => a.at - b.at).at(-1);
  if (latest?.id === result.id) {
    const { location: _currentLocation, ...currentIdentity } = state.custody[0] ?? {};
    const { location: _afterLocation, ...afterIdentity } = history.after;
    requireBoundary(summaryHash(currentIdentity) === summaryHash(afterIdentity), 'custody');
  }
  if (result.at === state.clock.worldMilliseconds) {
    requireBoundary(summaryHash(state.custody[0] ?? null) === summaryHash(history.after), 'custody');
    requireBoundary(history.bodies.every(b => summaryHash(state.bodies.find(current => current.entityId === b.entityId) ?? null) === summaryHash(b)) && state.duty.available === history.dutyAvailable, 'custody');
  }
}
