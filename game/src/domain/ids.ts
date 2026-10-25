import { InvariantViolation } from './errors.ts';

declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
export type PersonId = Brand<string, 'PersonId'>;
export type TitleId = Brand<string, 'TitleId'>;
export type HoldingId = Brand<string, 'HoldingId'>;
export type FactionId = Brand<string, 'FactionId'>;
export type OfficeId = Brand<string, 'OfficeId'>;
export type PolityId = Brand<string, 'PolityId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type CauseId = Brand<string, 'CauseId'>;
export type ResultId = Brand<string, 'ResultId'>;
export type GrantId = Brand<string, 'GrantId'>;
export type LotId = Brand<string, 'LotId'>;
export type RegionCode = Brand<string, 'RegionCode'>;
export type StationId = Brand<string, 'StationId'>;
export type WorldTick = Brand<number, 'WorldTick'>;
export type WorldYear = Brand<number, 'WorldYear'>;
export type Revision = Brand<number, 'Revision'>;
export type SchemaVersion = Brand<number, 'SchemaVersion'>;
export type FixtureProvenance = { readonly kind: 'CANON'; readonly source: string } | { readonly kind: 'TESTINPUT' };

// The parser is the single branding boundary; assertions narrow without casts.
function assertId<N extends string>(value: string, name: N): asserts value is Brand<string, N> {
  if (!value.trim()) throw new InvariantViolation('empty-id', [name]);
}
export function id<N extends string>(name: N, value: string): Brand<string, N> {
  assertId(value, name);
  return value;
}
function assertInteger<N extends string>(value: number, name: N): asserts value is Brand<number, N> {
  if (!Number.isSafeInteger(value) || value < 0) throw new InvariantViolation('invalid-integer', [name]);
}
export function integer<N extends string>(name: N, value: number): Brand<number, N> {
  assertInteger(value, name);
  return value;
}
export type Applicability = { readonly tense: 'past' | 'current'; readonly from: WorldYear; readonly until: WorldYear | null; readonly source: string };
