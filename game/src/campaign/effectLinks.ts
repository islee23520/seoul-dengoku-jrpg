import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { assertPhysicalEffect } from './physicalEffects.ts';
import type { CampaignState } from './stateSchemas.ts';

export function assertEffectAuthority(state: CampaignState, order: CampaignState['mandates'][number], effect: { readonly at: number; readonly content: CampaignContent }): void {
  const close = Math.min(state.clock.closedAt ?? Infinity, effect.content.data.operations.clock.scheduledCloseSeconds * 1000);
  requireBoundary(effect.at < close && order.authority.every(basis => {
    const revision = state.grants.find(g => g.id === basis.grantId)?.revisions.filter(r => r.effectiveAt <= effect.at).at(-1);
    return revision?.state === 'valid' && revision.version === basis.version;
  }), 'effect-authority');
}

export function assertResultEffects(state: CampaignState, content: CampaignContent): void {
  for (const result of state.results) {
    const order = state.mandates.find(m => m.orderId === result.orderId);
    requireBoundary(order !== undefined && order.acceptedAt !== null && result.at >= order.acceptedAt, 'cross-link');
    switch (result.kind) {
      case 'work': case 'custody':
        requireBoundary(result.safeReturn === null, 'cross-link');
        assertEffectAuthority(state, order, { at: result.at, content });
        if (result.kind === 'custody') assertPhysicalEffect(state, result, content);
        break;
      case 'report':
        requireBoundary(result.safeReturn === null && state.reports.some(r => r.fact.orderId === order.orderId && r.receivedAt === result.at), 'report-link'); break;
      case 'safe-return': assertPhysicalEffect(state, result, content); break;
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
    requireBoundary(!state.reservations.some(r => r.resource.kind === 'body' && r.resource.entityId === receipt.entityId && r.from < receipt.completedAt && receipt.startedAt < r.until && !(r.consumptionId === receipt.id && r.from === receipt.startedAt && r.until === receipt.completedAt)), 'inventory');
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
