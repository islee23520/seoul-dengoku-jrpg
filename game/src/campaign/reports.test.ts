import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { content, e0, reportedState } from './testFixtures.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { advanceCampaignCommands, submitCampaignCommand, CampaignApplication } from './application.ts';
import { integer, id } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { parseCampaignState, readReceivedReport } from './state.ts';
import { lordKnowledge, receiveCampaignReport, requireKnownReportFact } from './reports.ts';
import { campaignWorkGrowth, campaignWorkLedger } from './workResults.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { GrowthState } from '../domain/growth.ts';

// Every consumer retains the task 9 per-value provisional marker; no 1590 fallback.
const timeline = JSON.parse(await readFile(new URL('../../data/scenarios/townhall-s01-r2/derived-timeline.json', import.meta.url), 'utf8'));
const issue = (state: CampaignState, operation: 'S01-L' | 'S01-O') => {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
  return submitCampaignCommand(state, { kind: 'issue', commandId: operation, operation, issuerPersonId: 'K002', recipientId,
    expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion }, content).state;
};
const advance = (state: CampaignState, at: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', at), content, true);
const ledger = advance(issue(e0, 'S01-L'), timeline.dutyDesk.seconds * 1000);
const observing = issue(ledger, 'S01-O');
const before = advance(observing, timeline.reportReceived.seconds * 1000 - 1);
const complete = advance(before, timeline.reportReceived.seconds * 1000);
const query = { personId: 'K002' };
const clone = (s: CampaignState): any => JSON.parse(JSON.stringify(s));

test('observed and carried payloads remain unreadable until formal receipt', () => {
  const reports = before.reports.filter(r => r.source === 'K616');
  assert.equal(reports.length, 2);
  assert.ok(reports.every(r => r.deliveredAt === 1542000 && r.receivedAt === null));
  assert.equal(lordKnowledge(before, query).reports.filter(r => r.source === 'K616').length, 0);
  assert.equal(lordKnowledge(complete, { ...query, asOf: 1601999 }).reports.filter(r => r.source === 'K616').length, 0);
  for (const report of reports) {
    assert.throws(() => readReceivedReport(before, { personId: 'K002', reportId: report.id }), /report-unreceived/);
    assert.throws(() => receiveCampaignReport(before, { recipient: 'K002', reportId: report.id }, content), /report-unreceived/);
  }
  const received = lordKnowledge(complete, query).facts.filter(f => f.source === 'K616');
  assert.deepEqual(received.map(f => f.observedAt), [timeline.cisternObserved.seconds * 1000, timeline.tapObserved.seconds * 1000]);
  assert.ok(received.every(f => f.receivedAt === timeline.reportReceived.seconds * 1000 && f.uncertainty === 'partial-evidence'));
  assert.ok(received.every(f => f.evidence.kind === 'raw-observation' && f.evidence.measurementValue === null));
});

test('duplicate receipt is idempotent including after checkpoint restore', () => {
  const report = complete.reports.at(-1)!;
  const restored = parseCampaignState(clone(complete), content);
  const replay = receiveCampaignReport(restored, { recipient: report.recipient, reportId: report.id }, content);
  assert.deepEqual(replay, complete);
  assert.deepEqual(advance(replay, 1700000).knowledge, complete.knowledge);
});

test('truth changes in transit but formal receipt carries the original observation', () => {
  const changed = parseCampaignState({ ...before, facts: before.facts.map(f => f.sourcePersonId === 'K616' ? { ...f, version: f.version + 1 } : f) }, content);
  assert.equal(lordKnowledge(changed, query).facts.filter(f => f.source === 'K616').length, 0);
  const received = advance(changed, timeline.reportReceived.seconds * 1000);
  assert.deepEqual(lordKnowledge(received, query), lordKnowledge(complete, query));
  assert.ok(received.facts.filter(f => f.sourcePersonId === 'K616').every(f => f.version === 1));
});

test('late older reports never replace a newer received version in last-known facts', () => {
  const old = reportedState(true), original = old.reports[0]!;
  const fact = { ...original.fact, version: 1 };
  const newer = { ...original, id: 'newer-report', fact, receivedAt: integer('WorldMilliseconds', 1601999) };
  const state = parseCampaignState({ ...old, facts: [fact], reports: [newer, original], knowledge: old.knowledge.map(k => k.personId !== 'K002' ? k : {
    ...k, records: [{ reportId: newer.id, factId: fact.id, version: fact.version, receivedAt: newer.receivedAt, payloadHash: summaryHash(newer) }, ...k.records],
  }) }, content);
  assert.equal(lordKnowledge(state, query).reports.length, 2);
  assert.equal(lordKnowledge(state, query).facts[0]?.version, 1);
  assert.equal(lordKnowledge(state, { ...query, asOf: 1601998 }).facts.length, 0);
});

test('stale immutable receipt survives later truth without learning its version', () => {
  const old = reportedState(true), report = old.reports[0]!;
  const state = parseCampaignState({ ...old, facts: old.facts.map(f => ({ ...f, version: f.version + 1 })) }, content);
  assert.deepEqual(lordKnowledge(state, query), lordKnowledge(old, query));
  assert.equal(lordKnowledge(state, query).facts[0]?.version, 0);
  const edited = clone(state);
  edited.reports[0].fact.version = 1;
  assert.throws(() => parseCampaignState(edited, content), /report-link|report-unreceived/);
  assert.throws(() => requireKnownReportFact(state, { ...query, factId: report.fact.id, version: 1 }), /report-unreceived/);
  assert.doesNotThrow(() => requireKnownReportFact(state, { ...query, factId: report.fact.id, version: 0 }));
  assert.equal(Reflect.set(report.fact, 'version', 100), false);
  assert.equal(Reflect.set(state.reports[0]!.fact.evidence, 'measurementValue', 25), false);
  assert.equal(Reflect.set(lordKnowledge(state, query).facts, '0', null), false);
  assert.deepEqual(state.reports, old.reports);
});

test('forged issuer, source, time, payload and recomputed receipt hashes are rejected', () => {
  for (const mutate of [
    (s: any) => { s.reports.at(-1).source = 'K568'; },
    (s: any) => { s.reports.at(-1).recipient = 'K568'; },
    (s: any) => { s.reports.at(-1).causeId = 'another-issuer'; },
    (s: any) => { s.reports.at(-1).fact.causeId = 'another-issuer'; },
    (s: any) => { s.reports.at(-1).deliveredAt--; },
    (s: any) => { s.reports.at(-1).receivedAt--; },
    (s: any) => { s.reports.at(-1).fact.evidence.measurementValue = 25; },
    (s: any) => { s.reports.at(-1).omission = []; },
    (s: any) => { s.reports.at(-1).fact.evidence.currentPressure = 25; },
  ]) {
    const candidate = clone(complete); mutate(candidate);
    const report = candidate.reports.at(-1);
    const record = candidate.knowledge.find((k: any) => k.personId === 'K002').records.find((r: any) => r.reportId === report.id);
    record.receivedAt = report.receivedAt; record.payloadHash = summaryHash(report);
    assert.throws(() => parseCampaignState(candidate, content));
  }
});

test('projection is received-only, as-of, immutable, scoped, and rejects inherited options', () => {
  const snapshot = lordKnowledge(complete, { ...query, siteId: content.data.operations.authority.siteId });
  assert.equal(snapshot.reports.length, 6);
  assert.equal(lordKnowledge(complete, { ...query, asOf: 0 }).facts.length, 0);
  assert.equal(lordKnowledge(complete, { personId: 'K616' }).facts.length, 0);
  assert.throws(() => lordKnowledge(complete, { ...query, asOf: 1602001 }), /clock/);
  assert.deepEqual(Object.keys(snapshot).sort(), ['asOf', 'facts', 'personId', 'reports']);
  for (const field of ['currentVersion', 'stale', 'bodies', 'inventories', 'custody', 'grants', 'results', 'truth']) assert.equal(Object.hasOwn(snapshot, field), false);
  for (const request of [Object.create(query), { ...query, siteId: Object.create({}) }]) assert.throws(() => lordKnowledge(complete, request), /inherited-option/);
  assert.throws(() => receiveCampaignReport(complete, Object.create({ recipient: 'K002', reportId: complete.reports[0]!.id }), content), /inherited-option/);
  assert.throws(() => lordKnowledge(complete, { ...query, camera: 's01:townhall:tap' }), /shape/);
});

test('work completion is a single durable candidate before receipt and after replay', () => {
  const atWork = advance(observing, timeline.tapObserved.seconds * 1000);
  const result = atWork.results.find(r => r.orderId === 'S01-O' && r.kind === 'work')!;
  assert.equal(result.id, 'S01-O:work-completion');
  assert.equal(atWork.reports.filter(r => r.source === 'K616' && r.receivedAt !== null).length, 0);
  let state = parseCampaignState(clone(atWork), content);
  for (const at of [1476001, 1500000, 1542000, 1601999, 1602000, 1800000]) state = advance(state, at);
  state = acknowledgeCommandEffect(state, { orderId: 'S01-O', resultId: result.id, transition: 'work-completed' }, content);
  assert.equal(state.results.filter(r => r.kind === 'work' && r.orderId === 'S01-O').length, 1);
  assert.equal(state.commands.events.filter(e => e.kind === 'work-completed' && e.orderId === 'S01-O').length, 1);
  assert.deepEqual(campaignWorkLedger(state, content), campaignWorkLedger(atWork, content));
  const growth: GrowthState = { person: id('PersonId', 'K616'), xp: 7, level: 1,
    parameters: { maxHp: 1, maxMp: 1, attack: 1, defense: 1, mind: 1, agility: 1 }, focus: { focus: null, perks: [] }, appliedResults: [] };
  const pending = campaignWorkGrowth(state, growth, content);
  assert.equal(pending.projection.kind, 'blocked');
  assert.strictEqual(pending.projection.state, growth);
  assert.deepEqual(pending.pendingApplicability, [result.id]);
});

test('restore rejects duplicate completion identities and edited immutable work evidence', () => {
  for (const mutate of [
    (s: any) => { const work = s.results.find((r: any) => r.kind === 'work'); s.results.push({ ...work, id: 'new-work-id' }); s.appliedResultIds.push('new-work-id'); s.mandates[0].appliedResultIds.push('new-work-id'); },
    (s: any) => { const work = s.results.find((r: any) => r.kind === 'work'); work.workEvidence = []; work.payloadHash = summaryHash([]); },
    (s: any) => { const work = s.results.find((r: any) => r.kind === 'work'); work.at++; },
  ]) {
    const candidate = clone(complete); mutate(candidate); assert.throws(() => parseCampaignState(candidate, content));
  }
});

test('another approved ledger row cannot impersonate this observed row after rehashing', () => {
  const candidate = clone(complete);
  const report = candidate.reports[0];
  report.fact.evidence.rows = [content.data.operations.evidence.ledgerRows[1]];
  candidate.facts[0] = report.fact;
  const work = candidate.results.find((r: any) => r.kind === 'work');
  work.workEvidence[0] = report.fact; work.payloadHash = summaryHash(work.workEvidence);
  candidate.knowledge.find((k: any) => k.personId === 'K002').records[0].payloadHash = summaryHash(report);
  const receipt = candidate.results.find((r: any) => r.kind === 'report');
  receipt.payloadHash = summaryHash(candidate.reports.filter((r: any) => r.fact.orderId === report.fact.orderId));
  assert.throws(() => parseCampaignState(candidate, content), /report-link/);
});

test('application knowledge query does not advance time or expose remote actors', () => {
  const app = new CampaignApplication({ content, state: before, now: () => 0 });
  const initial = app.checkpoint();
  assert.equal(app.knowledge(query).facts.filter(f => f.source === 'K616').length, 0);
  assert.equal(app.view('K002').orders.find(o => o.recipientId === 'K616')?.stage, 'executing');
  app.settlement('K002'); app.view('K002');
  assert.deepEqual(app.checkpoint(), initial);
  app.close();
});
