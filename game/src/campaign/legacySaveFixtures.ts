import { readFile } from 'node:fs/promises';
import { z } from '../../../engine/node_modules/zod/index.js';
import { checkpoint } from '../save/campaignCheckpoint.ts';
import { runtimeSchema } from '../runtime/realtimeHost.ts';
import { stationSchema } from '../runtime/stationState.ts';
import { integer } from '../domain/ids.ts';
import { content } from './testFixtures.ts';
import type { LegacyMigrationContext } from './saveMigration.ts';

export const legacyGraphSource = await readFile(new URL('../../data/world/graph.json', import.meta.url), 'utf8');
const graph = z.object({ stations: z.array(z.object({ id: z.string() })), edges: z.array(z.object({ a: z.string(), b: z.string() })) }).parse(JSON.parse(legacyGraphSource));
export const legacyContext: LegacyMigrationContext = {
  content, legacyGraphSource, versions: { rulesHash: 'TESTINPUT:battle', contentHash: 'TESTINPUT:content', approvedInputsHash: 'TESTINPUT:approval' },
  worldRules: { versions: { schemaVersion: integer('SchemaVersion', 1), ruleVersion: 'TESTINPUT:world', contentVersion: 'TESTINPUT:content' },
    graph, cut: [], acceptSupply: null,
    authority() { throw new TypeError('No active legacy order in this fixture'); },
    execution: { provenance: 'TESTINPUT', ruleVersion: 'TESTINPUT:world', conflictPolicy: 'wait-for-availability',
      travelSteps: null, workSteps: null, acceptance: null, ready: null, admission: null } },
};

/** The real v1 checkpoint writer with the actual worldClock contract, not composed S01. */
export function legacyCheckpoint(stationId: string, worldTime = 990000) {
  const versions = legacyContext.worldRules.versions;
  return checkpoint(runtimeSchema.parse({ worldTick: 0, worldTime, clockCarry: 7, encounterAccumulator: 0.25,
    encounterSerial: 3, purposeRngStates: { encounter: 17 }, battle: null,
    campaignState: { facts: { watermark: 0, ruleVersion: versions.ruleVersion, orders: [], shipments: [], receipts: [],
      stations: [stationSchema.parse({ id: stationId, population: 12, supply: { food: 4 }, infrastructure: { road: 2 },
        threat: [], controlFaction: null, roles: [], appliedResultIds: [] })],
      ledger: { ...versions, entries: [], pendingResultIds: [] } }, settlementReceipts: [], ledgerCursor: 0 },
  }), { versions: legacyContext.versions, engineProjection: null });
}
