import type { CampaignState } from './stateSchemas.ts';
import type { CommandEvent, CommandState } from './commands.ts';

type Order = CampaignState['mandates'][number];
type Execution = CommandState['executions'][number];

export function replaceOrder(state: CampaignState, order: Order): CampaignState {
  return { ...state, mandates: state.mandates.map(m => m.orderId === order.orderId ? order : m) };
}
export function replaceExecution(state: CampaignState, execution: Execution): CampaignState {
  return { ...state, commands: { ...state.commands, executions: state.commands.executions.map(e => e.orderId === execution.orderId ? execution : e) } };
}
export function appendEvent(state: CampaignState, order: Order, kind: CommandEvent['kind'], phase: number, reason: string | null = null, physical: CommandEvent['physical'] = null): CampaignState {
  const previous = state.commands.events.filter(e => e.orderId === order.orderId).at(-1);
  const sequence = state.commands.events.length + 1;
  const event: CommandEvent = { id: order.orderId + ':event:' + sequence, orderId: order.orderId, causeId: order.causeId,
    predecessorId: previous?.id ?? null, at: state.clock.worldMilliseconds, phase, sequence, kind, effectId: null, reason, physical };
  return { ...state, clock: { ...state.clock, sequence: state.clock.sequence + 1 }, commands: { ...state.commands, events: [...state.commands.events, event] } };
}
export function releaseReservations(state: CampaignState, order: Order): CampaignState {
  return replaceOrder({ ...state, reservations: state.reservations.filter(r => r.orderId !== order.orderId) }, { ...order, reservationIds: [] });
}
