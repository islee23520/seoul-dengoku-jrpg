import { z } from '../../../engine/node_modules/zod/index.js';
import { id, integer } from '../domain/ids.ts';
import { ref, count } from './contentSchemas.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { parseCampaignState } from './state.ts';

const requestSchema = z.strictObject({ id: ref, entityId: ref, kind: z.enum(['rest', 'food', 'water']), expectedRevision: count,
  consent: z.literal(true) });

/** Explicit personal consent, no receipt grants another body food or free recovery. */
export function requestS01Care(inputState: CampaignState, input: unknown, content: CampaignContent): CampaignState {
  ownInput(input);
  const parsed = requestSchema.safeParse(input); if (!parsed.success) throw new CampaignBoundaryError('shape');
  const state = parseCampaignState(inputState, content), request = parsed.data;
  const previous = state.s01.care.find(c => c.id === request.id);
  if (previous) {
    requireBoundary(previous.entityId === request.entityId && previous.kind === request.kind, 'command-conflict');
    return state;
  }
  requireBoundary(request.expectedRevision === state.revision, 'stale-version');
  const o = content.data.operations, now = state.clock.worldMilliseconds;
  const duration = (request.kind === 'rest' ? o.durations.minimumRest : request.kind === 'food' ? o.durations.eat : o.durations.drink) * 1000;
  const body = state.bodies.find(b => b.entityId === request.entityId), inventory = state.inventories.find(i => i.entityId === request.entityId);
  requireBoundary(body !== undefined && inventory !== undefined && body.location.kind === 'node' && body.activity === 'waiting', 'body-unavailable');
  requireBoundary(now + duration <= o.clock.supportUntilSeconds * 1000, 'support-unavailable');
  requireBoundary(!state.s01.care.some(c => c.entityId === body.entityId && c.status === 'running') && !state.reservations.some(r => r.resource.kind === 'body' && r.resource.entityId === body.entityId && r.from < now + duration && now < r.until), 'rejected-conflict');
  if (request.kind !== 'rest') {
    requireBoundary(now + duration <= o.provisions.consumption.windowEndSeconds * 1000 && !state.consumption.some(c => c.entityId === body.entityId && c.kind === request.kind), 'inventory');
    requireBoundary(request.kind === 'food' ? inventory.emergencyReservedPacks >= o.provisions.consumption.foodPacks && inventory.foodPacks >= o.provisions.consumption.foodPacks : inventory.waterMl >= o.provisions.consumption.waterMl, 'inventory');
  }
  return parseCampaignState({ ...state, revision: state.revision + 1,
    bodies: state.bodies.map(b => b.entityId === body.entityId ? { ...b, activity: request.kind === 'rest' ? 'resting' : request.kind === 'food' ? 'eating' : 'drinking' } : b),
    s01: { ...state.s01, care: [...state.s01.care, { id: request.id, entityId: request.entityId, kind: request.kind, startedAt: now,
      elapsed: 0, initialEffort: body.regions.map(r => r.effortMilliseconds), status: 'running' }] } }, content);
}

export function nextS01CareBoundary(state: CampaignState, until: number, content: CampaignContent): number {
  return Math.min(until, ...state.s01.care.filter(c => c.status === 'running').map(c => c.startedAt +
    (c.kind === 'rest' ? content.data.operations.durations.minimumRest : c.kind === 'food' ? content.data.operations.durations.eat : content.data.operations.durations.drink) * 1000));
}

export function advanceS01Care(input: CampaignState, until: number, content: CampaignContent): CampaignState {
  let state = input;
  const o = content.data.operations;
  for (const care of input.s01.care.filter(c => c.status === 'running')) {
    const duration = (care.kind === 'rest' ? o.durations.minimumRest : care.kind === 'food' ? o.durations.eat : o.durations.drink) * 1000;
    const elapsed = Math.min(duration, until - care.startedAt), done = elapsed === duration;
    state = { ...state, s01: { ...state.s01, care: state.s01.care.map(c => c.id === care.id ? { ...c, elapsed, status: done ? 'completed' : 'running' } : c) },
      bodies: state.bodies.map(b => b.entityId !== care.entityId ? b : { ...b,
        activity: done ? 'waiting' : b.activity,
        regions: care.kind !== 'rest' ? b.regions : b.regions.map((r, index) => ({ ...r, effortMilliseconds: Math.max(o.body.effortFloor, (care.initialEffort[index] ?? 0) - elapsed * o.body.restRecoveryPerWorldSecond) })),
        foodCoveredUntil: done && care.kind === 'food' ? integer('WorldMilliseconds', o.provisions.consumption.extendsToSeconds * 1000) : b.foodCoveredUntil,
        waterCoveredUntil: done && care.kind === 'water' ? integer('WorldMilliseconds', o.provisions.consumption.extendsToSeconds * 1000) : b.waterCoveredUntil }) };
    if (done && care.kind !== 'rest') {
      const body = state.bodies.find(b => b.entityId === care.entityId); requireBoundary(body !== undefined, 'cross-link');
      state = { ...state, consumption: [...state.consumption, { id: id('ResultId', care.id), entityId: body.entityId, kind: care.kind,
        startedAt: care.startedAt, completedAt: integer('WorldMilliseconds', care.startedAt + duration), causeId: id('CauseId', care.id) }],
        inventories: state.inventories.map(i => i.entityId !== care.entityId ? i : care.kind === 'food'
          ? { ...i, foodPacks: i.foodPacks - o.provisions.consumption.foodPacks, consumedFoodPacks: i.consumedFoodPacks + o.provisions.consumption.foodPacks, emergencyReservedPacks: i.emergencyReservedPacks - o.provisions.consumption.foodPacks }
          : { ...i, waterMl: i.waterMl - o.provisions.consumption.waterMl, consumedWaterMl: i.consumedWaterMl + o.provisions.consumption.waterMl }) };
    }
  }
  return state;
}

/** Stopping a rest preserves exactly elapsed recovery; it never completes the remaining interval. */
export function interruptS01Rest(input: CampaignState, careId: string, content: CampaignContent): CampaignState {
  const state = parseCampaignState(input, content), care = state.s01.care.find(c => c.id === careId);
  requireBoundary(care !== undefined && care.kind === 'rest' && care.status === 'running', 'action-scope');
  return parseCampaignState({ ...state, revision: state.revision + 1,
    s01: { ...state.s01, care: state.s01.care.map(c => c.id === careId ? { ...c, status: 'interrupted' } : c) },
    bodies: state.bodies.map(b => b.entityId === care.entityId ? { ...b, activity: 'waiting' } : b) }, content);
}
