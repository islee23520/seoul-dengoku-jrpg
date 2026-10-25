import { z } from '../../../engine/node_modules/zod/index.js';
import { id } from '../domain/ids.ts';
import { ledgerRow, rawReading } from './operationSchemas.ts';
import { commandStateSchema } from './commands.ts';
import { bodyRegion, count, digest, grantId, milliseconds, nodeId, personId, ref, sceneId, siteId } from './contentSchemas.ts';

const cause = ref.transform(v => id('CauseId', v));
const orderId = ref.transform(v => id('OrderId', v));
const resultId = ref.transform(v => id('ResultId', v));
const entityId = ref.transform(v => v.startsWith('K') ? id('PersonId', v) : id('DutyId', v));
const refs = z.array(ref).readonly();
export const locationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('station'), stationId: ref.transform(v => id('StationId', v)) }).readonly(),
  z.strictObject({ kind: z.literal('site'), siteId }).readonly(),
  z.strictObject({ kind: z.literal('scene'), siteId, sceneId }).readonly(),
  z.strictObject({ kind: z.literal('node'), siteId, sceneId, nodeId }).readonly(),
  z.strictObject({ kind: z.literal('edge-progress'), siteId, from: nodeId, to: nodeId, travelledMillimetres: count }).readonly(),
]);
export type CampaignLocation = z.infer<typeof locationSchema>;
const body = z.strictObject({
  entityId, location: locationSchema, activity: z.enum(['waiting', 'walking', 'carrying', 'stationary', 'resting', 'eating', 'drinking']),
  disease: z.literal('no-active-episode-in-S01-setup'),
  regions: z.array(z.strictObject({ region: bodyRegion, effortMilliseconds: count, damage: z.literal('none'), function: z.literal('available') }).readonly()).readonly(),
  foodCoveredUntil: milliseconds, waterCoveredUntil: milliseconds,
}).readonly();
const grantRevision = z.strictObject({
  version: digest, previousVersion: digest.nullable(), state: z.enum(['valid', 'revoked', 'expired']),
  effectiveAt: milliseconds, causeId: cause, issuer: ref,
}).readonly();
const grant = z.strictObject({ id: grantId, sourceVersion: digest, revisions: z.array(grantRevision).min(1).readonly() }).readonly();
const authorityRef = z.strictObject({ grantId, version: digest }).readonly();
const mandate = z.strictObject({
  origin: z.enum(['command-ingress', 'legacy-boundary']),
  orderId, causeId: cause, operation: z.enum(['S01-L', 'S01-O']), issuerPersonId: personId, recipientId: personId,
  authority: z.array(authorityRef).length(2).readonly(), compositeVersion: digest,
  target: locationSchema, issuerLocation: locationSchema, recipientLocation: locationSchema,
  route: z.array(nodeId).min(1).readonly(), stage: z.enum(['proposed', 'delivered', 'received', 'consent', 'refused', 'reserved', 'executing', 'result-applied', 'receipt', 'cancelled', 'interrupted', 'expired']),
  issuedAt: milliseconds, receivedAt: milliseconds.nullable(), acceptedAt: milliseconds.nullable(),
  returnAcceptedAt: milliseconds.nullable(), workMilliseconds: count, reservationIds: refs,
  pendingResultIds: z.array(resultId).readonly(), appliedResultIds: z.array(resultId).readonly(),
}).readonly();
const custody = z.strictObject({
  assetId: ref, owner: ref, custodian: entityId, location: locationSchema, causeId: cause,
  seal: z.enum(['sealed', 'opened']), returnState: z.enum(['stored', 'return-required', 'handover-received', 'restocked', 'resealed']),
  unresolvedReturn: z.boolean(),
}).readonly();
const inventory = z.strictObject({
  entityId, prepaymentId: ref, foodPacks: count, emergencyReservedPacks: count, waterMl: count, paperSheets: count,
  consumedFoodPacks: count, consumedWaterMl: count, consumedPaperSheets: count,
}).readonly();
const resource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('body'), entityId }).readonly(),
  z.strictObject({ kind: z.literal('asset'), assetId: ref }).readonly(),
]);
const fact = z.strictObject({
  id: ref, version: count, orderId, sourcePersonId: personId, observedAt: milliseconds, location: locationSchema, causeId: cause,
  evidence: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ledger-comparison'), rows: z.array(ledgerRow).min(1).readonly() }).readonly(),
    rawReading.unwrap().extend({ kind: z.literal('raw-observation'), nodeId }).readonly(),
  ]),
}).readonly();
const report = z.strictObject({
  id: ref, fact, recipient: personId, carrier: entityId, createdAt: milliseconds, deliveredAt: milliseconds.nullable(), receivedAt: milliseconds.nullable(),
  source: personId, omission: z.array(z.enum(['missing-annex', 'unsigned-slot', 'uncalibrated', 'different-event-time', 'small-graduations', 'parallax', 'incomplete-work'])).readonly(),
  uncertainty: z.literal('partial-evidence'), causeId: cause,
}).readonly();
export type CampaignReport = z.infer<typeof report>;
export const campaignStateSchema = z.strictObject({
  schema: z.literal('composed-campaign.v1'), revision: count,
  commands: commandStateSchema,
  packages: z.strictObject({ manifest: digest, atlas: digest, identities: digest, scenario: digest, projection: digest, operations: digest }).readonly(),
  rulesRevision: digest, admissionReceipt: digest,
  clock: z.strictObject({ worldMilliseconds: milliseconds, subWorldMicroseconds: z.int().min(0).max(999).default(0), speed: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]), sequence: count, phase: z.literal('consistent-boundary'), closedAt: milliseconds.nullable() }).readonly(),
  people: z.array(z.strictObject({ id: personId }).readonly()).readonly(), bodies: z.array(body).readonly(),
  grants: z.array(grant).readonly(), mandates: z.array(mandate).readonly(), custody: z.array(custody).readonly(), inventories: z.array(inventory).readonly(),
  reservations: z.array(z.strictObject({ id: ref, orderId, resource, from: milliseconds, until: milliseconds, consumptionId: resultId.nullable().default(null) }).readonly()).readonly(),
  duty: z.strictObject({ entityId, keyId: ref, keyHolder: entityId, available: z.boolean() }).readonly(),
  tools: z.array(z.strictObject({ id: ref, owner: ref, location: locationSchema, available: z.boolean() }).readonly()).readonly(),
  notices: z.array(z.strictObject({ id: ref, grantId, version: digest, recipient: personId, carrier: entityId, legalEffectiveAt: milliseconds, receivedAt: milliseconds.nullable() }).readonly()).readonly(),
  disputes: z.array(z.strictObject({ id: ref, orderId, openedAt: milliseconds, reason: z.enum(['custody-unreturned', 'receipt-contested']), resolvedAt: milliseconds.nullable() }).readonly()).readonly(),
  facts: z.array(fact).readonly(), reports: z.array(report).readonly(),
  knowledge: z.array(z.strictObject({ personId, records: z.array(z.strictObject({ reportId: ref, factId: ref, version: count, receivedAt: milliseconds, payloadHash: digest }).readonly()).readonly() }).readonly()).readonly(),
  consumption: z.array(z.strictObject({ id: resultId, entityId, kind: z.enum(['food', 'water']), startedAt: milliseconds, completedAt: milliseconds, causeId: cause }).readonly()).readonly(),
  pendingResultIds: z.array(resultId).readonly(), appliedResultIds: z.array(resultId).readonly(),
  results: z.array(z.strictObject({ id: resultId, orderId, causeId: cause, at: milliseconds, kind: z.enum(['work', 'custody', 'report', 'safe-return']), payloadHash: digest,
    physical: z.strictObject({ previousResultId: resultId.nullable(), before: custody, after: custody,
      bodies: z.array(body).readonly(), dutyAvailable: z.boolean() }).readonly().nullable().default(null),
    safeReturn: z.strictObject({ assetId: ref, action: z.enum(['protect', 'carry-to-threshold', 'handover', 'restock', 'reseal']), custodian: entityId, location: locationSchema,
      priorCustodyResultId: resultId, safeRoute: z.literal(true), dutyAvailable: z.literal(true) }).readonly().nullable(),
  }).readonly()).readonly(),
  rng: z.strictObject({ kind: z.literal('unused-in-S01') }).readonly(),
}).readonly();
export type CampaignState = z.infer<typeof campaignStateSchema>;
