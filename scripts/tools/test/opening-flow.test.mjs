import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../../../engine/node_modules/esbuild/lib/main.js';
import { openingActors, selectOpeningActor, openingAction, blockedOpeningActions, openingAdmission } from '../../../game/src/runtime/openingScenario.ts';

const projection = JSON.parse(readFileSync(new URL('../../../game/data/scenarios/townhall-s01-r1/projection.json', import.meta.url)));
const numeric = JSON.parse(readFileSync(new URL('../../../game/data/scenarios/townhall-s01-r1/numeric-gaps.json', import.meta.url)));

test('selection exposes exactly the three scenario identities', () => {
  // Given: the scenario-scoped admission, not the entire wiki cast.
  const expected = [['K002', '이서담'], ['K568', '백산석'], ['K616', '성달현']];
  // When: reading the selectable actors.
  const listed = openingActors.map(actor => [actor.actorId, actor.name]);
  // Then: no catalog outsider is offered.
  assert.deepEqual(listed, expected);
});

test('unknown and injected actor values cannot produce a start', () => {
  // Given: unknown, structured, and prototype-like user values.
  const injected = ['K001', 'K999', '__proto__', '', null, { actorId: 'K002' }];
  // When / Then: every invalid selection is rejected before projection.
  for (const input of injected) assert.throws(() => selectOpeningActor(input));
});

test('each approved selection spawns at its exact authored map tile and facing', () => {
  // Given: the independent authored occupancy projection.
  for (const placement of projection.actors) {
    // When: selecting that actor.
    const selected = selectOpeningActor(placement.actorId);
    // Then: the spawn is unchanged from the projection, not a nearby station.
    assert.deepEqual({ mapId: selected.mapId, tile: selected.tile, facing: selected.facing },
      { mapId: placement.mapId, tile: placement.tile, facing: placement.facing });
  }
});

test('all missing numeric actions remain blocked with exact named input gaps', () => {
  // Given: all gaps except the separately approved scenario start.
  const expected = numeric.gaps.filter(gap => gap.category !== 'play-start-approval');
  // When: requesting every affected action.
  for (const gap of expected) for (const action of gap.blockedActions) {
    const result = openingAction(action);
    // Then: it cannot complete or silently use a zero default.
    assert.equal(result.kind, 'blocked');
    assert(result.gaps.includes(gap.id));
    assert(blockedOpeningActions.some(row => row.action === action && row.input === gap.id));
  }
  assert.equal(openingAdmission.publication, false);
  assert.equal(openingAdmission.appearanceApproved, false);
});

test('selection remains deterministic and returns independent placement values', () => {
  // Given: one caller mutates its returned coordinate.
  const first = selectOpeningActor('K002');
  first.tile.x = 99;
  // When: another caller selects the same identity.
  const second = selectOpeningActor('K002');
  // Then: source occupancy is preserved.
  assert.equal(second.tile.x, projection.actors[0].tile.x);
});

test('actual engine project start preserves chosen occupancy and never mutates production', async () => {
  // Given: the real engine parser bundled with the game-owned projection adapter.
  const root = new URL('../../../', import.meta.url).pathname;
  const before = readFileSync(new URL('../../../game/project.json', import.meta.url));
  const bundle = await build({ entryPoints: [root + 'hosting/opening-project.ts'], bundle: true, write: false,
    platform: 'node', format: 'esm', alias: { '@': root + 'engine/src' } });
  const { openingProject } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  // When: constructing each actual runtime project.
  for (const placement of projection.actors) {
    const project = openingProject(placement.actorId);
    // Then: engine-normalized starts retain exact scene coordinates and identity.
    assert.equal(project.startMapId, placement.mapId);
    assert.deepEqual(project.startPos, placement.tile);
    assert.deepEqual(project.system.startActorIds, [placement.actorId]);
    const authoredMap = JSON.parse(readFileSync(new URL('../../../game/data/scenarios/townhall-s01-r1/maps/' + placement.mapId + '.json', import.meta.url)));
    assert.equal(project.maps[placement.mapId].mapRole, authoredMap.mapRole);
    assert.equal(project.database.actors[0].characterTransparent, true);
  }
  assert.throws(() => openingProject('K001'));
  assert.deepEqual(readFileSync(new URL('../../../game/project.json', import.meta.url)), before);
});
