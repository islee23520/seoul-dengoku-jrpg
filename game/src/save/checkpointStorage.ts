import { z } from '../../../engine/node_modules/zod/index.js';
import { CheckpointCorrupt } from './campaignCheckpoint.ts';
import type { CheckpointStorage } from './campaignCheckpoint.ts';

const pointerSchema = z.strictObject({ current: z.string().min(1), previous: z.string().min(1).nullable() });
export function parseSaveJson(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new CheckpointCorrupt('invalid-json');
  }
}
function pointer(raw: string, namespace: string) {
  const parsed = pointerSchema.safeParse(parseSaveJson(raw));
  if (!parsed.success || ![parsed.data.current, parsed.data.previous].every(key => key === null || key.startsWith(namespace + ':payload:'))) {
    throw new CheckpointCorrupt('invalid-pointer');
  }
  return parsed.data;
}
export type StoredCheckpoint<T> = {
  readonly namespace: string;
  readonly parse: (value: unknown) => T;
  readonly checksum: (value: T) => string;
  readonly encode?: (value: T) => string;
};

/** Storage.setItem is the atomic commit primitive (including on quota failure).
 * A partial staged payload can remain after termination; it is never made active.
 * There is deliberately no cleanup/rollback write after the pointer commits.
 */
export function writeCheckpoint<T>(storage: CheckpointStorage, input: unknown, format: StoredCheckpoint<T>): T {
  const value = format.parse(input);
  const key = format.namespace + ':payload:' + format.checksum(value);
  const encoded = format.encode ? format.encode(value) : JSON.stringify(value);
  try {
    const raw = storage.getItem(format.namespace + ':active');
    const previous = raw === null ? null : pointer(raw, format.namespace);
    const existing = storage.getItem(key);
    if (existing !== null && existing !== encoded && (previous?.current === key || previous?.previous === key)) {
      throw new CheckpointCorrupt('payload-key-conflict');
    }
    if (existing !== encoded) storage.setItem(key, encoded);
    const readback = storage.getItem(key);
    if (readback !== encoded) throw new CheckpointCorrupt('staged-readback');
    format.parse(parseSaveJson(readback));
    if (previous?.current !== key) storage.setItem(format.namespace + ':active', JSON.stringify({ current: key, previous: previous?.current ?? null }));
    return value;
  } catch (error) {
    if (error instanceof DOMException) throw new CheckpointCorrupt('storage-' + error.name);
    throw error;
  }
}
export function readCheckpoint<T>(storage: CheckpointStorage, format: StoredCheckpoint<T>): T {
  try {
    const raw = storage.getItem(format.namespace + ':active');
    if (raw === null) throw new CheckpointCorrupt('missing-checkpoint');
    const active = pointer(raw, format.namespace);
    const bytes = storage.getItem(active.current);
    if (bytes === null) throw new CheckpointCorrupt('missing-payload');
    const value = format.parse(parseSaveJson(bytes));
    if (active.current !== format.namespace + ':payload:' + format.checksum(value)) throw new CheckpointCorrupt('pointer-checksum');
    return value;
  } catch (error) {
    if (error instanceof DOMException) throw new CheckpointCorrupt('storage-' + error.name);
    throw error;
  }
}
