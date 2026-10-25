import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0 } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { submitCampaignCommand, advanceCampaignCommands } from './application.ts';
import { revokeS01ForwardRoute } from './s01Effects.ts';
import { parseCampaignState } from './state.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './stateSchemas.ts';
import { readFile } from 'node:fs/promises';

const basis = composeCampaignAuthority(e0, { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: 0 }, content);
const issued = submitCampaignCommand(e0, { kind: 'issue', commandId: 'S01-L', operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: 0, expectedCompositeVersion: basis.compositeVersion }, content).state;
const advance = (state: CampaignState, at: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', at), content, true);
const before = advance(issued, 780000);
const request = (state: CampaignState) => ({ id: 'repair-cut', orderId: 'S01-L', issuer: content.data.operations.authority.issuer,
  grantId: content.data.operations.authority.mandates[0]!.grants[1], expectedRevision: state.revision, backwardRouteSafe: true, returnConsent: true });
const allowed = revokeS01ForwardRoute(before, request(before), content);
const clone = (state: CampaignState): CampaignState => JSON.parse(JSON.stringify(state));

test('F1 restore rejects injected allowed track after denied consent or safety', () => {
  for (const change of [{ returnConsent: false }, { backwardRouteSafe: false }]) {
    const denied = revokeS01ForwardRoute(before, { ...request(before), ...change }, content);
    const forged = { ...clone(denied), s01: { ...denied.s01, tracks: [...denied.s01.tracks.filter(t => t.lane !== 'cut-return'), allowed.s01.tracks.find(t => t.lane === 'cut-return')!] } };
    assert.throws(() => parseCampaignState(forged, content));
    assert.throws(() => parseCampaignState({ ...forged, s01: { ...forged.s01, incidents: allowed.s01.incidents } }, content));
  }
});
test('F2 restore rejects shortened retreat distance and retains full travel time', () => {
  const forged = { ...allowed, s01: { ...allowed.s01, tracks: allowed.s01.tracks.map(t => t.lane === 'cut-return' ? { ...t, retreatMillimetres: 1 } : t) } };
  assert.throws(() => parseCampaignState(forged, content));
  assert.equal(advance(allowed, 815999).custody[0]?.location.kind, 'edge-progress');
  assert.equal(advance(allowed, 816000).custody[0]?.location.kind, 'node');
});
test('F3 one millisecond carrying cut preserves half millimetre and its event links', () => {
  const fractional = advance(issued, 774001);
  assert.equal(fractional.custody[0]?.location.kind === 'edge-progress' && fractional.custody[0].location.travelledMillimetres, 0.5);
  const cut = revokeS01ForwardRoute(fractional, request(fractional), content);
  const notice = advance(parseCampaignState(clone(cut), content), 804001);
  assert.equal(notice.notices[0]?.receivedAt, 804001);
  assert.equal(notice.custody[0]?.location.kind, 'edge-progress');
  assert.equal(advance(notice, 804002).custody[0]?.location.kind, 'node');
});
test('F4 notice completes independently when either backward travel condition is denied', () => {
  for (const change of [{ returnConsent: false }, { backwardRouteSafe: false }]) {
    const denied = revokeS01ForwardRoute(before, { ...request(before), ...change }, content);
    const final = advance(denied, 840000);
    assert.equal(final.notices[0]?.receivedAt, 810000);
    assert.deepEqual(final.custody[0]?.location, before.custody[0]?.location);
  }
});
test('F5 baseline presentation binds its provisional marker to numeric fixture values', async () => {
  const fixture: unknown = JSON.parse(await readFile(new URL('../../data/scenarios/townhall-s01-r2/derived-timeline.json', import.meta.url), 'utf8'));
  assert.ok(typeof fixture === 'object' && fixture !== null);
  for (const key of ['dutyDesk', 'cisternObserved', 'tapObserved', 'reportReceived', 'realLedgerAt1x']) {
    const value: { provisional: boolean; decision: string; seconds: number } = Reflect.get(fixture, key);
    assert.equal(value.provisional, true);
    assert.equal(value.decision, 'section2-route-r2-pending-ratification');
    assert.equal(typeof value.seconds, 'number');
  }
});
