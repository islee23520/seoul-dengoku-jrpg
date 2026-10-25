import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export const encounterData = JSON.parse(readFileSync(new URL('../../game/data/encounters/three-station.json', import.meta.url), 'utf8'));
export const contains = (rect, point) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.w && point.y < rect.y + rect.h;

/** Pure post-conversion application. Emit patches externally; never rewrite unrelated maps. */
export function applyEncounters(project, data = encounterData) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.provenance, 'TESTINPUT');
  const copy = structuredClone(project);
  for (const [id, authored] of Object.entries(data.maps)) {
    const map = copy.maps[id];
    assert(map, 'Missing POC map: ' + id);
    assert.equal(authored.encounterRate, 0, 'Production pacing requires approval');
    assert.deepEqual(authored.troopIds, []);
    for (const entry of authored.encounterTable) {
      assert.equal(entry.troopId, data.candidate.troopId);
      assert(Number.isSafeInteger(entry.weight) && entry.weight > 0);
      assert(entry.conditions?.region, 'Unconditional encounters forbidden');
      const region = entry.conditions.region;
      assert(region.x >= 0 && region.y >= 0 && region.x + region.w <= map.width && region.y + region.h <= map.height);
      for (const safe of authored.safeZones) {
        assert(region.x + region.w <= safe.x || safe.x + safe.w <= region.x || region.y + region.h <= safe.y || safe.y + safe.h <= region.y, 'Safety overlap');
      }
    }
    // Candidate references belong to the separate TESTINPUT host data, not
    // the actorless engine database. Keep its stock admission table inert.
    Object.assign(map, structuredClone(authored), { encounterTable: [] });
  }
  return copy;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // stdout is a deterministic application artifact, consumed by the caller.
  console.log(JSON.stringify(applyEncounters(JSON.parse(readFileSync(process.argv[2] ?? 'game/project.json', 'utf8')))));
}
