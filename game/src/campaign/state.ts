import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import { CampaignContent, sourceGrantVersion } from './content.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import { nodeLocation } from './locations.ts';
import { assertAuthorityLinks, assertPhysicalLinks } from './stateLinks.ts';
import { assertReportLinks } from './reportLinks.ts';
import { campaignStateSchema } from './stateSchemas.ts';
import type { CampaignReport, CampaignState } from './stateSchemas.ts';
export type { CampaignState, CampaignLocation, CampaignReport } from './stateSchemas.ts';

/** Parse a complete boundary before giving it to a host. No host or second store is created. */
export function parseCampaignState(input: unknown, content: CampaignContent): CampaignState {
  ownInput(input);
  const parsed = campaignStateSchema.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const state = parsed.data;
  requireBoundary(summaryHash(state.packages) === summaryHash(content.hashes) && state.rulesRevision === content.hashes.operations && state.admissionReceipt === content.data.operations.startAuthorization.receiptSha256, 'stale-version');
  const collections = [state.people.map(p => p.id), state.bodies.map(b => b.entityId), state.grants.map(g => g.id), state.mandates.map(m => m.orderId), state.inventories.map(i => i.entityId), state.reservations.map(r => r.id), state.tools.map(t => t.id), state.notices.map(n => n.id), state.disputes.map(d => d.id), state.facts.map(f => f.id), state.reports.map(r => r.id), state.knowledge.map(k => k.personId), state.pendingResultIds, state.appliedResultIds, state.results.map(r => r.id)];
  requireBoundary(collections.every(ids => new Set(ids).size === ids.length), 'duplicate-id');
  requireBoundary(state.people.length === content.data.manifest.selection.persons.length && state.people.every(p => content.data.manifest.selection.persons.some(s => s.id === p.id)), 'person-scope');
  requireBoundary(state.clock.closedAt === null || state.clock.closedAt <= state.clock.worldMilliseconds, 'clock');
  assertAuthorityLinks(state, content);
  assertPhysicalLinks(state, content);
  assertReportLinks(state, content);
  for (const reservation of state.reservations) {
    const order = state.mandates.find(o => o.orderId === reservation.orderId);
    requireBoundary(order !== undefined && order.reservationIds.includes(reservation.id) && reservation.from < reservation.until, 'cross-link');
    const resource = reservation.resource;
    switch (resource.kind) {
      case 'body': requireBoundary(state.bodies.some(b => b.entityId === resource.entityId), 'cross-link'); break;
      case 'asset': requireBoundary(state.custody.some(c => c.assetId === resource.assetId) || state.tools.some(t => t.id === resource.assetId), 'cross-link'); break;
      default: assertNever(resource);
    }
    requireBoundary(!state.reservations.some(other => other.id !== reservation.id && summaryHash(other.resource) === summaryHash(reservation.resource) && other.from < reservation.until && reservation.from < other.until), 'cross-link');
  }
  for (const notice of state.notices) {
    const revision = state.grants.find(g => g.id === notice.grantId)?.revisions.find(r => r.version === notice.version);
    requireBoundary(revision !== undefined && revision.state !== 'valid' && revision.effectiveAt === notice.legalEffectiveAt && state.people.some(p => p.id === notice.recipient) && state.bodies.some(b => b.entityId === notice.carrier), 'cross-link');
    requireBoundary(notice.receivedAt === null || (notice.receivedAt >= notice.legalEffectiveAt && notice.receivedAt <= state.clock.worldMilliseconds), 'clock');
  }
  for (const dispute of state.disputes) requireBoundary(state.mandates.some(o => o.orderId === dispute.orderId) && dispute.openedAt <= state.clock.worldMilliseconds && (dispute.resolvedAt === null || (dispute.resolvedAt >= dispute.openedAt && dispute.resolvedAt <= state.clock.worldMilliseconds)), 'cross-link');
  requireBoundary(state.pendingResultIds.every(id => !state.appliedResultIds.includes(id)) && state.appliedResultIds.length === state.results.length && state.results.every(r => state.appliedResultIds.includes(r.id) && state.mandates.some(o => o.orderId === r.orderId) && r.at <= state.clock.worldMilliseconds), 'cross-link');
  return state;
}

export function createCampaignE0(content: CampaignContent): CampaignState {
  const { manifest, scenario, operations } = content.data;
  const epoch = operations.clock.epochSeconds * operations.clock.worldMillisecondsPerSecond;
  const bodies = [...scenario.actors.map(a => ({ id: a.id, at: a.at })), { id: operations.authority.duty, at: operations.authority.dutyPlacement }];
  return parseCampaignState({
    schema: 'composed-campaign.v1', revision: 0, packages: content.hashes, rulesRevision: content.hashes.operations,
    admissionReceipt: operations.startAuthorization.receiptSha256,
    clock: { worldMilliseconds: epoch, speed: 0, sequence: 0, phase: 'consistent-boundary', closedAt: null },
    people: manifest.selection.persons.map(p => ({ id: p.id })),
    bodies: bodies.map(b => ({ entityId: b.id, location: nodeLocation(b.at, content), activity: 'waiting',
      disease: operations.body.initial.disease,
      regions: operations.body.regions.map(region => ({ region, effortMilliseconds: operations.body.initial.effortSeconds * 1000, damage: operations.body.initial.damage, function: operations.body.initial.function })),
      foodCoveredUntil: operations.provisions.setup.coverageUntilSeconds * 1000, waterCoveredUntil: operations.provisions.setup.coverageUntilSeconds * 1000 })),
    grants: scenario.rights.grants.map(g => ({ id: g.id, sourceVersion: sourceGrantVersion(g), revisions: [{ version: sourceGrantVersion(g), previousVersion: null, state: 'valid', effectiveAt: epoch, causeId: 'S01:E0', issuer: g.issuer }] })),
    mandates: [], custody: [{ assetId: scenario.ledger.id, owner: scenario.ledger.owner, custodian: scenario.ledger.custodianAtE0, location: nodeLocation(scenario.ledger.container, content), causeId: 'S01:E0', seal: 'sealed', returnState: 'stored', unresolvedReturn: false }],
    inventories: operations.provisions.prepayments.map(p => ({ entityId: p.recipient, prepaymentId: p.id, foodPacks: p.preservedFoodPacks, emergencyReservedPacks: p.emergencyReservedPacks, waterMl: p.waterMl, paperSheets: operations.provisions.paper.find(row => row.recipient === p.recipient)?.sheets ?? 0, consumedFoodPacks: 0, consumedWaterMl: 0, consumedPaperSheets: 0 })),
    reservations: [], duty: { entityId: operations.authority.duty, keyId: scenario.ledger.key.id, keyHolder: scenario.ledger.key.holder, available: true },
    tools: scenario.availability.tools.map(t => ({ id: t.id, owner: t.owner, location: nodeLocation(t.at, content), available: true })),
    notices: [], disputes: [], facts: [], reports: [], knowledge: manifest.selection.persons.map(p => ({ personId: p.id, records: [] })),
    pendingResultIds: [], appliedResultIds: [], results: [], rng: { kind: 'unused-in-S01' },
  }, content);
}

/** A view receives only this receipt-filtered result, never the campaign/fact registry. */
export function receivedReports(state: CampaignState, person: CampaignState['people'][number]['id']): readonly CampaignReport[] {
  const knowledge = state.knowledge.find(k => k.personId === person);
  requireBoundary(knowledge !== undefined, 'person-scope');
  return knowledge.records.map(record => readReceivedReport(state, { personId: person, reportId: record.reportId }));
}
export function readReceivedReport(state: CampaignState, request: { readonly personId: string; readonly reportId: string }): CampaignReport {
  const record = state.knowledge.find(k => k.personId === request.personId)?.records.find(r => r.reportId === request.reportId);
  const report = state.reports.find(r => r.id === record?.reportId && r.recipient === request.personId && r.receivedAt !== null);
  requireBoundary(report !== undefined, 'report-unreceived');
  return report;
}
export function assertExpectedRevision(state: CampaignState, expected: number): void {
  requireBoundary(state.revision === expected, 'stale-version');
}
