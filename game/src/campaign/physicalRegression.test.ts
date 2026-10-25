import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0, rejects } from './testFixtures.ts';
import { safeReturnState, ledgerOrder } from './guardFixtures.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { summaryHash } from '../domain/eventLedger.ts';

export function handover() {
  const location = nodeLocation('s01:townhall:threshold', content);
  return { ...safeReturnState, clock: { ...safeReturnState.clock, worldMilliseconds: 1450000 },
    bodies: safeReturnState.bodies.map(b => b.entityId === content.data.operations.authority.duty ? { ...b, location } : b),
    custody: safeReturnState.custody.map(c => ({ ...c, location, custodian: content.data.operations.authority.duty, returnState: 'handover-received', seal: 'opened', causeId: 'return' })) };
}
test('R1 rejects same-instant handover while the original remains sealed at E0', () => {
  // Given a claimed completed handover but unchanged original physical state.
  const candidate = { ...handover(), custody: e0.custody };
  // When restoring. Then the claimed physical outcome must reject.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('R1 rejects same-instant handover while duty is unavailable', () => {
  // Given a claimed completed handover with unavailable actual duty.
  const candidate = { ...handover(), duty: { ...e0.duty, available: false } };
  // When restoring. Then a literal true claim cannot override physical state.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('R2 preserves a lawful handover when duty fatigue rises later', () => {
  // Given a coherent completed handover followed by later leg fatigue.
  const prior = parseCampaignState(handover(), content);
  const candidate = { ...prior, clock: { ...prior.clock, worldMilliseconds: 3000000 }, bodies: prior.bodies.map(b => b.entityId === content.data.operations.authority.duty
    ? { ...b, regions: b.regions.map(r => r.region === 'left-leg' ? { ...r, effortMilliseconds: 1800000 } : r) } : b) };
  // When restoring. Then later fatigue cannot erase historical lawful work.
  assert.doesNotThrow(() => parseCampaignState(candidate, content));
});
test('R3 permits K002 protection without K568 return consent', () => {
  // Given the opened original retained by K002, not transported or handed over.
  const location = nodeLocation('s01:townhall:desk', content);
  const pickup = safeReturnState.results[0]; assert.ok(pickup?.physical);
  const held = { ...pickup.physical.after, custodian: 'K002', location, causeId: 'delivered' };
  const delivery = { previousResultId: pickup.id, before: { ...pickup.physical.after, location }, after: held, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === 'K002' || b.entityId === 'K568').map(b => ({ ...b, location })) };
  const physical = { previousResultId: 'delivered', before: held, after: { ...held, causeId: 'return', unresolvedReturn: true }, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === 'K002') };
  const candidate = { ...handover(), mandates: safeReturnState.mandates.map(m => ({ ...m, returnAcceptedAt: null })),
    custody: [physical.after], appliedResultIds: ['pickup', 'delivered', 'return'],
    results: [pickup, { ...pickup, id: 'delivered', causeId: 'delivered', at: 1360000, physical: delivery, payloadHash: summaryHash(delivery) },
      ...safeReturnState.results.filter(r => r.kind === 'safe-return').map(r => ({ ...r, physical, payloadHash: summaryHash(physical), safeReturn: { ...r.safeReturn, action: 'protect', custodian: 'K002', location, priorCustodyResultId: 'delivered' } }))] };
  // When restoring. Then passive protection needs no invented transport consent.
  assert.doesNotThrow(() => parseCampaignState(candidate, content));
});
test('R4 rejects a completed meal overlapping reserved physical work', () => {
  // Given a 60-second meal overlapping the same body's work interval.
  const candidate = { ...ledgerOrder, bodies: ledgerOrder.bodies.map(b => b.entityId === 'K568' ? { ...b, foodCoveredUntil: 5400000 } : b),
    inventories: ledgerOrder.inventories.map(i => i.entityId === 'K568' ? { ...i, foodPacks: 1, consumedFoodPacks: 1, emergencyReservedPacks: 0 } : i),
    mandates: ledgerOrder.mandates.map(m => ({ ...m, reservationIds: ['work-reservation'] })),
    reservations: [{ id: 'work-reservation', orderId: 'order:observation', resource: { kind: 'body', entityId: 'K568' }, from: 1200000, until: 1300000 }],
    consumption: [{ id: 'meal', entityId: 'K568', kind: 'food', startedAt: 1200000, completedAt: 1260000, causeId: 'meal' }] };
  // When restoring. Then the single-body activity rule rejects the overlap.
  rejects(() => parseCampaignState(candidate, content), 'inventory');
});

test('R2 handover checks head and arms rather than an unrelated fatigued leg', () => {
  // Given historical handover participants with rested action-required regions.
  const candidate = handover();
  const bodies = candidate.bodies.map(b => b.entityId === content.data.operations.authority.duty ? { ...b, regions: b.regions.map(r => r.region === 'left-leg' ? { ...r, effortMilliseconds: 1800000 } : r) } : b);
  const results = candidate.results.map(r => {
    if (r.kind !== 'safe-return' || r.physical === null) return r;
    const physical = { ...r.physical, bodies: r.physical.bodies.map(b => bodies.find(current => current.entityId === b.entityId) ?? b) };
    return { ...r, physical, payloadHash: summaryHash(physical) };
  });
  // When restored. Then a leg does not prohibit stationary handover.
  assert.doesNotThrow(() => parseCampaignState({ ...candidate, bodies, results }, content));
});
test('R3 duty restocks its held original without K568 transport consent', () => {
  // Given duty already accepted the original, followed by its own restocking.
  const prior = safeReturnState.results[1]; assert.ok(prior?.physical);
  const location = nodeLocation('s01:townhall:locker', content);
  const physical = { previousResultId: prior.id, before: { ...prior.physical.after, location }, after: { ...prior.physical.after, location, causeId: 'restock', returnState: 'restocked' }, dutyAvailable: true,
    bodies: prior.physical.bodies.filter(b => b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location })) };
  const candidate = { ...safeReturnState, mandates: safeReturnState.mandates.map(m => ({ ...m, returnAcceptedAt: null })),
    custody: [physical.after], bodies: safeReturnState.bodies.map(b => physical.bodies.find(p => p.entityId === b.entityId) ?? b),
    appliedResultIds: [...safeReturnState.appliedResultIds, 'restock'], results: [...safeReturnState.results, { ...prior, id: 'restock', causeId: 'restock', at: 1500000,
      physical, payloadHash: summaryHash(physical), safeReturn: { ...prior.safeReturn, action: 'restock', location, priorCustodyResultId: prior.id } }] };
  // When restored. Then the appendix adds no K568 consent to duty's own restock.
  assert.doesNotThrow(() => parseCampaignState(candidate, content));
});

test('R4 permits the receipt own matching consumption reservation', () => {
  // Given a body reservation explicitly bound to the same meal and exact interval.
  const candidate = { ...ledgerOrder, bodies: ledgerOrder.bodies.map(b => b.entityId === 'K568' ? { ...b, foodCoveredUntil: 5400000 } : b),
    inventories: ledgerOrder.inventories.map(i => i.entityId === 'K568' ? { ...i, foodPacks: 1, consumedFoodPacks: 1, emergencyReservedPacks: 0 } : i),
    mandates: ledgerOrder.mandates.map(m => ({ ...m, reservationIds: ['meal-reservation'] })),
    reservations: [{ id: 'meal-reservation', orderId: 'order:observation', resource: { kind: 'body', entityId: 'K568' }, from: 1200000, until: 1260000, consumptionId: 'meal' }],
    consumption: [{ id: 'meal', entityId: 'K568', kind: 'food', startedAt: 1200000, completedAt: 1260000, causeId: 'meal' }] };
  // When restored. Then one activity is not mistaken for two activities.
  assert.doesNotThrow(() => parseCampaignState(candidate, content));
});
