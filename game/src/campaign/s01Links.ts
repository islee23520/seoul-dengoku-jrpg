import { summaryHash } from '../domain/eventLedger.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { requireBoundary } from './errors.ts';
import { s01Steps, s01Progress } from './s01Steps.ts';
import { nodeLocation } from './locations.ts';

/** Durable physical activity is recomputed from appendix rates, not trusted as checkpoint prose. */
export function assertS01Links(state: CampaignState, content: CampaignContent): void {
  const { tracks, activities, care } = state.s01, now = state.clock.worldMilliseconds, o = content.data.operations;
  for (const rows of [tracks, activities, care]) requireBoundary(new Set(rows.map(r => r.id)).size === rows.length, 'duplicate-id');
  for (const handler of state.commands.handlers.filter(h => /:(investigation|duty-return|recipient-return|cut-return):step:\d+:handler$/.test(h.id))) {
    requireBoundary(activities.some(a => a.id === handler.id.replace(/:handler$/, ':activity') && a.completedAt === handler.at), 'cross-link');
  }
  for (const result of state.results.filter(r => /:(investigation|duty-return):step:\d+$/.test(r.id))) {
    requireBoundary(activities.some(a => a.id === result.id + ':activity' && a.completedAt === result.at), 'cross-link');
  }
  for (const track of tracks) {
    const order = state.mandates.find(m => m.orderId === track.orderId);
    requireBoundary(order !== undefined && order.origin === 'command-ingress' && order.acceptedAt !== null && track.startedAt >= order.acceptedAt && track.startedAt <= now && track.id === order.orderId + ':' + track.lane, 'cross-link');
    const steps = s01Steps(track, state, content), history = activities.filter(a => a.trackId === track.id);
    requireBoundary(track.step <= steps.length && history.length === track.step && history.every((a, i) => a.step === i), 'cross-link');
    requireBoundary(track.status !== 'done' || track.step === steps.length, 'cross-link');
    requireBoundary(track.status !== 'return-response' || steps[track.step - 1]?.kind === 'report', 'cross-link');
    for (const activity of history) {
      const step = steps[activity.step]; requireBoundary(step !== undefined, 'cross-link');
      const replay = s01Progress(step, activity.initialEffort, activity.elapsed, content);
      requireBoundary(activity.id === track.id + ':step:' + activity.step + ':activity' && activity.completedAt <= now && activity.completedAt - activity.startedAt === activity.elapsed &&
        replay.elapsed === activity.elapsed && replay.progress === step.duration && activity.progress === replay.progress && summaryHash(activity.finalEffort) === summaryHash(replay.effort), 'inventory');
      requireBoundary(Object.keys(activity.initialEffort).length === step.people.length && step.people.every(p => Object.hasOwn(activity.initialEffort, p.id)), 'inventory');
      const previous = history[activity.step - 1];
      requireBoundary(previous === undefined || previous.completedAt <= activity.startedAt, 'event-order');
      if (previous) for (const person of step.people) {
        if (Object.hasOwn(previous.finalEffort, person.id) && previous.completedAt === activity.startedAt)
          requireBoundary(summaryHash(activity.initialEffort[person.id] ?? null) === summaryHash(previous.finalEffort[person.id] ?? null), 'inventory');
      }
      const key = track.id + ':step:' + activity.step;
      if (['pickup', 'deliver', 'return-pickup', 'handover', 'reseal'].includes(step.kind) || track.lane === 'duty-return' && step.kind === 'walk' && step.to === content.data.scenario.ledger.container)
        requireBoundary(state.results.some(r => r.id === key && r.at === activity.completedAt && r.orderId === order.orderId && r.physical !== null), 'custody');
      if (step.kind === 'compare' || step.kind === 'observe') requireBoundary(state.facts.some(f => f.id === key + ':fact' && f.observedAt === activity.completedAt && f.orderId === order.orderId), 'report-link');
      if (step.kind === 'report') requireBoundary(state.results.some(r => r.id === key && r.kind === 'report' && r.at === activity.completedAt), 'report-link');
    }
    if (Object.keys(track.initialEffort).length) {
      const step = steps[track.step]; requireBoundary(step !== undefined && track.startedAt + track.elapsed <= now, 'cross-link');
      const replay = s01Progress(step, track.initialEffort, track.elapsed, content);
      requireBoundary(replay.elapsed === track.elapsed && replay.progress === track.progress && (track.progress < step.duration || track.status === 'interrupted'), 'inventory');
      if (track.status === 'running') {
        requireBoundary(track.startedAt + track.elapsed === now, 'clock');
        for (const person of step.people) {
          const body = state.bodies.find(b => b.entityId === person.id); requireBoundary(body !== undefined && summaryHash(body.regions.map(r => r.effortMilliseconds)) === summaryHash(replay.effort[person.id] ?? null), 'inventory');
          if ((step.kind === 'walk' || step.kind === 'retreat') && track.elapsed > 0) {
            const speed = step.people.some(p => p.activity === 'carrying') ? o.routes.ledgerMetresPerSecond : o.routes.walkingMetresPerSecond;
            requireBoundary(body.location.kind === 'edge-progress' && body.location.from === step.from && body.location.to === step.to &&
              body.location.travelledMillimetres === Math.floor(step.kind === 'retreat' ? track.retreatMillimetres - track.progress * speed : track.progress * speed), 'location-scope');
          }
        }
      }
    } else requireBoundary(track.elapsed === 0 && track.progress === 0, 'inventory');
    if (track.lane === 'cut-return') {
      const notice = state.notices.find(n => n.id === track.noticeId);
      requireBoundary(notice !== undefined && notice.recipient === order.recipientId && track.retreatMillimetres > 0, 'cross-link');
      if (track.step > 0) requireBoundary(notice.receivedAt === history[0]?.completedAt, 'cross-link');
    }
  }
  requireBoundary(activities.every(a => tracks.some(t => t.id === a.trackId)), 'cross-link');
  for (const entry of care) {
    const body = state.bodies.find(b => b.entityId === entry.entityId); requireBoundary(body !== undefined, 'body-unavailable');
    const duration = (entry.kind === 'rest' ? o.durations.minimumRest : entry.kind === 'food' ? o.durations.eat : o.durations.drink) * 1000;
    requireBoundary(entry.startedAt + entry.elapsed <= now && entry.elapsed <= duration && (entry.status !== 'completed' || entry.elapsed === duration), 'clock');
    if (entry.status === 'running') requireBoundary(entry.startedAt + entry.elapsed === now && entry.elapsed < duration, 'clock');
    requireBoundary(!care.some(c => c.id !== entry.id && c.entityId === entry.entityId && c.startedAt < entry.startedAt + entry.elapsed && entry.startedAt < c.startedAt + c.elapsed), 'inventory');
    if (entry.status === 'completed' && entry.kind !== 'rest') requireBoundary(state.consumption.some(c => c.id === entry.id && c.entityId === entry.entityId && c.kind === entry.kind && c.startedAt === entry.startedAt && c.completedAt === entry.startedAt + duration), 'inventory');
    if (entry.kind === 'rest' && !care.some(c => c.entityId === entry.entityId && c.startedAt > entry.startedAt) && !activities.some(a => Object.hasOwn(a.finalEffort, entry.entityId) && a.completedAt > entry.startedAt + entry.elapsed) && !state.commands.events.some(e => e.physical?.participants.includes(entry.entityId) && e.at > entry.startedAt + entry.elapsed)) {
      requireBoundary(summaryHash(body.regions.map(r => r.effortMilliseconds)) === summaryHash(entry.initialEffort.map(value => Math.max(o.body.effortFloor, value - entry.elapsed * o.body.restRecoveryPerWorldSecond))), 'inventory');
    }
    requireBoundary(!state.reservations.some(r => r.resource.kind === 'body' && r.resource.entityId === entry.entityId && r.from < entry.startedAt + entry.elapsed && entry.startedAt < r.until), 'inventory');
  }
  // The latest completed activity cannot be erased by changing the body's fatigue or location.
  for (const body of state.bodies) {
    const latest = activities.filter(a => Object.hasOwn(a.finalEffort, body.entityId)).sort((a, b) => a.completedAt - b.completedAt).at(-1);
    if (!latest || tracks.some(t => t.status === 'running' && Object.hasOwn(t.initialEffort, body.entityId)) || care.some(c => c.entityId === body.entityId && c.startedAt >= latest.completedAt)) continue;
    const contact = state.commands.events.some(e => e.physical?.participants.includes(body.entityId) && e.at > latest.completedAt);
    const communicating = state.commands.executions.some(e => e.status === 'communicating' || e.status === 'return-response');
    if (contact || communicating) continue;
    const track = tracks.find(t => t.id === latest.trackId)!;
    if (track.status === 'interrupted' || tracks.some(t => t.status === 'interrupted' && Object.hasOwn(t.initialEffort, body.entityId) && t.startedAt >= latest.completedAt)) continue;
    requireBoundary(summaryHash(body.regions.map(r => r.effortMilliseconds)) === summaryHash(latest.finalEffort[body.entityId] ?? null), 'inventory');
    const step = s01Steps(track, state, content)[latest.step]!;
    if (step.kind !== 'notice') requireBoundary(summaryHash(body.location) === summaryHash(nodeLocation(step.kind === 'retreat' ? step.from : step.to, content)), 'location-scope');
  }
}
