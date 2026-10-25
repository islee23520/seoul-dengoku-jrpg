import { id, integer } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { CampaignSession } from './session.ts';
import type { PeaceSpeed, SessionOptions } from './session.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { assertComposedAuthority } from './authorityBasis.ts';
import { checkCampaignReadiness } from './authorityReadiness.ts';
import { CampaignBoundaryError, requireBoundary } from './errors.ts';
import { parseCampaignCommand, orderCausalEvents } from './commands.ts';
import type { CommandEvent, CommandState } from './commands.ts';
import { colocated, communicationSteps, contactReadiness, progressContact } from './commandSchedule.ts';
import { nodeLocation } from './locations.ts';
import { prepareS01Effects, nextS01Boundary, advanceS01Effects } from './s01Effects.ts';
import { requestS01Care, nextS01CareBoundary, advanceS01Care } from './s01Care.ts';
import { s01VisibleState } from './s01View.ts';

type Order = CampaignState['mandates'][number];
type Execution = CommandState['executions'][number];

function replaceOrder(state: CampaignState, order: Order): CampaignState {
  return { ...state, mandates: state.mandates.map(m => m.orderId === order.orderId ? order : m) };
}
function replaceExecution(state: CampaignState, execution: Execution): CampaignState {
  return { ...state, commands: { ...state.commands, executions: state.commands.executions.map(e => e.orderId === execution.orderId ? execution : e) } };
}
function appendEvent(state: CampaignState, order: Order, kind: CommandEvent['kind'], phase: number, reason: string | null = null, physical: CommandEvent['physical'] = null): CampaignState {
  const previous = state.commands.events.filter(e => e.orderId === order.orderId).at(-1);
  const sequence = state.commands.events.length + 1;
  const event: CommandEvent = { id: order.orderId + ':event:' + sequence, orderId: order.orderId, causeId: order.causeId,
    predecessorId: previous?.id ?? null, at: state.clock.worldMilliseconds, phase, sequence, kind, effectId: null, reason, physical };
  return { ...state, clock: { ...state.clock, sequence: state.clock.sequence + 1 }, commands: { ...state.commands, events: [...state.commands.events, event] } };
}
function releaseReservations(state: CampaignState, order: Order): CampaignState {
  return replaceOrder({ ...state, reservations: state.reservations.filter(r => r.orderId !== order.orderId) }, { ...order, reservationIds: [] });
}

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

function stop(state: CampaignState, execution: Execution, reason: string, physical: CommandEvent['physical'] = null): CampaignState {
  const order = state.mandates.find(m => m.orderId === execution.orderId);
  requireBoundary(order !== undefined, 'cross-link');
  const stage = order.acceptedAt === null ? 'refused' : 'interrupted';
  let next = releaseReservations(state, { ...order, stage });
  next = replaceExecution(next, { ...execution, status: 'terminal' });
  return appendEvent(next, order, stage, 2, reason, physical);
}

function advanceContact(input: CampaignState, until: CampaignState['clock']['worldMilliseconds'], content: CampaignContent, orderId: string): CampaignState {
  let state = input;
  const origin = state.clock.worldMilliseconds;
  requireBoundary(until >= origin, 'clock');
  if (until === origin) return state;
  // Contact uses the one shared duty; incompatible contacts are rejected at ingress, not queued.
  for (const initial of state.commands.executions) {
    if (initial.orderId !== orderId) continue;
    let execution = initial;
    if (execution.status === 'terminal') continue;
    while (state.clock.worldMilliseconds < until) {
      const order = state.mandates.find(m => m.orderId === execution.orderId);
      requireBoundary(order !== undefined, 'cross-link');
      if (execution.status === 'return-response' && execution.cancellation === null) {
        const o = content.data.operations;
        try {
          requireBoundary(order.operation === 'S01-L' && !execution.declineRequested && colocated(state, [order.issuerPersonId, order.recipientId]), 'consent-required');
          requireBoundary(state.custody.some(c => c.custodian === order.issuerPersonId && c.returnState === 'return-required'), 'custody');
          const response = { kind: 'response' as const, people: [order.issuerPersonId, order.recipientId], from: 's01:townhall:desk', to: 's01:townhall:desk', duration: o.durations.returnResponse * 1000 };
          const result = progressContact(state, response, execution.progressedMilliseconds, until - state.clock.worldMilliseconds, content);
          state = result.state;
          requireBoundary(!result.stopped, 'body-unavailable');
          execution = { ...execution, progressedMilliseconds: result.progress };
          if (result.progress === response.duration) {
            const physical = { startedAt: execution.startedAt, completedAt: state.clock.worldMilliseconds, participants: response.people,
              activity: 'stationary' as const, from: response.from, to: response.to, durationMilliseconds: response.duration };
            execution = { ...execution, status: 'awaiting-effects', progressedMilliseconds: 0 };
            state = replaceOrder(state, { ...order, returnAcceptedAt: state.clock.worldMilliseconds });
            state = appendEvent(state, order, 'return-accepted', 2, null, physical);
          }
          state = replaceExecution(state, execution);
        } catch (error) {
          if (!(error instanceof CampaignBoundaryError)) throw error;
          state = stop(state, execution, error.code);
        }
        break;
      }
      try { assertComposedAuthority(state, order, { content, at: state.clock.worldMilliseconds }); }
      catch (error) {
        if (!(error instanceof CampaignBoundaryError)) throw error;
        state = stop(state, execution, error.code); break;
      }
      if (execution.cancellation && colocated(state, [order.issuerPersonId, order.recipientId])) {
        const notice = { kind: 'delivery' as const, people: [order.issuerPersonId, order.recipientId], from: 's01:townhall:desk', to: 's01:townhall:desk', duration: content.data.operations.durations.revocationNotice * 1000 };
        requireBoundary(notice.people.every(person => state.reservations.some(r => r.orderId === order.orderId && r.resource.kind === 'body' &&
          r.resource.entityId === person && r.from <= state.clock.worldMilliseconds && r.until >= until)), 'rejected-conflict');
        execution = { ...execution, cancellation: { ...execution.cancellation, startedAt: execution.cancellation.startedAt ?? state.clock.worldMilliseconds } };
        requireBoundary(execution.cancellation !== null, 'cross-link');
        const result = progressContact(state, notice, execution.cancellation.progressMilliseconds, until - state.clock.worldMilliseconds, content);
        state = result.state;
        if (result.stopped) { state = stop(state, execution, 'body-unavailable'); break; }
        execution = { ...execution, cancellation: { ...execution.cancellation, progressMilliseconds: result.progress } };
        state = replaceExecution(state, execution);
        if (result.progress === notice.duration) {
          requireBoundary(execution.cancellation !== null, 'cross-link');
          execution = { ...execution, status: 'terminal', cancellation: { ...execution.cancellation, receivedAt: state.clock.worldMilliseconds } };
          state = replaceExecution(state, execution);
          requireBoundary(execution.cancellation !== null && execution.cancellation.startedAt !== null, 'event-order');
          state = appendEvent(state, order, 'notice-received', 3, null, { startedAt: execution.cancellation.startedAt,
            completedAt: state.clock.worldMilliseconds, participants: notice.people, activity: 'stationary', from: notice.from, to: notice.to, durationMilliseconds: notice.duration });
          const stage = order.acceptedAt === null ? 'cancelled' : 'interrupted';
          state = releaseReservations(state, { ...order, stage });
          state = appendEvent(state, order, stage, 3);
        }
        break;
      }
      if (execution.status === 'awaiting-effects') {
        const expires = Math.min(state.clock.closedAt ?? Infinity, content.data.operations.clock.scheduledCloseSeconds * 1000);
        if (expires <= until) state = stop({ ...state, clock: { ...state.clock, worldMilliseconds: integer('WorldMilliseconds', expires) } }, execution, 'authority-expired');
        break;
      }
      const steps = communicationSteps(order, content), step = steps[execution.step];
      requireBoundary(step !== undefined, 'event-order');
      const authorityDeadline = Math.min(state.clock.closedAt ?? Infinity, content.data.operations.clock.scheduledCloseSeconds * 1000);
      const result = progressContact(state, step, execution.progressedMilliseconds, Math.min(until, authorityDeadline) - state.clock.worldMilliseconds, content);
      state = result.state;
      execution = { ...execution, progressedMilliseconds: result.progress };
      state = replaceExecution(state, execution);
      if (result.stopped) { state = stop(state, execution, 'body-unavailable'); break; }
      if (result.progress < step.duration) continue;
      const physical = { startedAt: execution.startedAt, completedAt: state.clock.worldMilliseconds,
        participants: step.people, activity: step.kind === 'walk' ? 'walking' as const : 'stationary' as const,
        from: step.from, to: step.to, durationMilliseconds: step.duration };
      execution = { ...execution, step: execution.step + 1, startedAt: state.clock.worldMilliseconds, progressedMilliseconds: 0 };
      state = replaceExecution(state, execution);
      if (step.kind === 'walk') state = appendEvent(state, order, 'arrival', 1, null, physical);
      if (step.kind === 'call') state = appendEvent(state, order, 'called', 2, null, physical);
      if (step.kind === 'delivery') {
        state = replaceOrder(state, { ...order, stage: 'delivered' });
        state = appendEvent(state, order, 'delivered', 2, null, physical);
        state = replaceOrder(state, { ...order, stage: 'received', receivedAt: state.clock.worldMilliseconds });
        state = appendEvent(state, order, 'received', 2);
      }
      if (step.kind === 'response') {
        try {
          requireBoundary(!execution.declineRequested, 'recipient-unavailable');
          contactReadiness(state, order, content);
          const accepted = { ...order, stage: 'consent' as const, acceptedAt: state.clock.worldMilliseconds };
          state = replaceOrder(state, accepted);
          state = appendEvent(state, accepted, 'accepted', 2, null, physical);
          execution = { ...execution, status: 'awaiting-effects' };
          state = replaceExecution(state, execution);
          state = releaseReservations(state, accepted);
          const action = order.operation === 'S01-L' ? { kind: 'archive-check' as const } : { kind: 'walk' as const, to: 's01:townhall:entry' };
          const firstEdge = content.data.operations.routes.edges.find(e => e.from === 's01:townhall:desk' && e.to === 's01:townhall:entry');
          requireBoundary(firstEdge !== undefined, 'location-scope');
          const duration = (order.operation === 'S01-L' ? content.data.operations.durations.archiveCheck : firstEdge.metres / content.data.operations.routes.walkingMetresPerSecond) * 1000;
          const ready = checkCampaignReadiness(state, { orderId: order.orderId, expectedRevision: state.revision,
            expectedCompositeVersion: order.compositeVersion, until: state.clock.worldMilliseconds + duration, action }, content);
          const reservations = ready.resources.map((resource, index) => ({ id: order.orderId + ':work:' + index, orderId: order.orderId,
            resource, from: ready.from, until: ready.until, consumptionId: null }));
          const reserved = { ...accepted, stage: 'reserved' as const, reservationIds: reservations.map(r => r.id) };
          state = replaceOrder({ ...state, reservations: [...state.reservations, ...reservations] }, reserved);
          state = appendEvent(state, reserved, 'reserved', 2);
          state = replaceOrder(state, { ...reserved, stage: 'executing' });
          state = appendEvent(state, reserved, 'executing', 2);
        } catch (error) {
          if (!(error instanceof CampaignBoundaryError)) throw error;
          state = stop(state, execution, error.code, state.commands.events.some(e => e.orderId === order.orderId && e.kind === 'accepted') ? null : physical);
        }
        break;
      }
    }
  }
  return { ...state, revision: input.revision + until - origin, clock: { ...state.clock, worldMilliseconds: until } };
}

/** Exact event-time reducer supplied to the existing clock owner; no timer or alternate clock. */
export function advanceCampaignCommands(input: CampaignState, until: CampaignState['clock']['worldMilliseconds'], content: CampaignContent, physical = false): CampaignState {
  let state = parseCampaignState(input, content);
  const origin = state.clock.worldMilliseconds;
  requireBoundary(until >= origin, 'clock');
  while (state.clock.worldMilliseconds < until) {
    if (physical) state = prepareS01Effects(state, content);
    const from = state.clock.worldMilliseconds;
    let nextAt: number = physical ? nextS01CareBoundary(state, nextS01Boundary(state, until, content), content) : until;
    const active = state.commands.executions.filter(e => e.status !== 'terminal');
    const expires = Math.min(state.clock.closedAt ?? Infinity, content.data.operations.clock.scheduledCloseSeconds * 1000);
    if (active.length && expires > from) nextAt = Math.min(nextAt, expires);
    const phases = new Map<string, 1 | 2 | 3>();
    for (const execution of active) {
      const order = state.mandates.find(m => m.orderId === execution.orderId);
      requireBoundary(order !== undefined, 'cross-link');
      let step = communicationSteps(order, content)[execution.step];
      let progress = execution.progressedMilliseconds;
      if (execution.cancellation && colocated(state, [order.issuerPersonId, order.recipientId])) {
        step = { kind: 'delivery', people: [order.issuerPersonId, order.recipientId], from: 's01:townhall:desk', to: 's01:townhall:desk', duration: content.data.operations.durations.revocationNotice * 1000 };
        progress = execution.cancellation.progressMilliseconds;
        phases.set(order.orderId, 3);
      } else if (execution.status === 'return-response') {
        step = { kind: 'response', people: [order.issuerPersonId, order.recipientId], from: 's01:townhall:desk', to: 's01:townhall:desk', duration: content.data.operations.durations.returnResponse * 1000 };
      }
      if (!step || (execution.status === 'awaiting-effects' && !execution.cancellation)) continue;
      const result = progressContact(state, step, progress, until - from, content);
      if (result.elapsed > 0) nextAt = Math.min(nextAt, from + result.elapsed);
      phases.set(order.orderId, phases.get(order.orderId) ?? (step.kind === 'walk' ? 1 : 2));
    }
    const at = integer('WorldMilliseconds', nextAt);
    const events = active.filter(execution => !physical || execution.status !== 'awaiting-effects' || execution.cancellation !== null || !state.s01.tracks.some(t => t.orderId === execution.orderId && t.status === 'running')).map((execution, index) => ({ id: execution.orderId + ':boundary:' + at, at,
      phase: phases.get(execution.orderId) ?? 2, predecessorId: null, acceptanceSequence: index,
      apply: (current: CampaignState) => advanceContact({ ...current, clock: { ...current.clock, worldMilliseconds: from } }, at, content, execution.orderId),
    }));
    // Frame partitions are integration intervals, not durable physical handler identities.
    // Physical handlers use settleCampaignBoundary; command step receipts are persisted above.
    for (const event of orderCausalEvents(events, state.commands.events.map(e => e.id))) state = event.apply(state);
    if (physical) state = advanceS01Effects(advanceS01Care(state, at, content), from, at, content);
    state = parseCampaignState({ ...state, clock: { ...state.clock, worldMilliseconds: at } }, content);
  }
  return parseCampaignState({ ...state, revision: input.revision + until - origin }, content);
}

/** Game-owned facade. The mutable state and clock remain inside CampaignSession. */
export class CampaignApplication {
  readonly #session: CampaignSession;
  readonly #content: CampaignContent;
  constructor(options: Omit<SessionOptions, 'advance'>) {
    this.#content = options.content;
    this.#session = new CampaignSession({ ...options, advance: (state, until) => advanceCampaignCommands(state, until, options.content, true) });
  }
  submit(input: unknown) {
    let receipt: CommandState['receipts'][number] | undefined;
    this.#session.command(state => { const result = submitCampaignCommand(state, input, this.#content); receipt = result.receipt; return result.state; });
    requireBoundary(receipt !== undefined, 'cross-link');
    return receipt;
  }
  care(input: unknown): void { this.#session.command(state => requestS01Care(state, input, this.#content)); }
  settlement(personId: string) { return s01VisibleState(this.#session.state, personId, this.#content); }
  view(personId: string) {
    const state = this.#session.state;
    return Object.freeze({ revision: state.revision, worldMilliseconds: state.clock.worldMilliseconds, speed: state.clock.speed,
      orders: Object.freeze(state.mandates.filter(m => m.issuerPersonId === personId).map(m => Object.freeze({ orderId: m.orderId,
        operation: m.operation, recipientId: m.recipientId, stage: m.stage, receivedAt: m.receivedAt, acceptedAt: m.acceptedAt,
        cancellationPending: state.commands.executions.some(e => e.orderId === m.orderId && e.cancellation !== null && e.cancellation.receivedAt === null) }))) });
  }
  subscribe(listener: () => void): () => void { return this.#session.subscribe(listener); }
  reconcile(): void { this.#session.reconcile(); }
  setSpeed(speed: PeaceSpeed): void { this.#session.setSpeed(speed); }
  checkpoint(): CampaignState { return this.#session.checkpoint(); }
  close(): void { this.#session.close(); }
}
