import { z } from '../../../engine/node_modules/zod/index.js';
import { count, ref, MissingRuleInput } from '../battle/realtime.ts';
import { id } from '../domain/ids.ts';
import type { ResultId } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import type { EventLedger, LedgerEntry } from '../domain/eventLedger.ts';
import { InvariantViolation } from '../domain/errors.ts';
import { journeySchema, arrived } from './orderExecution.ts';

export const roleSchema = z.strictObject({
  role: z.enum(['scouting', 'supply', 'negotiation', 'medical']),
  personId: ref.transform(v => id('PersonId', v)), orderId: ref.transform(v => id('OrderId', v)),
}).readonly();
export const stationSchema = z.strictObject({
  id: ref.transform(v => id('StationId', v)), population: count, supply: z.record(ref, count).readonly(),
  infrastructure: z.record(ref, count).readonly(), threat: z.array(ref).readonly(),
  controlFaction: ref.transform(v => id('FactionId', v)).nullable(), roles: z.array(roleSchema).readonly(),
  appliedResultIds: z.array(ref.transform(v => id('ResultId', v))).readonly(),
}).readonly();
export type StationState = z.infer<typeof stationSchema>;
export type RoleAssignment = z.infer<typeof roleSchema>;
export const shipmentSchema = z.strictObject({
  id: ref, orderId: ref.transform(v => id('OrderId', v)), resource: ref, quantity: count,
  source: ref.transform(v => id('StationId', v)), destination: ref.transform(v => id('StationId', v)),
  custodian: ref.transform(v => id('PersonId', v)), owner: ref,
  journey: journeySchema, acceptedResultId: ref.transform(v => id('ResultId', v)).nullable(),
}).readonly();
export type Shipment = z.infer<typeof shipmentSchema>;

/** State transitions require the exact committed ledger payload, not a result-shaped token. */
export function transitionStation(state: StationState, next: StationState, input: { readonly ledger: EventLedger; readonly resultId: ResultId }): StationState {
  const entry = input.ledger.entries.find(e => e.resultId === input.resultId);
  if (!entry || entry.target !== state.id || next.id !== state.id) throw new InvariantViolation('station-ledger-result');
  if (state.appliedResultIds.includes(input.resultId)) {
    const payload = z.object({ station: stationSchema }).parse(entry.payload);
    if (summaryHash({ ...payload.station }) !== summaryHash({ ...state })) throw new InvariantViolation('station-result-conflict');
    return state;
  }
  if (summaryHash(entry.payload) !== summaryHash({ stationBeforeHash: summaryHash({ ...state }), station: { ...next } }) ||
      JSON.stringify(next.appliedResultIds) !== JSON.stringify([...state.appliedResultIds, input.resultId])) throw new InvariantViolation('station-result-chain');
  return stationSchema.parse(next);
}

/** A purchase or promise cannot increase stock; physical arrival and intake approval are required. */
export function approveSupply(state: StationState, shipment: Shipment, input: {
  readonly resultId: ResultId; readonly approve: ((shipment: Shipment) => boolean) | null;
}): StationState {
  if (!arrived(shipment.journey) || shipment.journey.path.at(-1) !== state.id || shipment.destination !== state.id) throw new InvariantViolation('supply-not-arrived');
  if (!input.approve) throw new MissingRuleInput('supply-arrival-acceptance');
  if (!input.approve(shipment)) throw new InvariantViolation('supply-intake-refused');
  return { ...state, supply: { ...state.supply, [shipment.resource]: (state.supply[shipment.resource] ?? 0) + shipment.quantity }, appliedResultIds: [...state.appliedResultIds, input.resultId] };
}

export function roleContribution(assignment: RoleAssignment, input: {
  readonly skill: number; readonly loyalty: number;
  readonly rules: ((assignment: RoleAssignment, values: { readonly skill: number; readonly loyalty: number }) => number) | null;
}): number {
  if (!input.rules) throw new MissingRuleInput('role-skill-loyalty-contribution');
  return input.rules(assignment, { skill: input.skill, loyalty: input.loyalty });
}

export function stationEntry(state: StationState, next: StationState, metadata: Omit<LedgerEntry, 'target' | 'beforeHash' | 'afterHash' | 'payload'>): LedgerEntry {
  const payload = { stationBeforeHash: summaryHash({ ...state }), station: { ...next } };
  return { ...metadata, target: state.id, beforeHash: summaryHash({ ...state }), afterHash: summaryHash(payload), payload };
}
