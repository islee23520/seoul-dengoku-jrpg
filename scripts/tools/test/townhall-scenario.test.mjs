import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineParser, hash } from '../seoul-map-convert.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = join(root, 'game/data/scenarios/townhall-s01-r1');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const scenario = json(join(directory, 'scenario.json'));
const projection = json(join(directory, 'projection.json'));
const gaps = json(join(directory, 'numeric-gaps.json'));
const wiki = json(join(directory, 'wiki-sync.json'));
const groups = ['epoch', 'sites', 'actors', 'reception', 'ledger', 'inspection', 'rights', 'availability', 'policies'];
const evidenceRoot = resolve(process.env.TOWNHALL_EVIDENCE_ROOT ?? root);
const evidence = ref => join(evidenceRoot, ref.split('#')[0]);
const nodes = new Map(projection.nodes.map(node => [node.id, node]));
const maps = Object.fromEntries(projection.scenes.map(scene => [scene.mapId, json(join(directory, scene.mapFile))]));

function projectFixture() {
  const project = json(join(root, 'game/project.json'));
  project.maps = structuredClone(maps);
  project.mapTree = { mapId: projection.scenes[0].mapId, children: projection.scenes.slice(1).map(scene => ({ mapId: scene.mapId, children: [] })) };
  project.mapConnections = [];
  project.startMapId = projection.actors[0].mapId;
  project.startPos = projection.actors[0].tile;
  return project;
}

test('approved nine record groups retain the exact revision-1 mirrors', () => {
  // Given: the hash-locked approved proposal and its nine semantic operations.
  const source = scenario.provenance.sources.find(source => source.evidenceRef.endsWith('/proposed-records.json'));
  const bytes = readFileSync(evidence(source.evidenceRef));
  const proposed = JSON.parse(bytes);
  // When: reading the game-side scenario record groups.
  const records = Object.fromEntries(groups.map(group => [group, scenario[group]]));
  // Then: each shipped value is the approved operation value, not an adapted lore record.
  assert.equal(hash(bytes), scenario.provenance.approvedRecordsSha256);
  assert.equal(proposed.patchOperations.length, groups.length);
  groups.forEach((group, index) => assert.deepEqual(records[group], proposed.patchOperations[index].value));
  assert.equal(hash(JSON.stringify(records)), scenario.provenance.recordGroupsSha256);
});

test('self-contained interior maps survive the converter actual engine parser', async () => {
  // Given: a detached validation harness, never a write to game/project.json.
  const project = projectFixture();
  const { validateProjectV4 } = await engineParser();
  // When: the engine parses the scenario maps in a complete project envelope.
  const parsed = validateProjectV4(project);
  // Then: the interior role and tile layers survive; malformed layers fail closed.
  for (const [id, map] of Object.entries(maps)) {
    assert.equal(parsed.maps[id].mapRole, map.mapRole);
    assert.equal('station' in parsed.maps[id], false);
    assert.deepEqual(parsed.maps[id].lowerTiles, map.lowerTiles);
  }
  assert.equal(parsed.maps[projection.scenes[0].mapId].mapRole, 'interior');
  const invalid = projectFixture();
  invalid.maps[projection.scenes[0].mapId].lowerTiles.pop();
  assert.throws(() => validateProjectV4(invalid));
});

test('projection references resolve to walkable unique actor locations and reachable routes', async () => {
  // Given: the actual collision rules and authored local map geometry.
  const project = projectFixture();
  const { isPassableLanding, canMove } = await engineParser();
  // When: resolving all projected canonical locations and route segments.
  const occupancy = projection.actors.map(actor => actor.mapId + ':' + actor.tile.x + ':' + actor.tile.y);
  // Then: one body has one valid location, and every route step is traversable.
  assert.equal(nodes.size, scenario.sites.length);
  assert.equal(new Set(occupancy).size, 3);
  assert.deepEqual(projection.actors.map(actor => actor.actorId), scenario.actors.map(actor => actor.id));
  for (const node of nodes.values()) {
    assert(maps[node.mapId]);
    assert(isPassableLanding(project, maps[node.mapId], node.tile.x, node.tile.y));
  }
  for (const actor of projection.actors) {
    const source = scenario.actors.find(source => source.id === actor.actorId);
    const node = nodes.get(actor.nodeId);
    assert.equal(actor.nodeId, source.worldLocation.sublocationId);
    assert.equal(actor.mapId, node.mapId);
    assert.deepEqual(actor.tile, node.tile);
    assert(['up', 'down', 'left', 'right'].includes(actor.facing));
    assert.equal(actor.effectiveAt, 'E0');
  }
  const originals = [scenario.ledger.route.orderedNodes, scenario.inspection.orderedNodes, scenario.rights.dutyWalk.section];
  projection.routes.forEach((route, index) => {
    assert.deepEqual(route.orderedNodes, originals[index]);
    assert.equal(route.geometry.length, route.orderedNodes.length - 1);
    route.geometry.forEach((segment, offset) => {
      const from = nodes.get(route.orderedNodes[offset]), to = nodes.get(route.orderedNodes[offset + 1]);
      assert.equal(segment.fromNode, from.id);
      assert.equal(segment.toNode, to.id);
      assert.deepEqual(segment.points[0], { mapId: from.mapId, ...from.tile });
      assert.deepEqual(segment.points.at(-1), { mapId: to.mapId, ...to.tile });
      if (segment.portalId) {
        const portal = projection.portals.find(portal => portal.id === segment.portalId);
        assert(portal && portal.bidirectional);
        assert.deepEqual([portal.fromNode, portal.toNode].sort(), [from.id, to.id].sort());
      } else {
        for (let i = 1; i < segment.points.length; i++) {
          const a = segment.points[i - 1], b = segment.points[i];
          assert.equal(a.mapId, b.mapId);
          assert(canMove(project, maps[a.mapId], a.x, a.y, b.x, b.y));
          assert(canMove(project, maps[a.mapId], b.x, b.y, a.x, a.y));
        }
      }
    });
  });
  const archivePortal = projection.portals.find(portal => portal.id === projection.access.archivePortalId);
  assert(archivePortal.requires.includes(scenario.rights.grants[1].id));
  assert(archivePortal.requires.includes('duty-escort'));
  assert.notEqual(nodes.get(scenario.ledger.container).mapId, nodes.get(scenario.reception.location).mapId);
  assert(nodes.get(scenario.reception.location).roles.includes('reception'));
  assert(nodes.get(scenario.ledger.container).roles.includes('custody-pickup'));
  for (const target of scenario.inspection.targets) assert(nodes.get(target.id).roles.includes('measurement'));
});

test('missing numeric inputs block named actions without zero or instant defaults', () => {
  // Given: explicit unresolved numeric and play-start inputs.
  const categories = ['time', 'wages', 'fatigue', 'calibration', 'travel-coefficients'];
  // When: resolving the actions affected by missing inputs.
  const blocked = new Set(gaps.gaps.flatMap(gap => gap.blockedActions));
  // Then: every gap is fail closed and start, movement, work and measurement cannot complete.
  for (const category of categories) assert(gaps.gaps.some(gap => gap.category === category));
  for (const input of scenario.policies.unapprovedFormulaInputs) assert(gaps.gaps.some(gap => gap.id === input.id));
  for (const gap of gaps.gaps) {
    assert.equal(gap.status, 'missing');
    assert.equal(gap.failClosed, true);
    assert.equal(gap.value, null);
    assert.equal(gap.defaultValue, null);
    assert(gap.blockedActions.length > 0);
  }
  for (const action of ['start-play', 'complete-movement', 'execute-labor', 'settle-injury-fatigue', 'commit-measurement']) assert(blocked.has(action));
  assert.equal(gaps.missingInputBehavior, scenario.policies.missingInputBehavior);
  assert.equal(scenario.executionAllowed, false);
  assert.equal(projection.executionAllowed, false);
  assert.equal(scenario.publicationAllowed, false);
});

test('approval and authored projection evidence resolve while wiki synchronization stays deferred', () => {
  // Given: real approval receipts and bounded source evidence.
  const provenance = scenario.provenance;
  assert.equal(provenance.evidenceRoot, 'REPO_ROOT');
  assert.equal(isAbsolute(provenance.evidenceRoot), false);
  assert.equal(wiki.databasePath, 'seoul-dengoku-wiki:data/canonical/wiki-cast.sqlite');
  assert.equal(isAbsolute(wiki.databasePath), false);
  // When: following each shipped provenance and projection reference.
  const entries = [...projection.scenes, ...projection.nodes, ...projection.portals, ...projection.actors, ...projection.routes, ...projection.routes.flatMap(route => route.geometry), projection.transform, projection.access, ...Object.values(maps)];
  // Then: hashes and verbatim receipt objects match actual files; no wiki admission is claimed.
  assert.equal(provenance.approvals.length, 3);
  for (const entry of [...provenance.approvals, ...provenance.sources]) {
    const bytes = readFileSync(evidence(entry.evidenceRef));
    assert.equal(hash(bytes), entry.sha256);
    if (entry.verbatim) assert.deepEqual(entry.verbatim, JSON.parse(bytes));
  }
  for (const entry of entries) {
    assert.equal(entry.sourceKind, 'authored-scenario-data');
    assert(existsSync(evidence(entry.evidenceRef)));
    const pointer = entry.evidenceRef.split('#')[1];
    if (pointer) {
      let value = json(evidence(entry.evidenceRef));
      for (const key of pointer.slice(1).split('/')) value = value[key];
      assert.notEqual(value, undefined);
    }
  }
  for (const gap of gaps.gaps) assert(existsSync(evidence(gap.evidenceRef)));
  assert(existsSync(evidence(wiki.investigationRef)));
  assert(existsSync(evidence(wiki.ownerSelectionRef)));
  assert.equal(wiki.status, 'DEFERRED_INCOMPLETE');
  assert.equal(wiki.databaseWritten, false);
  assert.equal(wiki.supportedWritePath, null);
  const crosswalkRef = provenance.sources.find(source => source.evidenceRef.endsWith('/source-crosswalk.json'));
  assert.equal(wiki.observedSha256, json(evidence(crosswalkRef.evidenceRef)).databaseObservation.sha256Before);
});
