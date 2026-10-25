import { canMove } from '@/project/collision';
import type { Project } from '@/project/types';
import type { PlaySceneContext } from '@/player/playSceneTypes';
import { characterSpriteY } from '@/player/characterDepth';
import { requestTransfer } from '../game/src/runtime/threeStation.ts';
import type { Exit } from '../game/src/runtime/threeStation.ts';
import type { RealtimeHost } from '../game/src/runtime/realtimeHost.ts';
import { MissingRuleInput } from '../game/src/battle/realtime.ts';

/** Game-owned port presentation: collision and authored transfers, no stock interpreter. */
export function threeStationPresenter(project: Project, input: {
  readonly host: RealtimeHost; readonly status: HTMLOutputElement;
  readonly record: (event: object) => void;
}): (scene: PlaySceneContext, milliseconds: number) => void {
  const exits = new Map<string, readonly Exit[]>();
  for (const map of Object.values(project.maps)) {
    exits.set(map.id, map.events.flatMap(event => event.pages?.flatMap(page => page.commands.flatMap(command => {
      switch (command.kind) {
        case 'transfer': {
          if (page.conditions.length || page.trigger.kind !== 'action') return [];
          return [{ x: event.x, y: event.y, target: { mapId: command.mapId, x: command.x, y: command.y } }];
        }
        default: return [];
      }
    })) ?? []));
  }
  let carry = 0;
  return (scene, milliseconds) => {
    carry = Math.max(0, carry - milliseconds);
    const key = scene.input_.update(); scene.input_.resetEdges();
    let moved = false;
    if (carry === 0 && (key.x !== 0 || key.y !== 0)) {
      const x = scene.tileX + key.x, y = scene.tileY + key.y;
      if (canMove(project, scene.map, scene.tileX, scene.tileY, x, y)) {
        scene.tileX = x; scene.tileY = y; scene.session.x = x; scene.session.y = y; moved = true;
        carry = scene.moveDurationMs;
        try {
          const admission = input.host.completedStep({ mapId: scene.map.id, x, y });
          input.record({ kind: 'completed-step', mapId: scene.map.id, x, y, admission });
          input.status.textContent = admission.kind === 'handled-opened' ? admission.battleId : admission.reason;
        } catch (error) {
          if (!(error instanceof MissingRuleInput)) throw error;
          input.status.textContent = error.name + ': ' + error.ruleKey;
          input.record({ kind: 'blocked-admission', ruleKey: error.ruleKey, mapId: scene.map.id, x, y });
        }
      }
    }
    if (key.actionPressed) {
      const available = exits.get(scene.map.id) ?? [];
      const target = available.find(exit => exit.x === scene.tileX && exit.y === scene.tileY);
      if (target) {
        const from = scene.map.id;
        const transfer = requestTransfer(available, { position: { mapId: from, x: scene.tileX, y: scene.tileY }, targetMapId: target.target.mapId });
        scene.session.currentMapId = transfer.mapId; scene.session.x = transfer.x; scene.session.y = transfer.y;
        scene.loadMap(transfer.mapId); scene.tileX = transfer.x; scene.tileY = transfer.y;
        input.record({ kind: 'transfer', from, ...transfer });
      }
    }
    if (moved || key.actionPressed) {
      scene.player.x = (scene.tileX + 0.5) * scene.map.tileSize;
      scene.player.y = characterSpriteY(scene.tileY, scene.map.tileSize);
      scene.player.setFrame(scene.playerSprite.idleFrameFor(key.dir ?? scene.facing));
    }
  };
}
