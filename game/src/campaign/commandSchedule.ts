import { summaryHash } from '../domain/eventLedger.ts';
import { id, integer } from '../domain/ids.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { nodeLocation } from './locations.ts';
import { requireBoundary } from './errors.ts';

type Order = CampaignState['mandates'][number];
export type CommunicationStep = { readonly kind: 'walk' | 'call' | 'delivery' | 'response';
  readonly people: readonly string[]; readonly from: string; readonly to: string; readonly duration: number };

/** Only the authored contact route. The investigation/return route belongs to S01 effects. */
export function communicationSteps(order: Order, content: CampaignContent): readonly CommunicationStep[] {
  const o = content.data.operations, desk = o.authority.actorPlacements[o.authority.designator];
  requireBoundary(desk !== undefined && order.recipientLocation.kind === 'node', 'location-scope');
  const steps: CommunicationStep[] = [];
  const walk = (people: readonly string[], from: string, to: string) => {
    const edge = o.routes.edges.find(e => (e.from === from && e.to === to) || (e.from === to && e.to === from));
    requireBoundary(edge !== undefined, 'location-scope');
    steps.push({ kind: 'walk', people, from, to, duration: edge.metres / o.routes.walkingMetresPerSecond * 1000 });
  };
  if (order.operation === 'S01-L' && order.recipientLocation.nodeId !== desk) walk([order.recipientId], order.recipientLocation.nodeId, desk);
  if (order.operation === 'S01-O' && order.recipientLocation.nodeId !== desk) {
    requireBoundary(order.recipientLocation.nodeId === 's01:townhall:yard', 'location-scope');
    walk([o.authority.duty], desk, 's01:townhall:entry');
    walk([o.authority.duty], 's01:townhall:entry', 's01:townhall:yard');
    steps.push({ kind: 'call', people: [o.authority.duty, order.recipientId], from: 's01:townhall:yard', to: 's01:townhall:yard', duration: o.durations.dutyCall * 1000 });
    walk([o.authority.duty, order.recipientId], 's01:townhall:yard', 's01:townhall:entry');
    walk([o.authority.duty, order.recipientId], 's01:townhall:entry', desk);
  }
  for (const kind of ['delivery', 'response'] as const) steps.push({ kind, people: [o.authority.designator, order.recipientId], from: desk, to: desk,
    duration: (kind === 'delivery' ? o.durations.commandDelivery : o.durations.response) * 1000 });
  return steps;
}

export function contactReadiness(state: CampaignState, order: Order, content: CampaignContent): void {
  const o = content.data.operations, now = state.clock.worldMilliseconds;
  const people = [order.issuerPersonId, order.recipientId, o.authority.duty];
  requireBoundary(!state.commands.executions.some(e => e.orderId !== order.orderId && e.status !== 'terminal' &&
    state.mandates.some(m => m.orderId === e.orderId && m.recipientId === order.recipientId)), 'rejected-conflict');
  requireBoundary(state.duty.available && state.duty.keyHolder === o.authority.duty, 'duty-unavailable');
  const duty = state.bodies.find(b => b.entityId === o.authority.duty);
  requireBoundary(duty?.location.kind === 'node' && duty.location.nodeId === o.authority.dutyPlacement, 'duty-unavailable');
  requireBoundary(state.tools.some(t => t.id === o.provisions.writingKit && t.available), 'tool-unavailable');
  requireBoundary(state.inventories.some(i => i.entityId === order.recipientId && i.paperSheets > 0), 'tool-unavailable');
  const travel = (path: readonly string[], carrying = false) => path.slice(1).reduce((total, to, index) => {
    const from = path[index];
    const edge = o.routes.edges.find(e => (e.from === from && e.to === to) || (e.to === from && e.from === to));
    requireBoundary(edge !== undefined, 'location-scope');
    return total + edge.metres / (carrying ? o.routes.ledgerMetresPerSecond : o.routes.walkingMetresPerSecond) * 1000;
  }, 0);
  const desk = 's01:townhall:desk', threshold = 's01:townhall:threshold', archive = 's01:townhall:archive', locker = 's01:townhall:locker';
  const route = [desk, threshold, archive, locker];
  const work = order.operation === 'S01-L'
    ? travel(route) + travel([...route].reverse(), true) + travel([desk, threshold], true) + travel([threshold, archive, locker], true) + travel([locker, archive, threshold, desk]) +
      (o.durations.archiveCheck + o.durations.pickup + o.durations.deliverToK002 + o.durations.compare + o.durations.report + o.durations.returnResponse + o.durations.returnPickup + o.durations.dutyHandover + o.durations.reseal) * 1000
    : travel([desk, 's01:townhall:entry', 's01:townhall:yard', 's01:townhall:cistern', 's01:townhall:tap', 's01:townhall:yard', 's01:townhall:entry', desk]) +
      (o.durations.cisternObservation + o.durations.tapObservation + o.durations.report) * 1000;
  const remaining = work + (order.receivedAt === null ? communicationSteps(order, content).reduce((sum, step) => sum + step.duration, 0) : 0);
  let tired = false;
  for (const person of people) {
    const body = state.bodies.find(b => b.entityId === person);
    requireBoundary(!state.s01.care.some(c => c.entityId === person && c.status === 'running'), 'rejected-conflict');
    requireBoundary(body !== undefined && body.location.kind === 'node', 'body-unavailable');
    requireBoundary(body.regions.every(r => r.effortMilliseconds < o.body.restRequiredAtEffortSeconds * 1000), 'body-unavailable');
    tired ||= body.regions.some(r => r.effortMilliseconds >= o.body.tiredAtEffortSeconds * 1000);
  }
  const until = now + remaining / (tired ? o.routes.tiredMultiplier : 1);
  requireBoundary(until < Math.min(state.clock.closedAt ?? Infinity, o.clock.scheduledCloseSeconds * 1000), 'support-unavailable');
  for (const person of people) {
    const body = state.bodies.find(b => b.entityId === person);
    requireBoundary(body !== undefined && until <= body.foodCoveredUntil && until <= body.waterCoveredUntil && until < o.clock.supportUntilSeconds * 1000, 'support-unavailable');
  }
  const assets = [o.provisions.writingKit, ...(order.operation === 'S01-L' ? [content.data.scenario.ledger.id] : [])];
  requireBoundary(!state.reservations.some(r => r.orderId !== order.orderId && r.until > now && r.from < until &&
    (r.resource.kind === 'body' ? people.includes(r.resource.entityId) : assets.includes(r.resource.assetId))), 'rejected-conflict');
  if (order.operation === 'S01-L') requireBoundary(state.custody.some(c => c.assetId === content.data.scenario.ledger.id &&
    c.custodian === o.authority.duty && ['stored', 'resealed'].includes(c.returnState)), 'custody');
}

/** Integrate at exact fatigue thresholds, not at frame edges. Returns actual elapsed and work. */
export function progressContact(state: CampaignState, step: CommunicationStep, progress: number, maximumElapsed: number, content: CampaignContent) {
  const o = content.data.operations, activity = step.kind === 'walk' ? 'walking' : 'stationary';
  const required = o.body.required[activity], rates = o.body.effortPerWorldSecond[activity];
  const participants = state.bodies.filter(b => step.people.includes(b.entityId));
  requireBoundary(participants.length === step.people.length, 'body-unavailable');
  requireBoundary(participants.every(b => step.kind === 'walk'
    ? b.location.kind === 'node' ? b.location.nodeId === step.from || (progress === step.duration && b.location.nodeId === step.to)
      : b.location.kind === 'edge-progress' && b.location.from === step.from && b.location.to === step.to
    : b.location.kind === 'node' && b.location.nodeId === step.from), 'location-scope');
  const supportUntil = Math.min(o.clock.supportUntilSeconds * 1000, ...participants.flatMap(b => [b.foodCoveredUntil, b.waterCoveredUntil]));
  if (state.clock.worldMilliseconds >= supportUntil) return { state, elapsed: 0, progress, stopped: true };
  const effort = participants.flatMap(b => b.regions.filter(r => required.includes(r.region)).map(r => r.effortMilliseconds));
  const stopped = effort.some(e => e >= o.body.restRequiredAtEffortSeconds * 1000);
  if (stopped) return { state, elapsed: 0, progress, stopped: true };
  const speed = effort.some(e => e >= o.body.tiredAtEffortSeconds * 1000) ? o.routes.tiredMultiplier : 1;
  const threshold = Math.min(...participants.flatMap(b => b.regions.filter(r => required.includes(r.region)).map(r => {
    const rate = rates[r.region] ?? 0;
    if (!rate) return Infinity;
    const next = r.effortMilliseconds < o.body.tiredAtEffortSeconds * 1000 ? o.body.tiredAtEffortSeconds : o.body.restRequiredAtEffortSeconds;
    return (next * 1000 - r.effortMilliseconds) / rate;
  })));
  const elapsed = Math.min(maximumElapsed, supportUntil - state.clock.worldMilliseconds, threshold, Math.ceil((step.duration - progress) / speed));
  const nextProgress = Math.min(step.duration, progress + elapsed * speed);
  const bodies: CampaignState['bodies'] = state.bodies.map(body => {
    if (!step.people.includes(body.entityId)) return body;
    const location = step.kind !== 'walk' ? body.location : nextProgress === step.duration ? nodeLocation(step.to, content) : {
      kind: 'edge-progress' as const, siteId: id('CampaignSiteId', content.data.operations.authority.siteId),
      from: id('CampaignNodeId', step.from), to: id('CampaignNodeId', step.to),
      // Exact half-millisecond work carry remains in the execution; location is whole millimetres.
      travelledMillimetres: Math.floor(nextProgress * o.routes.walkingMetresPerSecond),
    };
    return { ...body, location, activity: nextProgress === step.duration ? 'waiting' as const : activity,
      regions: body.regions.map(r => ({ ...r, effortMilliseconds: r.effortMilliseconds + elapsed * (rates[r.region] ?? 0) })) };
  });
  return { state: { ...state, bodies, clock: { ...state.clock, worldMilliseconds: integer('WorldMilliseconds', state.clock.worldMilliseconds + elapsed) } }, elapsed, progress: nextProgress, stopped: false };
}

export function colocated(state: CampaignState, people: readonly string[]): boolean {
  const bodies = people.map(id => state.bodies.find(b => b.entityId === id));
  return bodies.every(b => b?.location.kind === 'node' && summaryHash(b.location) === summaryHash(bodies[0]?.location ?? null));
}
