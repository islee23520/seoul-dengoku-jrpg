import { sha256 } from '../../../engine/node_modules/@noble/hashes/sha2.js';
import type { CauseId, PersonId, ResultId, SchemaVersion, WorldTick } from './ids.ts';
import { integer } from './ids.ts';
import { CheckpointCorrupt, LedgerConflict, VersionMismatch, requireCause } from './errors.ts';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type LedgerEntry = {
  readonly causeId: CauseId; readonly command: string; readonly worldTime: WorldTick;
  readonly actor: PersonId; readonly target: string; readonly beforeHash: string; readonly afterHash: string;
  readonly ruleVersion: string; readonly contentVersion: string; readonly resultId: ResultId; readonly payload: JsonValue;
};
export type Versions = { readonly schemaVersion: SchemaVersion; readonly ruleVersion: string; readonly contentVersion: string };
export type SettlementReceipt = { readonly resultId: ResultId; readonly payloadHash: string; readonly ledgerCursor: number; readonly afterHash: string };
export type EventLedger = Versions & { readonly entries: readonly LedgerEntry[]; readonly pendingResultIds: readonly ResultId[] };
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': case 'boolean': return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CheckpointCorrupt('nonfinite-json');
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
      return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
    default: throw new CheckpointCorrupt('non-json-value');
  }
}
export function summaryHash(value: JsonValue): string {
  return Array.from(sha256(new TextEncoder().encode(canonicalJson(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export function assertVersionCompatible(actual: Versions, expected: Versions): void {
  for (const key of ['schemaVersion', 'ruleVersion', 'contentVersion'] as const) {
    if (actual[key] !== expected[key]) throw new VersionMismatch(String(expected[key]), String(actual[key]));
  }
}
export function cursor(ledger: EventLedger): number { return ledger.entries.length; }
export function foldLedger(ledger: EventLedger): string { return summaryHash({ ...ledger }); }
export function applyResult(ledger: EventLedger, entry: LedgerEntry): { readonly ledger: EventLedger; readonly receipt: SettlementReceipt } {
  requireCause(entry.causeId);
  assertVersionCompatible({ ...ledger, ruleVersion: entry.ruleVersion, contentVersion: entry.contentVersion }, ledger);
  const previousIndex = ledger.entries.findIndex(e => e.resultId === entry.resultId);
  if (previousIndex >= 0) {
    const previous = ledger.entries[previousIndex];
    if (!previous || summaryHash({ ...previous }) !== summaryHash({ ...entry })) throw new LedgerConflict(entry.resultId);
    return { ledger, receipt: { resultId: entry.resultId, payloadHash: summaryHash(entry.payload), ledgerCursor: previousIndex + 1, afterHash: previous.afterHash } };
  }
  const last = ledger.entries.at(-1);
  if (last && (entry.worldTime < last.worldTime || entry.beforeHash !== last.afterHash)) throw new CheckpointCorrupt('ledger-chain');
  if (!entry.command || !entry.actor || !entry.target || !entry.resultId || !entry.beforeHash || !entry.afterHash) throw new CheckpointCorrupt('entry-fields');
  const next = { ...ledger, entries: [...ledger.entries, entry], pendingResultIds: ledger.pendingResultIds.filter(id => id !== entry.resultId) };
  return { ledger: next, receipt: { resultId: entry.resultId, payloadHash: summaryHash(entry.payload), ledgerCursor: cursor(next), afterHash: entry.afterHash } };
}
// Snapshot boundary: unknown data is checked here, never passed into domain logic.
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return record(value) && Object.values(value).every(isJson);
}
function assertEntry(value: unknown): asserts value is LedgerEntry {
  if (!record(value) || !['causeId', 'command', 'actor', 'target', 'beforeHash', 'afterHash', 'ruleVersion', 'contentVersion', 'resultId'].every(k => typeof value[k] === 'string' && value[k].length > 0) ||
    typeof value['worldTime'] !== 'number' || !Number.isSafeInteger(value['worldTime']) || value['worldTime'] < 0 || !isJson(value['payload'])) throw new CheckpointCorrupt('entry-shape');
}
export function restoreLedger(value: unknown, expected: Versions): EventLedger {
  if (!record(value) || typeof value['schemaVersion'] !== 'number' || !Number.isSafeInteger(value['schemaVersion']) || value['schemaVersion'] < 0 ||
    typeof value['ruleVersion'] !== 'string' || typeof value['contentVersion'] !== 'string' || !Array.isArray(value['entries']) ||
    !Array.isArray(value['pendingResultIds']) || !value['pendingResultIds'].every((id: unknown) => typeof id === 'string' && id.length > 0)) throw new CheckpointCorrupt('ledger-shape');
  const versions = { schemaVersion: integer('SchemaVersion', value['schemaVersion']), ruleVersion: value['ruleVersion'], contentVersion: value['contentVersion'] };
  assertVersionCompatible(versions, expected);
  let ledger: EventLedger = { ...versions, entries: [], pendingResultIds: [] };
  for (const entry of value['entries']) {
    assertEntry(entry);
    const result = applyResult(ledger, entry);
    if (result.ledger === ledger) throw new CheckpointCorrupt('duplicate-result');
    ledger = result.ledger;
  }
  function assertPending(ids: readonly unknown[]): asserts ids is readonly ResultId[] {
    if (!ids.every(id => typeof id === 'string' && id.length > 0)) throw new CheckpointCorrupt('pending-shape');
  }
  const pending: readonly unknown[] = value['pendingResultIds'];
  assertPending(pending);
  if (new Set(pending).size !== pending.length || pending.some(id => ledger.entries.some(e => e.resultId === id))) throw new CheckpointCorrupt('pending-applied-overlap');
  return { ...ledger, pendingResultIds: [...pending] };
}
