import { z } from '../../../engine/node_modules/zod/index.js';
import { sha256 } from '../../../engine/node_modules/@noble/hashes/sha2.js';
import type { Grant } from '../domain/authority.ts';
import type { ResultId } from '../domain/ids.ts';

export class MissingRuleInput extends Error {
  readonly ruleKey: string;
  constructor(ruleKey: string) { super(ruleKey); this.name = 'MissingRuleInput'; this.ruleKey = ruleKey; }
}
export class BattleConflict extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.name = 'BattleConflict'; this.reason = reason; }
}
export const ref = z.string().min(1);
export const count = z.int().nonnegative();
export const json = z.json().transform((value): Json => immutableJson(value));
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
function immutableJson(value: Json): Json {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableJson(item)])));
}
export function canonical(value: Json): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': case 'string': return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new BattleConflict('nonfinite-json');
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
    default: throw new BattleConflict('non-json');
  }
}
export function hash(value: Json): string {
  return Array.from(sha256(new TextEncoder().encode(canonical(value))), n => n.toString(16).padStart(2, '0')).join('');
}
const person = z.strictObject({ id: ref, hp: count, equipment: count }).readonly();
const squad = z.strictObject({ id: ref, population: count, supply: count, x: z.number(), y: z.number(), meleeLocked: z.boolean() }).readonly();
const hero = z.strictObject({ id: ref, personId: ref, x: z.number(), y: z.number() }).readonly();
export const contextSchema = z.strictObject({
  battleId: ref, encounterId: ref, worldStartTick: count, worldStartTime: z.number().nonnegative(),
  schemaVersion: z.literal(1), rulesHash: ref, contentHash: ref, approvedInputsHash: ref,
  provenance: z.enum(['TESTINPUT', 'CANON']), persons: z.array(person).readonly(), heroes: z.array(hero).readonly(), squads: z.array(squad).readonly(),
  commandGrants: json, formations: json, navigation: json, objective: json, supplyReservations: json,
  legalFallbackRoutes: json, reinforcementConditions: json, purposeRng: z.record(ref, count).readonly(),
}).readonly();
export type BattleContext = z.infer<typeof contextSchema>;
export const intentSchema = z.strictObject({
  commandId: ref, originPersonId: ref, contextHash: ref, observationVersion: count,
  selectedUnitIds: z.array(ref).min(1).readonly(),
  kind: z.enum(['move', 'attack-target', 'fire', 'ambush', 'battle-retreat', 'surrender-proposal', 'surrender-response']),
  targetOrPath: json, parentSignalId: ref,
}).readonly();
export type CommanderIntent = z.infer<typeof intentSchema>;
const accepted = z.strictObject({ intent: intentSchema, sequence: count, acceptedWorldTick: count, effectiveNextTick: count }).readonly();
const receipt = z.strictObject({ commandId: ref, sequence: count, replacedBy: ref.nullable(), executedAt: count.nullable() }).readonly();
export const resultId = z.custom<ResultId>((value: unknown) => typeof value === 'string' && value.length > 0);
export const outcomeSchema = z.strictObject({
  battleId: ref, resultId, contextHash: ref, rulesHash: ref, payloadHash: ref,
  terminalKind: z.enum(['ordinary-victory', 'ordinary-defeat', 'ordered-retreat', 'morale-rout', 'accepted-surrender']),
  individualAndHeroFacts: json, squadLosses: json, resourceFacts: json, commandEvaluationFacts: json,
}).readonly();
export type BattleOutcome = z.infer<typeof outcomeSchema>;
export const battleSchema = z.strictObject({
  context: contextSchema, stepIndex: count, persons: z.array(person).readonly(), heroes: z.array(hero).readonly(), squads: z.array(squad).readonly(),
  currentOrders: z.record(ref, accepted).readonly(), acceptedLog: z.array(accepted).readonly(), appliedCursor: count,
  signalReceipts: z.array(receipt).readonly(), evaluationReceipts: z.array(json).readonly(),
  attackApplications: z.record(ref, z.enum(['personal', 'aggregate'])).readonly(), rngCursors: z.record(ref, count).readonly(), outcome: outcomeSchema.nullable(),
}).readonly();
export type BattleState = z.infer<typeof battleSchema>;
export type Effect = {
  readonly attackId: string; readonly targetId: string; readonly kind: 'hp' | 'population' | 'equipment' | 'supply';
  readonly owner: 'personal' | 'aggregate'; readonly amount: number;
};
export type Resolution = {
  readonly effects: readonly Effect[];
  readonly positions: readonly { readonly unitId: string; readonly x: number; readonly y: number }[];
  readonly rngCursors: Readonly<Record<string, number>>; readonly evaluationReceipts: readonly Json[];
  readonly terminal: Omit<BattleOutcome, 'battleId' | 'contextHash' | 'rulesHash' | 'payloadHash'> | null;
};
export type BattleRules = {
  readonly rulesHash: string;
  readonly authorize: (state: BattleState, intent: CommanderIntent, tick: number) => Grant;
  readonly resolve: (state: BattleState, tick: number) => Resolution;
};
export function startBattle(context: BattleContext): BattleState {
  const copy = contextSchema.parse(context);
  const ids = [...copy.persons, ...copy.squads, ...copy.heroes].map(x => x.id);
  if (new Set(ids).size !== ids.length || copy.heroes.some(h => !copy.persons.some(p => p.id === h.personId))) throw new BattleConflict('participant-identity');
  return battleSchema.parse({ context: copy, stepIndex: 0, persons: copy.persons, heroes: copy.heroes, squads: copy.squads, currentOrders: {}, acceptedLog: [], appliedCursor: 0,
    signalReceipts: [], evaluationReceipts: [], attackApplications: {}, rngCursors: copy.purposeRng, outcome: null });
}
export function previewIntent(state: BattleState, intent: CommanderIntent, input: { readonly tick: number; readonly rules: BattleRules }): void {
  intentSchema.parse(intent);
  if (input.rules.rulesHash !== state.context.rulesHash) throw new MissingRuleInput('GP-11-resolution');
  if (state.outcome || intent.contextHash !== hash(state.context) || intent.observationVersion !== state.stepIndex || new Set(intent.selectedUnitIds).size !== intent.selectedUnitIds.length) throw new BattleConflict('stale-intent');
  const grant = input.rules.authorize(state, intent, input.tick);
  if (grant.state !== 'valid' || grant.basis.kind !== 'command' || grant.grantor !== intent.originPersonId || input.tick < grant.effectiveAt || input.tick >= grant.expiresAt || !grant.scope.includes(intent.kind)) throw new BattleConflict('command-authority');
  for (const unitId of intent.selectedUnitIds) {
    const unit = state.squads.find(s => s.id === unitId) ?? state.heroes.find(h => h.id === unitId);
    if (!unit || !grant.assets.includes(unitId)) throw new BattleConflict('command-scope');
    if ('meleeLocked' in unit && unit.meleeLocked) throw new BattleConflict('melee-lock');
  }
}
export function confirmIntent(state: BattleState, intent: CommanderIntent, input: { readonly tick: number; readonly rules: BattleRules }): BattleState {
  previewIntent(state, intent, input);
  if (state.acceptedLog.some(a => a.intent.commandId === intent.commandId)) throw new BattleConflict('duplicate-command');
  const command = { intent: intentSchema.parse(intent), sequence: state.acceptedLog.length + 1, acceptedWorldTick: input.tick, effectiveNextTick: input.tick + 1 };
  const replacements = new Set(state.acceptedLog.filter(a => a.sequence > state.appliedCursor && a.intent.selectedUnitIds.some(id => intent.selectedUnitIds.includes(id))).map(a => a.intent.commandId));
  return battleSchema.parse({ ...state, acceptedLog: [...state.acceptedLog, command], signalReceipts: [
    ...state.signalReceipts.map(r => replacements.has(r.commandId) ? { ...r, replacedBy: intent.commandId } : r),
    { commandId: intent.commandId, sequence: command.sequence, replacedBy: null, executedAt: null },
  ] });
}
export function stepBattle(state: BattleState, tick: number, rules: BattleRules | null): BattleState {
  if (state.outcome) return state;
  if (!rules || rules.rulesHash !== state.context.rulesHash) throw new MissingRuleInput('GP-11-resolution');
  const orders = { ...state.currentOrders };
  let cursor = state.appliedCursor;
  for (const command of state.acceptedLog) {
    if (command.sequence <= cursor || command.effectiveNextTick > tick) continue;
    for (const id of command.intent.selectedUnitIds) orders[id] = command;
    cursor = command.sequence;
  }
  const staged = { ...state, currentOrders: orders, appliedCursor: cursor };
  const resolved = rules.resolve(staged, tick);
  let persons = [...state.persons]; let squads = [...state.squads]; let heroes = [...state.heroes];
  const applications = { ...state.attackApplications };
  for (const effect of resolved.effects) {
    const key = canonical([state.context.battleId, effect.attackId, effect.targetId, effect.kind]);
    const previousOwner = applications[key];
    if (previousOwner && previousOwner !== effect.owner) throw new BattleConflict('duplicate-effect-channel');
    if (previousOwner) continue;
    if (!Number.isSafeInteger(effect.amount) || effect.amount < 0) throw new BattleConflict('effect-amount');
    switch (effect.kind) {
      case 'hp': case 'equipment': {
        const target = persons.find(p => p.id === effect.targetId);
        if (!target) throw new BattleConflict('person-target');
        const kind = effect.kind;
        persons = persons.map(p => p.id === target.id ? { ...p, [kind]: Math.max(0, p[kind] - effect.amount) } : p);
        break;
      }
      case 'population': case 'supply': {
        const target = squads.find(s => s.id === effect.targetId);
        if (!target) throw new BattleConflict('squad-target');
        const kind = effect.kind;
        squads = squads.map(s => s.id === target.id ? { ...s, [kind]: Math.max(0, s[kind] - effect.amount) } : s);
        break;
      }
      default: effect.kind satisfies never;
    }
    applications[key] = effect.owner;
  }
  for (const position of resolved.positions) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || ![...squads, ...heroes].some(u => u.id === position.unitId)) throw new BattleConflict('position');
    squads = squads.map(s => s.id === position.unitId ? { ...s, x: position.x, y: position.y } : s);
    heroes = heroes.map(h => h.id === position.unitId ? { ...h, x: position.x, y: position.y } : h);
  }
  const terminal = resolved.terminal;
  const payload = terminal === null ? null : { resultId: terminal.resultId, terminalKind: terminal.terminalKind,
    individualAndHeroFacts: terminal.individualAndHeroFacts, squadLosses: terminal.squadLosses,
    resourceFacts: terminal.resourceFacts, commandEvaluationFacts: terminal.commandEvaluationFacts,
    battleId: state.context.battleId, contextHash: hash(state.context), rulesHash: state.context.rulesHash };
  const outcome = payload === null ? null : outcomeSchema.parse({ ...payload, payloadHash: hash(payload) });
  return battleSchema.parse({ ...staged, stepIndex: state.stepIndex + 1, persons, squads, heroes, rngCursors: resolved.rngCursors,
    signalReceipts: state.signalReceipts.map(r => Object.values(orders).some(o => o.sequence === r.sequence) && r.executedAt === null ? { ...r, executedAt: tick } : r),
    evaluationReceipts: [...state.evaluationReceipts, ...resolved.evaluationReceipts], attackApplications: applications, outcome });
}
