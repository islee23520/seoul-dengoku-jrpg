import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryHash } from '../domain/eventLedger.ts';
import { integer } from '../domain/ids.ts';
import { content, rejects } from './testFixtures.ts';
import { acceptedOrder, changedGrant, checkRequest, readyState } from './authorityFixtures.ts';
import { checkCampaignReadiness } from './authorityReadiness.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { CampaignBoundaryError } from './errors.ts';

test('lawful readiness derives required original and duty resources from the actual pack', () => {
  // Given a separately accepted instruction and physically present duty.
  const state = readyState();
  // When archive confirmation is checked.
  const result = checkCampaignReadiness(state, checkRequest(state), content);
  // Then no new grant or world mutation is needed for the lawful resource set.
  assert.deepEqual(result.resources, [{ kind: 'body', entityId: 'K568' }, { kind: 'asset', assetId: 's01:townhall:ledger-original' }, { kind: 'body', entityId: 's01:townhall:night-record-duty' }]);
  assert.equal(result.conflictPolicy, 'reject-conflict');
  assert.deepEqual(state.reservations, []);
});

test('incompatible requests reject immediately while the existing reservation and independent job survive', () => {
  // Given an already reserved K568 request and one independent K616 walk.
  const winner = { ...acceptedOrder('S01-L', 'first'), stage: 'reserved', reservationIds: ['first-body'] } as const;
  const base = readyState();
  const state = parseCampaignState({ ...base, mandates: [acceptedOrder('S01-L', 'second'), winner, acceptedOrder('S01-O')],
    reservations: [{ id: 'first-body', orderId: 'first', resource: { kind: 'body', entityId: 'K568' }, from: 66000, until: 96000 }] }, content);
  const before = summaryHash(state), independent = state.mandates[2]; assert.ok(independent);
  // When the second request competes for the same body.
  rejects(() => checkCampaignReadiness(state, checkRequest(state), content), 'rejected-conflict');
  // Then no reservation is replaced and a compatible recipient can still advance.
  assert.equal(summaryHash(state), before);
  assert.equal(checkCampaignReadiness(state, { ...checkRequest(state), orderId: independent.orderId, expectedCompositeVersion: independent.compositeVersion,
    until: 78000, action: { kind: 'walk', to: 's01:townhall:entry' } }, content).resources.length, 1);
});

for (const [label, patch, code] of [
  ['unavailable duty', { duty: { ...readyState().duty, available: false } }, 'duty-unavailable'],
  ['fatigued body', { bodies: readyState().bodies.map(b => b.entityId === 'K568' ? { ...b, regions: b.regions.map(r => ({ ...r, effortMilliseconds: 1800000 })) } : b) }, 'body-unavailable'],
  ['missing consent', { mandates: [{ ...acceptedOrder('S01-L'), acceptedAt: null, stage: 'received' }] }, 'consent-required'],
] as const) test('readiness rejects ' + label, () => {
  // Given an authentic checkpoint with the named unavailable prerequisite.
  const state = parseCampaignState({ ...readyState(), ...patch }, content);
  // When / Then no new physical/resource effect is permitted.
  rejects(() => checkCampaignReadiness(state, checkRequest(state), content), code);
});

test('a tired participant needs the approved slower duration', () => {
  // Given tired arms, not a fabricated scalar health score.
  const base = readyState();
  const state = parseCampaignState({ ...base, bodies: base.bodies.map(b => b.entityId === 'K568' ? { ...b, regions: b.regions.map(r => ({ ...r, effortMilliseconds: 1200000 })) } : b) }, content);
  // When / Then the normal 30 second confirmation cannot be committed at full speed.
  rejects(() => checkCampaignReadiness(state, checkRequest(state), content), 'action-scope');
});

test('current revocation blocks effects even before subjective notice arrives', () => {
  // Given an accepted order revoked without any notice receipt.
  const state = changedGrant(readyState(), 'revoked');
  // When / Then a new effect cannot reuse the issue-time composite.
  rejects(() => checkCampaignReadiness(state, checkRequest(state), content), 'authority-revoked');
});

test('recipient access is rechecked for each proposed destination', () => {
  // Given the observation recipient at the reception desk.
  const state = readyState([acceptedOrder('S01-O')]);
  // When / Then its valid observation grant does not authorize archive access.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), action: { kind: 'walk', to: 's01:townhall:threshold' } }, content), 'location-scope');
});

test('a stale expected composite cannot reserve physical resources', () => {
  // Given current authority and a stale client review.
  const state = readyState();
  // When / Then the expected proof fails before any resource plan is returned.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), expectedCompositeVersion: 'f'.repeat(64) }, content), 'grant-version');
});

test('inherited action names do not select an authorized operation', () => {
  // Given inherited rather than own action input.
  const state = readyState();
  // When / Then it is rejected at the boundary.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), action: Object.create({ kind: 'archive-check' }) }, content), 'inherited-option');
});

test('unavailable tools produce only a lawful reason, never hidden world payloads', () => {
  // Given the real observation recipient at the instrument and an unavailable gauge.
  const base = readyState([acceptedOrder('S01-O')]);
  const state = parseCampaignState({ ...base, bodies: base.bodies.map(b => b.entityId === 'K616' ? { ...b, location: nodeLocation('s01:townhall:tap', content) } : b),
    tools: base.tools.map(t => ({ ...t, available: false })) }, content);
  // When / Then the UI receives a reason code, not unseen facts or reservation identities.
  assert.throws(() => checkCampaignReadiness(state, { ...checkRequest(state), until: 186000, action: { kind: 'observe-tap' } }, content),
    (error: unknown) => error instanceof CampaignBoundaryError && error.code === 'tool-unavailable' && Object.keys(error).every(k => ['code', 'name'].includes(k)));
});

test('the actual observation scope can read its fixed instrument with finite support', () => {
  // Given K616 physically present at the approved tap.
  const base = readyState([acceptedOrder('S01-O')]);
  const state = parseCampaignState({ ...base, bodies: base.bodies.map(b => b.entityId === 'K616' ? { ...b, location: nodeLocation('s01:townhall:tap', content) } : b) }, content);
  // When the real 120 second observation is checked.
  const result = checkCampaignReadiness(state, { ...checkRequest(state), until: 186000, action: { kind: 'observe-tap' } }, content);
  // Then only the named reader, gauge and already supplied light are required.
  assert.deepEqual(result.resources, [{ kind: 'body', entityId: 'K616' }, { kind: 'asset', assetId: 's01:townhall:pressure-gauge' }, { kind: 'asset', assetId: 's01:townhall:yard-lights' }]);
});

test('a valid instruction cannot carry an original the recipient does not hold', () => {
  // Given the original still belongs to the community in duty custody.
  const state = readyState();
  // When / Then authorization alone cannot invent pickup or physical possession.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), action: { kind: 'carry-original', to: 's01:townhall:threshold' } }, content), 'custody');
});

test('leaving the archive does not waive the actual duty escort', () => {
  // Given K568 in the archive while duty remains at the desk.
  const base = readyState();
  const state = parseCampaignState({ ...base, bodies: base.bodies.map(b => b.entityId === 'K568' ? { ...b, location: nodeLocation('s01:townhall:archive', content) } : b) }, content);
  // When / Then the return direction still requires the communal escort.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), action: { kind: 'walk', to: 's01:townhall:threshold' } }, content), 'duty-unavailable');
});

test('the exact reservation endpoint is compatible rather than overlapping', () => {
  // Given an existing half-open reservation ending at this boundary.
  const winner = { ...acceptedOrder('S01-L', 'first'), reservationIds: ['first-body'] };
  const base = readyState();
  const state = parseCampaignState({ ...base, mandates: [acceptedOrder('S01-L', 'second'), winner],
    reservations: [{ id: 'first-body', orderId: 'first', resource: { kind: 'body', entityId: 'K568' }, from: 60000, until: 66000 }] }, content);
  // When the next reservation starts exactly after the old one ends.
  const result = checkCampaignReadiness(state, checkRequest(state), content);
  // Then it succeeds without a fabricated overlap or wait.
  assert.equal(result.from, integer('WorldMilliseconds', 66000));
});
