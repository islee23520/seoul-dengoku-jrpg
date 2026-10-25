import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { assertLocation, physicalNodes } from './locations.ts';
import type { CampaignState } from './stateSchemas.ts';
import { assertEffectAuthority } from './effectLinks.ts';
import { s01Steps } from './s01Steps.ts';

export function assertReportLinks(state: CampaignState, content: CampaignContent): void {
  const { authority } = content.data.operations;
  const now = state.clock.worldMilliseconds;
  for (const fact of [...state.facts, ...state.reports.map(r => r.fact)]) {
    const order = state.mandates.find(m => m.orderId === fact.orderId);
    requireBoundary(order !== undefined && order.recipientId === fact.sourcePersonId && order.causeId === fact.causeId && order.acceptedAt !== null && order.acceptedAt <= fact.observedAt, 'report-link');
    assertEffectAuthority(state, order, { at: fact.observedAt, content });
    requireBoundary(fact.observedAt <= now, 'clock');
    assertLocation(fact.location, content);
    switch (fact.evidence.kind) {
      case 'ledger-comparison':
        requireBoundary(order.operation === 'S01-L' && fact.sourcePersonId === authority.mandates.find(m => m.id === 'S01-L')?.recipient && physicalNodes(fact.location).length === 1 && physicalNodes(fact.location)[0] === authority.actorPlacements[authority.designator] && new Set(fact.evidence.rows.map(r => r.id)).size === fact.evidence.rows.length && fact.evidence.rows.every(row => content.data.operations.evidence.ledgerRows.some(source => summaryHash(source) === summaryHash(row))), 'report-link'); break;
      case 'raw-observation': {
        const { kind, nodeId, ...reading } = fact.evidence;
        const source = content.data.operations.evidence.observations.find(o => o.siteId === nodeId);
        requireBoundary(order.operation === 'S01-O' && fact.sourcePersonId === authority.mandates.find(m => m.id === 'S01-O')?.recipient && source !== undefined && physicalNodes(fact.location).length === 1 && physicalNodes(fact.location)[0] === nodeId, 'report-link');
        const { siteId, observer, observedAt, quality, ...approved } = source;
        requireBoundary(summaryHash(reading) === summaryHash(approved), 'report-link');
        break;
      }
      default: assertNever(fact.evidence);
    }
  }
  for (const report of state.reports) {
    const order = state.mandates.find(m => m.orderId === report.fact.orderId);
    requireBoundary(order !== undefined && report.causeId === order.causeId && report.recipient === order.issuerPersonId, 'report-link');
    requireBoundary(state.people.some(p => p.id === report.recipient) && report.carrier === report.source && report.source === report.fact.sourcePersonId && report.recipient === authority.designator, 'report-link');
    requireBoundary(state.facts.some(f => f.id === report.fact.id && f.version >= report.fact.version), 'report-link');
    const sameVersion = state.facts.find(f => f.id === report.fact.id && f.version === report.fact.version);
    requireBoundary(sameVersion === undefined || summaryHash(sameVersion) === summaryHash(report.fact), 'report-link');
    requireBoundary(report.fact.observedAt <= report.createdAt && report.createdAt <= now, 'clock');
    requireBoundary(report.deliveredAt === null || (report.createdAt <= report.deliveredAt && report.deliveredAt <= now), 'clock');
    requireBoundary(report.receivedAt === null || (report.deliveredAt !== null && report.deliveredAt <= report.receivedAt && report.receivedAt <= now), 'report-unreceived');
    if (order.origin === 'command-ingress') {
      const track = state.s01.tracks.find(t => t.orderId === order.orderId && t.lane === 'investigation');
      requireBoundary(track !== undefined, 'report-link');
      const steps = s01Steps(track, state, content);
      const observation = state.s01.activities.find(a => a.trackId === track.id && a.id.replace(/:activity$/, ':fact') === report.fact.id);
      requireBoundary(observation !== undefined && observation.completedAt === report.fact.observedAt && report.createdAt === report.fact.observedAt && report.id === report.fact.id + ':report', 'report-link');
      const step = observation && steps[observation.step];
      requireBoundary(step !== undefined && (step.kind === 'compare' || step.kind === 'observe') && physicalNodes(report.fact.location)[0] === step.from, 'report-link');
      if (step.kind === 'compare') requireBoundary(report.fact.evidence.kind === 'ledger-comparison' &&
        summaryHash(report.fact.evidence.rows) === summaryHash([content.data.operations.evidence.ledgerRows[step.row!]!]), 'report-link');
      const delivery = state.s01.activities.find(a => a.trackId === track.id && steps[a.step]?.kind === 'report');
      const inTransit = steps[track.step]?.kind === 'report' && Object.keys(track.initialEffort).length > 0;
      requireBoundary(report.deliveredAt === null || report.deliveredAt === (delivery?.startedAt ?? (inTransit ? track.startedAt : null)), 'report-link');
      requireBoundary(report.receivedAt === null || report.receivedAt === delivery?.completedAt, 'report-unreceived');
      const omissions = report.fact.evidence.kind === 'ledger-comparison' ? ['missing-annex', 'unsigned-slot', 'different-event-time'] : report.fact.evidence.uncertainties;
      requireBoundary(summaryHash(report.omission) === summaryHash(omissions), 'report-link');
    }
    const records = state.knowledge.flatMap(k => k.records.filter(r => r.reportId === report.id).map(r => ({ personId: k.personId, ...r })));
    requireBoundary(report.receivedAt === null ? records.length === 0 : records.length === 1 && records[0]?.personId === report.recipient, 'report-unreceived');
  }
  requireBoundary(state.knowledge.length === state.people.length, 'person-scope');
  for (const knowledge of state.knowledge) {
    requireBoundary(state.people.some(p => p.id === knowledge.personId), 'person-scope');
    requireBoundary(new Set(knowledge.records.map(r => r.reportId)).size === knowledge.records.length, 'duplicate-id');
    for (const record of knowledge.records) {
      const report = state.reports.find(r => r.id === record.reportId);
      requireBoundary(report !== undefined && report.recipient === knowledge.personId && report.receivedAt !== null && report.receivedAt === record.receivedAt && report.fact.id === record.factId && report.fact.version === record.version, 'report-unreceived');
      requireBoundary(record.payloadHash === summaryHash(report), 'report-link');
    }
  }
}
