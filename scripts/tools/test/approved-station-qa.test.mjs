import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvedStationQa } from '../../../game/src/runtime/approvedStationQa.ts';
import { threeStationTestInput } from '../../../game/src/runtime/threeStationTestInput.ts';
import { encounterApplicationSchema } from '../../../game/src/runtime/threeStation.ts';
import { encounterData } from '../apply-encounters.mjs';
import { engineParser } from '../seoul-map-convert.mjs';

test('approved actor is the station party and admitted encounter participant', async () => {
  // Given approved K002 identity with explicitly synthetic numeric rules.
  const qa = approvedStationQa('K002');
  const host = threeStationTestInput(encounterApplicationSchema.parse(encounterData), 7, qa.actor.actorId);
  const { validateProjectV4 } = await engineParser();
  // When the station context enters the engine and corridor admission.
  const project = validateProjectV4(qa.project);
  for (const x of [8, 9, 10]) host.completedStep({ mapId: 'station-53696e646f72696d', x, y: 5 });
  // Then actual identity survives both presentation and battle boundaries.
  assert.deepEqual(project.session.partyActorIds, ['K002']);
  assert.deepEqual(project.system.startActorIds, ['K002']);
  assert.deepEqual(project.database.actors.map(actor => actor.id), ['K002']);
  assert.deepEqual(host.state.battle.context.persons.map(person => person.id), ['K002', 'TESTINPUT:slime']);
  assert.equal(host.state.battle.context.provenance, 'TESTINPUT');
  assert.throws(() => approvedStationQa('public-map-navigation-marker'));
});

test('station QA preserves authored portal metadata without inventing canonical travel', () => {
  // Given the actual scenario projection and its approved opening placement.
  const projection = JSON.parse(readFileSync(new URL('../../../game/data/scenarios/townhall-s01-r1/projection.json', import.meta.url)));
  // When entering the private station context.
  const qa = approvedStationQa('K002');
  // Then route provenance remains exact and movement consumes no invented duration.
  assert.deepEqual(qa.entry.canonicalPlacement, { mapId: 'townhall-s01-r1-reception', x: 5, y: 3 });
  assert.deepEqual(qa.entry.stationPlacement, { mapId: 'station-59656f6e676465756e67706f', x: 2, y: 5 });
  assert.deepEqual(qa.entry.authoredPortals, projection.portals.map(({ id, fromNode, toNode }) => ({ id, fromNode, toNode })));
  assert.deepEqual(qa.entry.authoredRoutes, projection.routes.map(({ id, orderedNodes, durationInputRef }) => ({ id, orderedNodes, durationInputRef })));
  assert.equal(qa.entry.travel.kind, 'blocked');
  assert.deepEqual(qa.entry.travel.gaps, ['external:clock-route', 'external:travel-coefficients']);
  assert.equal(qa.entry.consumedTravelTime, null);
  assert.equal(qa.entry.authoredPortals.some(portal => portal.toNode.startsWith('station-')), false);
});
