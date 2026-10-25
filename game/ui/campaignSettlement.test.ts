import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../src/campaign/content.ts';
import { createCampaignE0 } from '../src/campaign/state.ts';
import { CampaignApplication, advanceCampaignCommands } from '../src/campaign/application.ts';
import { composeCampaignAuthority } from '../src/campaign/authorityComposition.ts';
import { CampaignBoundaryError } from '../src/campaign/errors.ts';
import { integer } from '../src/domain/ids.ts';
import { buildSettlementView, describeReason, formatWorldSeconds, labelStage } from './campaignSettlementModel.ts';
import type { CampaignState } from '../src/campaign/stateSchemas.ts';

const data = new URL('../data/', import.meta.url);
const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
  scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await readFile(new URL(path, data), 'utf8')])));
const content = CampaignContent.parse(packages);
const timeline = JSON.parse(await readFile(new URL('scenarios/townhall-s01-r2/derived-timeline.json', data), 'utf8'));

/** One shared monotonic world for the whole file (tests run in order): E0 -> S01-L -> duty desk -> S01-O -> receipt. */
let hostTime = 0;
const app = new CampaignApplication({ content, state: createCampaignE0(content), now: () => hostTime });
const jump = (worldMs: number): void => { hostTime = worldMs / content.data.operations.clock.worldSecondsPerRealSecond; app.reconcile(); };
function issue(operation: 'S01-L' | 'S01-O'): void {
  const state = app.checkpoint();
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
  app.submit({ kind: 'issue', commandId: operation, issuerPersonId: 'K002', recipientId, operation,
    expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion });
}

test('E0 settlement view: people, place, custody with honest unknowns, no works', () => {
  const view = buildSettlementView(app.checkpoint(), content, 'K002');
  assert.equal(view.place.name, '신정2동 주민센터 · 야간 배급 접수대');
  assert.deepEqual([...view.people.map(p => p.name)].sort(), ['백산석', '성달현', '야간 기록 당직(기능)', '이서담']);
  const lord = view.people.find(p => p.id === 'K002')!;
  assert.equal(lord.place, '야간 배급 접수대');
  // K616 starts in the yard, outside the lord's reception scene: last-known absence, never a guess.
  const k616 = view.people.find(p => p.id === 'K616')!;
  assert.equal(k616.place, '마지막 수신 위치 없음');
  assert.equal(view.works.length, 0);
  assert.ok(view.custody && !view.custody.visible, 'original sits in the archive scene, unknown to the reception view');
  assert.equal(view.custody?.seal, '봉인 유지');
  assert.equal(view.support, 'available');
});

test('conflicting second command is rejected with a readable reason and unchanged state', () => {
  issue('S01-L'); app.setSpeed(1);
  const before = app.checkpoint();
  assert.throws(() => issue('S01-O'), error => error instanceof CampaignBoundaryError && error.code === 'rejected-conflict');
  assert.equal(app.checkpoint().revision, before.revision);
  assert.ok(describeReason('rejected-conflict').includes('충돌'));
  const view = buildSettlementView(app.checkpoint(), content, 'K002');
  assert.equal(view.works.length, 1);
});

test('mid-walk view shows the named step and no idle recipient', () => {
  jump(300000);
  const view = buildSettlementView(app.checkpoint(), content, 'K002');
  const work = view.works.find(w => w.orderId === 'S01-L')!;
  assert.equal(work.recipientName, '백산석');
  assert.ok(['발행됨(전달 중)', '전달됨', '수신(응답 전)', '수락', '예약됨', '집행 중'].includes(labelStage(work.stage)), work.stage);
  const k568 = view.people.find(p => p.id === 'K568')!;
  assert.notEqual(k568.task, '대기');
});

test('duty-desk boundary: original resealed; custody still shown through its last known facts', () => {
  jump(timeline.dutyDesk.seconds * 1000);
  const view = buildSettlementView(app.checkpoint(), content, 'K002');
  const custody = app.checkpoint().custody[0]!;
  assert.equal(custody.returnState, 'resealed', 'domain boundary reached');
  assert.equal(view.custody?.returnState, 'resealed');
  // Custody follows signed handovers, not the duty's arrival: the resealed original is not live custody the lord holds.
  assert.equal(view.custody?.custodian, custody.custodian);
  const work = view.works.find(w => w.orderId === 'S01-L')!;
  assert.equal(work.stage, 'receipt');
});

test('support expiry is a visible state, not an automatic stop', () => {
  const state: CampaignState = advanceCampaignCommands(createCampaignE0(content), integer('WorldMilliseconds', 5400001), content, true);
  const view = buildSettlementView(state, content, 'K002');
  assert.equal(view.support, 'expired');
  assert.equal(view.clockMs, 5400001);
});

test('world clock is formatted as a readable duration, never raw milliseconds', () => {
  assert.equal(formatWorldSeconds(1602000), '26분 42초');
  assert.equal(formatWorldSeconds(0), '0분 00초');
});

test('after the ledger is done, K616 can be lawfully commanded', () => {
  issue('S01-O');
  const view = buildSettlementView(app.checkpoint(), content, 'K002');
  assert.equal(view.works.filter(w => w.orderId === 'S01-O').length, 1);
});
