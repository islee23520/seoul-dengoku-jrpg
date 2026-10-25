import assert from 'node:assert/strict';
import { summaryHash } from '../domain/eventLedger.ts';
import { id, integer } from '../domain/ids.ts';
import { content, e0, reportedState } from './testFixtures.ts';
import { nodeLocation } from './locations.ts';
import { parseCampaignState } from './state.ts';
import type { CampaignState } from './state.ts';

/** Corrupt a serialized boundary, never an admitted live state. */
export function edit(input: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const copy: unknown = structuredClone(input);
  let cursor: unknown = copy;
  for (const key of path.slice(0, -1)) {
    assert.ok(typeof cursor === 'object' && cursor !== null);
    cursor = Reflect.get(cursor, key);
  }
  const last = path.at(-1);
  assert.ok(last !== undefined && typeof cursor === 'object' && cursor !== null);
  Reflect.set(cursor, last, value);
  return copy;
}
export function revoke(state: CampaignState, at: number): CampaignState['grants'] {
  return state.grants.map(g => {
    const event = { previousVersion: g.sourceVersion, state: 'revoked' as const, effectiveAt: integer('WorldMilliseconds', at), causeId: id('CauseId', 'revoke'), issuer: content.data.operations.authority.issuer };
    return { ...g, revisions: [...g.revisions, { ...event, version: summaryHash({ grantId: g.id, ...event }) }] };
  });
}
export const active = reportedState(false);
export const received = reportedState(true);
export const emptyOrder = parseCampaignState({ ...active, facts: [], reports: [] }, content);
export const reserved = parseCampaignState({ ...emptyOrder,
  mandates: emptyOrder.mandates.map(m => ({ ...m, reservationIds: ['reservation:1'], stage: 'reserved' })),
  reservations: [{ id: 'reservation:1', orderId: 'order:observation', resource: { kind: 'body', entityId: 'K616' }, from: 1152000, until: 1476000 }],
}, content);
export const revisionState = parseCampaignState({ ...emptyOrder, grants: revoke(emptyOrder, 1500000) }, content);
const revokedGrant = revisionState.grants[0];
assert.ok(revokedGrant);
const revision = revokedGrant.revisions[1];
assert.ok(revision);
export const noticeState = parseCampaignState({ ...revisionState, notices: [{ id: 'notice:1', grantId: revokedGrant.id, version: revision.version,
  recipient: 'K616', carrier: content.data.operations.authority.duty, legalEffectiveAt: 1500000, receivedAt: null }] }, content);
export const disputeState = parseCampaignState({ ...emptyOrder, disputes: [{ id: 'dispute:1', orderId: 'order:observation', openedAt: 1400000, reason: 'receipt-contested', resolvedAt: null }] }, content);
export const resultState = parseCampaignState({ ...emptyOrder, appliedResultIds: ['work:1'], results: [{ id: 'work:1', orderId: 'order:observation', causeId: 'work', at: 1464000, kind: 'work', payloadHash: '1'.repeat(64), safeReturn: null }] }, content);
export const foodState = parseCampaignState({ ...e0, clock: { ...e0.clock, worldMilliseconds: 60000 },
  bodies: e0.bodies.map(b => b.entityId === 'K002' ? { ...b, foodCoveredUntil: 5400000 } : b),
  inventories: e0.inventories.map(i => i.entityId === 'K002' ? { ...i, foodPacks: 1, consumedFoodPacks: 1, emergencyReservedPacks: 0 } : i),
  consumption: [{ id: 'eat:K002', entityId: 'K002', kind: 'food', startedAt: 0, completedAt: 60000, causeId: 'meal' }],
}, content);
const ledgerOperation = content.data.operations.authority.mandates.find(m => m.id === 'S01-L');
assert.ok(ledgerOperation);
const ledgerAuthority = ledgerOperation.grants.map(grantId => {
  const grant = e0.grants.find(g => g.id === grantId); assert.ok(grant);
  return { grantId, version: grant.sourceVersion };
});
export const ledgerOrder = parseCampaignState({ ...emptyOrder,
  mandates: emptyOrder.mandates.map(m => ({ ...m, operation: 'S01-L', recipientId: 'K568', authority: ledgerAuthority,
    compositeVersion: summaryHash({ operation: 'S01-L', authority: ledgerAuthority }),
    target: nodeLocation('s01:townhall:desk', content), route: ['s01:townhall:desk'], returnAcceptedAt: 1300000 })),
}, content);
const original = e0.custody[0]; assert.ok(original);
const locker = nodeLocation('s01:townhall:locker', content), threshold = nodeLocation('s01:townhall:threshold', content);
const picked = { ...original, custodian: id('PersonId', 'K568'), causeId: id('CauseId', 'pickup'), seal: 'opened' as const, returnState: 'return-required' as const };
const returned = { ...picked, custodian: id('DutyId', content.data.operations.authority.duty), location: threshold, causeId: id('CauseId', 'return'), returnState: 'handover-received' as const };
const pickupPhysical = { previousResultId: null, before: original, after: picked, dutyAvailable: true,
  bodies: e0.bodies.filter(b => b.entityId === 'K568' || b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location: locker })) };
const returnPhysical = { previousResultId: id('ResultId', 'pickup'), before: { ...picked, location: threshold }, after: returned, dutyAvailable: true,
  bodies: pickupPhysical.bodies.map(b => ({ ...b, location: threshold })) };
export const safeReturnState = parseCampaignState({ ...ledgerOrder, grants: revoke(ledgerOrder, 1400000), custody: [returned],
  bodies: ledgerOrder.bodies.map(b => returnPhysical.bodies.find(p => p.entityId === b.entityId) ?? b),
  appliedResultIds: ['pickup', 'return'], results: [
    { id: 'pickup', orderId: 'order:observation', causeId: 'pickup', at: 1350000, kind: 'custody', payloadHash: summaryHash(pickupPhysical), physical: pickupPhysical, safeReturn: null },
    { id: 'return', orderId: 'order:observation', causeId: 'return', at: 1450000, kind: 'safe-return', payloadHash: summaryHash(returnPhysical), physical: returnPhysical,
      safeReturn: { assetId: content.data.scenario.ledger.id, action: 'handover', custodian: content.data.operations.authority.duty,
        location: nodeLocation('s01:townhall:threshold', content), priorCustodyResultId: 'pickup', safeRoute: true, dutyAvailable: true } },
  ],
}, content);
