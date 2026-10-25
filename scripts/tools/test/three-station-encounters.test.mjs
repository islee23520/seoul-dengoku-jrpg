import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEncounters, encounterData } from '../apply-encounters.mjs';
import { engineParser, reachableCells } from '../seoul-map-convert.mjs';
import { encounterApplicationSchema, eligibleCorridor, requestTransfer } from '../../../game/src/runtime/threeStation.ts';
import { threeStationTestInput } from '../../../game/src/runtime/threeStationTestInput.ts';
import { RealtimeHost, validateHostContent } from '../../../game/src/runtime/realtimeHost.ts';
import { MissingRuleInput } from '../../../game/src/battle/realtime.ts';

const load = path => JSON.parse(readFileSync(new URL('../../../' + path, import.meta.url), 'utf8'));
const project = load('game/project.json');
const graph = load('game/data/world/graph.json');
const data = encounterApplicationSchema.parse(encounterData);
const sindorim = 'station-53696e646f72696d';
const yeongdeungpo = 'station-59656f6e676465756e67706f';
const guro = 'station-4775726f';
const corridor = { mapId: sindorim, x: 8, y: 5 };
const exits = map => map.events.flatMap(event => event.pages.flatMap(page => page.commands.filter(c => c.kind === 'transfer').map(target => ({ x: event.x, y: event.y, target }))));

test('transfer content requires game traversal ingress and rejects mixed resource or malformed commands', () => {
  // Given a real authored transfer, with no interpreter authority.
  const transfer = exits(project.maps[sindorim])[0].target;
  // When content enters with and without the game-owned presenter.
  assert.throws(() => validateHostContent({ commands: [transfer] }));
  assert.doesNotThrow(() => validateHostContent(project, true));
  // Then the allowance covers only exact transfer data, not other ingress.
  for (const command of [{ kind: 'gainGold', amount: 1 }, { ...transfer, x: -1 }, { ...transfer, commands: [] }, { ...transfer, save: true }]) {
    assert.throws(() => validateHostContent({ commands: [transfer, command] }, true));
  }
  assert.throws(() => validateHostContent({ commands: [transfer], pages: [{ save: true }] }, true));
});

test('encounter boundary rejects unconditional tables', () => {
  // Given the explicit TESTINPUT data boundary.
  const invalid = structuredClone(encounterData);
  // When a conditioned entry is replaced by an unconditional candidate.
  invalid.maps[sindorim].encounterTable = [{ troopId: 'troop_slime', weight: 1 }];
  // Then parsing rejects it rather than broadening eligibility.
  assert.equal(encounterApplicationSchema.safeParse(invalid).success, false);
});

test('encounter boundary rejects nonpositive structural weights', () => {
  // Given the explicit TESTINPUT data boundary.
  const invalid = structuredClone(encounterData);
  // When a candidate has no selection weight.
  invalid.maps[sindorim].encounterTable[0].weight = 0;
  // Then it cannot enter the selection function.
  assert.equal(encounterApplicationSchema.safeParse(invalid).success, false);
});

test('post-conversion application is deterministic and changes only three encounter projections', async () => {
  // Given materialized data with exactly three game-owned projections.
  const bare = structuredClone(project);
  for (const id of Object.keys(data.maps)) for (const field of Object.keys(data.maps[id])) delete bare.maps[id][field];
  // When applied twice and parsed by the engine.
  const applied = applyEncounters(bare);
  const { validateProjectV4 } = await engineParser();
  validateProjectV4(structuredClone(applied));
  // Then maps and all unrelated data remain equal, including standalone copies.
  assert.deepEqual(applied, project);
  assert.deepEqual(applyEncounters(applied), applied);
  assert.equal(Object.keys(project.maps).length, 334);
  for (const [id, map] of Object.entries(project.maps)) {
    assert.deepEqual(map, load('game/maps/' + id + '.json'));
    if (!data.maps[id]) assert.deepEqual(map, bare.maps[id]);
  }
  assert.equal(project.maps[sindorim].encounterTable.length, 0);
  assert.deepEqual(Object.keys(data.maps[sindorim].encounterTable[0]).sort(), ['conditions', 'troopId', 'weight']);
});

test('authored regions exclude every safe tile and arrival or exit pad', () => {
  // Given every tile of each POC map.
  const host = threeStationTestInput(data, 7);
  // When completed steps are admitted in every safety rectangle.
  for (const [mapId, authored] of Object.entries(data.maps)) for (const area of authored.safeZones) {
    for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) {
      const step = { mapId, x, y };
      assert.equal(eligibleCorridor(data, step), false);
      host.completedStep(step);
    }
  }
  // Then no accumulator, RNG or encounter changed, but corridor is reachable and eligible.
  assert.equal(host.state.encounterSerial, 0);
  assert.equal(host.state.encounterAccumulator, 0);
  assert.equal(host.state.purposeRngStates['three-station:selection'], 7);
  assert.equal(eligibleCorridor(data, corridor), true);
  assert(reachableCells(project, project.maps[sindorim], { x: 2, y: 5 }).some(p => p.x === 8 && p.y === 5));
  for (const id of Object.keys(data.maps)) for (const exit of exits(project.maps[id])) assert.equal(eligibleCorridor(data, { mapId: id, x: exit.x, y: exit.y }), false);
});

test('all graph-derived transfers remain independently equal and a three-station round trip rejects the direct edge', () => {
  // Given source graph adjacency calculated independently of map IDs.
  const expected = graph.edges.flatMap(({ a, b }) => [a + '>' + b, b + '>' + a]).sort();
  const actual = Object.values(project.maps).flatMap(map => exits(map).map(exit => map.station.id + '>' + project.maps[exit.target.mapId].station.id)).sort();
  // When walking the actual four authored transfer requests.
  let current = yeongdeungpo;
  for (const targetMapId of [sindorim, guro, sindorim, yeongdeungpo]) {
    const available = exits(project.maps[current]);
    const exit = available.find(exit => exit.target.mapId === targetMapId);
    current = requestTransfer(available, { position: { mapId: current, x: exit.x, y: exit.y }, targetMapId }).mapId;
  }
  // Then equality, isolates, round trip and rejection all hold.
  assert.deepEqual(actual, expected);
  assert.equal(graph.isolates.length, 8);
  assert.equal(current, yeongdeungpo);
  assert.throws(() => requestTransfer(exits(project.maps[current]), { position: { mapId: current, x: 29, y: 11 }, targetMapId: guro }), /not-at-graph-exit/);
});

test('seeded port admission resolves through the continuous battle spike deterministically', () => {
  // Given two hosts with identical explicit synthetic rules and seed.
  const hosts = [threeStationTestInput(data, 7), threeStationTestInput(data, 7)];
  // When three eligible movement completions and one clock tick arrive.
  for (const host of hosts) {
    const port = host.bind();
    for (let step = 0; step < 3; step++) port.completedStep({ ...corridor, x: corridor.x + step });
    port.elapsed(100);
  }
  // Then a real spike outcome exists and complete states are equal.
  assert.deepEqual(hosts[0].state, hosts[1].state);
  assert.equal(hosts[0].state.encounterSerial, 1);
  assert.equal(hosts[0].state.battle.context.encounterId, 'troop_slime');
  assert.equal(hosts[0].state.battle.outcome.terminalKind, 'ordinary-victory');
  assert.equal(hosts[0].state.purposeRngStates['three-station:selection'], 1025555898);
});

test('port admission without approved GP rules fails closed before any mutation', () => {
  // Given a production host with no approved numerical rules.
  const host = new RealtimeHost({ state: threeStationTestInput(data, 7).state, mode: 'production', rules: null, settle: state => state });
  const before = host.state;
  // When a completed eligible step reaches the port.
  assert.throws(() => host.bind().completedStep(corridor), MissingRuleInput);
  // Then nothing is mutated and zero production rate remains authored.
  assert.equal(host.state, before);
  assert(Object.values(data.maps).every(map => map.encounterRate === 0));
});
