import type { Applicability, CauseId, PersonId, PolityId, TitleId } from './ids.ts';
import { InvariantViolation, requireCause } from './errors.ts';

export type Title = {
  readonly id: TitleId;
  readonly name: string;
  readonly rank: string;
  readonly holder: PersonId | null;
  readonly polity: PolityId;
  readonly geographicParentTitle: TitleId | null;
  readonly personalLiegePerson: PersonId | null;
  readonly recognitionStatus: string;
  readonly applicability: Applicability;
  readonly basisEvents: readonly CauseId[];
};
// sp1.b42: award changes only the holder and its recorded cause, never authority.
export function awardTitle(title: Title, holder: PersonId, causeId: CauseId): Title {
  requireCause(causeId); return { ...title, holder, basisEvents: [...title.basisEvents, causeId] };
}
export function assertGeographicParentIsNotPersonalLiege(title: Title, proposed: PersonId | null): void {
  if (proposed !== title.personalLiegePerson) throw new InvariantViolation('geography-is-not-liege', [title.id]);
}
export function assertNoAutoAuthorityFromTitle(_title: Title): never { throw new InvariantViolation('title-is-not-authority'); }
