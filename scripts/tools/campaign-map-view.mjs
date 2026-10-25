// Derives the browser map view from the admitted campaign atlas (task2).
// Read-only projection: geometry is simplified for display only; ids, names,
// membership and control records are copied verbatim. No new facts are created.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const ATLAS = path.join(root, 'game/data/campaign/atlas.json');
export const VIEW = path.join(root, 'game/data/campaign/map-view.json');

const ringPoints = d => d.split(/(?=M)/).map(ring => {
  const n = ring.match(/-?\d+(?:\.\d+)?/g) ?? [], pts = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push(n[i] + ',' + n[i + 1]);
  if (pts.length && pts[0] !== pts.at(-1)) pts.push(pts[0]);
  return pts;
}).filter(pts => pts.length > 1);

const polygonOf = region => {
  const rings = ringPoints(region.path).map(pts => pts.map(p => p.split(',').map(Number)));
  const xs = rings.flat().map(p => p[0]), ys = rings.flat().map(p => p[1]);
  return { id: region.id, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
};
const inside = (poly, x, y) => {
  if (x < poly.box[0] || x > poly.box[2] || y < poly.box[1] || y > poly.box[3]) return false;
  let hit = false;
  for (const ring of poly.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Outline of every title of one rank. Membership comes only from the atlas (county currentSlots, and the
 * union of countyIds above county), so titles of one rank may overlap (constituency counties cross gu lines).
 * A dong segment belongs to a title's outline when exactly one side of its midpoint (probed 0.25 atlas units
 * along the normal) lies in a member dong; neighbouring dong do not always share vertices, so a
 * segment-identity test is not enough. Identical segments from several titles are drawn once. */
export function rankBoundary(regions, titles) {
  const polys = regions.map(polygonOf);
  const regionAt = (x, y) => polys.find(poly => inside(poly, x, y))?.id ?? null;
  const memberOf = new Map(regions.map(region => [region.id, []]));
  titles.forEach((title, index) => { for (const id of title.regionIds) memberOf.get(id)?.push(index); });
  const seen = new Set(), kept = [];
  for (const poly of polys) for (const ring of poly.rings) for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
    const a = ax + ',' + ay, b = bx + ',' + by, key = a < b ? a + '|' + b : b + '|' + a;
    if (seen.has(key)) continue; seen.add(key);
    const length = Math.hypot(bx - ax, by - ay); if (length === 0) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay) / length * 0.25, ny = (bx - ax) / length * 0.25;
    const left = new Set(memberOf.get(regionAt(mx + nx, my + ny)) ?? []), right = new Set(memberOf.get(regionAt(mx - nx, my - ny)) ?? []);
    if ([...left].some(t => !right.has(t)) || [...right].some(t => !left.has(t))) kept.push({ a: a < b ? a : b, b: a < b ? b : a });
  }
  const adjacency = new Map();
  for (const s of kept) for (const [p, q] of [[s.a, s.b], [s.b, s.a]]) (adjacency.get(p) ?? adjacency.set(p, []).get(p)).push({ q, s });
  const used = new Set(), lines = [];
  for (const s of kept) {
    if (used.has(s)) continue;
    used.add(s); const line = [s.a, s.b];
    for (let end = true; ;) {
      const tip = end ? line.at(-1) : line[0];
      const next = (adjacency.get(tip) ?? []).find(edge => !used.has(edge.s));
      if (!next) { if (!end) break; end = false; continue; }
      used.add(next.s); if (end) line.push(next.q); else line.unshift(next.q);
    }
    lines.push('M' + line.join('L'));
  }
  return lines.join('');
}

export function buildMapView(atlasBytes) {
  const atlas = JSON.parse(atlasBytes);
  if (atlas.schema !== 'campaign-atlas.v1') throw new Error('Unexpected atlas schema: ' + atlas.schema);
  const titles = new Map(atlas.geography.titles.map(title => [title.id, title]));
  const dongs = id => {
    const title = titles.get(id);
    if (!title) throw new Error('Unresolved title: ' + id);
    // currentSlots bind the current (2026) dong regions; datedSlots carry historical slots outside this atlas.
    if (title.rank === 'county') return title.currentSlots.map(slot => slot.dongId);
    return title.countyIds.flatMap(dongs);
  };
  const regionIds = new Set(atlas.regions.map(region => region.id));
  const stationRegion = station => station.control?.surfaceRegionId ?? null;
  return {
    schema: 'campaign-map-view.v1',
    edition: atlas.edition,
    atlasSha256: createHash('sha256').update(atlasBytes).digest('hex'),
    width: atlas.width, height: atlas.height,
    spatialDate: atlas.geography.spatialDate,
    semantics: atlas.semantics,
    executionAdmission: atlas.transport.executionAdmission,
    // State names exist in the atlas only as station control records (stateId -> polityName, verbatim).
    states: Object.fromEntries(atlas.stations.flatMap(station => (station.control?.polityIds ?? [])
      .map((id, index) => [id, station.control.polityNames[index]])).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    hegemons: atlas.hegemons.map(({ kind, stateId = null, name, memberStateIds, color }) => ({ kind, stateId, name, memberStateIds, color })),
    regions: atlas.regions.map(region => ({ id: region.id, name: region.name, district: region.district, path: region.path,
      status: region.status, polities: region.polities, hegemonStateIds: region.currentHegemons.map(h => h.stateId ?? null) })),
    titles: atlas.geography.titles.map(title => {
      const members = [...new Set(dongs(title.id))];
      for (const id of members) if (!regionIds.has(id)) throw new Error('Title member outside atlas: ' + id);
      return { id: title.id, rank: title.rank, name: title.name, parentId: title.parentId, holderPersonId: title.holderPersonId,
        regionIds: members };
    }),
    // Display boundaries per rank, dissolved from the region topology (title.path is the undissolved dong union).
    rankBoundaries: Object.fromEntries(['county', 'duchy', 'kingdom', 'empire'].map(rank =>
      [rank, rankBoundary(atlas.regions, atlas.geography.titles.filter(t => t.rank === rank).map(t => ({ regionIds: [...new Set(dongs(t.id))] })))])),
    stations: atlas.stations.map(station => ({ id: station.id, name: station.name, x: station.x, y: station.y,
      lineIds: station.lineIds, regionId: stationRegion(station) })),
    edges: atlas.edges.map(edge => ({ id: edge.id, a: edge.a, b: edge.b, lineIds: edge.lineIds })),
    selection: { persons: atlas.selection.persons, holding: atlas.selection.holding, titleBinding: atlas.selection.titleBinding,
      site: atlas.selection.site },
  };
}

export const serialize = view => JSON.stringify(view) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const view = buildMapView(await readFile(ATLAS));
  await writeFile(VIEW, serialize(view));
  console.log(JSON.stringify({ out: path.relative(root, VIEW), atlasSha256: view.atlasSha256, regions: view.regions.length, titles: view.titles.length, stations: view.stations.length, edges: view.edges.length }));
}
