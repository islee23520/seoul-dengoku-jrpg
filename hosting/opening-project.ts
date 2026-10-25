import { validateProjectV4 } from '@/project/io/shape';
import source from '../game/project.json';
import reception from '../game/data/scenarios/townhall-s01-r1/maps/townhall-s01-r1-reception.json';
import archive from '../game/data/scenarios/townhall-s01-r1/maps/townhall-s01-r1-archive.json';
import yard from '../game/data/scenarios/townhall-s01-r1/maps/townhall-s01-r1-yard.json';
import { selectOpeningActor } from '../game/src/runtime/openingScenario.ts';

export function openingProject(input: unknown) {
  const actor = selectOpeningActor(input);
  const project = structuredClone(source);
  return validateProjectV4({
    ...project,
    maps: Object.fromEntries([reception, archive, yard].map(map => [map.id, map])),
    mapConnections: [],
    mapTree: { mapId: reception.id, children: [{ mapId: archive.id, children: [] }, { mapId: yard.id, children: [] }] },
    startMapId: actor.mapId, startPos: actor.tile,
    system: { ...project.system, startActorIds: [actor.actorId] },
    session: { ...project.session, partyActorIds: [actor.actorId] },
    database: { ...project.database,
      actors: [{ id: actor.actorId, name: actor.name, nickname: actor.title, classId: 'scenario-identity',
        initialLevel: 1, maxLevel: 1, characterTransparent: true }],
      classes: [{ id: 'scenario-identity', name: '시나리오 인물 (능력치 미승인)' }],
    },
  });
}
