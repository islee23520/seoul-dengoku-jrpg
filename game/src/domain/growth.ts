import { z } from '../../../engine/node_modules/zod/index.js';
import type { EventLedger, LedgerEntry } from './eventLedger.ts';
import type { PersonId, ResultId, WorldTick } from './ids.ts';
import { id } from './ids.ts';
import type { Grant, ServiceRelation } from './authority.ts';
import { executableRetainers } from './authority.ts';
import type { Mandate } from './mandate.ts';
import { assertMandateAuthority } from './mandate.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';

// Structural ActorRecord projection (database.ts): no engine defaults or formulas.
export const parameterKeys = ['maxHp', 'maxMp', 'attack', 'defense', 'mind', 'agility'] as const;
export type Parameters = Readonly<Record<typeof parameterKeys[number], number>>;
export type ActorGrowthCurves = {
  readonly parameterCurves: Readonly<Record<typeof parameterKeys[number], readonly number[]>>;
  readonly expCurve: { readonly base: number; readonly extra: number; readonly acceleration: number };
  readonly maxLevel: number;
};
export type GrowthRules = {
  readonly curves: ActorGrowthCurves;
  readonly xp: Readonly<Record<'victory' | 'work-resolution', number | undefined>>;
  readonly threshold: (curve: ActorGrowthCurves['expCurve'], level: number) => number;
  readonly parameters: (curves: ActorGrowthCurves['parameterCurves'], level: number) => Parameters;
  readonly perkEffects: Readonly<Record<string, Partial<Parameters> | undefined>>;
};
const focusSchema = z.strictObject({
  focus: z.string().min(1).nullable(), perks: z.array(z.string().min(1)).max(3).readonly(),
}).superRefine((value, ctx) => {
  if ((!value.focus && value.perks.length) || new Set(value.perks).size !== value.perks.length) {
    ctx.addIssue({ code: 'custom', message: 'single-focus-perks' });
  }
}).readonly();
export type GrowthFocus = z.infer<typeof focusSchema>;
export function parseGrowthFocus(value: unknown): GrowthFocus { return focusSchema.parse(value); }
export type GrowthState = {
  readonly person: PersonId; readonly xp: number; readonly level: number; readonly parameters: Parameters;
  readonly focus: GrowthFocus; readonly appliedResults: readonly ResultId[];
};
export type GrowthProjection =
  | { readonly kind: 'applied'; readonly state: GrowthState }
  | { readonly kind: 'blocked'; readonly state: GrowthState; readonly error: MissingRuleInput };

function xpSource(entry: LedgerEntry): 'victory' | 'work-resolution' | null {
  switch (entry.command) {
    case 'victory': case 'work-resolution': return entry.command;
    case 'order-step': {
      // task13 records each lifecycle stage; award once, at actual result application.
      const result = z.object({ mandate: z.object({ stage: z.literal('result-applied') }) }).safeParse(entry.payload);
      return result.success ? 'work-resolution' : null;
    }
    default: return null; // Unrelated ledger commands are intentionally not growth inputs.
  }
}

// Fold only committed ledger results. Missing reflection inputs block the whole
// projection, including level and XP: a retry with approved rules loses no award.
export function projectGrowth(state: GrowthState, ledger: EventLedger, rules?: GrowthRules): GrowthProjection {
  try {
    parseGrowthFocus(state.focus);
    if (!rules) throw new MissingRuleInput('GrowthRules');
    let xp = state.xp;
    const applied = new Set(state.appliedResults);
    for (const entry of ledger.entries) {
      if (entry.actor !== state.person || applied.has(entry.resultId)) continue;
      const source = xpSource(entry);
      if (source === null) continue;
      const award = rules.xp[source];
      if (award === undefined) throw new MissingRuleInput('GrowthRules.xp.' + source);
      if (!Number.isFinite(award) || award < 0) throw new InvariantViolation('growth-xp');
      xp += award;
      applied.add(entry.resultId);
    }
    if (!Number.isFinite(xp) || xp < 0 || !Number.isSafeInteger(state.level) || state.level < 1 ||
      !Number.isSafeInteger(rules.curves.maxLevel) || rules.curves.maxLevel < state.level) throw new InvariantViolation('growth-state');
    let level = state.level;
    let previousThreshold = -Infinity;
    while (level < rules.curves.maxLevel) {
      const threshold = rules.threshold(rules.curves.expCurve, level + 1);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold <= previousThreshold) throw new InvariantViolation('growth-threshold');
      if (xp < threshold) break;
      previousThreshold = threshold;
      level += 1;
    }
    // Curves are reflected atomically, never a level with stale parameters.
    const base = rules.parameters(rules.curves.parameterCurves, level);
    const effects = state.focus.perks.map(perk => {
      const effect = rules.perkEffects[perk];
      if (!effect) throw new MissingRuleInput('GrowthRules.perkEffects.' + perk);
      return effect;
    });
    const parameters = { ...base };
    for (const key of parameterKeys) {
      parameters[key] += effects.reduce((sum, effect) => sum + (effect[key] ?? 0), 0);
      if (!Number.isFinite(parameters[key])) throw new InvariantViolation('growth-parameter');
    }
    return { kind: 'applied', state: { ...state, xp, level, parameters, appliedResults: [...applied] } };
  } catch (error) {
    if (error instanceof MissingRuleInput) return { kind: 'blocked', state, error };
    throw error;
  }
}

const serviceFactSchema = z.strictObject({
  principal: z.string().min(1).transform(value => id('PersonId', value)),
  personId: z.string().min(1).transform(value => id('PersonId', value)),
  role: z.literal('household-retainer'),
  disposition: z.enum(['active', 'retired-current']),
}).readonly();
// S06: recruitment/retention/release facts replace service state, never add a
// stat-derived slot count. Receipt/arrival/maintenance are upstream obligations.
export function delegationCapacity(ledger: EventLedger, context: {
  readonly grant: Grant; readonly now: WorldTick; readonly mandate: Mandate;
}): readonly PersonId[] {
  const services: ServiceRelation[] = [];
  for (const entry of ledger.entries) {
    switch (entry.command) {
      case 'service-recruited': case 'service-retained': case 'service-released': {
        const fact = serviceFactSchema.parse(entry.payload);
        if (entry.actor !== fact.principal || entry.target !== fact.personId ||
          (entry.command === 'service-released' ? fact.disposition !== 'retired-current' : fact.disposition !== 'active')) {
          throw new InvariantViolation('growth-service-fact');
        }
        const previous = services.findIndex(service => service.principal === fact.principal && service.personId === fact.personId);
        const service = { ...fact, causeId: entry.causeId };
        if (previous < 0) services.push(service); else services[previous] = service;
        break;
      }
      default: break;
    }
  }
  assertMandateAuthority(context.mandate, context.grant, context.now);
  return executableRetainers(services, context.grant, context.now);
}
