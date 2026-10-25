import type { CauseId, GrantId, OrderId, PersonId, ResultId, Revision, StationId, WorldTick } from './ids.ts';
import type { AuthorityBasis, Grant, GrantLimits, Custody } from './authority.ts';
import type { Character } from './character.ts';
import { InvariantViolation, VersionMismatch, assertNever, requireCause } from './errors.ts';

// task-33 common contract, sp1.b11/b12: field-carrying, not a scheduler.
export type MandateStage = 'proposed' | 'eligible' | 'delivered' | 'received' | 'consent' | 'refused' | 'held' | 'reserved' | 'executing' | 'result-applied' | 'receipt' | 'cancelled' | 'interrupted' | 'expired';
export type Mandate = GrantLimits & {
  readonly orderId: OrderId; readonly causeId: CauseId; readonly issuerPersonId: PersonId;
  readonly titleOrOfficeOrCommandBasis: AuthorityBasis; readonly parentAuthorityId: GrantId; readonly parentAuthorityVersion: Revision;
  readonly targetId: string; readonly targetVersion: Revision; readonly recipientId: PersonId; readonly goal: string;
  readonly issuerLocation: StationId; readonly recipientLocation: StationId; readonly communicationRoute: readonly StationId[];
  readonly issuedAt: WorldTick; readonly receivedAt: WorldTick | null; readonly acceptedAt: WorldTick | null;
  readonly reservations: readonly string[]; readonly personSchedule: readonly string[];
  readonly stage: MandateStage; readonly progress: string; readonly physicalLocation: StationId; readonly custody: readonly Custody[];
  readonly reportObservedAt: WorldTick | null; readonly reportCreatedAt: WorldTick | null; readonly reportDeliveredAt: WorldTick | null;
  readonly interruptReason: string | null; readonly refusalReason: string | null; readonly revokeReason: string | null;
  readonly pendingResultIds: readonly ResultId[]; readonly appliedResultIds: readonly ResultId[];
};
export type Preflight = {
  readonly targetId: string; readonly targetVersion: Revision; readonly recipient: Character; readonly authority: Grant;
  readonly now: WorldTick; readonly routeDelivered: boolean; readonly resourcesFeasible: boolean; readonly procedureApproved: boolean;
};
export function preflightMandate(order: Mandate, input: Preflight): void {
  // Deliberately sequential: observable first rejection is the SP b12 order.
  if (input.targetId !== order.targetId || input.targetVersion !== order.targetVersion) throw new VersionMismatch(String(order.targetVersion), String(input.targetVersion));
  if (input.recipient.id !== order.recipientId || !input.recipient.alive || input.recipient.captive || !input.recipient.conscious || !input.recipient.agency) throw new InvariantViolation('recipient-unavailable');
  assertMandateAuthority(order, input.authority, input.now);
  if (!input.routeDelivered) throw new InvariantViolation('delivery-unavailable');
  if (!input.resourcesFeasible) throw new InvariantViolation('resource-infeasible');
  if (!input.procedureApproved) throw new InvariantViolation('procedure-unapproved');
}
export function assertMandateAuthority(order: Mandate, grant: Grant, now: WorldTick): void {
  if (grant.id !== order.parentAuthorityId || grant.version !== order.parentAuthorityVersion || grant.state !== 'valid' ||
    grant.grantor !== order.issuerPersonId || grant.grantee !== order.recipientId || now < grant.effectiveAt || now >= grant.expiresAt ||
    order.effectiveAt < grant.effectiveAt || order.expiresAt > grant.expiresAt ||
    order.scope.some(s => !grant.scope.includes(s)) || order.assets.some(s => !grant.assets.includes(s)) ||
    order.roster.some(s => !grant.roster.includes(s)) || (order.subdelegation && !grant.subdelegation) ||
    Object.entries(order.budget).some(([k, v]) => !Number.isFinite(v) || v < 0 || grant.budget[k] === undefined || v > (grant.budget[k] ?? 0))) {
    throw new InvariantViolation('mandate-authority-invalid', [order.orderId, grant.id]);
  }
}
export function assertNoExecutionBeforeReceipt(order: Mandate, now: WorldTick): void {
  if (order.receivedAt === null || order.acceptedAt === null || order.receivedAt < order.issuedAt ||
    order.acceptedAt < order.receivedAt || now < order.acceptedAt) throw new InvariantViolation('execution-before-receipt');
}
export function advanceMandate(order: Mandate, stage: MandateStage, context: { readonly now: WorldTick; readonly authority: Grant }): Mandate {
  requireCause(order.causeId);
  const { now, authority } = context;
  if (['receipt', 'refused', 'cancelled', 'interrupted', 'expired'].includes(order.stage)) throw new InvariantViolation('terminal-mandate');
  if (now < order.issuedAt) throw new InvariantViolation('order-time');
  if (now >= order.expiresAt) return { ...order, stage: 'expired' };
  if (authority.state !== 'valid' || authority.version !== order.parentAuthorityVersion) {
    return { ...order, stage: 'refused', refusalReason: 'authority-revoked-or-stale', revokeReason: authority.state };
  }
  assertMandateAuthority(order, authority, now);
  const next: Readonly<Record<MandateStage, readonly MandateStage[]>> = {
    proposed: ['eligible', 'cancelled'], eligible: ['delivered', 'cancelled'], delivered: ['received', 'cancelled'],
    received: ['consent', 'refused', 'held', 'cancelled'], consent: ['reserved', 'cancelled'], held: ['received', 'cancelled'],
    reserved: ['executing', 'cancelled'], executing: ['result-applied', 'interrupted'], 'result-applied': ['receipt'],
    refused: [], receipt: [], cancelled: [], interrupted: [], expired: [],
  };
  if (!next[order.stage].includes(stage)) throw new InvariantViolation('mandate-stage', [order.stage, stage]);
  switch (stage) {
    case 'received': return { ...order, stage, receivedAt: now };
    case 'consent':
      if (order.receivedAt === null || now < order.receivedAt) throw new InvariantViolation('consent-before-receipt');
      return { ...order, stage, acceptedAt: now };
    case 'executing':
      assertNoExecutionBeforeReceipt(order, now);
      if (now < order.effectiveAt) throw new InvariantViolation('not-effective');
      return { ...order, stage };
    case 'proposed': case 'eligible': case 'delivered': case 'refused': case 'held': case 'reserved': case 'result-applied': case 'receipt': case 'cancelled': case 'interrupted': case 'expired': return { ...order, stage };
    default: return assertNever(stage);
  }
}

// sp1.20261003.commander: only an evidenced local battle signal may replace
// courier delivery and generic consent. Receipt still precedes reservation and execution.
export type BattleSignal = {
  readonly battleId: string; readonly recipientBattleId: string;
  readonly commander: PersonId; readonly commandBasisId: string; readonly causeId: CauseId;
};
export function receiveBattleSignal(order: Mandate, signal: BattleSignal, context: { readonly now: WorldTick; readonly authority: Grant }): Mandate {
  requireCause(signal.causeId);
  if (!signal.battleId || signal.battleId !== signal.recipientBattleId || signal.commander !== order.issuerPersonId ||
    order.titleOrOfficeOrCommandBasis.kind !== 'command' || signal.commandBasisId !== order.titleOrOfficeOrCommandBasis.id ||
    context.authority.basis.kind !== 'command' || context.authority.basis.id !== signal.commandBasisId ||
    context.authority.basis.causeId !== order.titleOrOfficeOrCommandBasis.causeId ||
    order.issuerLocation !== order.recipientLocation || order.stage !== 'eligible') throw new InvariantViolation('not-local-battle-signal');
  const delivered = advanceMandate(order, 'delivered', context);
  const received = advanceMandate(delivered, 'received', context);
  if (received.stage !== 'received') return received;
  return { ...received, stage: 'consent', acceptedAt: context.now };
}
