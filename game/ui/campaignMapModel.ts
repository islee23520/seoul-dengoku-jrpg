/** Read-only campaign map view model (task12). No DOM, no campaign state writes.
 * Inputs are the admitted task2 atlas projection (map-view.json) and identity map.
 *
 * Scope boundary (interim, until tasks 4/10 provide the lord-visible knowledge snapshot):
 * a lord sees only the regions named by the admitted holding record they hold
 * (atlas.selection.holding.adminRefs). A person without a holding sees only the region
 * of the admitted start site when they start there. Everything else is unknown. */

export type Rank = 'barony' | 'county' | 'duchy' | 'kingdom' | 'empire';
export type MapMode = 'political' | 'titles';
export type DockTab = 'titles' | 'sites';
export const ranks: readonly Rank[] = ['barony', 'county', 'duchy', 'kingdom', 'empire'];

export interface MapRegion { readonly id: string; readonly name: string; readonly district: string; readonly path: string;
  readonly status: string; readonly polities: readonly string[]; readonly hegemonStateIds: readonly (string | null)[] }
export interface MapTitle { readonly id: string; readonly rank: Rank; readonly name: string; readonly parentId: string | null;
  readonly holderPersonId: string | null; readonly regionIds: readonly string[] }
export interface MapStation { readonly id: string; readonly name: string; readonly x: number; readonly y: number;
  readonly lineIds: readonly string[]; readonly regionId: string | null }
export interface MapEdge { readonly id: string; readonly a: string; readonly b: string; readonly lineIds: readonly string[] }
export interface Hegemon { readonly kind: string; readonly stateId: string | null; readonly name: string;
  readonly memberStateIds: readonly string[]; readonly color: string }
export interface MapView {
  readonly schema: 'campaign-map-view.v1'; readonly edition: string; readonly atlasSha256: string;
  readonly width: number; readonly height: number; readonly executionAdmission: boolean;
  readonly states: Readonly<Record<string, string>>; readonly hegemons: readonly Hegemon[];
  readonly regions: readonly MapRegion[]; readonly titles: readonly MapTitle[];
  /** Per-rank display boundary, dissolved from the shared region topology. */
  readonly rankBoundaries: Readonly<Partial<Record<Rank, string>>>;
  readonly stations: readonly MapStation[]; readonly edges: readonly MapEdge[];
  readonly selection: {
    readonly persons: readonly { readonly id: string; readonly name: string; readonly stateId: string; readonly disposition: string }[];
    readonly holding: { readonly id: string; readonly holderPersonId: string; readonly directLiegePersonId: string; readonly stateId: string;
      readonly adminRefs: readonly { readonly id: string; readonly name: string }[] };
    readonly titleBinding: { readonly holdingId: string; readonly titleId: string; readonly parentTitleId: string; readonly parentHolderPersonId: string };
    readonly site: { readonly id: string; readonly name: string; readonly regionId: string };
  };
}
export interface IdentityMap {
  readonly titles: readonly { readonly canonical: string; readonly public: string }[];
  readonly references: readonly { readonly oldId: string; readonly newId: string; readonly status: string }[];
  readonly persons: readonly { readonly oldId: string; readonly newId: string; readonly status: string }[];
}

export type Selection =
  | { readonly kind: 'title'; readonly id: string; readonly canonicalId: string; readonly geographyId: string }
  | { readonly kind: 'holding'; readonly id: string; readonly canonicalId: string }
  | { readonly kind: 'region'; readonly id: string; readonly canonicalId: string }
  | { readonly kind: 'site'; readonly id: string; readonly canonicalId: string };

export interface MapViewState {
  readonly mode: MapMode; readonly rank: Rank; readonly rail: boolean;
  readonly tab: DockTab; readonly expanded: boolean; readonly selection: Selection | null;
}
export const initialViewState: MapViewState = Object.freeze({ mode: 'political', rank: 'county', rail: false, tab: 'titles', expanded: false, selection: null });

export interface LordScope {
  readonly personId: string;
  /** Regions the lord legally administers by the admitted holding record. */
  readonly jurisdiction: ReadonlySet<string>;
  /** Regions whose recorded facts this view may show. */
  readonly known: ReadonlySet<string>;
  readonly holdingIds: readonly string[];
  readonly titleIds: readonly string[];
  readonly basis: 'interim-admitted-holding-record';
}

export function lordScope(view: MapView, personId: string, startPlace: string | null): LordScope {
  const holding = view.selection.holding;
  const holds = holding.holderPersonId === personId;
  const jurisdiction = new Set(holds ? holding.adminRefs.map(ref => ref.id) : []);
  const known = new Set(jurisdiction);
  if (startPlace !== null && startPlace === view.selection.site.name) known.add(view.selection.site.regionId);
  return { personId, jurisdiction, known, basis: 'interim-admitted-holding-record',
    holdingIds: holds ? [holding.id] : [],
    titleIds: holds && view.selection.titleBinding.holdingId === holding.id ? [view.selection.titleBinding.titleId] : [] };
}

export type Resolution = { readonly ok: true; readonly selection: Selection }
  | { readonly ok: false; readonly reason: 'unknown-id' | 'out-of-scope' | 'unmapped-identity' };

const exactReference = (identity: IdentityMap, id: string): string | null =>
  identity.references.find(ref => ref.oldId === id && ref.status === 'exact')?.newId ?? null;

/** Political title ids carry the gu code of their geography duchy (`title:duchy-gu-11470-S01` -> `geography:duchy:11470`). */
const POLITICAL_DUCHY = /^title:duchy-gu-(\d{5})-S\d{2}$/;

/** Maps a raw id (pointer, keyboard or deep link) to a canonical selection, or refuses it. Pure. */
export function resolveSelection(view: MapView, identity: IdentityMap, scope: LordScope, raw: unknown): Resolution {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return { ok: false, reason: 'unknown-id' };
  if (raw === view.selection.site.id) {
    if (!view.regions.some(r => r.id === view.selection.site.regionId)) return { ok: false, reason: 'unknown-id' };
    if (!scope.known.has(view.selection.site.regionId)) return { ok: false, reason: 'out-of-scope' };
    const canonicalId = exactReference(identity, raw);
    return canonicalId ? { ok: true, selection: { kind: 'site', id: raw, canonicalId } } : { ok: false, reason: 'unmapped-identity' };
  }
  if (raw.startsWith('region:')) {
    if (!view.regions.some(r => r.id === raw)) return { ok: false, reason: 'unknown-id' };
    if (!scope.known.has(raw)) return { ok: false, reason: 'out-of-scope' };
    const canonicalId = exactReference(identity, raw);
    return canonicalId ? { ok: true, selection: { kind: 'region', id: raw, canonicalId } } : { ok: false, reason: 'unmapped-identity' };
  }
  if (raw.startsWith('holding:')) {
    if (raw !== view.selection.holding.id) return { ok: false, reason: 'unknown-id' };
    if (!scope.holdingIds.includes(raw)) return { ok: false, reason: 'out-of-scope' };
    const canonicalId = exactReference(identity, raw);
    return canonicalId ? { ok: true, selection: { kind: 'holding', id: raw, canonicalId } } : { ok: false, reason: 'unmapped-identity' };
  }
  if (raw.startsWith('title:')) {
    if (raw !== view.selection.titleBinding.titleId) return { ok: false, reason: 'unknown-id' };
    if (!scope.titleIds.includes(raw)) return { ok: false, reason: 'out-of-scope' };
    const code = POLITICAL_DUCHY.exec(raw)?.[1];
    const geographyId = code ? 'geography:duchy:' + code : null;
    const canonicalId = geographyId ? identity.titles.find(t => t.public === geographyId)?.canonical ?? null : null;
    return geographyId && canonicalId ? { ok: true, selection: { kind: 'title', id: raw, canonicalId, geographyId } } : { ok: false, reason: 'unmapped-identity' };
  }
  return { ok: false, reason: 'unknown-id' };
}

/** Selecting only replaces view state. It returns a new object and never touches the inputs. */
export function select(state: MapViewState, resolution: Resolution): MapViewState {
  if (!resolution.ok) return state;
  const selection = resolution.selection;
  const tab: DockTab = selection.kind === 'title' ? 'titles' : selection.kind === 'holding' ? 'sites' : state.tab;
  return { ...state, tab, selection };
}

export const setMode = (state: MapViewState, mode: MapMode): MapViewState => ({ ...state, mode });
export const setRank = (view: MapView, state: MapViewState, rank: Rank): MapViewState =>
  rankAvailable(view, rank) ? { ...state, mode: 'titles', rank } : state;
export const rankAvailable = (view: MapView, rank: Rank): boolean => view.titles.some(title => title.rank === rank);

export type RegionClass = 'jurisdiction' | 'known' | 'unknown';
export interface RegionFill { readonly id: string; readonly cls: RegionClass; readonly color: string | null; readonly label: string | null }

/** The hegemon colour is shown only for known regions; unknown regions never leak source control. */
export function regionFills(view: MapView, scope: LordScope, state: MapViewState): readonly RegionFill[] {
  const hegemonColor = (stateId: string | null): string | null => {
    if (!stateId) return null;
    return view.hegemons.find(h => h.stateId === stateId || h.memberStateIds.includes(stateId))?.color ?? null;
  };
  return view.regions.map(region => {
    const cls: RegionClass = scope.jurisdiction.has(region.id) ? 'jurisdiction' : scope.known.has(region.id) ? 'known' : 'unknown';
    if (cls === 'unknown') return { id: region.id, cls, color: null, label: null };
    const color = state.mode === 'political' ? hegemonColor(region.hegemonStateIds[0] ?? null) : null;
    return { id: region.id, cls, color, label: region.name };
  });
}

/** Boundary of the chosen title rank. Geography is public inspection data; holders stay as recorded (all unassigned). */
export const rankOutline = (view: MapView, state: MapViewState): string | null =>
  state.mode === 'titles' ? view.rankBoundaries[state.rank] ?? null : null;

/** Railway-visible overlay. Not the executable graph: executionAdmission stays false and no route is offered. */
export function railOverlay(view: MapView, scope: LordScope, state: MapViewState) {
  if (!state.rail) return { segments: [], stations: [], executable: false as const };
  const byId = new Map(view.stations.map(station => [station.id, station]));
  const segments = view.edges.flatMap(edge => {
    const a = byId.get(edge.a), b = byId.get(edge.b);
    return a && b ? [{ id: edge.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y }] : [];
  });
  const stations = view.stations.map(station => ({ id: station.id, x: station.x, y: station.y,
    label: station.regionId !== null && scope.known.has(station.regionId) ? station.name : null }));
  return { segments, stations, executable: false as const };
}

export const personName = (view: MapView, id: string | null): string | null =>
  id === null ? null : view.selection.persons.find(person => person.id === id)?.name ?? null;

/** Measured bounds of the source geometry (all region paths), in atlas units. */
export function geometryBounds(paths: readonly string[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    const numbers = path.match(/-?\d+(?:\.\d+)?/g) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = Number(numbers[i]), y = Number(numbers[i + 1]);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point-in-polygon over absolute M/L/Z rings. Used for pointer hit-test receipts. */
export function pathContains(path: string, x: number, y: number): boolean {
  let inside = false;
  for (const ring of path.split(/(?=M)/)) {
    const pts = (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (let i = 0, j = pts.length - 2; i + 1 < pts.length; j = i, i += 2) {
      const xi = pts[i]!, yi = pts[i + 1]!, xj = pts[j]!, yj = pts[j + 1]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export const hitTest = (view: MapView, x: number, y: number): string | null =>
  view.regions.find(region => pathContains(region.path, x, y))?.id ?? null;

/** Deep link: `#map=<mode>.<rank>.<rail01>[.<selection id>]`. Anything invalid falls back field by field. */
export function encodeHash(state: MapViewState): string {
  return '#map=' + [state.mode, state.rank, state.rail ? '1' : '0', ...(state.selection ? [encodeURIComponent(state.selection.id)] : [])].join('.');
}
export function decodeHash(view: MapView, identity: IdentityMap, scope: LordScope, hash: string):
  { readonly state: MapViewState; readonly rejected: readonly string[] } {
  const rejected: string[] = [];
  if (!hash.startsWith('#map=')) return { state: initialViewState, rejected: hash ? ['hash'] : [] };
  const [mode, rank, rail, encoded, ...extra] = hash.slice(5).split('.');
  let state: MapViewState = initialViewState;
  if (mode === 'political' || mode === 'titles') state = setMode(state, mode); else rejected.push('mode');
  if (ranks.includes(rank as Rank) && rankAvailable(view, rank as Rank)) state = { ...state, rank: rank as Rank }; else rejected.push('rank');
  if (rail === '0' || rail === '1') state = { ...state, rail: rail === '1' }; else rejected.push('rail');
  if (extra.length) rejected.push('extra');
  if (encoded !== undefined) {
    let id: string | null = null;
    try { id = decodeURIComponent(encoded); } catch { rejected.push('selection'); }
    if (id !== null) {
      const resolution = resolveSelection(view, identity, scope, id);
      if (resolution.ok) state = select(state, resolution); else rejected.push('selection:' + resolution.reason);
    }
  }
  return { state, rejected };
}
