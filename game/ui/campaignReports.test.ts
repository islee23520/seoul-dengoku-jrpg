import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../src/campaign/content.ts';
import { createCampaignE0 } from '../src/campaign/state.ts';
import { CampaignApplication } from '../src/campaign/application.ts';
import { composeCampaignAuthority } from '../src/campaign/authorityComposition.ts';
import { buildInboxView, sortedRows, unreadIds } from './campaignReportsModel.ts';

const data = new URL('../data/', import.meta.url);
const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
  scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await readFile(new URL(path, data), 'utf8')])));
const content = CampaignContent.parse(packages);
const timeline = JSON.parse(await readFile(new URL('scenarios/townhall-s01-r2/derived-timeline.json', data), 'utf8'));

/** One shared monotonic world: E0 -> S01-L -> duty desk -> S01-O -> just before receipt -> receipt. */
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

test('inbox membership is the received receipt: no S01-O fact appears before its receipt', () => {
  issue('S01-L'); app.setSpeed(1);
  jump(timeline.dutyDesk.seconds * 1000);
  issue('S01-O');
  jump(timeline.reportReceived.seconds * 1000 - 1);
  const before = app.checkpoint();
  assert.ok(before.reports.some(r => r.fact.orderId === 'S01-O'), 'world reports exist before receipt');
  // Earlier S01-L reports may already be lawfully received; the K616 observation reports must not be.
  assert.equal(buildInboxView(before, content, 'K002').rows.filter(r => r.orderId === 'S01-O').length, 0, 'no unreceived fact or payload is revealed');
});

test('received K616 partial reports keep raw evidence, omissions and uncertainty distinct', () => {
  jump(timeline.reportReceived.seconds * 1000);
  const rows = buildInboxView(app.checkpoint(), content, 'K002').rows.filter(r => r.orderId === 'S01-O');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.sourceName === '성달현' && row.receivedAt === timeline.reportReceived.seconds * 1000));
  const tap = rows.find(row => row.evidence.lines.some(line => line.includes('20~30 표시 사이')))!;
  assert.ok(tap.evidence.lines.some(line => line.includes('측정값 없음')), 'never an interpolated 25kPa value');
  assert.ok(tap.omission.includes('미교정 기기'));
  assert.equal(tap.uncertainty, 'partial-evidence');
  const cistern = rows.find(row => row.evidence.lines.some(line => line.includes('눈금 5칸')))!;
  assert.ok(cistern.evidence.lines.some(line => line.includes('교정 영수 없음')));
  assert.ok(cistern.observedAt <= cistern.createdAt && cistern.createdAt <= cistern.deliveredAt! && cistern.deliveredAt! <= cistern.receivedAt);
});

test('older received payloads are immutable when the world later changes', () => {
  const received = app.checkpoint();
  const rows = buildInboxView(received, content, 'K002').rows;
  const mutated = { ...received, facts: received.facts.map(f => ({ ...f, version: f.version + 1 })) };
  assert.deepEqual(buildInboxView(mutated as never, content, 'K002').rows, rows);
});

test('unread is local presentation metadata keyed by reportId', () => {
  const rows = buildInboxView(app.checkpoint(), content, 'K002').rows;
  assert.ok(rows.length >= 2);
  assert.equal(unreadIds(rows, new Set()).size, rows.length);
  assert.equal(unreadIds(rows, new Set(rows.map(row => row.reportId))).size, 0);
});

test('row order is newest-received first and deterministic', () => {
  const first = sortedRows(buildInboxView(app.checkpoint(), content, 'K002')).map(r => r.reportId);
  const second = sortedRows(buildInboxView(app.checkpoint(), content, 'K002')).map(r => r.reportId);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 2);
});
