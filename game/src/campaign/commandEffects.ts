import { z } from '../../../engine/node_modules/zod/index.js';
import { ref } from './contentSchemas.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import { commandEventSchema } from './commands.ts';

const effectSchema = z.strictObject({ orderId: ref, resultId: ref,
  transition: z.enum(['work-completed', 'report-received', 'return-completed']) });

/** Consumes actual task 9/10 result receipts. A stage label or caller timestamp is never an effect. */
export function acknowledgeCommandEffect(inputState: CampaignState, input: unknown, content: CampaignContent): CampaignState {
  ownInput(input);
  const parsed = effectSchema.safeParse(input);
  if (!parsed.success) throw new CampaignBoundaryError('shape');
  const state = parseCampaignState(inputState, content), request = parsed.data;
  const order = state.mandates.find(m => m.orderId === request.orderId);
  const result = state.results.find(r => r.id === request.resultId && r.orderId === request.orderId);
  requireBoundary(order !== undefined && result !== undefined, 'cross-link');
  const existing = state.commands.events.find(e => e.effectId === result.id);
  if (existing) {
    requireBoundary(existing.kind === request.transition, 'command-conflict');
    return state;
  }
  requireBoundary(result.at === state.clock.worldMilliseconds && order.acceptedAt !== null && result.at > order.acceptedAt, 'event-order');
  const previous = state.commands.events.filter(e => e.orderId === order.orderId).at(-1);
  requireBoundary(previous !== undefined, 'event-order');
  let stage = order.stage;
  let returnResponse = false;
  switch (request.transition) {
    case 'work-completed':
      requireBoundary(result.kind === 'work' && order.stage === 'executing' &&
        state.facts.some(f => f.orderId === order.orderId && f.observedAt === result.at), 'cross-link');
      stage = 'result-applied'; break;
    case 'report-received':
      requireBoundary(result.kind === 'report' && order.stage === 'result-applied' && state.reports.some(r => r.fact.orderId === order.orderId && r.receivedAt === result.at), 'report-link');
      // The original remains return-required; report receipt cannot complete the ledger mandate.
      stage = order.operation === 'S01-O' ? 'receipt' : 'result-applied';
      returnResponse = order.operation === 'S01-L'; break;
    case 'return-completed':
      requireBoundary(order.operation === 'S01-L' && order.returnAcceptedAt !== null && order.returnAcceptedAt < result.at &&
        result.kind === 'safe-return' && result.safeReturn?.action === 'reseal' && state.custody.some(c => c.returnState === 'resealed') &&
        state.commands.events.some(e => e.orderId === order.orderId && e.kind === 'report-received'), 'custody');
      stage = 'receipt'; break;
  }
  const event = commandEventSchema.parse({ id: order.orderId + ':effect:' + result.id, orderId: order.orderId, causeId: order.causeId,
    predecessorId: previous.id, at: result.at, phase: 3, sequence: state.commands.events.length + 1, kind: request.transition,
    effectId: result.id, reason: null });
  return parseCampaignState({ ...state, clock: { ...state.clock, sequence: state.clock.sequence + 1 },
    mandates: state.mandates.map(m => m.orderId === order.orderId ? { ...m, stage } : m),
    commands: { ...state.commands, events: [...state.commands.events, event], executions: state.commands.executions.map(e =>
      e.orderId !== order.orderId ? e : stage === 'receipt' ? { ...e, status: 'terminal' } : returnResponse ?
        { ...e, status: 'return-response', startedAt: state.clock.worldMilliseconds, progressedMilliseconds: 0 } : e) } }, content);
}
