import { z } from '../../../engine/node_modules/zod/index.js';
import { count, milliseconds, ref } from './contentSchemas.ts';

const progress = z.number().nonnegative().multipleOf(0.5);
const effort = z.record(ref, z.array(count).length(6));
export const s01StateSchema = z.strictObject({
  tracks: z.array(z.strictObject({
    id: ref, orderId: ref, lane: z.enum(['investigation', 'recipient-return', 'duty-return', 'cut-return']),
    step: count, startedAt: milliseconds, elapsed: count, progress,
    initialEffort: effort, status: z.enum(['running', 'return-response', 'done', 'interrupted']),
    retreatMillimetres: count.default(0), noticeId: ref.nullable().default(null),
  }).readonly()).readonly(),
  activities: z.array(z.strictObject({
    id: ref, trackId: ref, step: count, startedAt: milliseconds, completedAt: milliseconds,
    elapsed: count, progress, initialEffort: effort, finalEffort: effort,
  }).readonly()).readonly(),
  care: z.array(z.strictObject({ id: ref, entityId: ref, kind: z.enum(['rest', 'food', 'water']),
    startedAt: milliseconds, elapsed: count, initialEffort: z.array(count).length(6),
    status: z.enum(['running', 'completed', 'interrupted']),
  }).readonly()).readonly(),
}).readonly();
export type S01State = z.infer<typeof s01StateSchema>;
