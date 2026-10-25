import type { PersonId, WorldTick, ResultId, StationId } from './ids.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import type { StationEconomy } from './stationGoods.ts';

export type PriceObservation = {
  readonly observer: PersonId;
  readonly observedAt: WorldTick;
  readonly stationId: StationId;
  readonly sourceResultIds: readonly ResultId[];
  readonly goods: StationEconomy['goods'];
  readonly priceChanges: StationEconomy['priceChanges'];
};
/** Basic local facts have no payment or trust gate. The ledger is not world truth. */
export function basicMarketFacts(state: StationEconomy): { readonly open: true; readonly cost: 0; readonly station: StationEconomy } {
  return { open: true, cost: 0, station: state };
}
export function observePrices(state: StationEconomy, input: {
  readonly observer: PersonId; readonly observedAt: WorldTick;
}): PriceObservation {
  return { ...input, stationId: state.stationId, sourceResultIds: [...state.appliedResultIds],
    goods: state.goods.map(g => ({ ...g, demandTags: [...g.demandTags] })), priceChanges: state.priceChanges.map(p => ({ ...p })) };
}
export function marketInfoLedger(records: readonly PriceObservation[], observer: PersonId): readonly PriceObservation[] {
  return records.filter(record => record.observer === observer);
}
export function remoteMarketInfo(record: PriceObservation, input: {
  readonly paid: number; readonly fee?: (record: PriceObservation) => number;
}): PriceObservation {
  if (!input.fee) throw new MissingRuleInput('EconomyRules.remoteInfoFee');
  const fee = input.fee(record);
  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(input.paid) || input.paid < fee) throw new InvariantViolation('remote-info-payment');
  return record;
}
