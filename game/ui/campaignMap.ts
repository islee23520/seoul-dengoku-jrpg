/** Campaign map screen (task12), ported from Unity StrategyMapScreen flat route + FoundationPovHud (reference R4):
 * 48px common navigation (person, 정치/작위 modes, rank filters, settings, POV, back, 무주지 legend),
 * left identity dock, state-control context, right held-titles / personal-holdings dock over a full-bleed map.
 * Selection only changes view state; it emits no campaign cause and writes no game state. */
import { t } from '../../hosting/ui-strings.ts';
import type { UiStringKey } from '../../hosting/ui-strings.ts';
import {
  decodeHash, encodeHash, geometryBounds, lordScope, personName, railOverlay, rankAvailable, ranks,
  rankOutline, regionFills, resolveSelection, select, setMode, setRank,
} from './campaignMapModel.ts';
import type { IdentityMap, MapView, MapViewState, Rank, Resolution, Selection } from './campaignMapModel.ts';

export * from './campaignMapModel.ts';

/** Strings with no Unity ui-strings.json source. Listed in the task12 DoneClaim. */
export const webOnlyStrings = {
  rail: '철도',
  railNote: '철도 표시 · 실행 경로 아님',
  legendJurisdiction: '관할',
  legendReported: '보고된 통제 · 없음',
  mapLabel: '서울 캠페인 지도',
  zoomIn: '확대', zoomOut: '축소', zoomReset: '원래 크기',
  outOfScope: '알려진 범위 밖의 지역이다',
  site: '시설',
} as const;

export interface CampaignActor { readonly actorId: string; readonly name: string; readonly title: string; readonly place: string; readonly liege: string }
export interface CampaignMapOptions {
  readonly view: MapView; readonly identity: IdentityMap; readonly actor: CampaignActor;
  readonly onBack: () => void; readonly location?: { hash: string };
}

const SVG = 'http://www.w3.org/2000/svg';
/** Below this width the two left docks and the right dock no longer fit side by side; must match campaign-map.css. */
const STACKED_MAX = 1000;
// Lucide 0.4 icon paths (ISC), the set the Unity FoundationHudIconCatalog names: flag, map-pin, user, map, shield, home, chevrons.
const icons: Record<string, string> = {
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  map: '<path d="M14.1 6 9.9 3.9a2 2 0 0 0-1.8 0L3.6 6.2A1 1 0 0 0 3 7v12.8a1 1 0 0 0 1.4.9l3.7-1.9a2 2 0 0 1 1.8 0l4.2 2.1a2 2 0 0 0 1.8 0l4.5-2.3a1 1 0 0 0 .6-.9V5.2a1 1 0 0 0-1.4-.9l-3.7 1.9a2 2 0 0 1-1.8 0z"/><path d="M15 5.8v15"/><path d="M9 3.2v15"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6a2 2 0 0 1 .7 1.5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', minus: '<path d="M5 12h14"/>',
  locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/>',
};
const icon = (name: string): string => '<svg class="cm-icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] ?? '') + '</svg>';
const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

export interface CampaignMapHandle { readonly state: () => MapViewState; readonly release: () => void }

export function mountCampaignMap(parent: HTMLElement, options: CampaignMapOptions): CampaignMapHandle {
  const { view, identity, actor } = options;
  const loc = options.location ?? window.location;
  const scope = lordScope(view, actor.actorId, actor.place);
  const abort = new AbortController(); const { signal } = abort;
  const decoded = decodeHash(view, identity, scope, loc.hash);
  if (decoded.rejected.length) console.info('[campaign-map] deep link fields ignored', decoded.rejected);
  let state: MapViewState = decoded.state;
  parent.dataset.screen = 'campaign-map';
  if (decoded.rejected.length) parent.dataset.hashRejected = decoded.rejected.join(','); else delete parent.dataset.hashRejected;

  const titleRow = scope.titleIds[0];
  const titleCode = titleRow ? resolveSelection(view, identity, scope, titleRow) : null;
  const geographyTitle = titleCode?.ok && titleCode.selection.kind === 'title'
    ? view.titles.find(title => title.id === (titleCode.selection as Extract<Selection, { kind: 'title' }>).geographyId) : undefined;
  const titleName = geographyTitle ? geographyTitle.name + ' ' + t('ui.map.rank.duchy') : t('ui.hud.pov.unknown');
  const holding = view.selection.holding;
  const holdingDistricts = [...new Set(holding.adminRefs.map(ref => view.regions.find(region => region.id === ref.id)?.district ?? ''))];
  const holdingName = holdingDistricts.length === 1 && holdingDistricts[0] ? holdingDistricts[0] : t('ui.hud.pov.unknown');
  const stateName = view.states[view.selection.persons.find(p => p.id === actor.actorId)?.stateId ?? ''] ?? t('ui.hud.pov.unknown');
  const liegeName = personName(view, actor.liege) ?? t('ui.hud.pov.unknown');

  const navButton = (id: string, label: string, extra = ''): string =>
    '<button class="ui-button ui-button--menu cm-nav__button" type="button" id="' + id + '" ' + extra + '>' + label + '</button>';
  parent.innerHTML = '<div class="cm">'
    + '<div class="cm__stage" id="cm-stage"><svg class="cm__map" id="cm-map" tabindex="0" role="group" aria-label="' + webOnlyStrings.mapLabel + '" aria-describedby="cm-map-help"></svg>'
    + '<p id="cm-map-help" class="cm-visually-hidden">↑↓←→ · + − · 0</p>'
    + '<div class="cm-zoom" role="group" aria-label="' + webOnlyStrings.mapLabel + '">'
    + '<button class="ui-button cm-zoom__button" type="button" data-zoom="in" aria-label="' + webOnlyStrings.zoomIn + '" title="' + webOnlyStrings.zoomIn + '">' + icon('plus') + '</button>'
    + '<button class="ui-button cm-zoom__button" type="button" data-zoom="out" aria-label="' + webOnlyStrings.zoomOut + '" title="' + webOnlyStrings.zoomOut + '">' + icon('minus') + '</button>'
    + '<button class="ui-button cm-zoom__button" type="button" data-zoom="reset" aria-label="' + webOnlyStrings.zoomReset + '" title="' + webOnlyStrings.zoomReset + '">' + icon('locate') + '</button></div>'
    + '<output class="cm-toast" id="cm-toast" role="status"></output>'
    + '<div class="cm-legend ui-panel" aria-label="범례">'
    + '<span class="cm-legend__item"><i class="cm-swatch cm-swatch--jurisdiction"></i>' + webOnlyStrings.legendJurisdiction + '</span>'
    + '<span class="cm-legend__item"><i class="cm-swatch cm-swatch--reported"></i>' + webOnlyStrings.legendReported + '</span>'
    + '<span class="cm-legend__item"><i class="cm-swatch cm-swatch--unknown"></i>' + t('ui.hud.pov.unknown') + '</span>'
    + '<span class="cm-legend__item" id="cm-legend-rail" hidden><i class="cm-swatch cm-swatch--rail"></i>' + webOnlyStrings.railNote + '</span></div></div>'
    + '<header class="cm-nav"><h1 class="cm-nav__person">' + esc(actor.name) + '</h1>'
    + '<div class="cm-nav__group" role="group" aria-label="' + t('ui.key.map-mode') + '">'
    + navButton('cm-mode-political', t('ui.character-select.mode.political')) + navButton('cm-mode-titles', t('ui.character-select.mode.titles')) + '</div>'
    + '<div class="cm-nav__group cm-nav__ranks" role="group" aria-label="' + t('ui.character-select.mode.titles') + '">'
    + ranks.map(rank => navButton('cm-rank-' + rank, t(('ui.map.rank.' + rank) as UiStringKey), rankAvailable(view, rank) ? '' : 'disabled')).join('') + '</div>'
    + navButton('cm-rail', webOnlyStrings.rail)
    + '<div class="cm-nav__trail">' + navButton('cm-settings', t('ui.main-menu.settings'), 'disabled')
    + navButton('cm-pov', 'POV', 'aria-pressed="true" aria-disabled="true"') + navButton('cm-back', t('ui.main-menu.back'))
    + '<span class="cm-nav__legend"><i class="cm-swatch cm-swatch--unclaimed"></i>' + t('ui.map.unclaimed') + '</span></div></header>'
    + '<section class="cm-dock cm-dock--identity ui-panel" aria-label="' + esc(actor.name) + '">'
    + '<h2 class="cm-identity__name">' + esc(actor.name) + '</h2><p class="cm-identity__role">' + esc(actor.title) + '</p>'
    + '<dl class="cm-facts">' + fact('flag', t('ui.hud.pov.state'), stateName) + fact('map-pin', t('ui.hud.pov.current-location'), actor.place)
    + fact('user', t('ui.hud.pov.direct-liege'), liegeName) + '</dl></section>'
    + '<section class="cm-dock cm-dock--context ui-panel" aria-label="' + t('ui.hud.pov.territorial-control') + '"><dl class="cm-facts">'
    + fact('map', t('ui.hud.pov.territorial-control'), t('ui.hud.pov.state-control-value', stateName, t('ui.hud.pov.unknown'))) + '</dl></section>'
    + '<section class="cm-dock cm-dock--detail ui-panel" aria-label="' + t('ui.hud.pov.held-titles') + '">'
    + '<h2 class="cm-detail__name">' + esc(actor.name) + '</h2>'
    + '<div class="cm-tabs" role="tablist">'
    + '<button class="ui-button cm-tab" type="button" role="tab" id="cm-tab-titles" aria-controls="cm-rows">' + icon('shield') + t('ui.hud.pov.held-titles') + '</button>'
    + '<button class="ui-button cm-tab" type="button" role="tab" id="cm-tab-sites" aria-controls="cm-rows">' + icon('home') + t('ui.hud.pov.personal-holdings') + '</button></div>'
    + '<div class="cm-detail__scroll"><div class="cm-rows" id="cm-rows" role="tabpanel"></div><div class="cm-context" id="cm-context" aria-live="polite"></div></div></section>'
    + '</div>';

  function fact(name: string, label: string, value: string): string {
    return '<div class="cm-fact"><dt>' + icon(name) + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }
  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Campaign map element missing: ' + selector);
    return found;
  };
  const svg = q<SVGSVGElement>('#cm-map'), stage = q<HTMLElement>('#cm-stage');
  const rows = q<HTMLElement>('#cm-rows'), context = q<HTMLElement>('#cm-context'), toast = q<HTMLOutputElement>('#cm-toast');

  // ---- map layers (static geometry built once, classes updated per state)
  const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
    const element = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  const world = node('g', { class: 'cm-world' });
  const regionLayer = node('g', { class: 'cm-regions' }), titleLayer = node('g', { class: 'cm-titles' });
  const scopeLayer = node('g', { class: 'cm-scope' }), railLayer = node('g', { class: 'cm-rail' }), selectionLayer = node('g', { class: 'cm-selection' });
  world.append(regionLayer, titleLayer, scopeLayer, railLayer, selectionLayer); svg.append(world);
  const regionPaths = new Map<string, SVGPathElement>();
  for (const region of view.regions) {
    const path = node('path', { d: region.path, 'data-region': region.id, class: 'cm-region' });
    regionPaths.set(region.id, path); regionLayer.append(path);
  }
  // Jurisdiction members are the keyboard-reachable map targets, in source order.
  for (const id of scope.known) {
    const region = view.regions.find(r => r.id === id); if (!region) continue;
    const target = node('path', { d: region.path, 'data-region': id, class: 'cm-target', tabindex: '0', role: 'button', 'aria-label': region.name });
    scopeLayer.append(target);
  }

  // ---- pan / zoom (screen-space transform; strokes do not scale)
  const bounds = geometryBounds(view.regions.map(region => region.path));
  let fit = 1, k = 1, tx = 0, ty = 0;
  const box = (): DOMRect => stage.getBoundingClientRect();
  const fitRect = (): { x: number; y: number; w: number; h: number } => {
    const r = box(), narrow = r.width <= STACKED_MAX;
    const css = getComputedStyle(parent);
    const num = (name: string): number => parseFloat(css.getPropertyValue(name)) || 0;
    const margin = num('--layout-margin'), header = narrow ? 0 : num('--layout-header-h'), dock = narrow ? 0 : num('--layout-dock-w') + num('--layout-gutter');
    return { x: margin, y: header + margin, w: Math.max(1, r.width - 2 * margin - dock), h: Math.max(1, r.height - header - 2 * margin) };
  };
  const apply = (): void => { world.setAttribute('transform', 'translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + k.toFixed(4) + ')'); };
  const reset = (): void => {
    const area = fitRect(), w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
    fit = Math.min(area.w / w, area.h / h); k = fit;
    tx = area.x + (area.w - w * k) / 2 - bounds.minX * k; ty = area.y + (area.h - h * k) / 2 - bounds.minY * k;
    apply();
  };
  const zoomAt = (factor: number, sx: number, sy: number): void => {
    const next = Math.min(fit * 8, Math.max(fit, k * factor));
    tx = sx - (sx - tx) * (next / k); ty = sy - (sy - ty) * (next / k); k = next; apply();
  };
  const center = (): [number, number] => { const area = fitRect(); return [area.x + area.w / 2, area.y + area.h / 2]; };
  reset();
  const resize = new ResizeObserver(() => reset()); resize.observe(stage);
  signal.addEventListener('abort', () => resize.disconnect());

  svg.addEventListener('wheel', event => {
    event.preventDefault(); const r = box();
    zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - r.left, event.clientY - r.top);
  }, { signal, passive: false });
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, { signal });
  svg.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) svg.setPointerCapture(event.pointerId);
    drag.moved = true; tx += dx; ty += dy; drag.x = event.clientX; drag.y = event.clientY; apply();
    svg.classList.add('is-panning');
  }, { signal });
  const endDrag = (event: PointerEvent): void => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved; drag = null; svg.classList.remove('is-panning');
    if (moved) return;
    const target = (event.target as Element).closest('[data-region]');
    if (target) pick(target.getAttribute('data-region') ?? '');
  };
  svg.addEventListener('pointerup', endDrag, { signal });
  svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('is-panning'); }, { signal });
  svg.addEventListener('keydown', event => {
    const step = 48;
    const target = (event.target as Element).closest('[data-region]');
    if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pick(target.getAttribute('data-region') ?? ''); return; }
    const [cx, cy] = center();
    switch (event.key) {
      case 'ArrowLeft': tx += step; break; case 'ArrowRight': tx -= step; break;
      case 'ArrowUp': ty += step; break; case 'ArrowDown': ty -= step; break;
      case '+': case '=': zoomAt(1.25, cx, cy); break; case '-': case '_': zoomAt(1 / 1.25, cx, cy); break;
      case '0': reset(); break;
      default: return;
    }
    event.preventDefault(); apply();
  }, { signal });
  for (const button of parent.querySelectorAll<HTMLButtonElement>('[data-zoom]')) button.addEventListener('click', () => {
    const [cx, cy] = center(); const kind = button.dataset.zoom;
    if (kind === 'reset') reset(); else zoomAt(kind === 'in' ? 1.25 : 1 / 1.25, cx, cy);
  }, { signal });

  // ---- state transitions
  function update(next: MapViewState): void {
    state = next;
    history.replaceState(history.state, '', encodeHash(state));
    // Dock rows are re-rendered; keep keyboard focus on the same control, or on the new selection.
    const active = document.activeElement instanceof HTMLElement && parent.contains(document.activeElement) ? document.activeElement : null;
    const key = active?.dataset.pick ? '[data-pick="' + CSS.escape(active.dataset.pick) + '"]' : active?.id ? '#' + CSS.escape(active.id) : null;
    render();
    if (active && !active.isConnected) {
      const again = (key && parent.querySelector<HTMLElement>(key)) || context.querySelector<HTMLElement>('button') || rows.querySelector<HTMLElement>('button');
      again?.focus();
    }
  }
  function pick(raw: string): void {
    const resolution: Resolution = resolveSelection(view, identity, scope, raw);
    if (!resolution.ok) {
      toast.textContent = resolution.reason === 'out-of-scope' ? webOnlyStrings.outOfScope : t('ui.hud.pov.unknown');
      parent.dataset.lastRefusal = resolution.reason;
      return;
    }
    toast.textContent = ''; delete parent.dataset.lastRefusal;
    update(select(state, resolution));
  }
  q('#cm-mode-political').addEventListener('click', () => update(setMode(state, 'political')), { signal });
  q('#cm-mode-titles').addEventListener('click', () => update(setMode(state, 'titles')), { signal });
  for (const rank of ranks) q('#cm-rank-' + rank).addEventListener('click', () => update(setRank(view, state, rank as Rank)), { signal });
  q('#cm-rail').addEventListener('click', () => update({ ...state, rail: !state.rail }), { signal });
  // The title screen listens for any click on the root; this click must not reach it.
  q('#cm-back').addEventListener('click', event => { event.stopPropagation(); release(); options.onBack(); }, { signal });
  q('#cm-tab-titles').addEventListener('click', () => update({ ...state, tab: 'titles' }), { signal });
  q('#cm-tab-sites').addEventListener('click', () => update({ ...state, tab: 'sites' }), { signal });
  parent.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-pick]');
    if (button) { pick(button.dataset.pick ?? ''); return; }
    if ((event.target as Element).closest('#cm-jurisdiction')) update({ ...state, expanded: !state.expanded });
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && state.selection) {
      event.preventDefault();
      update({ ...state, selection: null }); svg.focus();
    } else if ((event.key === 'm' || event.key === 'M') && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault(); update(setMode(state, state.mode === 'political' ? 'titles' : 'political'));
    }
  }, { signal });

  // ---- render
  function render(): void {
    const setSelected = (id: string, selected: boolean): void => {
      const button = q<HTMLButtonElement>('#' + id);
      button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected));
    };
    setSelected('cm-mode-political', state.mode === 'political'); setSelected('cm-mode-titles', state.mode === 'titles');
    for (const rank of ranks) setSelected('cm-rank-' + rank, state.mode === 'titles' && state.rank === rank);
    setSelected('cm-rail', state.rail); q('#cm-pov').classList.add('is-selected');
    parent.dataset.mode = state.mode; parent.dataset.rank = state.rank; parent.dataset.rail = String(state.rail);
    parent.dataset.selection = state.selection ? state.selection.kind + ':' + state.selection.canonicalId : '';

    for (const fill of regionFills(view, scope, state)) {
      const path = regionPaths.get(fill.id)!;
      path.setAttribute('class', 'cm-region cm-region--' + fill.cls);
      if (fill.color) path.style.setProperty('--cm-fill', fill.color); else path.style.removeProperty('--cm-fill');
    }
    const outline = rankOutline(view, state);
    titleLayer.replaceChildren(...(outline ? [node('path', { d: outline, class: 'cm-title' })] : []));
    const rail = railOverlay(view, scope, state);
    q<HTMLElement>('#cm-legend-rail').hidden = !state.rail;
    railLayer.replaceChildren(
      ...rail.segments.map(s => node('line', { x1: String(s.x1), y1: String(s.y1), x2: String(s.x2), y2: String(s.y2), class: 'cm-rail__edge' })),
      ...rail.stations.map(s => node('circle', { cx: String(s.x), cy: String(s.y), r: '1.6', class: 'cm-rail__station' + (s.label ? ' is-known' : '') })),
      ...rail.stations.filter(s => s.label).map(s => { const label = node('text', { x: String(s.x + 3), y: String(s.y - 3), class: 'cm-rail__label' }); label.textContent = s.label; return label; }));
    const selectedRegions = state.selection?.kind === 'region' ? [state.selection.id]
      : state.selection?.kind === 'site' ? [view.selection.site.regionId]
      : state.selection ? [...scope.jurisdiction] : [];
    selectionLayer.replaceChildren(...selectedRegions.map(id => node('path', { d: view.regions.find(r => r.id === id)?.path ?? '', class: 'cm-selected' })));
    for (const target of scopeLayer.children) target.classList.toggle('is-selected', selectedRegions.length === 1 && target.getAttribute('data-region') === selectedRegions[0]);

    // right dock: tabs, rows, context
    for (const [id, tab] of [['cm-tab-titles', 'titles'], ['cm-tab-sites', 'sites']] as const) {
      const button = q<HTMLButtonElement>('#' + id);
      button.classList.toggle('is-selected', state.tab === tab); button.setAttribute('aria-selected', String(state.tab === tab));
    }
    const row = (id: string, glyph: string, label: string): string => {
      const selected = state.selection?.id === id;
      return '<button class="ui-button cm-row' + (selected ? ' is-selected' : '') + '" type="button" data-pick="' + esc(id) + '" aria-pressed="' + selected + '">' + icon(glyph) + '<span>' + esc(label) + '</span></button>';
    };
    if (state.tab === 'titles') rows.innerHTML = titleRow ? row(titleRow, 'shield', titleName) : '<p class="cm-empty">' + t('ui.character-select.none') + '</p>';
    else rows.innerHTML = scope.holdingIds.length ? row(holding.id, 'home', holdingName) : '<p class="cm-empty">' + t('ui.character-select.none') + '</p>';
    context.innerHTML = contextHtml(state.selection);
  }

  function contextHtml(selection: Selection | null): string {
    if (!selection) return '';
    const count = String(holding.adminRefs.length);
    switch (selection.kind) {
      case 'title': {
        const list = state.expanded ? '<ul class="cm-regions-list">' + holding.adminRefs.map(ref =>
          '<li><button class="ui-button cm-chip" type="button" data-pick="' + esc(ref.id) + '">' + esc(ref.name) + '</button></li>').join('') + '</ul>' : '';
        return '<button class="ui-button cm-row" type="button" id="cm-jurisdiction" aria-expanded="' + state.expanded + '">'
          + icon(state.expanded ? 'chevron-down' : 'chevron-right') + '<span>' + t('ui.hud.pov.jurisdiction-count', count) + '</span></button>' + list
          + row2(holding.id, 'home', holdingName) + '<p class="cm-caption">' + t('ui.hud.pov.admin-count', count) + '</p>';
      }
      case 'holding':
        return '<dl class="cm-facts">' + fact('shield', t('ui.hud.pov.held-titles'), titleName)
          + fact('map', t('ui.hud.pov.personal-holdings'), t('ui.hud.pov.admin-count', count)) + '</dl>'
          + '<p class="cm-label">' + esc(t('ui.hud.pov.grant-liege', personName(view, holding.directLiegePersonId) ?? t('ui.hud.pov.unknown'))) + '</p>';
      case 'region': {
        const region = view.regions.find(r => r.id === selection.id)!;
        const states = region.polities.map(id => view.states[id] ?? t('ui.hud.pov.unknown')).join(', ') || t('ui.hud.pov.unknown');
        const hegemon = view.hegemons.find(h => h.stateId === region.hegemonStateIds[0])?.name ?? t('ui.hud.pov.unknown');
        const site = view.selection.site.regionId === region.id ? row2(view.selection.site.id, 'map-pin', view.selection.site.name) : '';
        return '<h3 class="cm-context__title">' + esc(region.name) + '</h3><p class="cm-caption">' + esc(region.district) + '</p>'
          + '<dl class="cm-facts">' + fact('flag', t('ui.hud.pov.state'), states) + fact('map', t('ui.hud.pov.territorial-control'), hegemon) + '</dl>' + site;
      }
      case 'site': {
        const region = view.regions.find(r => r.id === view.selection.site.regionId)!;
        const here = actor.place === view.selection.site.name ? fact('user', t('ui.hud.pov.current-location'), actor.name) : '';
        return '<h3 class="cm-context__title">' + esc(view.selection.site.name) + '</h3><p class="cm-caption">' + webOnlyStrings.site + '</p>'
          + '<dl class="cm-facts">' + fact('map-pin', region.district, region.name) + here + '</dl>';
      }
      default: return selection satisfies never;
    }
  }
  function row2(id: string, glyph: string, label: string): string {
    return '<button class="ui-button cm-row" type="button" data-pick="' + esc(id) + '">' + icon(glyph) + '<span>' + esc(label) + '</span></button>';
  }

  render();
  function release(): void { abort.abort(); }
  return { state: () => state, release };
}

