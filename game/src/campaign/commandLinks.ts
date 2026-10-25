import { summaryHash } from '../domain/eventLedger.ts';
import { requireBoundary } from './errors.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { communicationSteps } from './commandSchedule.ts';

/** The journal is checkpoint state, not an in-memory idempotency cache. */
export function assertCommandLinks(state: CampaignState, content: CampaignContent): void {
  const { receipts, events, executions, handlers } = state.commands;
  for (const ids of [receipts.map(r => r.command.commandId), [...events, ...handlers].map(e => e.id), executions.map(e => e.orderId)]) {
    requireBoundary(ids.length === new Set(ids).size, 'duplicate-id');
  }
  requireBoundary(events.length <= state.clock.sequence, 'event-order');
  for (const [index, handler] of handlers.entries()) {
    requireBoundary(handler.at <= state.clock.worldMilliseconds && (handler.predecessorId === null ||
      [...events, ...handlers.slice(0, index)].some(e => e.id === handler.predecessorId && e.at <= handler.at)), 'event-order');
  }
  for (const order of state.mandates) {
    if (order.origin === 'command-ingress') {
      requireBoundary(executions.some(e => e.orderId === order.orderId) && receipts.some(r => r.orderId === order.orderId && r.command.kind === 'issue'), 'cross-link');
      if (['proposed', 'delivered', 'received', 'consent', 'reserved', 'executing'].includes(order.stage)) {
        requireBoundary(state.clock.worldMilliseconds < Math.min(state.clock.closedAt ?? Infinity, content.data.operations.clock.scheduledCloseSeconds * 1000), 'event-order');
      }
    } else requireBoundary(!executions.some(e => e.orderId === order.orderId) && !receipts.some(r => r.orderId === order.orderId) && !events.some(e => e.orderId === order.orderId), 'cross-link');
  }
  for (const [index, event] of events.entries()) {
    const previous = events[index - 1];
    requireBoundary(event.sequence === index + 1 && event.at <= state.clock.worldMilliseconds && (!previous || previous.at <= event.at), 'event-order');
    const cause = event.predecessorId === null ? null : events.slice(0, index).find(e => e.id === event.predecessorId);
    requireBoundary(event.predecessorId === null || (cause !== undefined && cause !== null && cause.at <= event.at && cause.orderId === event.orderId), 'event-order');
    requireBoundary(state.mandates.some(m => m.orderId === event.orderId && m.causeId === event.causeId), 'cross-link');
    requireBoundary(executions.some(e => e.orderId === event.orderId), 'cross-link');
    requireBoundary(event.effectId === null || state.results.some(r => r.id === event.effectId && r.orderId === event.orderId && r.at === event.at), 'cross-link');
    requireBoundary(event.id === (event.effectId === null ? event.orderId + ':event:' + event.sequence : event.orderId + ':effect:' + event.effectId), 'event-order');
    if (event.physical) requireBoundary(event.physical.completedAt === event.at && event.physical.startedAt < event.at &&
      event.at - event.physical.startedAt >= event.physical.durationMilliseconds && event.physical.participants.every(id => state.bodies.some(b => b.entityId === id)), 'event-order');
  }
  for (const receipt of receipts) {
    const order = state.mandates.find(m => m.orderId === receipt.orderId);
    const event = events.find(e => e.id === receipt.eventId);
    requireBoundary(receipt.payloadHash === summaryHash(receipt.command) && order !== undefined &&
      receipt.command.issuerPersonId === order.issuerPersonId && event !== undefined && event.orderId === receipt.orderId &&
      event.at === receipt.at && receipt.revision <= state.revision, 'cross-link');
    if (receipt.command.kind === 'issue') requireBoundary(receipt.command.commandId === order.orderId && event.kind === 'issued' &&
      receipt.command.recipientId === order.recipientId && receipt.command.operation === order.operation && receipt.command.expectedCompositeVersion === order.compositeVersion, 'cross-link');
    else requireBoundary(event.kind === 'cancellation-requested' && receipt.command.orderId === order.orderId, 'cross-link');
  }
  for (const execution of executions) {
    const order = state.mandates.find(m => m.orderId === execution.orderId);
    requireBoundary(order !== undefined && receipts.some(r => r.orderId === order.orderId && r.command.kind === 'issue'), 'cross-link');
    requireBoundary(execution.startedAt <= state.clock.worldMilliseconds, 'clock');
    const chain = events.filter(e => e.orderId === order.orderId);
    requireBoundary(chain[0]?.kind === 'issued' && chain[0].at === order.issuedAt && chain.every((e, i) =>
      e.predecessorId === (chain[i - 1]?.id ?? null)), 'event-order');
    for (const kind of ['issued', 'delivered', 'received', 'accepted', 'reserved', 'executing', 'work-completed', 'report-received', 'return-accepted', 'return-completed', 'cancellation-requested', 'notice-received']) {
      requireBoundary(chain.filter(e => e.kind === kind).length <= 1, 'duplicate-id');
    }
    const milestones = ['issued', 'delivered', 'received', 'accepted', 'reserved', 'executing', 'work-completed', 'report-received', 'return-accepted', 'return-completed'];
    let prior = -1;
    for (const event of chain) {
      const index = milestones.indexOf(event.kind);
      if (index < 0) continue;
      requireBoundary(index === prior + 1, 'event-order'); prior = index;
    }
    const steps = communicationSteps(order, content);
    requireBoundary(execution.step <= steps.length && (execution.step < steps.length || execution.status !== 'communicating'), 'event-order');
    const step = steps[execution.step];
    requireBoundary(!step || execution.progressedMilliseconds < step.duration, 'event-order');
    const completions = chain.filter(e => e.physical !== null && !['return-accepted', 'interrupted', 'notice-received'].includes(e.kind));
    requireBoundary(completions.length === execution.step, 'event-order');
    for (const [index, event] of completions.entries()) {
      const step = steps[index], physical = event.physical;
      requireBoundary(physical !== null && physical.startedAt >= (completions[index - 1]?.at ?? order.issuedAt), 'event-order');
      requireBoundary(step !== undefined && physical !== null && physical.durationMilliseconds === step.duration && physical.from === step.from &&
        physical.to === step.to && summaryHash(physical.participants) === summaryHash(step.people) &&
        (step.kind === 'response' ? ['accepted', 'refused'].includes(event.kind) : event.kind === (step.kind === 'walk' ? 'arrival' : step.kind === 'call' ? 'called' : 'delivered')), 'event-order');
    }
    requireBoundary(execution.startedAt >= (completions.at(-1)?.at ?? order.issuedAt) &&
      execution.progressedMilliseconds <= state.clock.worldMilliseconds - execution.startedAt, 'event-order');
    const received = chain.find(e => e.kind === 'received'), accepted = chain.find(e => e.kind === 'accepted');
    requireBoundary(order.receivedAt === (received?.at ?? null) && order.acceptedAt === (accepted?.at ?? null), 'event-order');
    if (accepted) requireBoundary(received !== undefined && accepted.at - received.at >= content.data.operations.durations.response * 1000, 'event-order');
    const returned = chain.find(e => e.kind === 'return-accepted');
    requireBoundary(order.returnAcceptedAt === (returned?.at ?? null), 'event-order');
    if (returned) {
      const physical = returned.physical;
      requireBoundary(physical !== null && physical.durationMilliseconds === content.data.operations.durations.returnResponse * 1000 &&
        chain.some(e => e.kind === 'report-received' && e.at <= physical.startedAt), 'event-order');
    }
    if (execution.cancellation) {
      const cancellation = execution.cancellation;
      const notice = chain.find(e => e.kind === 'notice-received');
      requireBoundary(receipts.some(r => r.command.commandId === cancellation.commandId && r.command.kind === 'request-cancellation' && r.at === cancellation.requestedAt) &&
        cancellation.receivedAt === (notice?.at ?? null), 'cross-link');
      requireBoundary(cancellation.startedAt === null ? cancellation.progressMilliseconds === 0 && cancellation.receivedAt === null :
        cancellation.startedAt >= cancellation.requestedAt && cancellation.startedAt >= (completions.at(-1)?.at ?? order.issuedAt) &&
        cancellation.startedAt <= state.clock.worldMilliseconds && cancellation.progressMilliseconds <= state.clock.worldMilliseconds - cancellation.startedAt, 'event-order');
      if (notice) {
        const physical = notice.physical;
        requireBoundary(physical !== null && physical.startedAt === cancellation.startedAt && physical.durationMilliseconds === content.data.operations.durations.revocationNotice * 1000 &&
          physical.activity === 'stationary' && physical.from === 's01:townhall:desk' && physical.to === physical.from &&
          summaryHash(physical.participants) === summaryHash([order.issuerPersonId, order.recipientId]) &&
          cancellation.progressMilliseconds === physical.durationMilliseconds, 'event-order');
      }
      const noticeStart = cancellation.startedAt;
      if (execution.status !== 'terminal' && noticeStart !== null) requireBoundary([order.issuerPersonId, order.recipientId].every(person =>
        state.reservations.some(r => r.orderId === order.orderId && r.resource.kind === 'body' && r.resource.entityId === person &&
          r.from <= noticeStart && r.until >= state.clock.worldMilliseconds)), 'cross-link');
    }
    if (execution.status === 'terminal') requireBoundary(['refused', 'cancelled', 'interrupted', 'expired', 'receipt'].includes(order.stage), 'event-order');
    if (execution.status === 'communicating') requireBoundary(['proposed', 'received'].includes(order.stage), 'event-order');
    if (execution.status === 'awaiting-effects') requireBoundary(['consent', 'reserved', 'executing', 'result-applied'].includes(order.stage), 'event-order');
    if (execution.status === 'return-response') requireBoundary(order.operation === 'S01-L' && order.stage === 'result-applied' &&
      order.returnAcceptedAt === null && chain.some(e => e.kind === 'report-received') && execution.progressedMilliseconds < content.data.operations.durations.returnResponse * 1000, 'event-order');
  }
}
