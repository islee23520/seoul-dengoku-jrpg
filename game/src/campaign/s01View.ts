import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { receivedReports } from './state.ts';
import { id } from '../domain/ids.ts';
import { s01Steps } from './s01Steps.ts';

/** Local activity and already-received reports only; remote raw facts never enter this projection. */
export function s01VisibleState(state: CampaignState, personId: string, content: CampaignContent) {
  const o = content.data.operations, now = state.clock.worldMilliseconds;
  if (personId !== o.authority.designator) return Object.freeze({ actors: Object.freeze([]), original: null, reports: Object.freeze([]), closed: null, support: null });
  const observer = state.bodies.find(b => b.entityId === personId);
  const scene = observer?.location.kind === 'node' ? observer.location.sceneId : null;
  const local = (location: CampaignState['bodies'][number]['location']) => scene !== null &&
    (location.kind === 'node' ? location.sceneId === scene : location.kind === 'edge-progress' &&
      content.data.projection.nodes.some(n => n.id === location.from && n.sceneId === scene));
  const original = state.custody[0];
  return Object.freeze({
    actors: Object.freeze(state.bodies.filter(b => local(b.location)).map(b => {
      const track = state.s01.tracks.find(t => t.status === 'running' && s01Steps(t, state, content)[t.step]?.people.some(p => p.id === b.entityId));
      const step = track && s01Steps(track, state, content)[track.step];
      return Object.freeze({ entityId: b.entityId, location: Object.freeze({ ...b.location }), activity: b.activity,
        task: step?.kind ?? 'waiting', returning: track?.lane === 'duty-return' || track?.lane === 'recipient-return' || track?.lane === 'cut-return',
        food: now >= b.foodCoveredUntil ? 'uncovered' : 'covered', water: now >= b.waterCoveredUntil ? 'uncovered' : 'covered' });
    })),
    original: original && local(original.location) ? Object.freeze({ ...original, location: Object.freeze({ ...original.location }) }) : null,
    reports: Object.freeze(receivedReports(state, id('PersonId', personId))),
    closed: now >= Math.min(state.clock.closedAt ?? Infinity, o.clock.scheduledCloseSeconds * 1000),
    support: now >= o.clock.supportUntilSeconds * 1000 ? 'expired' : 'available',
  });
}
