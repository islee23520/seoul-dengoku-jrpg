import { z } from '../../../engine/node_modules/zod/index.js';
import { sha256 } from '../../../engine/node_modules/@noble/hashes/sha2.js';
import { canonicalJson, summaryHash } from '../domain/eventLedger.ts';
import { CheckpointCorrupt as LedgerCorrupt, InvariantViolation, VersionMismatch } from '../domain/errors.ts';
import { CheckpointCorrupt, restoreCheckpoint, campaignSchema } from '../save/campaignCheckpoint.ts';
import type { CampaignCheckpoint, CheckpointStorage, Versions } from '../save/campaignCheckpoint.ts';
import { parseSaveJson, readCheckpoint, writeCheckpoint } from '../save/checkpointStorage.ts';
import { restoreWorld } from '../runtime/worldClock.ts';
import type { WorldRules } from '../runtime/worldClock.ts';
import type { RealtimeHost } from '../runtime/realtimeHost.ts';
import { assertAdmittedContent } from './content.ts';
import type { CampaignContent } from './content.ts';
import { CampaignBoundaryError, ownInput } from './errors.ts';

export const LEGACY_MIGRATION_NAMESPACE = 'seoul-legacy-world-v2';
export type LegacyMigrationContext = {
  readonly content: CampaignContent;
  readonly versions: Versions;
  readonly legacyGraphSource: string;
  /** The previous runtime's rules and graph, never the S01 clock or newly guessed rates. */
  readonly worldRules: WorldRules;
};
type Resolution = { readonly oldId: string; readonly newId: string; readonly status: 'exact' | 'authenticated-alias' };
export type LegacyWorldSave = {
  readonly namespace: typeof LEGACY_MIGRATION_NAMESPACE;
  readonly envelopeVersion: 2;
  readonly original: string;
  readonly legacy: CampaignCheckpoint;
  readonly provenance: {
    readonly sourceChecksum: string;
    readonly identityMapHash: string;
    readonly targetEdition: string;
    readonly stations: readonly Resolution[];
    readonly timeline: 'preserve-legacy-units-no-S01-rebase';
  };
  readonly checksum: string;
};
export type LegacyImport =
  | { readonly kind: 'migrated'; readonly save: LegacyWorldSave }
  | { readonly kind: 'quarantined'; readonly reason: string; readonly original: string; readonly legacy: CampaignCheckpoint | null };

/** No host/storage mutation. Original bytes are the export, including invalid JSON. */
export function migrateLegacySave(original: string, context: LegacyMigrationContext): LegacyImport {
  let legacy: CampaignCheckpoint | null = null;
  try {
    if (Object.getPrototypeOf(context) !== Object.prototype ||
        !['content', 'versions', 'worldRules', 'legacyGraphSource'].every(key => {
          const descriptor = Object.getOwnPropertyDescriptor(context, key);
          return descriptor !== undefined && 'value' in descriptor;
        })) throw new CheckpointCorrupt('inherited-option');
    assertAdmittedContent(context.content);
    const graphHash = Array.from(sha256(new TextEncoder().encode(context.legacyGraphSource)), n => n.toString(16).padStart(2, '0')).join('');
    if (graphHash !== context.content.data.identities.legacyEdition.graphSha256) throw new CheckpointCorrupt('legacy-graph-hash');
    const graph = z.object({ stations: z.array(z.object({ id: z.string() })), edges: z.array(z.object({ a: z.string(), b: z.string() })) })
      .parse(parseSaveJson(context.legacyGraphSource));
    const suppliedGraph = { stations: context.worldRules.graph.stations.map(s => ({ id: s.id })),
      edges: context.worldRules.graph.edges.map(e => ({ a: e.a, b: e.b })) };
    if (summaryHash(graph) !== summaryHash(suppliedGraph)) throw new CheckpointCorrupt('legacy-graph-contract');
    legacy = restoreCheckpoint(parseSaveJson(original), context.versions);
    if (legacy.runtime.battle !== null) throw new CheckpointCorrupt('unsupported-legacy-battle');
    if (legacy.engineProjection !== null) throw new CheckpointCorrupt('unsupported-engine-placement');
    const world = restoreWorld(campaignSchema.parse(legacy.runtime.campaignState).facts, context.worldRules);
    if (world.watermark !== legacy.runtime.worldTick) throw new CheckpointCorrupt('world-host-watermark');
    for (const station of world.stations) {
      if (!graph.stations.some(s => s.id === station.id) ||
          station.appliedResultIds.some(id => !world.ledger.entries.some(e => e.resultId === id)) ||
          station.roles.some(role => !world.orders.some(o => o.mandate.orderId === role.orderId))) throw new CheckpointCorrupt('legacy-station-link');
    }
    for (const receipt of world.receipts) {
      const order = world.orders.find(o => o.mandate.orderId === receipt.orderId);
      const entry = world.ledger.entries.find(e => e.resultId === receipt.resultId);
      if (!order || !entry || entry.target !== order.mandate.orderId || entry.worldTime !== receipt.tick ||
          !order.mandate.appliedResultIds.includes(entry.resultId)) throw new CheckpointCorrupt('legacy-receipt-link');
    }
    for (const shipment of world.shipments) {
      if (!world.orders.some(o => o.mandate.orderId === shipment.orderId) ||
          (shipment.acceptedResultId !== null && !world.ledger.entries.some(e => e.resultId === shipment.acceptedResultId))) {
        throw new CheckpointCorrupt('legacy-shipment-link');
      }
    }
    // Active route execution requires placement/rate compatibility which task2 does not approve.
    if (world.orders.some(o => !['receipt', 'refused', 'cancelled', 'interrupted', 'expired'].includes(o.mandate.stage)) ||
        world.shipments.some(s => s.acceptedResultId === null)) throw new CheckpointCorrupt('unsupported-active-route');
    const ids = new Set(world.stations.map(s => String(s.id)));
    for (const order of world.orders) {
      for (const station of [...order.journey.path, ...order.workPath, ...order.reportPath, ...order.mandate.communicationRoute,
        order.mandate.issuerLocation, order.mandate.recipientLocation, order.mandate.physicalLocation]) ids.add(station);
    }
    for (const shipment of world.shipments) for (const station of [...shipment.journey.path, shipment.source, shipment.destination]) ids.add(station);
    const stations: Resolution[] = [];
    for (const oldId of [...ids].sort()) {
      const matches = context.content.data.identities.stations.filter(row => row.oldId === oldId);
      const row = matches[0];
      if (matches.length !== 1 || row === undefined || row.status === 'excluded') throw new CheckpointCorrupt('unsupported-station-identity');
      if (!context.content.data.atlas.stations.some(s => s.id === row.newId)) throw new CheckpointCorrupt('target-station-link');
      stations.push({ oldId, newId: row.newId, status: row.status });
    }
    if (new Set(stations.map(s => s.newId)).size !== stations.length) throw new CheckpointCorrupt('ambiguous-station-merge');
    // Runtime, facts, ledger, receipts and engine snapshot are never rewritten under a new hash history.
    const payload: Omit<LegacyWorldSave, 'checksum'> = { namespace: LEGACY_MIGRATION_NAMESPACE, envelopeVersion: 2, original, legacy,
      provenance: { sourceChecksum: legacy.checksum, identityMapHash: context.content.hashes.identities,
        targetEdition: context.content.data.atlas.edition, stations, timeline: 'preserve-legacy-units-no-S01-rebase' as const } };
    return { kind: 'migrated', save: { ...payload, checksum: summaryHash(payload) } };
  } catch (error) {
    if (error instanceof CheckpointCorrupt || error instanceof CampaignBoundaryError || error instanceof LedgerCorrupt ||
        error instanceof InvariantViolation || error instanceof VersionMismatch || error instanceof z.ZodError) {
      return { kind: 'quarantined', reason: error instanceof z.ZodError ? 'unsupported-legacy-facts' : error.message, original, legacy };
    }
    throw error;
  }
}

const storedShape = z.object({ original: z.string() });
export function parseLegacyWorldSave(input: unknown, context: LegacyMigrationContext): LegacyWorldSave {
  ownInput(input);
  const parsed = storedShape.safeParse(input);
  if (!parsed.success) throw new CheckpointCorrupt('legacy-migration-shape');
  const migrated = migrateLegacySave(parsed.data.original, context);
  if (migrated.kind === 'quarantined') throw new CheckpointCorrupt(migrated.reason);
  const json = z.json().safeParse(input);
  if (!json.success || canonicalJson(json.data) !== canonicalJson(migrated.save)) throw new CheckpointCorrupt('migration-provenance');
  return migrated.save;
}
export function persistLegacyWorldSave(storage: CheckpointStorage, input: unknown, context: LegacyMigrationContext): LegacyWorldSave {
  return writeCheckpoint(storage, input, { namespace: LEGACY_MIGRATION_NAMESPACE,
    parse: value => parseLegacyWorldSave(value, context), checksum: value => value.checksum });
}
export function loadLegacyWorldSave(storage: CheckpointStorage, context: LegacyMigrationContext): LegacyWorldSave {
  return readCheckpoint(storage, { namespace: LEGACY_MIGRATION_NAMESPACE,
    parse: value => parseLegacyWorldSave(value, context), checksum: value => value.checksum });
}
/** Install only after complete old-contract and target-link validation. No elapsed/offline argument. */
export function restoreLegacyWorldSave(host: RealtimeHost, input: unknown, context: LegacyMigrationContext): LegacyWorldSave {
  const save = parseLegacyWorldSave(input, context);
  host.replace(save.legacy.runtime);
  return save;
}
