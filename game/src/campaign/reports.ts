import { z } from '../../../engine/node_modules/zod/index.js';
import { summaryHash } from '../domain/eventLedger.ts';
import { id, integer } from '../domain/ids.ts';
import { receiveReport } from '../domain/knowledge.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignReport, CampaignState } from './stateSchemas.ts';
import { parseCampaignState, receivedReports } from './state.ts';
import { assertReportLinks } from './reportLinks.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import { milliseconds, personId, ref, siteId } from './contentSchemas.ts';
import { s01Steps } from './s01Steps.ts';

/** Called at observation completion, not when the lord opens a panel. */
export function registerObservationReport(state: CampaignState, fact: CampaignState['facts'][number]): CampaignState {
  const order = state.mandates.find(m => m.orderId === fact.orderId);
  requireBoundary(order !== undefined && order.recipientId === fact.sourcePersonId && order.causeId === fact.causeId, 'report-link');
  const report: CampaignReport = { id: fact.id + ':report', fact, recipient: order.issuerPersonId, carrier: order.recipientId,
    createdAt: fact.observedAt, deliveredAt: null, receivedAt: null, source: order.recipientId,
    omission: fact.evidence.kind === 'ledger-comparison' ? ['missing-annex', 'unsigned-slot', 'different-event-time'] : fact.evidence.uncertainties.filter(
      (value): value is 'uncalibrated' | 'small-graduations' | 'parallax' | 'different-event-time' => value === 'uncalibrated' || value === 'small-graduations' || value === 'parallax' || value === 'different-event-time'),
    uncertainty: 'partial-evidence', causeId: order.causeId };
  const previous = state.reports.find(r => r.id === report.id);
  requireBoundary(previous === undefined, 'duplicate-id');
  return { ...state, reports: [...state.reports, report] };
}

/** Delivery is the carrier reaching the issuer and starting the actual report activity. */
export function deliverOrderReports(state: CampaignState, orderId: string): CampaignState {
  const order = state.mandates.find(m => m.orderId === orderId);
  requireBoundary(order !== undefined, 'report-link');
  const carrier = state.bodies.find(b => b.entityId === order.recipientId);
  const recipient = state.bodies.find(b => b.entityId === order.issuerPersonId);
  requireBoundary(carrier?.location.kind === 'node' && recipient?.location.kind === 'node' &&
    carrier.location.nodeId === recipient.location.nodeId, 'report-unreceived');
  return { ...state, reports: state.reports.map(r => r.fact.orderId === orderId && r.deliveredAt === null
    ? { ...r, deliveredAt: state.clock.worldMilliseconds } : r) };
}

const receiptRequest = z.strictObject({ reportId: ref, recipient: personId });

/** No caller payload/timestamp/issuer is accepted. Physical history authenticates receipt. */
export function receiveCampaignReport(inputState: CampaignState, input: unknown, content: CampaignContent): CampaignState {
  return parseCampaignState(receivePhysicalReport(parseCampaignState(inputState, content), input, content), content);
}

/** Internal physical transaction: the enclosing scheduler commits and validates the batch. */
export function receivePhysicalReport(inputState: CampaignState, input: unknown, content: CampaignContent): CampaignState {
  ownInput(input);
  const parsed = receiptRequest.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const state = inputState;
  assertReportLinks(state, content);
  const report = state.reports.find(r => r.id === parsed.data.reportId && r.recipient === parsed.data.recipient);
  requireBoundary(report !== undefined, 'report-unreceived');
  if (report.receivedAt !== null) return state;
  const track = state.s01.tracks.find(t => t.orderId === report.fact.orderId && t.lane === 'investigation');
  const activity = track && state.s01.activities.find(a => a.trackId === track.id && s01Steps(track, state, content)[a.step]?.kind === 'report');
  requireBoundary(activity !== undefined && activity.startedAt === report.deliveredAt && activity.completedAt === state.clock.worldMilliseconds, 'report-unreceived');
  const knowledge = state.knowledge.find(k => k.personId === report.recipient);
  requireBoundary(knowledge !== undefined, 'person-scope');
  // The shared domain receipt rule is the only way to add a knowledge record.
  const informed = receiveReport({ personId: knowledge.personId,
    records: knowledge.records.map(r => ({ ...r, version: integer('Revision', r.version) })),
    understanding: {}, practiceProgress: {}, skills: {}, qualifications: [] }, {
    id: report.id, fact: { id: report.fact.id, version: integer('Revision', report.fact.version), content: summaryHash(report.fact), causeId: report.fact.causeId },
    recipient: report.recipient, observedAt: integer('WorldTick', report.fact.observedAt), createdAt: integer('WorldTick', report.createdAt),
    deliveredAt: report.deliveredAt === null ? null : integer('WorldTick', report.deliveredAt), source: report.source,
    omission: report.omission, uncertainty: report.uncertainty, causeId: report.causeId,
  }, integer('WorldTick', state.clock.worldMilliseconds));
  requireBoundary(informed.records.length === knowledge.records.length + 1, 'report-link');
  const received = { ...report, receivedAt: state.clock.worldMilliseconds };
  // The enclosing physical boundary validates atomically after every report in the batch.
  return { ...state, reports: state.reports.map(r => r.id === report.id ? received : r), knowledge: state.knowledge.map(k => k.personId !== report.recipient ? k : {
    ...k, records: [...k.records, { reportId: report.id, factId: report.fact.id, version: report.fact.version,
      receivedAt: received.receivedAt, payloadHash: summaryHash(received) }],
  }) };
}

const querySchema = z.strictObject({ personId, asOf: milliseconds.optional(), siteId: siteId.optional() });

/** Last known means last received version, never a comparison with hidden current truth. */
export function lordKnowledge(state: CampaignState, input: unknown) {
  ownInput(input);
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const query = parsed.data, asOf = query.asOf ?? state.clock.worldMilliseconds;
  requireBoundary(asOf <= state.clock.worldMilliseconds, 'clock');
  const reports = receivedReports(state, id('PersonId', query.personId)).filter(r => r.receivedAt !== null && r.receivedAt <= asOf &&
    (query.siteId === undefined || ('siteId' in r.fact.location && r.fact.location.siteId === query.siteId)));
  const latest = new Map<string, CampaignReport>();
  for (const report of reports) {
    const previous = latest.get(report.fact.id);
    if (!previous || report.fact.version > previous.fact.version || report.fact.version === previous.fact.version && report.fact.observedAt > previous.fact.observedAt) latest.set(report.fact.id, report);
  }
  return Object.freeze({ personId: query.personId, asOf, reports: Object.freeze(reports),
    facts: Object.freeze([...latest.values()].map(report => Object.freeze({ reportId: report.id, factId: report.fact.id,
      version: report.fact.version, observedAt: report.fact.observedAt, createdAt: report.createdAt, deliveredAt: report.deliveredAt,
      receivedAt: report.receivedAt, source: report.source, location: report.fact.location, evidence: report.fact.evidence,
      omission: report.omission, uncertainty: report.uncertainty }))) });
}

/** Errors reveal no alternative version, issuer, or undisclosed fact value. */
export function requireKnownReportFact(state: CampaignState, input: unknown): void {
  ownInput(input);
  const parsed = z.strictObject({ personId, factId: ref, version: z.int().nonnegative(), asOf: milliseconds.optional() }).safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const { factId, version, ...query } = parsed.data;
  requireBoundary(lordKnowledge(state, query).facts.some(f => f.factId === factId && f.version === version), 'report-unreceived');
}
