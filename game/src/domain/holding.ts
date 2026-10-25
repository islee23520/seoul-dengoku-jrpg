import type { HoldingId, PersonId, RegionCode, TitleId } from './ids.ts';
import { InvariantViolation } from './errors.ts';

export type Holding = {
  readonly id: HoldingId;
  readonly boundTitle: TitleId;
  readonly territoryScope: readonly RegionCode[];
  readonly evidenceStatus: 'current_seoul_evidenced';
  readonly effectiveControl: readonly { readonly personId: PersonId; readonly asset: string }[];
};
export function deriveOwnershipFromHolding(holding: Holding): never {
  throw new InvariantViolation('holding-is-not-asset-ownership', [holding.id]);
}
export function assertPossessionIsNotControl(holding: Holding, personId: PersonId, asset: string): void {
  if (!holding.effectiveControl.some(c => c.personId === personId && c.asset === asset)) {
    throw new InvariantViolation('possession-is-not-control', [holding.id, asset]);
  }
}
