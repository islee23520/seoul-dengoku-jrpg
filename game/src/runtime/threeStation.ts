import { z } from '../../../engine/node_modules/zod/index.js';
import { MissingRuleInput, BattleConflict } from '../battle/realtime.ts';
import type { BattleContext } from '../battle/realtime.ts';
import type { HostRules, RuntimeState, MovementStep } from './realtimeHost.ts';

const rect = z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative(), w: z.int().positive(), h: z.int().positive() }).readonly();
const entry = z.strictObject({ troopId: z.literal('troop_slime'), weight: z.int().positive(), conditions: z.strictObject({ region: rect }).readonly() }).readonly();
export const encounterApplicationSchema = z.strictObject({
  schemaVersion: z.literal(1), provenance: z.literal('TESTINPUT'), approval: z.string().min(1),
  candidate: z.strictObject({ troopId: z.literal('troop_slime'), enemyId: z.literal('enemy_slime'), resourceId: z.literal('generated-enemy-slime-01'), usage: z.string().min(1) }).readonly(),
  maps: z.record(z.string().min(1), z.strictObject({ encounterRate: z.literal(0), troopIds: z.array(z.never()).readonly(), encounterTable: z.array(entry).readonly(), safeZones: z.array(rect).min(1).readonly() }).readonly()).readonly(),
}).readonly();
export type EncounterApplication = z.infer<typeof encounterApplicationSchema>;
type Rect = z.infer<typeof rect>;
const contains = (area: Rect, point: MovementStep): boolean => point.x >= area.x && point.y >= area.y && point.x < area.x + area.w && point.y < area.y + area.h;

export function eligibleCorridor(data: EncounterApplication, step: MovementStep): boolean {
  const map = data.maps[step.mapId];
  return Number.isSafeInteger(step.x) && Number.isSafeInteger(step.y) && !!map && !map.safeZones.some(area => contains(area, step)) && map.encounterTable.some(candidate => contains(candidate.conditions.region, step));
}

/** Pacing and participant construction are injected; no numerical production default. */
export function corridorEncounter(data: EncounterApplication, input: {
  readonly rate: number; readonly threshold: number;
  readonly context: (state: RuntimeState, troopId: string) => BattleContext;
}): HostRules['encounter'] {
  if (!Number.isFinite(input.rate) || input.rate <= 0 || !Number.isFinite(input.threshold) || input.threshold <= 0) throw new MissingRuleInput('encounter-pacing');
  return (state, step) => {
    const eligible = eligibleCorridor(data, step);
    const unchanged = { rate: input.rate, eligible, safe: !eligible, accumulator: state.encounterAccumulator, rng: state.purposeRngStates, context: null };
    if (!eligible) return unchanged;
    const next = state.encounterAccumulator + input.rate;
    if (next < input.threshold) return { ...unchanged, accumulator: next };
    const seed = state.purposeRngStates['three-station:selection'];
    if (seed === undefined) throw new MissingRuleInput('encounter-seed');
    const cursor = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const candidates = data.maps[step.mapId]?.encounterTable.filter(candidate => contains(candidate.conditions.region, step)) ?? [];
    let draw = cursor / 4294967296 * candidates.reduce((total, candidate) => total + candidate.weight, 0);
    for (const candidate of candidates) {
      draw -= candidate.weight;
      if (draw < 0) return { ...unchanged, accumulator: 0, rng: { ...state.purposeRngStates, 'three-station:selection': cursor }, context: input.context(state, candidate.troopId) };
    }
    throw new BattleConflict('encounter-selection');
  };
}

export type Transfer = { readonly mapId: string; readonly x: number; readonly y: number };
export type Exit = { readonly x: number; readonly y: number; readonly target: Transfer };
/** Only actual graph-derived authored exits are admitted, never geometric proximity. */
export function requestTransfer(exits: readonly Exit[], input: { readonly position: Transfer; readonly targetMapId: string }): Transfer {
  const exit = exits.find(candidate => candidate.target.mapId === input.targetMapId && candidate.x === input.position.x && candidate.y === input.position.y);
  if (!exit) throw new BattleConflict('not-at-graph-exit');
  return exit.target;
}
