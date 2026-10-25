import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0, rejects } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { acceptedOrder, changedGrant, readyState } from './authorityFixtures.ts';
import { parseCampaignState } from './state.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { CampaignContent } from './content.ts';
import { packages } from './testFixtures.ts';
import { assertComposedAuthority } from './authorityBasis.ts';

const request = { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: 0 };

test('the two real communal grants compose without forging a personal issuer', () => {
  // Given the admitted production pack, not a relabelled single grant.
  // When the lord designates the named retainer.
  const basis = composeCampaignAuthority(e0, request, content);
  // Then both original issuers and their distinct recipients survive the adapter.
  assert.deepEqual(basis.grants.map(g => [g.id, g.issuer, g.recipient]), [
    ['grant:townhall-s01-reception-r1', 's01:townhall:ration-community', 'K002'],
    ['grant:townhall-s01-archive-r1', 's01:townhall:ration-community', 'K568'],
  ]);
  assert.equal(basis.subdelegation, false);
  assert.equal(basis.original.owner, content.data.scenario.ledger.owner);
  assert.equal(basis.original.keyTransfer, false);
});

test('the named observation recipient receives only its own actual grant pair', () => {
  // Given a second named operation.
  const input = { ...request, operation: 'S01-O', recipientId: 'K616' };
  // When its authority is composed.
  const basis = composeCampaignAuthority(e0, input, content);
  // Then its access grant differs while communal designation is shared.
  assert.deepEqual(basis.authority.map(g => g.grantId), ['grant:townhall-s01-reception-r1', 'grant:townhall-s01-inspect-r1']);
});

for (const [label, input, code] of [
  ['forged issuer', { ...request, issuerPersonId: 'K001' }, 'authority-source'],
  ['extra recipient', { ...request, recipientId: 'K616' }, 'authority-source'],
  ['retired recipient', { ...request, recipientId: 'K100' }, 'authority-source'],
  ['stale composite', { ...request, expectedCompositeVersion: '0'.repeat(64) }, 'grant-version'],
  ['stale state', { ...request, expectedRevision: 1 }, 'stale-version'],
  ['expanded scope', { ...request, scope: ['open-valve'] }, 'shape'],
  ['subdelegation', { ...request, subdelegation: true }, 'shape'],
  ['title only', { ...request, titleOrOfficeOrCommandBasis: { kind: 'title', id: 'holding:yangcheon' } }, 'shape'],
  ['inherited options', Object.create(request), 'inherited-option'],
] as const) test('composition rejects ' + label, () => {
  // Given the unchanged admitted E0 state.
  const before = summaryHash(e0);
  // When / Then the attempted authority expansion fails without mutation.
  rejects(() => composeCampaignAuthority(e0, input, content), code);
  assert.equal(summaryHash(e0), before);
});

for (const omitted of ['grant:townhall-s01-reception-r1', 'grant:townhall-s01-archive-r1']) test('a single remaining grant cannot replace ' + omitted, () => {
  // Given only one side of the authority relationship.
  const state = { ...e0, grants: e0.grants.filter(g => g.id !== omitted) };
  // When / Then no composite can be issued.
  rejects(() => composeCampaignAuthority(state, request, content), 'authority-source');
});

test('changing the source issuer or scope cannot reuse admitted content', () => {
  // Given tampered bytes, not an approval flag.
  const scenario = packages.scenario.replace('"named-two-only"', '"unlimited"');
  // When / Then admission fails before any adapter proof exists.
  rejects(() => CampaignContent.parse({ ...packages, scenario }), 'content-hash');
});

test('a forged communal revision issuer is rejected even with otherwise valid grant references', () => {
  // Given a serialized grant history relabelled as the lord's own grant.
  const state = { ...e0, grants: e0.grants.map(g => ({ ...g, revisions: g.revisions.map(r => ({ ...r, issuer: 'K002' })) })) };
  // When / Then original communal provenance cannot be replaced.
  rejects(() => composeCampaignAuthority(state, request, content), 'authority-source');
});

test('simultaneous conflicting terminal grant revisions cannot be arbitrarily selected', () => {
  // Given two incompatible terminal revisions of the same source grant.
  const revoked = changedGrant(readyState(), 'revoked'), expired = changedGrant(readyState(), 'expired');
  const state = { ...revoked, grants: revoked.grants.map(g => ({ ...g,
    revisions: [...g.revisions, ...expired.grants.filter(other => other.id === g.id).flatMap(other => other.revisions.slice(1))] })) };
  // When / Then the boundary refuses the fork rather than selecting a winner.
  rejects(() => composeCampaignAuthority(state, request, content), 'grant-version');
});

for (const status of ['revoked', 'expired'] as const) test('new composition rejects a currently ' + status + ' grant', () => {
  // Given an authentic communal revision after the original issue.
  const state = changedGrant(readyState(), status);
  // When / Then no new instruction is authorized.
  rejects(() => composeCampaignAuthority(state, request, content), status === 'expired' ? 'authority-expired' : 'authority-revoked');
});

test('scheduled expiry rejects at the exact close boundary', () => {
  // Given the original grants at Eclose.
  const state = parseCampaignState({ ...e0, clock: { ...e0.clock, worldMilliseconds: 3600000 } }, content);
  // When / Then no new instruction uses yesterday\'s opening validity.
  rejects(() => composeCampaignAuthority(state, request, content), 'authority-expired');
});

test('effect authority rejects an altered pair even with a recomputed composite digest', () => {
  // Given a K568 order whose access grant was replaced by the other recipient grant.
  const state = readyState(), order = acceptedOrder('S01-L'), other = acceptedOrder('S01-O');
  const changed = { ...order, authority: other.authority, compositeVersion: summaryHash({ operation: order.operation, authority: other.authority }) };
  // When / Then the current effect check compares the actual named grant identities.
  rejects(() => assertComposedAuthority(state, changed, { content, at: state.clock.worldMilliseconds }), 'grant-version');
});

for (const recipientId of ['K002', 'K616'] as const) test('effect authority rejects a forged recipient ' + recipientId, () => {
  // Given a forged serialized order with no matching access basis.
  const state = readyState();
  // When / Then the trusted checkpoint boundary rejects it.
  rejects(() => parseCampaignState({ ...state, mandates: state.mandates.map(m => ({ ...m, recipientId })) }, content), 'authority-source');
});
