import { id, integer } from '../domain/ids.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { CampaignBoundaryError, requireBoundary } from './errors.ts';
import { assertComposedAuthority } from './authorityBasis.ts';
import { acknowledgeCommandEffect } from './commandEffects.ts';
import { settleCampaignBoundary } from './scheduler.ts';
import { s01Steps, s01Progress, s01RetreatDistance } from './s01Steps.ts';
import type { S01Step, S01Track } from './s01Steps.ts';
import { z } from '../../../engine/node_modules/zod/index.js';
import { ref, count } from './contentSchemas.ts';
import { ownInput } from './errors.ts';

type Order = CampaignState['mandates'][number];
type Result = CampaignState['results'][number];
const ms = (value: number) => integer('WorldMilliseconds', value);
const replaceTrack = (state: CampaignState, track: S01Track): CampaignState => ({ ...state,
  s01: { ...state.s01, tracks: state.s01.tracks.map(t => t.id === track.id ? track : t) } });

function newTrack(state: CampaignState, order: Order, lane: S01Track['lane']): S01Track {
  return { id: order.orderId + ':' + lane, orderId: order.orderId, lane, step: 0, startedAt: state.clock.worldMilliseconds,
    elapsed: 0, progress: 0, initialEffort: {}, status: 'running', retreatMillimetres: 0, noticeId: null, decisionHash: null };
}
function requiredResources(step: S01Step, order: Order, content: CampaignContent): CampaignState['reservations'][number]['resource'][] {
  const resources: CampaignState['reservations'][number]['resource'][] = step.people.map(p => ({ kind: 'body', entityId: id(p.id.startsWith('K') ? 'PersonId' : 'DutyId', p.id) }));
  if (order.operation === 'S01-L' && !step.people.every(p => p.activity === 'walking')) resources.push({ kind: 'asset', assetId: content.data.scenario.ledger.id });
  if (step.kind === 'compare' || step.kind === 'observe') resources.push({ kind: 'asset', assetId: content.data.operations.provisions.writingKit });
  if (step.kind === 'observe') for (const tool of content.data.scenario.availability.tools.filter(t => t.at === step.from || t.id === content.data.operations.provisions.lights)) resources.push({ kind: 'asset', assetId: tool.id });
  return resources;
}

function assertStep(state: CampaignState, track: S01Track, step: S01Step, content: CampaignContent): void {
  const order = state.mandates.find(m => m.orderId === track.orderId);
  requireBoundary(order !== undefined, 'cross-link');
  const o = content.data.operations, original = state.custody[0];
  requireBoundary(original !== undefined, 'custody');
  const returning = track.lane !== 'investigation' || step.kind === 'handover' || (step.kind === 'walk' && order.returnAcceptedAt !== null);
  if (!returning) assertComposedAuthority(state, order, { content, at: state.clock.worldMilliseconds });
  if (returning && order.operation === 'S01-L') requireBoundary(order.returnAcceptedAt !== null || original.custodian === o.authority.duty, 'consent-required');
  if (step.kind === 'retreat') requireBoundary(state.notices.some(n => n.id === track.noticeId && n.receivedAt !== null && n.receivedAt <= state.clock.worldMilliseconds), 'consent-required');
  if (step.people.some(p => p.id === o.authority.duty)) requireBoundary(state.duty.available && state.duty.keyHolder === o.authority.duty, 'duty-unavailable');
  if (['compare', 'observe'].includes(step.kind)) {
    requireBoundary(state.tools.some(t => t.id === o.provisions.writingKit && t.available), 'tool-unavailable');
    requireBoundary(state.inventories.some(i => i.entityId === order.recipientId && i.paperSheets + i.consumedPaperSheets > 0), 'inventory');
  }
  if (step.kind === 'compare') requireBoundary(original.custodian === order.issuerPersonId && original.location.kind === 'node' && original.location.nodeId === step.from && original.returnState === 'return-required', 'custody');
  if (step.kind === 'pickup') requireBoundary(original.custodian === o.authority.duty && ['stored', 'resealed'].includes(original.returnState) && original.location.kind === 'node' && original.location.nodeId === step.from, 'custody');
  if (step.kind === 'deliver' || step.kind === 'handover') requireBoundary(original.custodian === order.recipientId && original.location.kind === 'node' && original.location.nodeId === step.from, 'custody');
  if (step.kind === 'return-pickup') requireBoundary(order.returnAcceptedAt !== null && original.custodian === order.issuerPersonId, 'consent-required');
  if (step.kind === 'observe') requireBoundary(state.clock.worldMilliseconds < o.provisions.lightsUntilSeconds * 1000 && requiredResources(step, order, content).every(r => r.kind !== 'asset' || state.tools.some(t => t.id === r.assetId && t.available)), 'tool-unavailable');
  for (const person of step.people) {
    const body = state.bodies.find(b => b.entityId === person.id);
    requireBoundary(body !== undefined, 'body-unavailable');
    if (track.lane === 'cut-return') requireBoundary(body.location.kind === 'edge-progress' && body.location.from === step.from && body.location.to === step.to || step.kind === 'notice' && body.location.kind === 'edge-progress', 'location-scope');
    else requireBoundary(body.location.kind === 'node' ? body.location.nodeId === step.from || (track.progress === step.duration && body.location.nodeId === step.to) : step.kind === 'walk' && body.location.kind === 'edge-progress' && body.location.from === step.from && body.location.to === step.to, 'location-scope');
    if (person.activity === 'carrying') requireBoundary(original.custodian === person.id && summaryHash(original.location) === summaryHash(body.location), 'custody');
    requireBoundary(!state.s01.care.some(c => c.entityId === person.id && c.status === 'running'), 'rejected-conflict');
  }
}

function interrupt(state: CampaignState, track: S01Track, reason: string): CampaignState {
  let next = replaceTrack(state, { ...track, status: 'interrupted' });
  const order = next.mandates.find(m => m.orderId === track.orderId);
  requireBoundary(order !== undefined, 'cross-link');
  const execution = next.commands.executions.find(e => e.orderId === order.orderId);
  next = { ...next, bodies: next.bodies.map(b => Object.keys(track.initialEffort).includes(b.entityId) ? { ...b, activity: 'waiting' } : b) };
  const held = next.custody[0];
  if (held && !['stored', 'resealed'].includes(held.returnState) && !held.unresolvedReturn) next = transfer(next, order, track.id + ':interrupted', { unresolvedReturn: true }, 'protect');
  if (execution?.status !== 'terminal') {
    const previous = next.commands.events.filter(e => e.orderId === order.orderId).at(-1);
    requireBoundary(previous !== undefined, 'event-order');
    const sequence = next.commands.events.length + 1;
    next = { ...next, clock: { ...next.clock, sequence: next.clock.sequence + 1 },
      mandates: next.mandates.map(m => m.orderId === order.orderId ? { ...m, stage: 'interrupted' } : m),
      commands: { ...next.commands, executions: next.commands.executions.map(e => e.orderId === order.orderId ? { ...e, status: 'terminal' } : e),
        events: [...next.commands.events, { id: order.orderId + ':event:' + sequence, orderId: order.orderId, causeId: order.causeId,
          predecessorId: previous.id, sequence, at: next.clock.worldMilliseconds, phase: 3, kind: 'interrupted', effectId: null, reason, physical: null }] } };
  }
  const active = Object.keys(track.initialEffort);
  const reservations = next.reservations.filter(r => !(r.orderId === order.orderId && r.until > state.clock.worldMilliseconds));
  return { ...next, reservations, mandates: next.mandates.map(m => m.orderId === order.orderId ? { ...m, reservationIds: reservations.filter(r => r.orderId === order.orderId).map(r => r.id) } : m),
    bodies: next.bodies.map(b => active.includes(b.entityId) ? { ...b, activity: 'waiting' } : b) };
}

/** Open only actually accepted physical work; no queued retry or second clock. */
export function prepareS01Effects(input: CampaignState, content: CampaignContent): CampaignState {
  let state = input;
  for (const order of state.mandates) {
    if (order.origin !== 'command-ingress' || order.acceptedAt === null || order.stage !== 'executing' || state.s01.tracks.some(t => t.orderId === order.orderId)) continue;
    state = { ...state, s01: { ...state.s01, tracks: [...state.s01.tracks, newTrack(state, order, 'investigation')] } };
  }
  for (const initial of state.s01.tracks) {
    let track = initial;
    const order = state.mandates.find(m => m.orderId === track.orderId);
    requireBoundary(order !== undefined, 'cross-link');
    if (track.status === 'return-response' && order.returnAcceptedAt !== null) track = { ...track, status: 'running', startedAt: state.clock.worldMilliseconds };
    if (track.status !== 'running') { state = replaceTrack(state, track); continue; }
    const step = s01Steps(track, state, content)[track.step];
    if (!step) { state = replaceTrack(state, { ...track, status: 'done' }); continue; }
    const execution = state.commands.executions.find(e => e.orderId === order.orderId);
    if (execution?.cancellation !== null && execution?.cancellation !== undefined && track.lane === 'investigation') {
      state = replaceTrack({ ...state, bodies: state.bodies.map(b => Object.keys(track.initialEffort).includes(b.entityId) ? { ...b, activity: 'waiting' } : b) }, { ...track, status: 'interrupted' });
      continue;
    }
    try {
      assertStep(state, track, step, content);
      if (Object.keys(track.initialEffort).length) continue;
      const initialEffort = Object.fromEntries(step.people.map(p => {
        const body = state.bodies.find(b => b.entityId === p.id); requireBoundary(body !== undefined, 'body-unavailable');
        return [p.id, body.regions.map(r => r.effortMilliseconds)];
      }));
      track = { ...track, initialEffort, startedAt: state.clock.worldMilliseconds };
      const duration = s01Progress(step, initialEffort, Infinity, content);
      requireBoundary(duration.elapsed > 0 && !duration.stopped, 'body-unavailable');
      const until = state.clock.worldMilliseconds + duration.elapsed;
      requireBoundary(until < content.data.operations.clock.supportUntilSeconds * 1000 && step.people.every(p => state.bodies.some(b => b.entityId === p.id && b.foodCoveredUntil >= until && b.waterCoveredUntil >= until)), 'support-unavailable');
      const resources = requiredResources(step, order, content);
      requireBoundary(!state.reservations.some(r => r.orderId !== order.orderId && r.from < until && r.until > state.clock.worldMilliseconds && resources.some(resource => summaryHash(resource) === summaryHash(r.resource))), 'rejected-conflict');
      const reservations = state.reservations.filter(r => !(r.orderId === order.orderId && r.until > state.clock.worldMilliseconds &&
        !state.s01.tracks.some(t => t.id !== track.id && t.status === 'running' && r.id.startsWith(t.id + ':step:'))));
      reservations.push(...resources.map((resource, index) => ({ id: track.id + ':step:' + track.step + ':resource:' + index, orderId: order.orderId,
        resource, from: state.clock.worldMilliseconds, until: ms(until), consumptionId: null })));
      state = replaceTrack({ ...state, reservations, mandates: state.mandates.map(m => m.orderId === order.orderId ? { ...m, reservationIds: reservations.filter(r => r.orderId === order.orderId).map(r => r.id) } : m) }, track);
    } catch (error) {
      if (!(error instanceof CampaignBoundaryError)) throw error;
      state = interrupt(state, track, error.code);
    }
  }
  return state;
}

export function nextS01Boundary(state: CampaignState, until: number, content: CampaignContent): number {
  let next = until;
  for (const track of state.s01.tracks.filter(t => t.status === 'running')) {
    const step = s01Steps(track, state, content)[track.step]; requireBoundary(step !== undefined, 'cross-link');
    const result = s01Progress(step, track.initialEffort, Infinity, content);
    next = Math.min(next, track.startedAt + result.elapsed);
  }
  return next;
}

function addResult(state: CampaignState, result: Result): CampaignState {
  requireBoundary(!state.results.some(r => r.id === result.id), 'duplicate-id');
  return { ...state, results: [...state.results, result], appliedResultIds: [...state.appliedResultIds, result.id],
    mandates: state.mandates.map(m => m.orderId === result.orderId ? { ...m, appliedResultIds: [...m.appliedResultIds, result.id] } : m) };
}
function transfer(state: CampaignState, order: Order, resultId: string, change: Partial<CampaignState['custody'][number]>, action: NonNullable<Result['safeReturn']>['action'] | null): CampaignState {
  const before = state.custody[0]; requireBoundary(before !== undefined, 'custody');
  const previous = state.results.filter(r => r.physical !== null).at(-1);
  const after = { ...before, ...change, causeId: order.causeId };
  const participants = [...new Set([before.custodian, after.custodian])];
  const physical = { previousResultId: previous?.id ?? null, before, after, bodies: state.bodies.filter(b => participants.includes(b.entityId)), dutyAvailable: state.duty.available };
  requireBoundary(action === null || previous !== undefined, 'custody');
  const result: Result = { id: id('ResultId', resultId), orderId: order.orderId, causeId: order.causeId, at: state.clock.worldMilliseconds,
    kind: action === null ? 'custody' : 'safe-return', payloadHash: summaryHash(physical), physical,
    safeReturn: action === null ? null : { assetId: after.assetId, action, custodian: after.custodian, location: after.location,
      priorCustodyResultId: previous!.id, safeRoute: true, dutyAvailable: true } };
  return addResult({ ...state, custody: [after] }, result);
}

function completeStep(state: CampaignState, track: S01Track, step: S01Step, content: CampaignContent): CampaignState {
  const order = state.mandates.find(m => m.orderId === track.orderId); requireBoundary(order !== undefined, 'cross-link');
  const o = content.data.operations, resultId = track.id + ':step:' + track.step;
  let next = state;
  const activity = { id: resultId + ':activity', trackId: track.id, step: track.step, startedAt: track.startedAt,
    completedAt: next.clock.worldMilliseconds, elapsed: track.elapsed, progress: track.progress, initialEffort: track.initialEffort,
    finalEffort: Object.fromEntries(step.people.map(p => [p.id, next.bodies.find(b => b.entityId === p.id)!.regions.map(r => r.effortMilliseconds)])) };
  next = { ...next, s01: { ...next.s01, activities: [...next.s01.activities, activity] } };
  const status = step.kind === 'report' && order.operation === 'S01-L' ? 'return-response' : track.step + 1 === s01Steps(track, next, content).length ? 'done' : 'running';
  next = replaceTrack(next, { ...track, step: track.step + 1, startedAt: next.clock.worldMilliseconds, elapsed: 0, progress: 0, initialEffort: {}, status });
  switch (step.kind) {
    case 'pickup': next = transfer(next, order, resultId, { custodian: order.recipientId, seal: 'opened', returnState: 'return-required' }, null); break;
    case 'deliver': next = transfer(next, order, resultId, { custodian: order.issuerPersonId }, null); break;
    case 'return-pickup': next = transfer(next, order, resultId, { custodian: order.recipientId }, null); break;
    case 'handover': next = transfer(next, order, resultId, { custodian: id('DutyId', o.authority.duty), returnState: 'handover-received' }, 'handover'); break;
    case 'reseal':
      next = transfer(next, order, resultId, { seal: 'sealed', returnState: 'resealed', unresolvedReturn: false }, 'reseal');
      next = acknowledgeCommandEffect(next, { orderId: order.orderId, resultId, transition: 'return-completed' }, content); break;
    case 'walk':
      if (track.lane === 'duty-return' && step.to === content.data.scenario.ledger.container) next = transfer(next, order, resultId, { returnState: 'restocked', unresolvedReturn: false }, 'restock');
      break;
    case 'compare': case 'observe': {
      assertComposedAuthority(next, order, { content, at: next.clock.worldMilliseconds });
      const row = step.row; requireBoundary(row !== undefined, 'cross-link');
      const observation = o.evidence.observations[row];
      const ledgerRow = o.evidence.ledgerRows[row];
      requireBoundary(step.kind === 'compare' ? ledgerRow !== undefined : observation !== undefined, 'cross-link');
      const { siteId: _site, observer: _observer, observedAt: _at, quality: _quality, ...raw } = observation ?? o.evidence.observations[0]!;
      const fact: CampaignState['facts'][number] = { id: resultId + ':fact', version: 0, orderId: order.orderId,
        sourcePersonId: order.recipientId, observedAt: next.clock.worldMilliseconds, location: nodeLocation(step.from, content), causeId: order.causeId,
        evidence: step.kind === 'compare' ? { kind: 'ledger-comparison', rows: [ledgerRow!] } : { kind: 'raw-observation', nodeId: id('CampaignNodeId', step.from), ...raw } };
      next = { ...next, facts: [...next.facts, fact], inventories: next.inventories.map(i => i.entityId === order.recipientId && i.consumedPaperSheets === 0
        ? { ...i, paperSheets: i.paperSheets - 1, consumedPaperSheets: i.consumedPaperSheets + 1 } : i) };
      if (step.kind === 'compare' ? row === o.evidence.ledgerRows.length - 1 : row === o.evidence.observations.length - 1) {
        next = addResult(next, { id: id('ResultId', resultId), orderId: order.orderId, causeId: order.causeId, at: next.clock.worldMilliseconds,
          kind: 'work', physical: null, safeReturn: null, payloadHash: summaryHash(next.facts.filter(f => f.orderId === order.orderId)) });
        next = acknowledgeCommandEffect(next, { orderId: order.orderId, resultId, transition: 'work-completed' }, content);
      }
      break;
    }
    case 'report': {
      const reports: CampaignState['reports'] = next.facts.filter(f => f.orderId === order.orderId).map(fact => ({ id: fact.id + ':report', fact,
        recipient: order.issuerPersonId, carrier: order.recipientId, createdAt: fact.observedAt, deliveredAt: track.startedAt,
        receivedAt: next.clock.worldMilliseconds, source: order.recipientId, omission: fact.evidence.kind === 'ledger-comparison' ? ['missing-annex', 'unsigned-slot'] : ['uncalibrated'],
        uncertainty: 'partial-evidence', causeId: order.causeId }));
      next = { ...next, reports: [...next.reports, ...reports], knowledge: next.knowledge.map(k => k.personId !== order.issuerPersonId ? k : { ...k,
        records: [...k.records, ...reports.map(r => ({ reportId: r.id, factId: r.fact.id, version: r.fact.version, receivedAt: next.clock.worldMilliseconds, payloadHash: summaryHash(r) }))] }) };
      next = addResult(next, { id: id('ResultId', resultId), orderId: order.orderId, causeId: order.causeId, at: next.clock.worldMilliseconds,
        kind: 'report', physical: null, safeReturn: null, payloadHash: summaryHash(reports) });
      next = acknowledgeCommandEffect(next, { orderId: order.orderId, resultId, transition: 'report-received' }, content);
      break;
    }
    case 'notice':
      next = { ...next, notices: next.notices.map(n => n.id === track.noticeId ? { ...n, receivedAt: next.clock.worldMilliseconds } : n) }; break;
    case 'archive-check': case 'retreat': break;
  }
  if (step.kind === 'handover') next = { ...next, s01: { ...next.s01, tracks: [...next.s01.tracks, newTrack(next, order, 'recipient-return'), newTrack(next, order, 'duty-return')] } };
  return next;
}

/** Integrate all active participants to the same clock boundary, then settle durable effects once. */
export function advanceS01Effects(input: CampaignState, from: number, until: number, content: CampaignContent): CampaignState {
  let state = input;
  const completed: { track: S01Track; step: S01Step }[] = [];
  for (const originalTrack of input.s01.tracks.filter(t => t.status === 'running')) {
    let track = originalTrack;
    const step = s01Steps(track, state, content)[track.step]; requireBoundary(step !== undefined, 'cross-link');
    try { assertStep({ ...state, clock: { ...state.clock, worldMilliseconds: ms(from) } }, track, step, content); }
    catch (error) { if (!(error instanceof CampaignBoundaryError)) throw error; state = interrupt(state, track, error.code); continue; }
    const result = s01Progress(step, track.initialEffort, until - track.startedAt, content);
    track = { ...track, elapsed: result.elapsed, progress: result.progress };
    const done = result.progress === step.duration;
    state = { ...state, bodies: state.bodies.map(body => {
      const person = step.people.find(p => p.id === body.entityId); if (!person) return body;
      let location = body.location;
      if (step.kind === 'walk' || step.kind === 'retreat') {
        const speed = step.people.some(p => p.activity === 'carrying') ? content.data.operations.routes.ledgerMetresPerSecond : content.data.operations.routes.walkingMetresPerSecond;
        location = done ? nodeLocation(step.kind === 'retreat' ? step.from : step.to, content) : { kind: 'edge-progress', siteId: id('CampaignSiteId', content.data.operations.authority.siteId),
          from: id('CampaignNodeId', step.from), to: id('CampaignNodeId', step.to), travelledMillimetres: step.kind === 'retreat' ? s01RetreatDistance(track, state, content) - result.progress * speed : result.progress * speed };
      }
      const efforts = result.effort[body.entityId]; requireBoundary(efforts !== undefined, 'inventory');
      return { ...body, location, activity: done ? 'waiting' : person.activity,
        regions: body.regions.map((r, i) => ({ ...r, effortMilliseconds: efforts[i]! })) };
    }) };
    state = { ...state, custody: state.custody.map(c => ['return-required', 'handover-received'].includes(c.returnState)
      ? { ...c, location: state.bodies.find(b => b.entityId === c.custodian)!.location } : c) };
    state = replaceTrack(state, track);
    if (done) completed.push({ track, step });
    else if (result.stopped) state = interrupt(state, track, 'body-unavailable');
  }
  state = { ...state, clock: { ...state.clock, worldMilliseconds: ms(until) } };
  for (const track of state.s01.tracks.filter(t => t.status === 'running' && t.lane === 'investigation')) {
    const order = state.mandates.find(m => m.orderId === track.orderId)!;
    if (until >= Math.min(state.clock.closedAt ?? Infinity, content.data.operations.clock.scheduledCloseSeconds * 1000) && order.returnAcceptedAt === null) {
      state = interrupt(state, track, 'authority-expired');
      const index = completed.findIndex(c => c.track.id === track.id); if (index >= 0) completed.splice(index, 1);
    }
  }
  if (completed.length) state = settleCampaignBoundary(state, completed.map(({ track, step }, index) => ({ id: track.id + ':step:' + track.step + ':handler', at: until, phase: 3,
    predecessorId: state.commands.handlers.filter(h => h.id.startsWith(track.id + ':')).at(-1)?.id ?? state.commands.events.filter(e => e.orderId === track.orderId).at(-1)?.id ?? null,
    acceptanceSequence: index, apply: current => completeStep(current, track, step, content) })), content);
  return parseCampaignState(state, content);
}

const cutSchema = z.strictObject({ id: ref, orderId: ref, issuer: ref, grantId: ref, expectedRevision: count,
  backwardRouteSafe: z.boolean(), returnConsent: z.boolean() });

/** Scenario authority event, not a player privilege: revoke and block forward travel at the actual boundary. */
export function revokeS01ForwardRoute(inputState: CampaignState, input: unknown, content: CampaignContent): CampaignState {
  ownInput(input);
  const parsed = cutSchema.safeParse(input); if (!parsed.success) throw new CampaignBoundaryError('shape');
  const state = parseCampaignState(inputState, content), request = parsed.data;
  requireBoundary(request.expectedRevision === state.revision, 'stale-version');
  const order = state.mandates.find(m => m.orderId === request.orderId), o = content.data.operations;
  requireBoundary(order !== undefined && order.operation === 'S01-L' && order.returnAcceptedAt !== null, 'consent-required');
  requireBoundary(request.issuer === o.authority.issuer && order.authority.some(a => a.grantId === request.grantId), 'authority-source');
  const track = state.s01.tracks.find(t => t.orderId === order.orderId && t.lane === 'investigation' && t.status === 'running');
  const location = state.custody[0]?.location;
  requireBoundary(track !== undefined && location?.kind === 'edge-progress' && location.from === 's01:townhall:desk' && location.to === 's01:townhall:threshold' && state.custody[0]?.custodian === order.recipientId, 'location-scope');
  requireBoundary(state.bodies.some(b => b.entityId === o.authority.duty && summaryHash(b.location) === summaryHash(location)), 'duty-unavailable');
  const grant = state.grants.find(g => g.id === request.grantId), previous = grant?.revisions.at(-1);
  requireBoundary(grant !== undefined && previous?.state === 'valid' && !state.notices.some(n => n.id === request.id), 'grant-version');
  const revision = { previousVersion: previous.version, state: 'revoked' as const, effectiveAt: state.clock.worldMilliseconds,
    causeId: id('CauseId', request.id), issuer: request.issuer };
  const version = summaryHash({ grantId: grant.id, ...revision });
  let next: CampaignState = { ...state, revision: state.revision + 1, grants: state.grants.map(g => g.id === grant.id ? { ...g, revisions: [...g.revisions, { ...revision, version }] } : g),
    notices: [...state.notices, { id: request.id, grantId: grant.id, version, recipient: order.recipientId, carrier: id('DutyId', o.authority.duty), legalEffectiveAt: state.clock.worldMilliseconds, receivedAt: null }] };
  next = interrupt(next, track, 'authority-revoked');
  const interrupted = next.s01.tracks.find(t => t.id === track.id), protection = next.results.find(r => r.id === track.id + ':interrupted');
  requireBoundary(interrupted !== undefined && protection !== undefined, 'cross-link');
  const decision = { id: request.id, orderId: order.orderId, interruptedTrackId: track.id, at: state.clock.worldMilliseconds,
    returnConsent: request.returnConsent, backwardRouteSafe: request.backwardRouteSafe,
    interruptedHash: summaryHash(interrupted), protectionResultId: protection.id };
  const hash = summaryHash(decision);
  requireBoundary(protection.physical !== null, 'custody');
  const causeId = id('CauseId', request.id + ':' + hash);
  const physical = { ...protection.physical, after: { ...protection.physical.after, causeId } };
  next = { ...next, custody: [physical.after], results: next.results.map(r => r.id === protection.id ? { ...r, causeId, physical, payloadHash: summaryHash(physical) } : r),
    s01: { ...next.s01, incidents: [...next.s01.incidents, { ...decision, hash }] } };
  const noticeTrack = { ...newTrack(next, order, 'cut-return'), noticeId: request.id, decisionHash: hash };
  next = { ...next, s01: { ...next.s01, tracks: [...next.s01.tracks,
    { ...noticeTrack, retreatMillimetres: s01RetreatDistance(noticeTrack, next, content) }] } };
  return parseCampaignState(next, content);
}
