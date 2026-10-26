import { z } from '../../../engine/node_modules/zod/index.js';
import { id, integer } from '../domain/ids.ts';
import { clockRules, durations, routeRules, provisionRules, bodyRules, evidenceRules, orderingRules, responseRules } from './operationSchemas.ts';

export const ref = z.string().min(1);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const personId = ref.transform(value => id('PersonId', value));
export const nodeId = ref.transform(value => id('CampaignNodeId', value));
export const sceneId = ref.transform(value => id('CampaignSceneId', value));
export const siteId = ref.transform(value => id('CampaignSiteId', value));
export const grantId = ref.transform(value => id('GrantId', value));
export const milliseconds = count.transform(value => integer('WorldMilliseconds', value));
const refs = z.array(ref).readonly();
const persons = z.array(z.object({ id: personId, name: ref, disposition: z.enum(['active', 'retired-current']) }).readonly()).readonly();
const selection = z.object({
  persons,
  holding: z.object({ id: ref, holderPersonId: personId, directLiegePersonId: personId, adminRefs: z.array(z.object({ id: ref })) }).readonly(),
  titleBinding: z.object({ holdingId: ref, titleId: ref, parentTitleId: ref, parentHolderPersonId: personId }).readonly(),
  court: z.array(z.object({ personId, liegePersonId: personId, courtId: ref, status: z.enum(['active', 'retired-current']) }).readonly()).readonly(),
  site: z.object({ id: siteId, regionId: ref, name: ref }).readonly(),
}).readonly();
export const manifestShape = z.object({ schema: z.literal('campaign-source-manifest.v1'), selection }).readonly();
export const atlasShape = z.object({
  schema: z.literal('campaign-atlas.v1'), edition: ref, source: z.object({ manifestSha256: digest }), selection,
  stations: z.array(z.object({ id: ref.transform(value => id('StationId', value)) }).readonly()).readonly(),
  edges: z.array(z.object({ id: ref, a: ref, b: ref }).readonly()).readonly(),
}).readonly();
export const identityShape = z.object({
  schema: z.literal('campaign-identity-map.v1'), edition: ref, source: z.object({ manifestSha256: digest }),
  legacyEdition: z.object({ schema: ref, graphSha256: digest, immutable: z.literal(true) }).readonly(),
  stations: z.array(z.discriminatedUnion('status', [
    z.object({ oldId: ref, oldMapId: ref, status: z.literal('exact'), newId: ref, newMapId: ref, placement: z.literal('station-identity-only') }).readonly(),
    z.object({ oldId: ref, oldMapId: ref, status: z.literal('authenticated-alias'), newId: ref, newMapId: ref, placement: z.literal('unsupported') }).readonly(),
    z.object({ oldId: ref, oldMapId: ref, status: z.literal('excluded'), newId: z.null(), placement: z.literal('unsupported') }).readonly(),
  ])).readonly(),
  persons: z.array(z.object({ oldId: personId, newId: personId, status: z.literal('exact') }).readonly()).readonly(),
}).readonly();
export const sourceGrant = z.object({
  id: grantId, issuer: ref, recipient: personId, scope: refs, delegationDepth: z.enum(['named-two-only', 'none']), sealException: ref.nullable().default(null),
}).readonly();
export const scenarioShape = z.object({
  id: ref, siteId, regionId: ref,
  sites: z.array(z.object({ id: nodeId, regionId: ref, anchorRef: siteId, name: ref }).readonly()).readonly(),
  actors: z.array(z.object({ id: personId, at: nodeId, access: z.array(nodeId).readonly(), bodyPresent: z.literal(true) }).readonly()).readonly(),
  rights: z.object({ basis: z.object({ id: ref, issuer: ref }).readonly(), grants: z.array(sourceGrant).readonly(), dutyWalk: z.object({ section: z.array(nodeId).readonly() }), forbidden: z.array(ref).readonly() }).readonly(),
  policies: z.object({ scheduleConflictPolicy: z.literal('reject-conflict') }).readonly(),
  ledger: z.object({ id: ref, name: ref, owner: ref, custodianAtE0: ref, container: nodeId, key: z.object({ id: ref, holder: ref, transfer: z.literal(false), operation: ref }).readonly(), route: z.object({ orderedNodes: z.array(nodeId).readonly() }) }).readonly(),
  availability: z.object({ tools: z.array(z.object({ id: ref, owner: ref, at: nodeId }).readonly()).readonly(), channels: z.array(z.object({ id: ref, method: ref }).readonly()).readonly() }).readonly(),
}).readonly();
export const projectionShape = z.object({
  scenarioId: ref, transform: z.object({ crs: ref }),
  scenes: z.array(z.object({ id: sceneId, siteId }).readonly()).readonly(),
  nodes: z.array(z.object({ id: nodeId, sceneId }).readonly()).readonly(),
  actors: z.array(z.object({ actorId: personId, nodeId }).readonly()).readonly(),
}).readonly();
export const bodyRegion = z.enum(['left-arm', 'right-arm', 'left-leg', 'right-leg', 'head', 'torso']);
export const operationShape = z.object({
  schema: z.literal('townhall-operations.v2'), scenarioId: z.literal('townhall-s01-r2'), scope: z.array(z.enum(['S01-L', 'S01-O'])).readonly(),
  approval: z.object({ candidateSha256: digest }), startAuthorization: z.object({ status: z.literal('authorized'), receiptSha256: digest }),
  clock: clockRules, durations, evidence: evidenceRules, ordering: orderingRules, responses: responseRules, closedScopes: refs,
  authority: z.object({
    issuer: ref, duty: ref, holdingId: ref, regionId: ref, siteId, designator: personId,
    actorPlacements: z.record(personId, nodeId).readonly(), dutyPlacement: nodeId, originalCount: z.literal(1),
    keyTransfer: z.literal(false), wholeOriginal: z.literal(true), returnRequiresSeparateConsent: z.literal(true), returnStates: refs,
    noticeDistinctFromRevocation: z.literal(true), safeReturnOnlyAfterRevocation: z.literal(true),
    mandates: z.array(z.object({ id: z.enum(['S01-L', 'S01-O']), recipient: personId, grants: z.array(grantId).length(2).readonly() }).readonly()).readonly(),
  }).readonly(),
  routes: z.object({ ...routeRules, edges: z.array(z.object({ from: nodeId, to: nodeId, metres: z.number().positive(), bidirectional: z.literal(true), ledgerAllowed: z.boolean() }).readonly()).readonly() }).readonly(),
  provisions: z.object({
    ...provisionRules,
    prepayments: z.array(z.object({ id: ref, issuer: ref, recipient: ref, preservedFoodPacks: count, emergencyReservedPacks: count, waterMl: count, supportUntilSeconds: count,
      paidBeforeE0: z.literal(true), freeOwnedPacks: count, performancePay: z.literal(false), automaticClawback: z.literal(false), forcedConsent: z.literal(false) }).readonly()).readonly(),
    setup: z.object({ coverageUntilSeconds: count, mealCount: count, waterConsumedMl: count, restCompleted: z.literal(true), alreadyConsumedExcludedFromInventory: z.literal(true) }).readonly(), paper: z.array(z.object({ recipient: personId, sheets: count }).readonly()).readonly(),
  }).readonly(),
  body: z.object({ ...bodyRules, regions: z.array(bodyRegion).readonly(), initial: z.object({ effortSeconds: count, damage: z.literal('none'), function: z.literal('available'), disease: z.literal('no-active-episode-in-S01-setup') }).readonly() }).readonly(),
}).readonly();
