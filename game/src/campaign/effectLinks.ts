import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { assertLocation, physicalNodes } from './locations.ts';
import type { CampaignState } from './stateSchemas.ts';

export function assertEffectAuthority(state: CampaignState, order: CampaignState['mandates'][number], effect: { readonly at: number; readonly content: CampaignContent }): void {
  const close = Math.min(state.clock.closedAt ?? Infinity, effect.content.data.operations.clock.scheduledCloseSeconds * 1000);
  requireBoundary(effect.at < close && order.authority.every(basis => {
    const revision = state.grants.find(g => g.id === basis.grantId)?.revisions.filter(r => r.effectiveAt <= effect.at).at(-1);
    return revision?.state === 'valid' && revision.version === basis.version;
  }), 'effect-authority');
}

export function assertResultEffects(state: CampaignState, content: CampaignContent): void {
  const { operations: o, scenario: s } = content.data;
  for (const result of state.results) {
    const order = state.mandates.find(m => m.orderId === result.orderId);
    requireBoundary(order !== undefined && order.acceptedAt !== null && result.at >= order.acceptedAt, 'cross-link');
    switch (result.kind) {
      case 'work': case 'custody':
        requireBoundary(result.safeReturn === null, 'cross-link');
        assertEffectAuthority(state, order, { at: result.at, content }); break;
      case 'report':
        requireBoundary(result.safeReturn === null && state.reports.some(r => r.fact.orderId === order.orderId && r.receivedAt === result.at), 'report-link'); break;
      case 'safe-return': {
        const duty = result.safeReturn;
        requireBoundary(duty !== null && order.operation === 'S01-L' && duty.assetId === s.ledger.id && order.returnAcceptedAt !== null && order.returnAcceptedAt <= result.at, 'custody');
        const previous = state.results.find(r => r.id === duty.priorCustodyResultId);
        requireBoundary(previous !== undefined && previous.orderId === order.orderId && previous.at < result.at && (previous.kind === 'custody' || previous.kind === 'safe-return'), 'custody');
        const body = state.bodies.find(b => b.entityId === duty.custodian);
        requireBoundary(body !== undefined && result.at <= body.foodCoveredUntil && result.at <= body.waterCoveredUntil && result.at < o.clock.supportUntilSeconds * 1000 && body.regions.every(r => r.effortMilliseconds < o.body.restRequiredAtEffortSeconds * 1000), 'inventory');
        assertLocation(duty.location, content);
        const nodes = physicalNodes(duty.location);
        switch (duty.action) {
          case 'protect': case 'carry-to-threshold':
            requireBoundary([order.recipientId, o.authority.duty].includes(duty.custodian) && nodes.length > 0 && nodes.every(n => s.ledger.route.orderedNodes.includes(n)), 'custody'); break;
          case 'handover':
            requireBoundary(duty.custodian === o.authority.duty && nodes.length === 1 && nodes[0] === 's01:townhall:threshold', 'custody'); break;
          case 'restock': case 'reseal':
            requireBoundary(duty.custodian === o.authority.duty && nodes.length === 1 && nodes[0] === s.ledger.container, 'custody'); break;
          default: assertNever(duty.action);
        }
        break;
      }
      default: assertNever(result.kind);
    }
  }
}

export function assertConsumption(state: CampaignState, content: CampaignContent): void {
  const { provisions: p, durations: d } = content.data.operations;
  requireBoundary(new Set(state.consumption.map(r => r.id)).size === state.consumption.length && new Set(state.consumption.map(r => r.entityId + ':' + r.kind)).size === state.consumption.length, 'duplicate-id');
  for (const receipt of state.consumption) {
    requireBoundary(state.bodies.some(b => b.entityId === receipt.entityId) && receipt.completedAt <= state.clock.worldMilliseconds, 'inventory');
    const duration = receipt.kind === 'food' ? d.eat : d.drink;
    requireBoundary(receipt.completedAt - receipt.startedAt === duration * 1000 && receipt.completedAt <= p.consumption.windowEndSeconds * 1000, 'inventory');
    requireBoundary(!state.consumption.some(other => other.id !== receipt.id && other.entityId === receipt.entityId && other.startedAt < receipt.completedAt && receipt.startedAt < other.completedAt), 'inventory');
  }
  for (const body of state.bodies) {
    const inventory = state.inventories.find(i => i.entityId === body.entityId);
    requireBoundary(inventory !== undefined, 'inventory');
    const food = state.consumption.some(r => r.entityId === body.entityId && r.kind === 'food');
    const water = state.consumption.some(r => r.entityId === body.entityId && r.kind === 'water');
    requireBoundary(inventory.consumedFoodPacks === (food ? p.consumption.foodPacks : 0) && inventory.emergencyReservedPacks === (food ? 0 : 1) && body.foodCoveredUntil === (food ? p.consumption.extendsToSeconds : p.setup.coverageUntilSeconds) * 1000, 'inventory');
    requireBoundary(inventory.consumedWaterMl === (water ? p.consumption.waterMl : 0) && body.waterCoveredUntil === (water ? p.consumption.extendsToSeconds : p.setup.coverageUntilSeconds) * 1000, 'inventory');
  }
}
