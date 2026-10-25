import source from '../../project.json' with { type: 'json' };
import projection from '../../data/scenarios/townhall-s01-r1/projection.json' with { type: 'json' };
import { selectOpeningActor, openingAction } from './openingScenario.ts';

/** Private station-context entry, not travel from the canonical E0 placement. */
export function approvedStationQa(input: unknown) {
  const actor = selectOpeningActor(input);
  const project = structuredClone(source);
  return {
    actor,
    entry: {
      kind: 'TESTINPUT:station-context-entry', canonicalPlacement: { mapId: actor.mapId, ...actor.tile },
      stationPlacement: { mapId: project.startMapId, ...project.startPos },
      travel: openingAction('complete-movement'), consumedTravelTime: null,
      authoredPortals: projection.portals.map(portal => ({ id: portal.id, fromNode: portal.fromNode, toNode: portal.toNode })),
      authoredRoutes: projection.routes.map(route => ({ id: route.id, orderedNodes: route.orderedNodes, durationInputRef: route.durationInputRef })),
    },
    project: {
      ...project,
      system: { ...project.system, startActorIds: [actor.actorId] },
      session: { ...project.session, partyActorIds: [actor.actorId] },
      database: { ...project.database,
        actors: [{ id: actor.actorId, name: actor.name, nickname: actor.title, classId: 'scenario-identity',
          initialLevel: 1, maxLevel: 1, characterTransparent: true }],
        classes: [{ id: 'scenario-identity', name: 'Scenario identity (statistics unapproved)' }],
      },
    },
  };
}
