import type { CauseId, PersonId } from './ids.ts';
import { InvariantViolation, MissingRuleInput, assertNever, requireCause } from './errors.ts';

// game-thesis source.b5/b6: scales and body parts, not effect formulas.
export const abilityNames = ['leadership', 'strategy', 'negotiation', 'administration', 'insight', 'learning', 'dexterity', 'constitution'] as const;
export type Ability = typeof abilityNames[number];
export type Abilities = Readonly<Record<Ability, number>>;
export const bodyParts = ['left-arm', 'right-arm', 'left-leg', 'right-leg', 'head', 'torso'] as const;
export type BodyPart = typeof bodyParts[number];
export type BodyState = {
  readonly damage: Readonly<Record<BodyPart, string>>;
  readonly function: Readonly<Record<BodyPart, string>>;
  readonly diseases: readonly { readonly name: string; readonly progression: string; readonly causeId: CauseId }[];
};
export type Trait = { readonly name: string; readonly causeId: CauseId };
export type Character = {
  readonly id: PersonId;
  readonly alive: boolean;
  readonly captive: boolean;
  readonly conscious: boolean;
  readonly agency: boolean;
  readonly baseAbilities: Abilities;
  readonly finalAbilities: Abilities;
  readonly skills: Readonly<Record<string, number>>;
  readonly traits: readonly Trait[];
  readonly body: BodyState;
};
export type TraitEffectRules = { readonly effects: Readonly<Record<string, number>> };
export type AbilityEffect = { readonly source: 'opening-narrative' | 'trait'; readonly key: string; readonly causeId: CauseId; readonly amount: number };
function assertRange(value: number, max: number): void {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new InvariantViolation('ability-range');
}
export function assertAbilityRanges(character: Character): void {
  for (const name of abilityNames) {
    assertRange(character.baseAbilities[name], 20);
    assertRange(character.finalAbilities[name], 100);
  }
  for (const value of Object.values(character.skills)) assertRange(value, 99.9);
  for (const trait of character.traits) assertTraitHasCause(trait);
}
export function assertTraitHasCause(trait: Trait): void { requireCause(trait.causeId); }
export function composeFinalAbility(base: number, effects: readonly AbilityEffect[], rules?: TraitEffectRules): number {
  assertRange(base, 20);
  let total = base;
  for (const effect of effects) {
    requireCause(effect.causeId);
    if (!Number.isFinite(effect.amount)) throw new InvariantViolation('effect-range');
    switch (effect.source) {
      case 'opening-narrative': total += effect.amount; break;
      case 'trait': {
        if (!rules) throw new MissingRuleInput('TraitEffectRules.effects');
        const amount = rules.effects[effect.key];
        if (amount === undefined) throw new MissingRuleInput('TraitEffectRules.effects.' + effect.key);
        if (!Number.isFinite(amount)) throw new InvariantViolation('effect-range');
        total += amount; break;
      }
      default: return assertNever(effect.source);
    }
  }
  return Math.max(0, Math.min(100, total));
}
