import type { PersonId, StationId } from './ids.ts';
import type { EventLedger, LedgerEntry } from './eventLedger.ts';
import { summaryHash } from './eventLedger.ts';
import { assertNever, InvariantViolation, MissingRuleInput } from './errors.ts';
import { classifyOpinion } from './relation.ts';
import type { Relations } from './relation.ts';
import { economySchema, economyEventSchema } from './stationGoods.ts';
import type { EconomyEvent, StationEconomy, StationGood } from './stationGoods.ts';

export type InvestmentPolicy = {
  readonly threshold: number;
  readonly allowedTrust: readonly ReturnType<typeof classifyOpinion>[];
  readonly facilities: readonly string[];
  readonly materials: readonly string[];
  readonly defense: number;
  readonly share: number;
  readonly visibleChange: string;
};
// Callbacks own all base rates and stock-response coefficients. No production defaults.
export type EconomyRules = {
  readonly provenance: 'TESTINPUT' | 'APPROVED_GP';
  readonly ruleVersion: string;
  readonly price?: (input: { readonly good: StationGood; readonly event: EconomyEvent; readonly state: StationEconomy }) => number;
  readonly investment?: (input: { readonly stationId: StationId; readonly sector: 'commercial' | 'military' }) => InvestmentPolicy;
};
export type EconomyContext = {
  readonly rules?: EconomyRules;
  readonly relations: Relations;
  readonly representative: PersonId;
};

function projectEconomy(state: StationEconomy, event: EconomyEvent, context: EconomyContext): StationEconomy {
  const current = economySchema.parse(state), action = economyEventSchema.parse(event);
  if (current.appliedResultIds.includes(action.resultId)) throw new InvariantViolation('economy-result-reused');
  let next = current;
  let targetGoodId: string | null = null;
  switch (action.kind) {
    case 'trade': {
      const good = current.goods.find(g => g.id === action.goodId);
      if (!good || good.stock < action.quantity) throw new InvariantViolation('economy-stock');
      next = { ...current, goods: current.goods.map(g => g.id === good.id ? { ...g, stock: g.stock - action.quantity } : g) };
      break;
    }
    case 'condition': {
      if (action.cause !== action.condition.cause) throw new InvariantViolation('economy-condition-cause');
      targetGoodId = action.condition.goodId;
      next = { ...current, conditions: [...current.conditions, action.condition] };
      break;
    }
    case 'investment': {
      const resolve = context.rules?.investment;
      if (!resolve) throw new MissingRuleInput('EconomyRules.investment');
      const policy = resolve({ stationId: current.stationId, sector: action.sector });
      if (![policy.threshold, policy.defense, policy.share].every(n => Number.isFinite(n) && n >= 0) ||
        !policy.visibleChange.trim() || policy.facilities.some(f => !current.availableFacilities.includes(f)) ||
        (action.sector === 'commercial' && policy.defense !== 0) ||
        (action.sector === 'military' && (policy.facilities.length > 0 || policy.materials.length > 0))) throw new InvariantViolation('economy-investment-policy');
      const previous = current.investments.find(i => i.investor === action.investor && i.sector === action.sector);
      const total = (previous?.amount ?? 0) + action.amount;
      const trust = context.relations.trust.find(t => t.from === context.representative && t.to === action.investor)?.value ?? 0;
      const unlock = total >= policy.threshold && policy.allowedTrust.includes(classifyOpinion(trust));
      const newlyUnlocked = unlock && !current.visibleChanges.includes(policy.visibleChange);
      next = { ...current,
        investments: [...current.investments.filter(i => i !== previous), { investor: action.investor, sector: action.sector, amount: total, share: unlock ? policy.share : previous?.share ?? 0 }],
        unlockedFacilities: newlyUnlocked ? [...new Set([...current.unlockedFacilities, ...policy.facilities])] : current.unlockedFacilities,
        materials: newlyUnlocked ? [...new Set([...current.materials, ...policy.materials])] : current.materials,
        defense: newlyUnlocked ? current.defense + policy.defense : current.defense,
        visibleChanges: newlyUnlocked ? [...current.visibleChanges, policy.visibleChange] : current.visibleChanges };
      break;
    }
    default: return assertNever(action);
  }
  switch (action.kind) {
    case 'trade': break; // Structural stock accounting does not guess a price response.
    case 'condition':
    case 'investment': {
      const price = context.rules?.price;
      if (!price) throw new MissingRuleInput('EconomyRules.price');
      const goods = next.goods.map(good => {
        if (targetGoodId !== null && good.id !== targetGoodId) return good;
        const value = price({ good, event: action, state: next });
        if (!Number.isFinite(value) || value < 0) throw new InvariantViolation('economy-price');
        return { ...good, price: value };
      });
      if (targetGoodId !== null && !goods.some(g => g.id === targetGoodId)) throw new InvariantViolation('economy-good-missing');
      next = { ...next, goods, priceChanges: [...current.priceChanges, ...goods.flatMap(g => {
        const before = current.goods.find(old => old.id === g.id);
        return before && before.price !== g.price ? [{ resultId: action.resultId, goodId: g.id, before: before.price, after: g.price, cause: action.cause }] : [];
      })] };
      break;
    }
    default: return assertNever(action);
  }
  return economySchema.parse({ ...next, appliedResultIds: [...current.appliedResultIds, action.resultId] });
}

export function economyEntry(state: StationEconomy, event: EconomyEvent, input: {
  readonly context: EconomyContext;
  readonly metadata: Omit<LedgerEntry, 'target' | 'payload' | 'resultId' | 'causeId' | 'afterHash'>;
}): LedgerEntry {
  const economy = projectEconomy(state, event, input.context);
  if (input.context.rules && input.context.rules.ruleVersion !== input.metadata.ruleVersion) throw new InvariantViolation('economy-rule-version');
  const payload = { economyBeforeHash: summaryHash(state), event: economyEventSchema.parse(event), economy };
  return { ...input.metadata, target: state.stationId, resultId: event.resultId, causeId: event.causeId, payload, afterHash: summaryHash(payload) };
}

/** Only exact committed payloads can change world facts, including prices. */
export function transitionEconomy(state: StationEconomy, event: EconomyEvent, input: {
  readonly ledger: EventLedger; readonly context: EconomyContext;
}): StationEconomy {
  const entry = input.ledger.entries.find(e => e.resultId === event.resultId);
  if (!entry || entry.target !== state.stationId || entry.causeId !== event.causeId) throw new InvariantViolation('economy-ledger-result');
  const next = projectEconomy(state, event, input.context);
  const expected = { economyBeforeHash: summaryHash(state), event: economyEventSchema.parse(event), economy: next };
  if (summaryHash(entry.payload) !== summaryHash(expected) || entry.afterHash !== summaryHash(expected) ||
    (input.context.rules && entry.ruleVersion !== input.context.rules.ruleVersion)) throw new InvariantViolation('economy-result-chain');
  return next;
}
