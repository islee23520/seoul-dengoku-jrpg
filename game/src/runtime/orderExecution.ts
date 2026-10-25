import { z } from '../../../engine/node_modules/zod/index.js';
import { count, ref, MissingRuleInput } from '../battle/realtime.ts';
import { id, integer } from '../domain/ids.ts';
import type { Grant } from '../domain/authority.ts';
import { advanceMandate, assertMandateAuthority, preflightMandate } from '../domain/mandate.ts';
import type { Mandate, Preflight } from '../domain/mandate.ts';
import { InvariantViolation, assertNever } from '../domain/errors.ts';

const person = ref.transform(v => id('PersonId', v));
const station = ref.transform(v => id('StationId', v));
const result = ref.transform(v => id('ResultId', v));
const cause = ref.transform(v => id('CauseId', v));
const tick = count.transform(v => integer('WorldTick', v));
const revision = count.transform(v => integer('Revision', v));
const basis = z.strictObject({ kind: z.enum(['office', 'title', 'command', 'right']), id: ref, causeId: cause });
export const mandateSchema = z.strictObject({
  orderId: ref.transform(v => id('OrderId', v)), causeId: cause, issuerPersonId: person,
  titleOrOfficeOrCommandBasis: basis, parentAuthorityId: ref.transform(v => id('GrantId', v)), parentAuthorityVersion: revision,
  targetId: ref, targetVersion: revision, recipientId: person, goal: ref,
  scope: z.array(ref).readonly(), assets: z.array(ref).readonly(), roster: z.array(person).readonly(), budget: z.record(ref, z.number().nonnegative()).readonly(), subdelegation: z.boolean(),
  effectiveAt: tick, expiresAt: tick, issuerLocation: station, recipientLocation: station, communicationRoute: z.array(station).min(1).readonly(),
  issuedAt: tick, receivedAt: tick.nullable(), acceptedAt: tick.nullable(), reservations: z.array(ref).readonly(), personSchedule: z.array(ref).readonly(),
  stage: z.enum(['proposed', 'eligible', 'delivered', 'received', 'consent', 'refused', 'held', 'reserved', 'executing', 'result-applied', 'receipt', 'cancelled', 'interrupted', 'expired']),
  progress: z.string(), physicalLocation: station,
  custody: z.array(z.strictObject({ custodian: person, lotId: ref.transform(v => id('LotId', v)), asset: ref, causeId: cause })).readonly(),
  reportObservedAt: tick.nullable(), reportCreatedAt: tick.nullable(), reportDeliveredAt: tick.nullable(),
  interruptReason: z.string().nullable(), refusalReason: z.string().nullable(), revokeReason: z.string().nullable(),
  pendingResultIds: z.array(result).readonly(), appliedResultIds: z.array(result).readonly(),
}).readonly();
export const journeySchema = z.strictObject({ path: z.array(station).min(1).readonly(), leg: count, elapsed: count }).readonly();
export const executionSchema = z.strictObject({
  mandate: mandateSchema, serial: count, journey: journeySchema,
  workPath: z.array(station).min(1).readonly(), reportPath: z.array(station).min(1).readonly(),
  workElapsed: count, reservationKeys: z.array(ref).readonly(),
}).readonly();
export type Execution = z.infer<typeof executionSchema>;
export type Journey = z.infer<typeof journeySchema>;
export type WorldGraph = { readonly stations: readonly { readonly id: string }[]; readonly edges: readonly { readonly a: string; readonly b: string }[] };
export type ExecutionRules = {
  readonly provenance: 'TESTINPUT' | 'CANON'; readonly ruleVersion: string;
  readonly conflictPolicy: 'reject-conflict' | 'wait-for-availability';
  readonly travelSteps: ((edge: { readonly from: string; readonly to: string }) => number) | null;
  readonly workSteps: ((order: Mandate) => number) | null;
  readonly acceptance: ((order: Mandate) => 'accept' | 'hold' | 'reject') | null;
  readonly ready: ((order: Mandate) => Omit<Preflight, 'authority' | 'now' | 'routeDelivered'> | null) | null;
  readonly admission: ((orders: readonly Execution[], order: Mandate) => boolean) | null;
};
export function travel(journey: Journey, input: { readonly graph: WorldGraph; readonly cut: readonly string[]; readonly rules: ExecutionRules }): Journey {
  const from = journey.path[journey.leg], to = journey.path[journey.leg + 1];
  if (to === undefined) return journey;
  if (from === undefined) throw new InvariantViolation('route-leg');
  if (!input.graph.edges.some(e => (e.a === from && e.b === to) || (e.b === from && e.a === to)) || input.cut.includes(edgeKey(from, to))) return journey;
  if (!input.rules.travelSteps) throw new MissingRuleInput('travel-duration-coefficients');
  const duration = input.rules.travelSteps({ from, to });
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new MissingRuleInput('travel-duration-coefficients');
  return journey.elapsed + 1 >= duration ? { ...journey, leg: journey.leg + 1, elapsed: 0 } : { ...journey, elapsed: journey.elapsed + 1 };
}
export function edgeKey(a: string, b: string): string { return JSON.stringify([a, b].sort()); }
export function arrived(journey: Journey): boolean { return journey.leg === journey.path.length - 1; }
export function admitOrder(orders: readonly Execution[], execution: Execution, rules: ExecutionRules): readonly Execution[] {
  const previous = orders.find(o => o.mandate.orderId === execution.mandate.orderId);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(execution)) throw new InvariantViolation('order-id-conflict');
    return orders;
  }
  if (!rules.admission) throw new MissingRuleInput('owner-command-cadence');
  if (!rules.admission(orders, execution.mandate)) throw new InvariantViolation('command-admission');
  if (execution.mandate.stage !== 'proposed' || execution.serial !== 0) throw new InvariantViolation('order-admission-stage');
  return [...orders, execution];
}
export function stepOrder(execution: Execution, input: {
  readonly now: number; readonly authority: Grant; readonly graph: WorldGraph; readonly cut: readonly string[];
  readonly rules: ExecutionRules; readonly occupied: readonly string[]; readonly deliveryReady: boolean;
}): Execution {
  const order = execution.mandate, now = integer('WorldTick', input.now), context = { now, authority: input.authority };
  const transition = (stage: Mandate['stage']): Execution => ({ ...execution, mandate: advanceMandate(order, stage, context) });
  const unavailable = (): Execution => {
    switch (input.rules.conflictPolicy) {
      case 'reject-conflict': return { ...execution, mandate: { ...order, stage: 'refused', refusalReason: 'recipient-unavailable', reservations: [], personSchedule: [] } };
      case 'wait-for-availability': return execution;
      default: return assertNever(input.rules.conflictPolicy);
    }
  };
  if (['receipt', 'refused', 'cancelled', 'interrupted', 'expired'].includes(order.stage)) return execution;
  if (now >= order.expiresAt) return transition('expired');
  if (input.authority.state !== 'valid' || input.authority.version !== order.parentAuthorityVersion) return transition('refused');
  assertMandateAuthority(order, input.authority, now);
  switch (order.stage) {
    case 'proposed': return transition('eligible');
    case 'eligible': {
      const journey = travel(execution.journey, input);
      return { ...execution, journey, mandate: arrived(journey) ? advanceMandate(order, 'delivered', context) : order };
    }
    case 'delivered': return transition('received');
    case 'held':
      switch (input.rules.conflictPolicy) {
        case 'reject-conflict': return unavailable();
        case 'wait-for-availability': return transition('received');
        default: return assertNever(input.rules.conflictPolicy);
      }
    case 'received': {
      if (!input.rules.acceptance) throw new MissingRuleInput('retainer-acceptance');
      const decision = input.rules.acceptance(order);
      switch (decision) {
        case 'accept': return transition('consent');
        case 'hold':
          switch (input.rules.conflictPolicy) {
            case 'reject-conflict': return { ...execution, mandate: { ...order, stage: 'refused', refusalReason: 'recipient-unavailable' } };
            case 'wait-for-availability': return transition('held');
            default: return assertNever(input.rules.conflictPolicy);
          }
        case 'reject': return { ...transition('refused'), mandate: { ...order, stage: 'refused', refusalReason: 'recipient-refused' } };
        default: return assertNever(decision);
      }
    }
    case 'consent': {
      if (!input.rules.ready) throw new MissingRuleInput('retainer-readiness');
      const ready = input.rules.ready(order);
      if (execution.reservationKeys.some(k => input.occupied.includes(k))) {
        switch (input.rules.conflictPolicy) {
          case 'reject-conflict': return { ...execution, mandate: { ...order, stage: 'refused', refusalReason: 'rejected-conflict' } };
          case 'wait-for-availability': return execution;
          default: return assertNever(input.rules.conflictPolicy);
        }
      }
      if (!ready || now < order.effectiveAt) return unavailable();
      preflightMandate(order, { ...ready, now, authority: input.authority, routeDelivered: true });
      return { ...transition('reserved'), mandate: { ...advanceMandate(order, 'reserved', context), reservations: execution.reservationKeys, personSchedule: [order.recipientId] } };
    }
    case 'reserved': {
      if (!input.rules.ready) throw new MissingRuleInput('retainer-readiness');
      const ready = input.rules.ready(order);
      if (!ready) return unavailable();
      preflightMandate(order, { ...ready, now, authority: input.authority, routeDelivered: true });
      return { ...transition('executing'), journey: { path: execution.workPath, leg: 0, elapsed: 0 } };
    }
    case 'executing': {
      if (!input.rules.ready) throw new MissingRuleInput('retainer-readiness');
      const current = input.rules.ready(order);
      if (!current) return unavailable();
      preflightMandate(order, { ...current, now, authority: input.authority, routeDelivered: true });
      if (!arrived(execution.journey)) {
        const journey = travel(execution.journey, input);
        const physicalLocation = journey.path[journey.leg];
        if (!physicalLocation) throw new InvariantViolation('route-location');
        return { ...execution, journey, mandate: { ...order, physicalLocation } };
      }
      if (!input.rules.workSteps) throw new MissingRuleInput('retainer-work-coefficients');
      const duration = input.rules.workSteps(order);
      if (!Number.isSafeInteger(duration) || duration <= 0) throw new MissingRuleInput('retainer-work-coefficients');
      const workElapsed = execution.workElapsed + 1;
      if (workElapsed < duration || !input.deliveryReady) return { ...execution, workElapsed };
      return { ...transition('result-applied'), workElapsed, journey: { path: execution.reportPath, leg: 0, elapsed: 0 },
        mandate: { ...advanceMandate(order, 'result-applied', context), reportObservedAt: now, reportCreatedAt: now, reservations: [], personSchedule: [] } };
    }
    case 'result-applied': {
      const journey = travel(execution.journey, input);
      return { ...execution, journey, mandate: arrived(journey) ? { ...advanceMandate(order, 'receipt', context), reportDeliveredAt: now } : order };
    }
    case 'receipt': case 'refused': case 'cancelled': case 'interrupted': case 'expired': return execution;
    default: return assertNever(order.stage);
  }
}
