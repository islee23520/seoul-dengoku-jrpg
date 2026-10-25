import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import { CampaignBoundaryError, requireBoundary } from './errors.ts';
import { assertComposedAuthority } from './authorityBasis.ts';
import { assertPhysicalEffect } from './physicalEffects.ts';
import type { CampaignState } from './stateSchemas.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { s01Steps } from './s01Steps.ts';

export function assertEffectAuthority(state: CampaignState, order: CampaignState['mandates'][number], effect: { readonly at: number; readonly content: CampaignContent }): void {
  try { assertComposedAuthority(state, order, effect); }
  catch (error) {
    if (error instanceof CampaignBoundaryError) throw new CampaignBoundaryError('effect-authority');
    throw error;
  }
}

export function assertResultEffects(state: CampaignState, content: CampaignContent): void {
  for (const result of state.results) {
    const order = state.mandates.find(m => m.orderId === result.orderId);
    requireBoundary(order !== undefined && order.acceptedAt !== null && result.at >= order.acceptedAt, 'cross-link');
    requireBoundary(order.origin !== 'command-ingress' || result.causeId === order.causeId || result.kind === 'safe-return', 'cross-link');
    requireBoundary(result.kind === 'work' || result.workEvidence === null, 'cross-link');
    if (result.kind === 'work') {
      requireBoundary(state.results.filter(r => r.orderId === order.orderId && r.kind === 'work').length === 1, 'duplicate-id');
      if (order.origin === 'command-ingress') {
        const track = state.s01.tracks.find(t => t.orderId === order.orderId && t.lane === 'investigation');
        requireBoundary(track !== undefined && result.id === order.orderId + ':work-completion' && result.workEvidence !== null, 'cross-link');
        const steps = s01Steps(track, state, content);
        const observations = state.s01.activities.filter(a => a.trackId === track.id && ['compare', 'observe'].includes(steps[a.step]!.kind));
        const expected = order.operation === 'S01-L' ? content.data.operations.evidence.ledgerRows.length : content.data.operations.evidence.observations.length;
        requireBoundary(observations.length === expected && observations.at(-1)?.completedAt === result.at && result.workEvidence.length === expected &&
          result.workEvidence.every((f, i) => f.id === observations[i]?.id.replace(/:activity$/, ':fact') && f.orderId === order.orderId &&
            f.causeId === order.causeId && f.sourcePersonId === order.recipientId && f.observedAt === observations[i]?.completedAt &&
            state.reports.some(r => r.fact.id === f.id && summaryHash(r.fact) === summaryHash(f))) &&
          result.payloadHash === summaryHash(result.workEvidence), 'cross-link');
      }
    }
    switch (result.kind) {
      case 'work': case 'custody':
        requireBoundary(result.safeReturn === null, 'cross-link');
        assertEffectAuthority(state, order, { at: result.at, content });
        if (result.kind === 'custody') assertPhysicalEffect(state, result, content);
        break;
      case 'report':
        requireBoundary(result.safeReturn === null && state.reports.some(r => r.fact.orderId === order.orderId && r.receivedAt === result.at), 'report-link');
        if (order.origin === 'command-ingress') {
          const reports = state.reports.filter(r => r.fact.orderId === order.orderId);
          requireBoundary(reports.every(r => r.receivedAt === result.at) && result.payloadHash === summaryHash(reports), 'report-link');
        }
        break;
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
