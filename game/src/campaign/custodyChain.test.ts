import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0, rejects } from './testFixtures.ts';
import { safeReturnState } from './guardFixtures.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { assertPhysicalEffect } from './physicalEffects.ts';

const pickup = safeReturnState.results[0], handover = safeReturnState.results[1];
assert.ok(pickup?.physical && handover?.physical);
const picked = pickup.physical.after, handed = handover.physical.after;

test('rejects a chronological fork after K568 already delivered the original to K002', () => {
  // Given pickup -> delivery to K002, followed by a handover still consuming pickup.
  const location = nodeLocation('s01:townhall:desk', content);
  const physical = { previousResultId: pickup.id, before: { ...picked, location },
    after: { ...picked, location, custodian: 'K002', causeId: 'delivery' }, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === 'K002' || b.entityId === 'K568').map(b => ({ ...b, location })) };
  const delivery = { ...pickup, id: 'delivery', causeId: 'delivery', at: 1370000, physical, payloadHash: summaryHash(physical) };
  const candidate = { ...safeReturnState, results: [pickup, delivery, handover], appliedResultIds: [pickup.id, delivery.id, handover.id] };
  // When restoring the sorted history. Then K568 cannot transfer an item now held by K002.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});

test('rejects threshold handover while all witnesses and the original are mid-edge', () => {
  // Given consistent physical witnesses one metre beyond the threshold, not at its node.
  assert.ok(handover.physical);
  const location = { kind: 'edge-progress', siteId: content.data.operations.authority.siteId,
    from: 's01:townhall:threshold', to: 's01:townhall:archive', travelledMillimetres: 1000 };
  const physical = { ...handover.physical, before: { ...handover.physical.before, location }, after: { ...handed, location },
    bodies: handover.physical.bodies.map(b => ({ ...b, location })) };
  const result = { ...handover, physical, payloadHash: summaryHash(physical), safeReturn: { ...handover.safeReturn, location } };
  const candidate = { ...safeReturnState, clock: { ...safeReturnState.clock, worldMilliseconds: handover.at }, custody: [physical.after],
    bodies: safeReturnState.bodies.map(b => physical.bodies.find(p => p.entityId === b.entityId) ?? b), results: [pickup, result] };
  // When restoring. Then an edge endpoint cannot stand in for arrival at the threshold.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});

test('rejects reseal directly after threshold handover without a restocked event', () => {
  // Given a real handover predecessor, but no separate restocking result.
  const location = nodeLocation('s01:townhall:locker', content);
  const physical = { previousResultId: handover.id, before: { ...handed, location },
    after: { ...handed, location, causeId: 'reseal', returnState: 'resealed', seal: 'sealed' }, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location })) };
  const reseal = { ...handover, id: 'reseal', causeId: 'reseal', at: 1560000, physical, payloadHash: summaryHash(physical),
    safeReturn: { ...handover.safeReturn, action: 'reseal', location, priorCustodyResultId: handover.id } };
  const candidate = { ...safeReturnState, clock: { ...safeReturnState.clock, worldMilliseconds: reseal.at }, custody: [physical.after],
    bodies: safeReturnState.bodies.map(b => physical.bodies.find(p => p.entityId === b.entityId) ?? b),
    results: [pickup, handover, reseal], appliedResultIds: [pickup.id, handover.id, reseal.id] };
  // When restoring. Then distinct handover, restock and reseal cannot be collapsed.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});

test('preserves separate restock and reseal events in a valid current-holder chain', () => {
  // Given the handover followed by distinct locker restock and reseal receipts.
  const location = nodeLocation('s01:townhall:locker', content);
  const bodies = e0.bodies.filter(b => b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location }));
  const restockPhysical = { previousResultId: handover.id, before: { ...handed, location },
    after: { ...handed, location, causeId: 'restock', returnState: 'restocked' }, dutyAvailable: true, bodies };
  const restock = { ...handover, id: 'restock', causeId: 'restock', at: 1500000, physical: restockPhysical, payloadHash: summaryHash(restockPhysical),
    safeReturn: { ...handover.safeReturn, action: 'restock', location, priorCustodyResultId: handover.id } };
  const resealPhysical = { previousResultId: restock.id, before: restockPhysical.after,
    after: { ...restockPhysical.after, causeId: 'reseal', returnState: 'resealed', seal: 'sealed' }, dutyAvailable: true, bodies };
  const reseal = { ...restock, id: 'reseal', causeId: 'reseal', at: 1560000, physical: resealPhysical, payloadHash: summaryHash(resealPhysical),
    safeReturn: { ...restock.safeReturn, action: 'reseal', priorCustodyResultId: restock.id } };
  const candidate = { ...safeReturnState, custody: [resealPhysical.after],
    bodies: safeReturnState.bodies.map(b => bodies.find(p => p.entityId === b.entityId) ?? b),
    results: [pickup, handover, restock, reseal], appliedResultIds: [pickup.id, handover.id, restock.id, reseal.id] };
  // When restoring. Then all distinct events and the final seal survive.
  const restored = parseCampaignState(candidate, content);
  assert.deepEqual(restored.results.map(r => r.id), [pickup.id, handover.id, 'restock', 'reseal']);
  assert.equal(restored.custody[0]?.returnState, 'resealed');
});

test('rejects restocking at the threshold despite the correct handover predecessor', () => {
  // Given a correctly ordered restock that never reaches the original locker.
  const physical = { previousResultId: handover.id, before: handed,
    after: { ...handed, causeId: 'restock', returnState: 'restocked' }, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location: handed.location })) };
  const restock = { ...handover, id: 'restock', causeId: 'restock', at: 1500000, physical, payloadHash: summaryHash(physical),
    safeReturn: { ...handover.safeReturn, action: 'restock', priorCustodyResultId: handover.id } };
  // When checking the restored history before current-state validation can mask it.
  // Then correct event order alone does not make the threshold a storage locker.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [safeReturnState, restock, content]), 'custody');
});
