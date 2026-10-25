import { z } from '../../../engine/node_modules/zod/index.js';
import { count, digest, milliseconds, personId, ref } from './contentSchemas.ts';
import { CampaignBoundaryError, ownInput } from './errors.ts';

const common = { commandId: ref, issuerPersonId: personId, expectedRevision: count };
export const campaignCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('issue'), operation: z.enum(['S01-L', 'S01-O']),
    recipientId: personId, expectedCompositeVersion: digest }).readonly(),
  z.strictObject({ ...common, kind: z.literal('request-cancellation'), orderId: ref }).readonly(),
]);
export type CampaignCommand = z.infer<typeof campaignCommandSchema>;
export function parseCampaignCommand(input: unknown): CampaignCommand {
  ownInput(input);
  const result = campaignCommandSchema.safeParse(input);
  if (!result.success) throw new CampaignBoundaryError('shape');
  return result.data;
}

export const commandEventSchema = z.strictObject({
  id: ref, orderId: ref, causeId: ref, predecessorId: ref.nullable(), at: milliseconds,
  phase: z.int().min(0).max(5), sequence: count,
  kind: z.enum(['issued', 'arrival', 'called', 'delivered', 'received', 'accepted', 'refused', 'reserved', 'executing',
    'cancellation-requested', 'notice-received', 'cancelled', 'interrupted', 'work-completed', 'report-received', 'return-accepted', 'return-completed']),
  effectId: ref.nullable(), reason: ref.nullable(),
  physical: z.strictObject({ startedAt: milliseconds, completedAt: milliseconds,
    participants: z.array(ref).min(1).readonly(), activity: z.enum(['walking', 'stationary']),
    from: ref, to: ref, durationMilliseconds: count,
  }).readonly().nullable().default(null),
}).readonly();
export type CommandEvent = z.infer<typeof commandEventSchema>;
export const commandStateSchema = z.strictObject({
  handlers: z.array(z.strictObject({ id: ref, at: milliseconds, phase: z.int().min(0).max(5),
    predecessorId: ref.nullable(), acceptanceSequence: count }).readonly()).readonly(),
  receipts: z.array(z.strictObject({ command: campaignCommandSchema, payloadHash: digest, orderId: ref,
    at: milliseconds, revision: count, eventId: ref }).readonly()).readonly(),
  events: z.array(commandEventSchema).readonly(),
  executions: z.array(z.strictObject({
    orderId: ref, step: count, startedAt: milliseconds, progressedMilliseconds: z.number().nonnegative().multipleOf(0.5),
    status: z.enum(['communicating', 'awaiting-effects', 'return-response', 'terminal']),
    declineRequested: z.boolean(),
    cancellation: z.strictObject({ commandId: ref, requestedAt: milliseconds, startedAt: milliseconds.nullable(), receivedAt: milliseconds.nullable(), progressMilliseconds: z.number().nonnegative().multipleOf(0.5) }).readonly().nullable(),
  }).readonly()).readonly(),
}).readonly();
export type CommandState = z.infer<typeof commandStateSchema>;

/** Topological order within each time/phase, then recorded acceptance order and stable ID. */
export function orderCausalEvents<T extends { readonly id: string; readonly at: number; readonly phase: number;
  readonly predecessorId: string | null; readonly acceptanceSequence: number }>(events: readonly T[], applied: readonly string[]): readonly T[] {
  const pending = [...events], known = new Set(applied), ordered: T[] = [];
  if (new Set(pending.map(e => e.id)).size !== pending.length || pending.some(e => known.has(e.id))) throw new CampaignBoundaryError('duplicate-id');
  while (pending.length) {
    pending.sort((a, b) => a.at - b.at || a.phase - b.phase || a.acceptanceSequence - b.acceptanceSequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const first = pending[0];
    if (!first) break;
    const index = pending.findIndex(e => e.at === first.at && e.phase === first.phase && (e.predecessorId === null || known.has(e.predecessorId)));
    if (index < 0) throw new CampaignBoundaryError('event-order');
    const [event] = pending.splice(index, 1);
    if (!event) throw new CampaignBoundaryError('event-order');
    ordered.push(event); known.add(event.id);
  }
  return ordered;
}
