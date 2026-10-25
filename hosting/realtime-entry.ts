import { createPlayGame } from '@/player/createPlayGame';
import { setExportedProject } from '@/player/exportProjectStoreShim';
import { startSession } from '@/project/session';
import { createSaveSnapshot, applySaveSnapshot, readAutosave } from '@/player/saveSlots';
import { ensureM2Runtime } from '@/player/interpreter/m2RuntimeState';
import type { PlaySceneContext } from '@/player/playSceneTypes';
import type { Project } from '@/project/types';
import type { PlaySession } from '@/project/session';
import type { RuntimeState } from '../game/src/runtime/realtimeHost.ts';
import { RealtimeHost, validateHostContent } from '../game/src/runtime/realtimeHost.ts';
import { json, hash, MissingRuleInput, BattleConflict } from '../game/src/battle/realtime.ts';
import { checkpoint, persistCheckpoint, loadCheckpoint } from '../game/src/save/campaignCheckpoint.ts';
import type { Versions } from '../game/src/save/campaignCheckpoint.ts';
import { mountRealtimeBattle } from '../game/ui/realtimeBattle.ts';
import { openingProject } from './opening-project.ts';
import { mountOpening } from './opening-flow.ts';
import { mountGrowthStats } from '../game/ui/growthStats.ts';
import './growth-stats.css';
import { selectOpeningActor, openingAction } from '../game/src/runtime/openingScenario.ts';
import { samplingProject, mountSamplingNotice } from './sampling-assets.ts';

/** Dedicated integration API. No actors, GP values or production admission defaults. */
export async function bootRealtime(input: {
  readonly parent: HTMLElement; readonly project: Project; readonly host: RealtimeHost; readonly versions: Versions;
  readonly projectSession: (boundary: RuntimeState, previous: PlaySession) => PlaySession;
  readonly presentTraversal?: (scene: PlaySceneContext, milliseconds: number) => void;
}): Promise<() => void> {
  const sampledProject = samplingProject(input.project);
  validateHostContent(json.parse(JSON.parse(JSON.stringify(input.project))), input.presentTraversal !== undefined);
  if (!input.host.options.rules) throw new MissingRuleInput('approved-GP-content-time-inputs');
  setExportedProject(sampledProject);
  const boundary = structuredClone(input.host.state); const before = hash(boundary);
  const session = input.projectSession(boundary, startSession(input.project));
  if (before !== hash(boundary)) throw new BattleConflict('projection-mutated-boundary');
  ensureM2Runtime(session).access.save = false;
  let scene: PlaySceneContext | null = null;
  const game = await createPlayGame(input.parent, session, { simulationPort: { bind(current) {
    scene = current;
    ensureM2Runtime(current.session).access.save = false;
    const binding = input.host.bind();
    return { ...binding, present(_scene, milliseconds) {
      input.presentTraversal?.(current, milliseconds);
      const boundary = structuredClone(input.host.state); const before = hash(boundary);
      const projected = input.projectSession(boundary, structuredClone(current.session));
      if (before !== hash(boundary)) throw new BattleConflict('projection-mutated-boundary');
      ensureM2Runtime(projected).access.save = false; current.session = projected;
    }, release() { binding.release(); if (scene === current) scene = null; } };
  } } });
  const releaseHud = mountRealtimeBattle(input.parent, input.host);
  const controls = document.createElement('div');
  const status = document.createElement('output');
  for (const operation of ['save', 'load'] as const) {
    const button = document.createElement('button'); button.textContent = operation;
    button.onclick = () => {
      try {
        if (!scene) throw new BattleConflict('presentation-not-ready');
        switch (operation) {
          case 'save': {
            const boundary = structuredClone(input.host.state);
            const boundaryHash = hash(boundary);
            const projectionCopy = input.projectSession(boundary, structuredClone(scene.session));
            if (boundaryHash !== hash(boundary)) throw new BattleConflict('projection-mutated-boundary');
            ensureM2Runtime(projectionCopy).access.save = false;
            const before = hash(json.parse(JSON.parse(JSON.stringify(projectionCopy))));
            const projection = createSaveSnapshot(input.project, projectionCopy);
            if (before !== hash(json.parse(JSON.parse(JSON.stringify(projectionCopy))))) throw new BattleConflict('snapshot-mutated-copy');
            for (const key of ['gameTime', 'actorVitals', 'gold', 'inventory', 'rng'] as const) {
              if (hash(json.parse(JSON.parse(JSON.stringify(projection.session[key] ?? null)))) !== hash(json.parse(JSON.parse(JSON.stringify(projectionCopy[key] ?? null))))) throw new BattleConflict('projection-normalization-divergence');
            }
            persistCheckpoint(localStorage, checkpoint(boundary, { versions: input.versions, engineProjection: json.parse(JSON.parse(JSON.stringify(projection))) }));
            break;
          }
          case 'load': {
            const saved = loadCheckpoint(localStorage, input.versions);
            // Reuse the engine's unknown-input parser without exposing an engine save write.
            const encoded = JSON.stringify(saved.engineProjection);
            const snapshot = readAutosave({ getItem: () => encoded, length: 1, key: () => null,
              setItem() { throw new BattleConflict('stock-save-write'); },
              removeItem() { throw new BattleConflict('stock-save-write'); },
              clear() { throw new BattleConflict('stock-save-write'); } });
            if (snapshot.kind !== 'present') throw new BattleConflict('invalid-engine-projection');
            const restored = applySaveSnapshot(input.project, snapshot.snapshot);
            ensureM2Runtime(restored).access.save = false;
            input.host.replace(saved.runtime);
            // Restart only after both complete envelope and projection have validated.
            game.registry.set('initialSession', restored);
            game.scene.getScene('PlayScene').scene.restart();
            break;
          }
          default: operation satisfies never;
        }
        status.textContent = operation + ' complete';
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        status.textContent = error.name + ': ' + error.message;
      }
    };
    controls.append(button);
  }
  controls.append(status); input.parent.append(controls);
  const releaseSampling = mountSamplingNotice(input.parent, sampledProject);
  return () => { releaseSampling(); controls.remove(); releaseHud(); game.destroy(true); };
}
/** Approved E0 occupancy presentation. Missing numeric rules prevent every simulation transition. */
export async function spawnOpening(id: unknown, parent: HTMLElement): Promise<void> {
  const actor = selectOpeningActor(id);
  const project = samplingProject(openingProject(actor.actorId));
  setExportedProject(project);
  const session = startSession(project);
  ensureM2Runtime(session).access.save = false;
  await new Promise<void>((resolve, reject) => {
    void createPlayGame(parent, session, {
      onPlaySceneReady: resolve,
      simulationPort: { bind(scene) {
        scene.facing = actor.facing;
        return {
          elapsed() { /* E0 has no approved time conversion. No clock advancement. */ },
          completedStep() { return openingAction('complete-movement'); },
          present(current) {
            parent.dataset.mapId = current.map.id;
            parent.dataset.tileX = String(current.tileX); parent.dataset.tileY = String(current.tileY);
            parent.dataset.facing = current.facing;
            current.player.setVisible(false);
            if (!current.game.registry.get('openingOccupancy')) {
              current.add.text((actor.tile.x + .5) * current.map.tileSize, actor.tile.y * current.map.tileSize,
                actor.name + '\n' + actor.facing, { fontSize: '12px', color: '#E6EAF0', backgroundColor: '#141C2A' }).setOrigin(.5, 1);
              current.game.registry.set('openingOccupancy', true);
            }
          },
          release() {},
        };
      } },
    }).catch(reject);
  });
  // Opening admission supplies placement only, not an initialized GrowthState.
  mountGrowthStats(parent, { person: actor.actorId, name: actor.name, growth: null });
  mountSamplingNotice(parent, project);
}
const opening = document.querySelector<HTMLElement>('#realtime');
if (opening) mountOpening(opening, spawnOpening);
