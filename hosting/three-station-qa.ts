import { bootRealtime } from './realtime-entry.ts';
import { threeStationPresenter } from './three-station-presenter.ts';
import { approvedStationQa } from '../game/src/runtime/approvedStationQa.ts';
import { validateProjectV4 } from '@/project/io/shape';
import { encounterApplicationSchema } from '../game/src/runtime/threeStation.ts';
import { threeStationTestInput } from '../game/src/runtime/threeStationTestInput.ts';
import data from '../game/data/encounters/three-station.json';
import type { PlaySceneContext } from '@/player/playSceneTypes';
import type { Dir } from '@/player/input';

/** Private QA entry only emitted with THREE_STATION_QA=1; not public preview. */
export async function bootThreeStationQa(parent: HTMLElement): Promise<{
  readonly snapshot: () => object;
  readonly step: (direction: Dir) => object;
  readonly action: () => object;
  readonly close: () => void;
}> {
  const approved = approvedStationQa('K002');
  const project = validateProjectV4(approved.project);
  const host = threeStationTestInput(encounterApplicationSchema.parse(data), 7, approved.actor.actorId);
  const status = document.createElement('output');
  status.textContent = 'TESTINPUT: K002 station-context QA; travel blocked; synthetic encounter rules and statistics, not GP approval';
  parent.append(status);
  const identity = document.createElement('p');
  identity.textContent = approved.actor.actorId + ' ' + approved.actor.name + ' | TESTINPUT station context, not canonical travel; appearance unapproved';
  parent.append(identity);
  const log: object[] = [];
  const presenter = threeStationPresenter(project, { host, status, record: event => log.push(event) });
  let current: PlaySceneContext | null = null;
  let occupancy: ReturnType<PlaySceneContext['add']['text']> | null = null;
  const snapshot = (): object => ({ ready: current !== null, mapId: current?.map.id, x: current?.tileX, y: current?.tileY, status: status.textContent,
    actorId: approved.actor.actorId, partyActorIds: current?.session.partyActorIds, entry: approved.entry,
    tick: host.state.worldTick, encounters: host.state.encounterSerial, context: host.state.battle?.context, battle: host.state.battle?.outcome, log });
  const close = await bootRealtime({ parent, project, host,
    versions: { rulesHash: 'TESTINPUT:three-station-rules', contentHash: 'TESTINPUT:slime', approvedInputsHash: 'TESTINPUT:not-GP-approval' },
    projectSession: (_boundary, previous) => previous,
    presentTraversal: (scene, ms) => {
      current = scene; presenter(scene, ms); scene.player.setVisible(false);
      if (!occupancy || !scene.children.exists(occupancy)) {
        occupancy = scene.add.text(0, 0, approved.actor.actorId + ' ' + approved.actor.name,
          { fontSize: '12px', color: '#ffffff', backgroundColor: '#141c2a' });
      }
      occupancy.setPosition(scene.player.x, scene.player.y);
    },
  });
  return {
    snapshot, close,
    step: direction => {
      if (!current) throw new Error('QA presentation not ready');
      current.input_.injectDirection(direction);
      presenter(current, current.moveDurationMs);
      current.input_.injectDirection(null);
      return snapshot();
    },
    action: () => {
      if (!current) throw new Error('QA presentation not ready');
      current.input_.injectActionEdge(); presenter(current, 0); return snapshot();
    },
  };
}
