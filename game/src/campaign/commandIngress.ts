import { id, integer } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { requireBoundary } from './errors.ts';
import { parseCampaignCommand } from './commands.ts';
import { colocated, communicationSteps, contactReadiness } from './commandSchedule.ts';
import { nodeLocation } from './locations.ts';
import { replaceOrder, replaceExecution, appendEvent } from './commandTransitions.ts';
type Order = CampaignState['mandates'][number];

/** UI ingress: fixed scoped operations only, no supplied authority, effects, stages or timestamps. */
export function submitCampaignCommand(inputState: CampaignState, input: unknown, content: CampaignContent) {
  const command = parseCampaignCommand(input);
  const state = parseCampaignState(inputState, content);
  const payloadHash = summaryHash(command);
  const replay = state.commands.receipts.find(r => r.command.commandId === command.commandId);
  if (replay) {
    requireBoundary(replay.payloadHash === payloadHash, 'command-conflict');
    return { state, receipt: replay };
  }
  requireBoundary(command.expectedRevision === state.revision, 'stale-version');
  let next = state;
  let order: Order;
  if (command.kind === 'issue') {
    const basis = composeCampaignAuthority(state, commandAuthorityRequest(command), content);
    const recipient = state.bodies.find(b => b.entityId === basis.recipientId);
    const issuer = state.bodies.find(b => b.entityId === basis.issuerPersonId);
    requireBoundary(recipient !== undefined && issuer !== undefined, 'body-unavailable');
    order = { origin: 'command-ingress', orderId: id('OrderId', command.commandId), causeId: id('CauseId', command.commandId), operation: command.operation,
      issuerPersonId: basis.issuerPersonId, recipientId: basis.recipientId, authority: basis.authority, compositeVersion: basis.compositeVersion,
      target: nodeLocation(command.operation === 'S01-L' ? content.data.scenario.ledger.container : 's01:townhall:cistern', content),
      issuerLocation: issuer.location, recipientLocation: recipient.location,
      route: [id('CampaignNodeId', 's01:townhall:desk')], stage: 'proposed', issuedAt: state.clock.worldMilliseconds,
      receivedAt: null, acceptedAt: null, returnAcceptedAt: null, workMilliseconds: 0, reservationIds: [], pendingResultIds: [], appliedResultIds: [] };
    contactReadiness(state, order, content);
    const steps = communicationSteps(order, content);
    const until = state.clock.worldMilliseconds + steps.reduce((sum, step) => sum + step.duration, 0) / content.data.operations.routes.tiredMultiplier;
    const resources: CampaignState['reservations'][number]['resource'][] = [
      ...[order.issuerPersonId, order.recipientId, id('DutyId', content.data.operations.authority.duty)].map(entityId => ({ kind: 'body' as const, entityId })),
      { kind: 'asset', assetId: content.data.operations.provisions.writingKit },
      ...(order.operation === 'S01-L' ? [{ kind: 'asset' as const, assetId: content.data.scenario.ledger.id }] : []),
    ];
    const reservations = resources.map((resource, index) => ({ id: order.orderId + ':contact:' + index, orderId: order.orderId, resource,
      from: state.clock.worldMilliseconds, until: integer('WorldMilliseconds', until), consumptionId: null }));
    order = { ...order, reservationIds: reservations.map(r => r.id) };
    next = { ...state, mandates: [...state.mandates, order], reservations: [...state.reservations, ...reservations],
      commands: { ...state.commands, executions: [...state.commands.executions, { orderId: order.orderId, step: 0,
        startedAt: state.clock.worldMilliseconds, progressedMilliseconds: 0, status: 'communicating', declineRequested: false, cancellation: null }] } };
    next = appendEvent(next, order, 'issued', 2);
  } else {
    const existing = state.mandates.find(m => m.orderId === command.orderId);
    requireBoundary(existing !== undefined && existing.issuerPersonId === command.issuerPersonId, 'authority-source');
    order = existing;
    const execution = state.commands.executions.find(e => e.orderId === order.orderId);
    requireBoundary(execution !== undefined && execution.status !== 'terminal' && execution.cancellation === null, 'action-scope');
    const people = [order.issuerPersonId, order.recipientId];
    const now = state.clock.worldMilliseconds;
    const remainingContact = colocated(state, people) ? 0 : communicationSteps(order, content).slice(execution.step).reduce((sum, step) => sum + step.duration, 0);
    const until = integer('WorldMilliseconds', now + (remainingContact + content.data.operations.durations.revocationNotice * 1000) / content.data.operations.routes.tiredMultiplier);
    requireBoundary(!state.reservations.some(r => {
      const resource = r.resource;
      return r.orderId !== order.orderId && r.from < until && now < r.until && resource.kind === 'body' && people.some(person => person === resource.entityId);
    }), 'rejected-conflict');
    const reservations = [...state.reservations];
    for (const entityId of people) {
      const index = reservations.findIndex(r => r.orderId === order.orderId && r.resource.kind === 'body' && r.resource.entityId === entityId && r.until >= now);
      const previous = reservations[index];
      if (previous) reservations[index] = { ...previous, until: integer('WorldMilliseconds', Math.max(previous.until, until)) };
      else reservations.push({ id: command.commandId + ':notice:' + entityId, orderId: order.orderId, resource: { kind: 'body', entityId }, from: now, until, consumptionId: null });
    }
    next = replaceOrder({ ...state, reservations }, { ...order, reservationIds: reservations.filter(r => r.orderId === order.orderId).map(r => r.id) });
    next = replaceExecution(next, { ...execution, cancellation: { commandId: command.commandId, requestedAt: now, startedAt: null, receivedAt: null, progressMilliseconds: 0 } });
    next = appendEvent(next, order, 'cancellation-requested', 2);
  }
  const event = next.commands.events.at(-1);
  requireBoundary(event !== undefined, 'event-order');
  const receipt = { command, payloadHash, orderId: order.orderId, at: state.clock.worldMilliseconds, revision: state.revision + 1, eventId: event.id };
  next = parseCampaignState({ ...next, revision: receipt.revision, commands: { ...next.commands, receipts: [...next.commands.receipts, receipt] } }, content);
  const stored = next.commands.receipts.at(-1);
  requireBoundary(stored !== undefined, 'cross-link');
  return { state: next, receipt: stored };
}
function commandAuthorityRequest(command: Extract<ReturnType<typeof parseCampaignCommand>, { kind: 'issue' }>) {
  return { operation: command.operation, issuerPersonId: command.issuerPersonId, recipientId: command.recipientId,
    expectedRevision: command.expectedRevision, expectedCompositeVersion: command.expectedCompositeVersion };
}
