import type { CauseId, GrantId, LotId, OfficeId, PersonId, Revision, TitleId, WorldTick } from './ids.ts';
import { integer } from './ids.ts';
import { InvariantViolation, requireCause } from './errors.ts';

// sp1.b8/C01: these are independently evidenced facts, never implications.
export type OfficeAppointment = { readonly officeId: OfficeId; readonly personId: PersonId; readonly causeId: CauseId };
export type TitleRight = { readonly titleId: TitleId; readonly holder: PersonId; readonly causeId: CauseId };
export type Ownership = { readonly owner: PersonId | string; readonly asset: string; readonly kind: 'personal' | 'institutional' | 'shared-equity' | 'lease' | 'debt-claim-collateral' | 'records-keys-relics'; readonly causeId: CauseId };
export type EffectiveControl = { readonly controller: PersonId; readonly asset: string; readonly causeId: CauseId };
export type AccessRight = { readonly personId: PersonId; readonly asset: string; readonly actions: readonly string[]; readonly causeId: CauseId };
export type Custody = { readonly custodian: PersonId; readonly lotId: LotId; readonly asset: string; readonly causeId: CauseId };
export type CommandScope = { readonly commander: PersonId; readonly roster: readonly PersonId[]; readonly actions: readonly string[]; readonly causeId: CauseId };
export type ServiceRelation = { readonly principal: PersonId; readonly personId: PersonId; readonly role: 'household-retainer' | 'landed-vassal' | 'worker' | 'player-body'; readonly disposition: 'active' | 'retired-current'; readonly causeId: CauseId };
export type AuthorityFacts = { readonly offices: readonly OfficeAppointment[]; readonly ownership: readonly Ownership[]; readonly commands: readonly CommandScope[] };
export type GrantLimits = {
  readonly scope: readonly string[]; readonly assets: readonly string[]; readonly roster: readonly PersonId[];
  readonly budget: Readonly<Record<string, number>>; readonly subdelegation: boolean;
  readonly effectiveAt: WorldTick; readonly expiresAt: WorldTick;
};
export type AuthorityBasis = { readonly kind: 'office' | 'title' | 'command' | 'right'; readonly id: string; readonly causeId: CauseId };
export type Grant = GrantLimits & {
  readonly id: GrantId; readonly grantor: PersonId; readonly grantee: PersonId;
  readonly basis: AuthorityBasis; readonly parentAuthorityId: GrantId | null; readonly version: Revision;
  readonly state: 'valid' | 'suspended' | 'expired' | 'revoked'; readonly basisEvents: readonly CauseId[];
};
export type GrantContext = { readonly parent: Grant; readonly now: WorldTick };
export function assertGrantWithinGrantorRights(child: Grant, context: GrantContext): void {
  const { parent, now } = context;
  requireCause(child.basis.causeId);
  if (parent.state !== 'valid' || now < parent.effectiveAt || now >= parent.expiresAt ||
    child.grantor !== parent.grantee || child.parentAuthorityId !== parent.id || !parent.subdelegation ||
    child.effectiveAt < parent.effectiveAt || child.expiresAt > parent.expiresAt || child.expiresAt <= child.effectiveAt ||
    child.scope.some(x => !parent.scope.includes(x)) || child.assets.some(x => !parent.assets.includes(x)) ||
    child.roster.some(x => !parent.roster.includes(x)) ||
    Object.entries(child.budget).some(([key, n]) => !Number.isFinite(n) || n < 0 || parent.budget[key] === undefined || n > (parent.budget[key] ?? 0))) {
    throw new InvariantViolation('grant-outside-rights', [child.id, parent.id]);
  }
}
export function revokeGrant(grant: Grant, causeId: CauseId): Grant {
  requireCause(causeId);
  return { ...grant, state: 'revoked', version: integer('Revision', grant.version + 1), basisEvents: [...grant.basisEvents, causeId] };
}
export function ownershipOf(facts: AuthorityFacts, person: PersonId): readonly Ownership[] { return facts.ownership.filter(x => x.owner === person); }
export function commandOf(facts: AuthorityFacts, person: PersonId): readonly CommandScope[] { return facts.commands.filter(x => x.commander === person); }
export function grantCommandFromOffice(_office: OfficeAppointment): never { throw new InvariantViolation('office-implies-nothing'); }
export function assertCustodianIsNotOwner(custody: Custody, rights: readonly Ownership[]): void {
  if (!rights.some(r => r.owner === custody.custodian && r.asset === custody.asset)) throw new InvariantViolation('custody-is-not-ownership');
}
export function assertKeyPossessionIsNotRight(personId: PersonId, asset: string, rights: readonly AccessRight[]): void {
  if (!rights.some(r => r.personId === personId && r.asset === asset)) throw new InvariantViolation('key-is-not-access');
}
export function assertTransferableAsset(asset: { readonly id: string; readonly recognizedPerson: boolean }): void {
  if (asset.recognizedPerson) throw new InvariantViolation('person-is-not-property', [asset.id]);
}
// S06: command capacity comes from active service AND an explicit grant, not stats.
export function executableRetainers(services: readonly ServiceRelation[], grant: Grant, now: WorldTick): readonly PersonId[] {
  if (grant.state !== 'valid' || now < grant.effectiveAt || now >= grant.expiresAt) return [];
  return services.filter(s => s.principal === grant.grantor && s.disposition === 'active' && s.role === 'household-retainer' && grant.roster.includes(s.personId)).map(s => s.personId);
}
