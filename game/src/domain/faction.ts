import type { Applicability, FactionId, RegionCode } from './ids.ts';
import { InvariantViolation, MissingRuleInput, assertNever } from './errors.ts';

export type Faction = {
  readonly id: FactionId;
  readonly kind: 'political-block' | 'kingdom' | 'operating-house';
  readonly applicability: Applicability;
  readonly scope: readonly RegionCode[];
};
export type WorldRelationLedgerFact = { readonly from: string; readonly kind: string; readonly to: string; readonly reason: string };
export function ingestWorldRelationLedgerFacts(rows: readonly WorldRelationLedgerFact[]): readonly WorldRelationLedgerFact[] {
  return rows.map(row => {
    if (!row.from || !row.kind || !row.to || !row.reason) throw new InvariantViolation('world-relation-shape');
    return { ...row };
  });
}
export function assertCurrentFactionInSeoul(faction: Faction, scope?: ReadonlySet<RegionCode>): void {
  switch (faction.applicability.tense) {
    case 'past': return;
    case 'current':
      if (!scope || scope.size === 0) throw new MissingRuleInput('Seoul.scope');
      if (faction.scope.length === 0 || faction.scope.some(region => !scope.has(region))) {
        throw new InvariantViolation('outside-seoul', [faction.id]);
      }
      return;
    default: return assertNever(faction.applicability.tense);
  }
}
