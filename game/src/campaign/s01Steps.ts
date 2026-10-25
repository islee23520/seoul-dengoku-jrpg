import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { requireBoundary } from './errors.ts';

export type S01Step = {
  readonly kind: 'walk' | 'archive-check' | 'pickup' | 'deliver' | 'compare' | 'observe' | 'report' | 'return-pickup' | 'handover' | 'reseal' | 'notice' | 'retreat';
  readonly from: string; readonly to: string; readonly duration: number;
  readonly people: readonly { readonly id: string; readonly activity: 'walking' | 'carrying' | 'stationary' }[];
  readonly row?: number;
};
export type S01Track = CampaignState['s01']['tracks'][number];

/** The interrupted action is the distance authority, including exact sub-millimetre progress. */
export function s01RetreatDistance(track: S01Track, state: CampaignState, content: CampaignContent): number {
  const incident = state.s01.incidents.find(i => i.id === track.noticeId && i.orderId === track.orderId);
  const interrupted = state.s01.tracks.find(t => t.id === incident?.interruptedTrackId && t.lane === 'investigation' && t.status === 'interrupted');
  requireBoundary(interrupted !== undefined, 'cross-link');
  const step = s01Steps(interrupted, state, content)[interrupted.step];
  requireBoundary(step?.kind === 'walk' && step.people.some(p => p.activity === 'carrying'), 'cross-link');
  const edge = content.data.operations.routes.edges.find(e => e.from === step.from && e.to === step.to || e.to === step.from && e.from === step.to);
  requireBoundary(edge !== undefined && edge.ledgerAllowed, 'location-scope');
  const replay = s01Progress(step, interrupted.initialEffort, interrupted.elapsed, content);
  requireBoundary(replay.progress === interrupted.progress, 'inventory');
  return replay.progress * (edge.metres * 1000 / step.duration);
}

/** Authored actions only. Durations and distances always come from the admitted appendix. */
export function s01Steps(track: S01Track, state: CampaignState, content: CampaignContent): readonly S01Step[] {
  const order = state.mandates.find(m => m.orderId === track.orderId);
  requireBoundary(order !== undefined, 'cross-link');
  const o = content.data.operations, actor = order.recipientId, duty = o.authority.duty, lord = o.authority.designator;
  const n = (name: string) => 's01:townhall:' + name;
  const desk = n('desk'), threshold = n('threshold'), archive = n('archive'), locker = n('locker');
  const steps: S01Step[] = [];
  const stationary = (kind: S01Step['kind'], at: string, seconds: number, people: readonly string[], row?: number) => {
    steps.push({ kind, from: at, to: at, duration: seconds * 1000, people: people.map(id => ({ id, activity: 'stationary' })), ...(row === undefined ? {} : { row }) });
  };
  const walk = (from: string, to: string, people: readonly string[], carrier?: string) => {
    const edge = o.routes.edges.find(e => (e.from === from && e.to === to) || (e.to === from && e.from === to));
    requireBoundary(edge !== undefined && (!carrier || edge.ledgerAllowed), 'location-scope');
    steps.push({ kind: 'walk', from, to, duration: edge.metres / (carrier ? o.routes.ledgerMetresPerSecond : o.routes.walkingMetresPerSecond) * 1000,
      people: people.map(id => ({ id, activity: id === carrier ? 'carrying' : 'walking' })) });
  };
  if (track.lane === 'recipient-return') walk(threshold, desk, [actor]);
  else if (track.lane === 'duty-return') {
    walk(threshold, archive, [duty], duty); walk(archive, locker, [duty], duty);
    stationary('reseal', locker, o.durations.reseal, [duty]);
    walk(locker, archive, [duty]); walk(archive, threshold, [duty]); walk(threshold, desk, [duty]);
  } else if (track.lane === 'cut-return') {
    stationary('notice', desk, o.durations.revocationNotice, [actor, duty]);
    const decision = state.s01.incidents.find(i => i.id === track.noticeId);
    requireBoundary(decision !== undefined, 'cross-link');
    if (decision.returnConsent && decision.backwardRouteSafe) steps.push({ kind: 'retreat', from: desk, to: threshold,
      duration: s01RetreatDistance(track, state, content) / o.routes.ledgerMetresPerSecond,
      people: [{ id: actor, activity: 'carrying' }, { id: duty, activity: 'walking' }] });
  } else if (order.operation === 'S01-L') {
    stationary('archive-check', desk, o.durations.archiveCheck, [actor, duty]);
    walk(desk, threshold, [actor, duty]); walk(threshold, archive, [actor, duty]); walk(archive, locker, [actor, duty]);
    stationary('pickup', locker, o.durations.pickup, [actor, duty]);
    walk(locker, archive, [actor, duty], actor); walk(archive, threshold, [actor, duty], actor); walk(threshold, desk, [actor, duty], actor);
    stationary('deliver', desk, o.durations.deliverToK002, [actor, lord]);
    o.evidence.ledgerRows.forEach((_, row) => stationary('compare', desk, o.durations.compareRow, [actor, lord], row));
    stationary('report', desk, o.durations.report, [actor, lord]);
    stationary('return-pickup', desk, o.durations.returnPickup, [actor, lord]);
    walk(desk, threshold, [actor, duty], actor);
    stationary('handover', threshold, o.durations.dutyHandover, [actor, duty]);
  } else {
    walk(desk, n('entry'), [actor]); walk(n('entry'), n('yard'), [actor]); walk(n('yard'), n('cistern'), [actor]);
    stationary('observe', n('cistern'), o.durations.cisternObservation, [actor], 0);
    walk(n('cistern'), n('tap'), [actor]); stationary('observe', n('tap'), o.durations.tapObservation, [actor], 1);
    walk(n('tap'), n('yard'), [actor]); walk(n('yard'), n('entry'), [actor]); walk(n('entry'), desk, [actor]);
    stationary('report', desk, o.durations.report, [actor, lord]);
  }
  return steps;
}

/** One activity per participant; the escort walks at the carrier's rate, never carries twice. */
export function s01Progress(step: S01Step, initial: Readonly<Record<string, readonly number[]>>, maximumElapsed: number, content: CampaignContent) {
  const o = content.data.operations;
  const effort = Object.fromEntries(Object.entries(initial).map(([id, values]) => [id, [...values]]));
  let elapsed = 0, progress = 0;
  while (elapsed < maximumElapsed && progress < step.duration) {
    let tired = false, threshold = Infinity;
    for (const person of step.people) {
      const values = effort[person.id]; requireBoundary(values !== undefined, 'body-unavailable');
      for (const [index, region] of o.body.regions.entries()) {
        if (!o.body.required[person.activity].includes(region)) continue;
        const value = values[index]; requireBoundary(value !== undefined, 'inventory');
        if (value >= o.body.restRequiredAtEffortSeconds * 1000) return { elapsed, progress, effort, stopped: true };
        tired ||= value >= o.body.tiredAtEffortSeconds * 1000;
        const rate = o.body.effortPerWorldSecond[person.activity][region] ?? 0;
        if (rate) threshold = Math.min(threshold, ((value < o.body.tiredAtEffortSeconds * 1000 ? o.body.tiredAtEffortSeconds : o.body.restRequiredAtEffortSeconds) * 1000 - value) / rate);
      }
    }
    const speed = tired ? o.routes.tiredMultiplier : 1;
    const delta = Math.min(maximumElapsed - elapsed, threshold, Math.ceil((step.duration - progress) / speed));
    elapsed += delta; progress = Math.min(step.duration, progress + delta * speed);
    for (const person of step.people) {
      const values = effort[person.id]; requireBoundary(values !== undefined, 'body-unavailable');
      o.body.regions.forEach((region, index) => { values[index] = (values[index] ?? 0) + delta * (o.body.effortPerWorldSecond[person.activity][region] ?? 0); });
    }
  }
  return { elapsed, progress, effort, stopped: false };
}
