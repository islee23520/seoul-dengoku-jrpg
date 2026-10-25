import { z } from '../../../engine/node_modules/zod/index.js';
import { id } from './ids.ts';

const text = z.string().trim().min(1);
const amount = z.number().nonnegative();
export const stationGoodSchema = z.strictObject({
  id: text, basePrice: amount, price: amount, stock: z.number().int().nonnegative(),
  quality: text, demandTags: z.array(text).readonly(),
}).readonly();
export type StationGood = z.infer<typeof stationGoodSchema>;
export const conditionSchema = z.strictObject({
  kind: z.enum(['power-outage', 'contamination', 'faction-demand', 'stock-response']),
  cause: text, goodId: text,
}).readonly();
export type StationCondition = z.infer<typeof conditionSchema>;
const eventBase = { resultId: text.transform(v => id('ResultId', v)), causeId: text.transform(v => id('CauseId', v)), cause: text };
export const economyEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...eventBase, kind: z.literal('condition'), condition: conditionSchema }),
  z.strictObject({ ...eventBase, kind: z.literal('trade'), goodId: text, quantity: z.number().int().positive(), route: text }),
  z.strictObject({ ...eventBase, kind: z.literal('investment'), sector: z.enum(['commercial', 'military']),
    investor: text.transform(v => id('PersonId', v)), amount: amount.positive() }),
]).readonly();
export type EconomyEvent = z.infer<typeof economyEventSchema>;
export const economySchema = z.strictObject({
  stationId: text.transform(v => id('StationId', v)),
  goods: z.array(stationGoodSchema).readonly(), conditions: z.array(conditionSchema).readonly(),
  investments: z.array(z.strictObject({ investor: text.transform(v => id('PersonId', v)),
    sector: z.enum(['commercial', 'military']), amount, share: amount }).readonly()).readonly(),
  availableFacilities: z.array(text).readonly(), unlockedFacilities: z.array(text).readonly(),
  materials: z.array(text).readonly(), defense: amount, visibleChanges: z.array(text).readonly(),
  priceChanges: z.array(z.strictObject({ resultId: eventBase.resultId, goodId: text,
    before: amount, after: amount, cause: text }).readonly()).readonly(),
  appliedResultIds: z.array(eventBase.resultId).readonly(),
}).readonly().superRefine((state, context) => {
  if (new Set(state.goods.map(g => g.id)).size !== state.goods.length ||
    new Set(state.appliedResultIds).size !== state.appliedResultIds.length ||
    state.unlockedFacilities.some(f => !state.availableFacilities.includes(f))) {
    context.addIssue({ code: 'custom', message: 'invalid-economy-state' });
  }
});
export type StationEconomy = z.infer<typeof economySchema>;
