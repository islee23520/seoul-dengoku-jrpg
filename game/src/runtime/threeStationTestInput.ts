import { RealtimeHost, runtimeSchema } from './realtimeHost.ts';
import type { HostRules } from './realtimeHost.ts';
import { corridorEncounter } from './threeStation.ts';
import type { EncounterApplication } from './threeStation.ts';
import { BattleConflict, resultId } from '../battle/realtime.ts';
import { selectOpeningActor } from './openingScenario.ts';

/** Explicit synthetic test injection only. Never selected by production boot. */
export function threeStationTestInput(data: EncounterApplication, seed: number, participant?: unknown): RealtimeHost {
  const actor = participant === undefined ? null : selectOpeningActor(participant);
  const versions = { rulesHash: 'TESTINPUT:three-station-rules', contentHash: 'TESTINPUT:slime', approvedInputsHash: 'TESTINPUT:not-GP-approval' };
  const rules: HostRules = {
    intervalMs: 100, worldUnitsPerStep: 1, provenance: 'TESTINPUT', approvedInputsHash: versions.approvedInputsHash,
    validateApproval: context => context.provenance === 'TESTINPUT' && context.approvedInputsHash === versions.approvedInputsHash,
    advanceWorld: campaign => campaign,
    battle: {
      rulesHash: versions.rulesHash,
      authorize: () => { throw new BattleConflict('TESTINPUT:no-command-grants'); },
      resolve: (battle, tick) => ({
        effects: [], positions: [], rngCursors: battle.rngCursors, evaluationReceipts: [tick],
        terminal: {
          resultId: resultId.parse('TESTINPUT:result:' + battle.context.battleId), terminalKind: 'ordinary-victory',
          individualAndHeroFacts: [], squadLosses: [], resourceFacts: [], commandEvaluationFacts: [],
        },
      }),
    },
    encounter: corridorEncounter(data, { rate: 1, threshold: 3, context: (state, troopId) => ({
      ...versions, provenance: 'TESTINPUT', schemaVersion: 1,
      battleId: 'TESTINPUT:three-station:' + state.encounterSerial, encounterId: troopId,
      worldStartTick: state.worldTick, worldStartTime: state.worldTime,
      persons: [...(actor ? [{ id: actor.actorId, hp: 1, equipment: 0 }] : []), { id: 'TESTINPUT:slime', hp: 1, equipment: 0 }], heroes: [], squads: [],
      commandGrants: {}, formations: {}, navigation: {}, objective: {}, supplyReservations: {}, legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: {},
    }) }),
  };
  return new RealtimeHost({ mode: 'TESTINPUT', rules, settle: state => state,
    state: runtimeSchema.parse({ worldTick: 0, worldTime: 0, clockCarry: 0, encounterAccumulator: 0, encounterSerial: 0,
      purposeRngStates: { 'three-station:selection': seed }, battle: null, campaignState: {} }),
  });
}
