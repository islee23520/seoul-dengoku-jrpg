import { z } from '../../../engine/node_modules/zod/index.js';
import type { HostRules, RealtimeHost, RuntimeState } from './realtimeHost.ts';
import { count, ref, json, MissingRuleInput } from '../battle/realtime.ts';
import type { Json } from '../battle/realtime.ts';
import { campaignSchema } from '../save/campaignCheckpoint.ts';
import { id, integer } from '../domain/ids.ts';
import type { Grant } from '../domain/authority.ts';
import { InvariantViolation } from '../domain/errors.ts';
import { applyResult, restoreLedger, summaryHash } from '../domain/eventLedger.ts';
import type { EventLedger, Versions } from '../domain/eventLedger.ts';
import { executionSchema, stepOrder, arrived, travel } from './orderExecution.ts';
import type { Execution, ExecutionRules, WorldGraph } from './orderExecution.ts';
import { stationSchema, shipmentSchema, approveSupply, stationEntry, transitionStation } from './stationState.ts';
import type { Shipment } from './stationState.ts';

const shape = z.strictObject({
  watermark: count, ruleVersion: ref, orders: z.array(executionSchema).readonly(), stations: z.array(stationSchema).readonly(),
  shipments: z.array(shipmentSchema).readonly(), ledger: json,
  receipts: z.array(z.strictObject({ orderId: ref, serial: count, tick: count, stage: ref, resultId: ref })).readonly(),
}).readonly();
export type WorldState = Omit<z.infer<typeof shape>, 'ledger'> & { readonly ledger: EventLedger };
export type WorldRules = {
  readonly versions: Versions; readonly execution: ExecutionRules; readonly graph: WorldGraph; readonly cut: readonly string[];
  readonly authority: (order: Execution) => Grant;
  readonly acceptSupply: ((shipment: Shipment) => boolean) | null;
};
export function restoreWorld(value: unknown, rules: WorldRules): WorldState {
  const parsed = shape.parse(value);
  if (parsed.ruleVersion !== rules.execution.ruleVersion || parsed.ruleVersion !== rules.versions.ruleVersion) throw new InvariantViolation('world-rule-version');
  const ledger = restoreLedger(parsed.ledger, rules.versions);
  if (new Set(parsed.orders.map(o => o.mandate.orderId)).size !== parsed.orders.length ||
      new Set(parsed.shipments.map(s => s.id)).size !== parsed.shipments.length ||
      new Set(parsed.stations.map(s => s.id)).size !== parsed.stations.length) throw new InvariantViolation('world-duplicate-id');
  for (const order of parsed.orders) {
    for (const path of [order.journey.path, order.workPath, order.reportPath]) {
      if (path.some(p => !rules.graph.stations.some(s => s.id === p))) throw new InvariantViolation('world-route-station');
    }
    if (order.journey.leg >= order.journey.path.length || order.serial !== parsed.receipts.filter(r => r.orderId === order.mandate.orderId).length) throw new InvariantViolation('world-order-cursor');
  }
  if (parsed.receipts.some(r => r.tick > parsed.watermark || !ledger.entries.some(e => e.resultId === r.resultId))) throw new InvariantViolation('world-receipt-chain');
  return { ...parsed, ledger };
}

/** Pure reducer: its tick is supplied exclusively by RealtimeHost.advanceWorld. */
export function stepWorld(state: WorldState, tick: number, rules: WorldRules): WorldState {
  if (tick === state.watermark) return state;
  if (tick !== state.watermark + 1) throw new InvariantViolation('world-step-sequence');
  if (state.ruleVersion !== rules.execution.ruleVersion) throw new InvariantViolation('world-rule-version');
  let ledger = state.ledger;
  const orders: Execution[] = [], receipts = [...state.receipts];
  // Reservations are per person/resource. Compatible jobs do not share a global lock.
  const active = (o: Execution): boolean => o.mandate.stage === 'reserved' || o.mandate.stage === 'executing';
  for (const original of state.orders) {
    const occupied = [...orders, ...state.orders.filter(o => !orders.some(done => done.mandate.orderId === o.mandate.orderId) && o.mandate.orderId !== original.mandate.orderId)]
      .filter(active).flatMap(o => [...o.reservationKeys, 'person:' + o.mandate.recipientId]);
    let next = stepOrder({ ...original, reservationKeys: [...new Set([...original.reservationKeys, 'person:' + original.mandate.recipientId])] },
      { now: tick, authority: rules.authority(original), graph: rules.graph, cut: rules.cut, rules: rules.execution, occupied,
        deliveryReady: state.shipments.filter(s => s.orderId === original.mandate.orderId).every(s => s.acceptedResultId !== null) });
    if (summaryHash({ ...next }) !== summaryHash({ ...original })) {
      const serial = original.serial + 1, resultId = id('ResultId', original.mandate.orderId + ':' + serial);
      const terminal = ['receipt', 'refused', 'cancelled', 'interrupted', 'expired'].includes(next.mandate.stage);
      next = { ...next, serial, mandate: { ...next.mandate,
        reservations: terminal ? [] : next.mandate.reservations, personSchedule: terminal ? [] : next.mandate.personSchedule,
        appliedResultIds: [...next.mandate.appliedResultIds, resultId] } };
      const beforeHash = ledger.entries.at(-1)?.afterHash ?? summaryHash(null), payload = { ...next };
      ledger = applyResult(ledger, { causeId: next.mandate.causeId, command: 'order-step', worldTime: integer('WorldTick', tick),
        actor: next.mandate.recipientId, target: next.mandate.orderId, beforeHash, afterHash: summaryHash(payload),
        ruleVersion: rules.versions.ruleVersion, contentVersion: rules.versions.contentVersion, resultId, payload }).ledger;
      receipts.push({ orderId: next.mandate.orderId, serial, tick, stage: next.mandate.stage, resultId });
    }
    orders.push(next);
  }
  const shipments: Shipment[] = [], stations = [...state.stations];
  for (const shipment of state.shipments) {
    const executor = orders.find(o => o.mandate.orderId === shipment.orderId);
    // Revocation never teleports physical custody or refunds completed work.
    if (!executor || executor.mandate.stage !== 'executing' || shipment.acceptedResultId !== null) { shipments.push(shipment); continue; }
    const journey = travel(shipment.journey, { graph: rules.graph, cut: rules.cut, rules: rules.execution });
    let next: Shipment = { ...shipment, journey };
    if (arrived(journey)) {
      const index = stations.findIndex(s => s.id === shipment.destination), station = stations[index];
      if (!station) throw new InvariantViolation('supply-destination');
      const resultId = id('ResultId', shipment.id + ':arrival');
      const updated = approveSupply(station, next, { resultId, approve: rules.acceptSupply });
      const entry = stationEntry(station, updated, { causeId: executor.mandate.causeId, command: 'supply-arrival', worldTime: integer('WorldTick', tick),
        actor: shipment.custodian, ruleVersion: rules.versions.ruleVersion, contentVersion: rules.versions.contentVersion, resultId });
      const beforeHash = ledger.entries.at(-1)?.afterHash ?? entry.beforeHash;
      ledger = applyResult(ledger, { ...entry, beforeHash }).ledger;
      stations[index] = transitionStation(station, updated, { ledger, resultId });
      next = { ...next, acceptedResultId: resultId };
    }
    shipments.push(next);
  }
  return { ...state, watermark: tick, orders, receipts, stations, shipments, ledger };
}

/** Compose with the one existing scheduler; no timers, elapsed accumulator, pause or monthly loop. */
export function worldAdvance(rules: WorldRules, mode: 'TESTINPUT' | 'production'): HostRules['advanceWorld'] {
  return (campaign: Json, tick: number): Json => {
    if (mode === 'production' && rules.execution.provenance !== 'CANON') throw new MissingRuleInput('approved-world-clock-inputs');
    const parsed = campaignSchema.parse(campaign);
    return { ...parsed, facts: { ...stepWorld(restoreWorld(parsed.facts, rules), tick, rules) } };
  };
}
/** Scene callbacks inherit the host's generation invalidation rather than owning another clock. */
export function bindWorldClock(host: RealtimeHost): ReturnType<RealtimeHost['bind']> { return host.bind(); }
export function worldAtBoundary(runtime: RuntimeState, rules: WorldRules): WorldState {
  const state = restoreWorld(campaignSchema.parse(runtime.campaignState).facts, rules);
  if (state.watermark !== runtime.worldTick) throw new InvariantViolation('world-host-watermark');
  return state;
}
