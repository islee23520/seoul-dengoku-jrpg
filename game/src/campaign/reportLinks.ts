import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { assertLocation, physicalNodes } from './locations.ts';
import type { CampaignState } from './stateSchemas.ts';
import { assertEffectAuthority } from './effectLinks.ts';

export function assertReportLinks(state: CampaignState, content: CampaignContent): void {
  const { authority } = content.data.operations;
  const now = state.clock.worldMilliseconds;
  for (const fact of [...state.facts, ...state.reports.map(r => r.fact)]) {
    const order = state.mandates.find(m => m.orderId === fact.orderId);
    requireBoundary(order !== undefined && order.recipientId === fact.sourcePersonId && order.acceptedAt !== null && order.acceptedAt <= fact.observedAt, 'report-link');
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
    requireBoundary(state.people.some(p => p.id === report.recipient) && report.carrier === report.source && report.source === report.fact.sourcePersonId && report.recipient === authority.designator, 'report-link');
    requireBoundary(state.facts.some(f => f.id === report.fact.id && f.version >= report.fact.version), 'report-link');
    const sameVersion = state.facts.find(f => f.id === report.fact.id && f.version === report.fact.version);
    requireBoundary(sameVersion === undefined || summaryHash(sameVersion) === summaryHash(report.fact), 'report-link');
    requireBoundary(report.fact.observedAt <= report.createdAt && report.createdAt <= now, 'clock');
    requireBoundary(report.deliveredAt === null || (report.createdAt <= report.deliveredAt && report.deliveredAt <= now), 'clock');
    requireBoundary(report.receivedAt === null || (report.deliveredAt !== null && report.deliveredAt <= report.receivedAt && report.receivedAt <= now), 'report-unreceived');
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
