import { openingActors, selectOpeningActor, openingAdmission } from '../game/src/runtime/openingScenario.ts';
import { t } from './ui-strings.ts';
import { describeStartFailure } from './opening-errors.ts';
import { mountCampaignOrders } from '../game/ui/campaignOrders.ts';
import { mountPaneNav } from '../game/ui/paneNav.ts';
import { geometryBounds } from '../game/ui/campaignMapModel.ts';
import { mountCampaignMap } from '../game/ui/campaignMap.ts';
import type { MapView, IdentityMap } from '../game/ui/campaignMap.ts';
import { loadCampaignRuntime } from './campaign-content.ts';
import { ordersStrings } from '../game/ui/campaignOrdersModel.ts';
import mapView from '../game/data/campaign/map-view.json';
import identityMap from '../game/data/campaign/identity-map.json';

type Actor = (typeof openingActors)[number];
type Spawn = (id: unknown, surface: HTMLElement) => Promise<void>;
export type OpeningCampaign = {
  readonly enter: (actor: Actor) => void;
  readonly continue: () => Promise<void>;
  readonly live: boolean;
};

/** Unity flow ported from MainTitleCanvas / CharacterSelectLayer: title -> menu -> selection -> confirm -> world. */
export function mountOpening(parent: HTMLElement, spawn: Spawn, campaign?: OpeningCampaign): void {
  let screen: AbortController | null = null;
  const enter = (name: string, html: string): AbortSignal => {
    screen?.abort(); screen = new AbortController();
    parent.dataset.screen = name; parent.innerHTML = html;
    return screen.signal;
  };
  const el = <T extends HTMLElement>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Opening element missing: ' + selector);
    return found;
  };

  function title(): void {
    const signal = enter('title', '<section class="ui-title" aria-label="타이틀"><hr class="ui-title__rule">'
      + '<h1 class="ui-title__mark">' + t('ui.main-title.mark') + '</h1><p class="ui-title__sub">' + t('ui.main-title.sub') + '</p>'
      + '<button class="ui-title__entry" type="button" id="title-enter">' + t('ui.main-title.enter') + '</button><hr class="ui-title__rule"></section>');
    el<HTMLButtonElement>('#title-enter').focus();
    const go = (): void => menu();
    parent.addEventListener('click', go, { signal, once: true });
    document.addEventListener('keydown', event => {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return;
      event.preventDefault(); go();
    }, { signal });
  }

  function menu(): void {
    const signal = enter('menu', '<section class="ui-menu ui-panel" role="dialog" aria-modal="true" aria-labelledby="menu-heading">'
      + '<h1 id="menu-heading" class="ui-menu__heading">' + t('ui.main-menu.heading') + '</h1>'
      + '<button class="ui-button ui-button--primary ui-menu__item" id="menu-new" type="button">' + t('ui.main-menu.new-game') + '</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" id="menu-continue" type="button"' + (campaign ? '' : ' disabled') + '>' + t('ui.main-menu.continue') + '</button>'
      + '<p class="ui-menu__status" role="status">' + (campaign?.live ? '진행 중인 캠페인으로 돌아간다. 시간은 계속 흐른다.' : campaign ? '마지막 명시 저장에서 이어간다. 미저장 진행은 복구되지 않는다.' : t('ui.main-menu.save-status.empty')) + '</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.settings') + '</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.quit') + '</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.account') + '</button>'
      + '<p class="ui-menu__note">' + t('ui.main-menu.placeholder-note') + '</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" id="menu-back" type="button">' + t('ui.main-menu.back') + '</button></section>');
    const newGame = el<HTMLButtonElement>('#menu-new'), back = el<HTMLButtonElement>('#menu-back');
    const resume = el<HTMLButtonElement>('#menu-continue');
    const active = campaign ? [newGame, resume, back] : [newGame, back];
    const mark = (target: HTMLButtonElement): void => { for (const b of active) b.classList.toggle('is-selected', b === target); target.focus(); };
    for (const b of active) {
      b.addEventListener('focus', () => mark(b), { signal });
      b.addEventListener('pointerenter', () => mark(b), { signal });
    }
    newGame.addEventListener('click', () => selection(0), { signal });
    resume.addEventListener('click', () => {
      if (!campaign) return;
      resume.disabled = true;
      void campaign.continue().then(() => screen?.abort()).catch(error => {
        if (!(error instanceof Error)) throw error;
        el('.ui-menu__status').textContent = error.message;
        resume.disabled = false; resume.focus();
      });
    }, { signal });
    back.addEventListener('click', () => title(), { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); title(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault();
        const current = active.findIndex(button => button === document.activeElement);
        const next = active[(current + (event.key === 'ArrowUp' || event.shiftKey ? active.length - 1 : 1)) % active.length];
        if (next) mark(next);
      }
    }, { signal });
    mark(newGame);
  }

  /** Character selection (Unity R3/R8 anatomy, task22 fix-1): header 48 with mode filter
   * (정치/작위, Q/E), search (/) and count; left roster 303 with the 개막 지정 card; center map
   * 618 built from the admitted task12 map-view geometry with the start region highlighted;
   * right detail 303 with the honest portrait fallback, admitted facts and the unavailable
   * biography note. Mobile follows task26 §3: one visible list OR detail pane. */
  function selection(initial: number): void {
    const signal = enter('selection', '<div class="ui-select">'
      + '<header class="ui-select__header"><h1 class="ui-select__title" tabindex="-1">' + t('ui.character-select.title') + '</h1>'
      + '<p class="ui-select__scenario">야간 배급 창구 · 신정2동 · 세 번째 급수계약 개막일</p>'
      + '<div class="ui-select__modes" role="group" aria-label="정렬 방식">'
      + '<button class="ui-button ui-button--menu ui-select__mode" type="button" id="select-mode-political" aria-pressed="true">' + t('ui.character-select.mode.political') + '</button>'
      + '<button class="ui-button ui-button--menu ui-select__mode" type="button" id="select-mode-titles" aria-pressed="false">' + t('ui.character-select.mode.titles') + '</button></div>'
      + '<label class="ui-select__faction">소속 <select id="select-faction"><option value="">전체</option></select></label>'
      + '<label class="ui-select__search"><span class="ui-select__search-label">검색</span>'
      + '<input id="select-search" type="search" autocomplete="off"></label>'
      + '<p class="ui-select__count"></p>'
      + '<p class="ui-select__hint"><kbd class="ui-key-cap">' + t('ui.key.move') + '</kbd> <kbd class="ui-key-cap">Q/E</kbd> <kbd class="ui-key-cap">/</kbd></p></header>'
      + '<aside class="ui-select__dock ui-panel" aria-label="후보 인물"><div class="ui-select__list" role="listbox" aria-label="개막 인물"></div></aside>'
      + '<div class="ui-select__stage"><svg id="select-map" role="img" aria-label="서울 지도 · 시작 지역 신정2동"></svg>'
      + '<p class="ui-select__map-caption"></p></div>'
      + '<section class="ui-select__dock ui-select__detail ui-panel" aria-live="polite" aria-label="선택한 인물">'
      + '<div class="ui-portrait"><p class="ui-portrait__name"></p><p class="ui-portrait__fallback">초상 자리 · 실제 자료 없음</p><p class="ui-portrait__id"></p></div>'
      + '<div class="ui-select__bio"></div>'
      + '<footer class="ui-select__actions"><button class="ui-button ui-button--menu" id="select-back" type="button"><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.character-select.back') + '</button>'
      + '<button class="ui-button ui-button--primary" id="select-confirm" type="button"><kbd class="ui-key-cap ui-key-cap--on-primary">' + t('ui.key.submit') + '</kbd> ' + t('ui.character-select.confirm') + '</button></footer>'
      + '<output class="ui-select__status" role="status"></output></section></div>');
    const list = el('.ui-select__list'), bio = el('.ui-select__bio'), status = el<HTMLOutputElement>('.ui-select__status');
    const count = el('.ui-select__count'), search = el<HTMLInputElement>('#select-search');
    const faction = el<HTMLSelectElement>('#select-faction');
    const factionIds = [...new Set(openingActors.map(actor => mapView.selection.persons.find(person => person.id === actor.actorId)?.stateId).filter((id): id is string => Boolean(id)))];
    for (const id of factionIds) {
      const option = document.createElement('option'); option.value = id; option.textContent = mapView.states[id as keyof typeof mapView.states] ?? id; faction.append(option);
    }
    const modePolitical = el<HTMLButtonElement>('#select-mode-political'), modeTitles = el<HTMLButtonElement>('#select-mode-titles');
    // Liege names come only from admitted opening actors; K001 has no admitted name, so its rows are omitted.
    const liegeName = (actor: Actor): string | undefined => openingActors.find(other => other.actorId === actor.liege)?.name;
    const roleLabel = (actor: Actor): string => actor.role === 'landed-vassal-lord' ? '봉신 영주' : '위임 수행자';
    let mode: 'political' | 'titles' = 'political';
    let query = '';
    let selected = initial; let dialog: AbortController | null = null; let preparing = false;

    // ---- center stage: admitted map geometry with the selected actor's start region highlighted
    const svg = parent.querySelector<SVGSVGElement>('#select-map')!, caption = el('.ui-select__map-caption');
    const regions = mapView.regions as readonly { readonly id: string; readonly name: string; readonly path: string }[];
    const bounds = geometryBounds(regions.map(region => region.path));
    svg.setAttribute('viewBox', (bounds.minX - 4) + ' ' + (bounds.minY - 4) + ' ' + (bounds.maxX - bounds.minX + 8) + ' ' + (bounds.maxY - bounds.minY + 8));
    const regionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    highlight.setAttribute('class', 'ui-select__region ui-select__region--start');
    for (const region of regions) {
      if (region.id === 'region:1147063000') highlight.setAttribute('d', region.path);
      else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', region.path); path.setAttribute('class', 'ui-select__region');
        regionLayer.append(path);
      }
    }
    regionLayer.append(highlight); svg.append(regionLayer);

    const ordered = (): readonly Actor[] => [...openingActors].sort((left, right) => {
      if (mode === 'titles') return (right.titleId ? 1 : 0) - (left.titleId ? 1 : 0);
      return (left.role === 'landed-vassal-lord' ? 0 : 1) - (right.role === 'landed-vassal-lord' ? 0 : 1);
    });
    const visible = (): readonly Actor[] => {
      const needle = query.trim().toLowerCase();
      return ordered().filter(actor => (!faction.value || mapView.selection.persons.find(person => person.id === actor.actorId)?.stateId === faction.value)
        && (!needle || actor.name.toLowerCase().includes(needle) || actor.actorId.toLowerCase().includes(needle)));
    };
    const cards = new Map<string, HTMLButtonElement>();
    for (const actor of openingActors) {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'ui-card'; card.setAttribute('role', 'option'); card.dataset.actor = actor.actorId;
      const name = document.createElement('span'); name.className = 'ui-card__name'; name.textContent = actor.name;
      const role = document.createElement('span'); role.className = 'ui-card__title'; role.textContent = actor.title;
      const meta = document.createElement('span'); meta.className = 'ui-card__meta'; meta.textContent = actor.place;
      name.append(' ', role); card.append(name, meta);
      if (actor.actorId === 'K002') {
        const start = document.createElement('span'); start.className = 'ui-card__start'; start.textContent = '개막 지정';
        card.append(start);
      }
      card.addEventListener('click', () => {
        select(openingActors.indexOf(actor), true);
        panes.showDetail();
      }, { signal });
      cards.set(actor.actorId, card);
      list.append(card);
    }
    const fact = (label: string, value: string): string => '<div class="ui-fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    const text = (value: string): string => { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; };
    function render(actor: Actor): void {
      const shown = visible();
      for (const [id, card] of cards) card.hidden = !shown.some(entry => entry.actorId === id);
      list.querySelector('.ui-select__reset')?.remove();
      if (!shown.length) {
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'ui-button ui-select__reset'; reset.textContent = '검색 · 소속 초기화';
        reset.addEventListener('click', () => { query = ''; search.value = ''; faction.value = ''; render(openingActors[selected]!); });
        list.append(reset);
      }
      for (const actor of ordered()) list.append(cards.get(actor.actorId)!);
      el<HTMLButtonElement>('#select-confirm').disabled = preparing || shown.length === 0;
      count.textContent = shown.length === openingActors.length
        ? t('ui.character-select.count', String(openingActors.length))
        : shown.length + ' / ' + t('ui.character-select.count', String(openingActors.length));
      if (!shown.length) {
        list.setAttribute('aria-label', '개막 인물 · 결과 없음');
        bio.innerHTML = '<p class="cs-empty">' + t('ui.character-select.none') + '</p>';
        el('.ui-portrait__name').textContent = ''; el('.ui-portrait__id').textContent = '';
        caption.textContent = '';
        return;
      }
      list.setAttribute('aria-label', '개막 인물');
      const current = shown.find(entry => entry.actorId === actor.actorId) ?? shown[0]!;
      selected = openingActors.indexOf(current);
      bio.innerHTML = '<h2 class="ui-select__name">' + text(current.name) + '</h2><p class="ui-select__role">' + text(current.title) + '</p>';
      el('.ui-portrait__name').textContent = current.name;
      el('.ui-portrait__id').textContent = current.actorId;
      const region = regions.find(entry => entry.id === current.regionId);
      caption.textContent = '시작 지역 · ' + (region?.name ?? current.regionId);
      select(openingActors.indexOf(current), false);
    }
    function select(index: number, focus: boolean): void {
      const shown = visible();
      if (!shown.length) return;
      let current = shown.findIndex(entry => openingActors.indexOf(entry) === index);
      if (current < 0) current = 0;
      selected = openingActors.indexOf(shown[current]!);
      cards.forEach((card, id) => {
        const isSelected = id === shown[current]?.actorId;
        card.classList.toggle('is-selected', isSelected);
        card.setAttribute('aria-selected', String(isSelected));
        card.tabIndex = isSelected ? 0 : -1;
      });
      renderDetail(openingActors[selected]!);
      if (focus) cards.get(shown[current]!.actorId)?.focus();
    }
    function renderDetail(actor: Actor): void {
      bio.innerHTML = '<h2 class="ui-select__name">' + text(actor.name) + '</h2><p class="ui-select__role">' + text(actor.title) + '</p>';
      el('.ui-portrait__name').textContent = actor.name;
      el('.ui-portrait__id').textContent = actor.actorId;
      const region = regions.find(entry => entry.id === actor.regionId);
      caption.textContent = '시작 지역 · ' + (region?.name ?? actor.regionId);
      bio.querySelector('.ui-select__facts')?.remove();
      const facts = document.createElement('dl'); facts.className = 'ui-select__facts';
      facts.innerHTML = fact(t('ui.character-select.dialog.start'), text(actor.place))
        + (liegeName(actor) ? fact(t('ui.character-select.label.liege'), text(liegeName(actor)!)) : '')
        + fact('역할', text(roleLabel(actor)))
        + fact('수행자', actor.retainers.length ? text(actor.retainers.map(id => openingActors.find(entry => entry.actorId === id)?.name ?? id).join(' · ')) : t('ui.character-select.none'));
      bio.append(facts);
      const note = bio.querySelector<HTMLElement>('.ui-select__note') ?? Object.assign(bio.appendChild(document.createElement('p')), { className: 'ui-select__note' });
      note.textContent = '전기 · 포부 자료는 아직 인준되지 않았다.';
    }
    function applyMode(): void {
      modePolitical.setAttribute('aria-pressed', String(mode === 'political'));
      modeTitles.setAttribute('aria-pressed', String(mode === 'titles'));
    }
    modePolitical.addEventListener('click', () => { mode = 'political'; applyMode(); render(openingActors[selected]!); }, { signal });
    modeTitles.addEventListener('click', () => { mode = 'titles'; applyMode(); render(openingActors[selected]!); }, { signal });
    faction.addEventListener('change', () => render(openingActors[selected]!), { signal });
    search.addEventListener('input', () => { query = search.value; render(openingActors[selected]!); }, { signal });
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); search.value = ''; query = ''; render(openingActors[selected]!); search.blur(); }
    }, { signal });
    // Task26 §3 mobile: roster is the list pane; map + detail are the detail pane.
    const panes = mountPaneNav({ root: el('.ui-select'), listPanes: [el('.ui-select__dock:not(.ui-select__detail)')],
      detailPanes: [el('.ui-select__stage'), el('.ui-select__detail')], listBody: list,
      labels: { list: '인물 목록', detail: '상세 · 지도' } });
    function openConfirm(): void {
      if (dialog || preparing || visible().length === 0) return;
      const actor = visible()[Math.max(0, visible().findIndex(entry => openingActors.indexOf(entry) === selected))] ?? openingActors[selected]!;
      dialog = new AbortController();
      const restore = document.activeElement instanceof HTMLElement ? document.activeElement : cards.get(actor.actorId)!;
      const overlay = document.createElement('div'); overlay.className = 'ui-scrim';
      overlay.innerHTML = '<section class="ui-dialog ui-panel" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-summary">'
        + '<h2 id="dialog-title" class="ui-dialog__title"></h2><dl id="dialog-summary" class="ui-select__facts"></dl>'
        + '<p class="ui-dialog__hint">' + t('ui.character-select.dialog.hint') + '</p>'
        + '<div class="ui-dialog__actions"><button class="ui-button ui-button--menu" type="button" data-cancel><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.character-select.dialog.cancel') + '</button>'
        + '<button class="ui-button ui-button--primary" type="button" data-start>' + t('ui.character-select.dialog.start-action') + '</button></div></section>';
      overlay.querySelector('#dialog-title')!.textContent = t('ui.character-select.dialog.title', actor.name);
      const liege = liegeName(actor);
      // 소속 (state/faction) and 작위 (held noble titles) have no admitted web data, so those rows are omitted.
      overlay.querySelector('#dialog-summary')!.innerHTML = fact(t('ui.character-select.dialog.start'), text(actor.place))
        + (liege ? fact(t('ui.character-select.label.liege'), text(liege)) : '');
      const cancel = overlay.querySelector<HTMLButtonElement>('[data-cancel]')!, start = overlay.querySelector<HTMLButtonElement>('[data-start]')!;
      const close = (): void => { dialog?.abort(); dialog = null; overlay.remove(); restore.focus(); };
      cancel.addEventListener('click', close, { signal: dialog.signal });
      start.addEventListener('click', () => { overlay.remove(); dialog?.abort(); dialog = null; void begin(actor.actorId); }, { signal: dialog.signal });
      overlay.addEventListener('click', event => { if (event.target === overlay) close(); }, { signal: dialog.signal });
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'Tab' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); (document.activeElement === cancel ? start : cancel).focus();
        }
      }, { signal: dialog.signal });
      parent.append(overlay); cancel.focus();
    }
    async function begin(id: string): Promise<void> {
      if (preparing) return;
      preparing = true;
      try {
        const actor = selectOpeningActor(id);
        el<HTMLButtonElement>('#select-confirm').disabled = true;
        status.textContent = t('ui.character-select.loading');
        const surface = document.createElement('section'); surface.id = 'scenario-world';
        await spawn(actor.actorId, surface);
        if (campaign) { screen?.abort(); campaign.enter(actor); }
        else world(actor, surface);
      } catch (error) {
        preparing = false;
        const failure = describeStartFailure(error);
        console.error('[opening] start failed', failure.code, error);
        status.textContent = campaign && error instanceof Error ? failure.text + ' ' + error.message : failure.text;
        const confirm = el<HTMLButtonElement>('#select-confirm');
        confirm.disabled = false;
        // The start dialog is gone; return focus to the action that opened it.
        confirm.focus();
      }
    }
    el('#select-back').addEventListener('click', () => { if (!preparing && !panes.unwind()) menu(); }, { signal });
    el('#select-confirm').addEventListener('click', openConfirm, { signal });
    document.addEventListener('keydown', event => {
      if (dialog || event.defaultPrevented) return;
      if (preparing) { if (event.key === 'Escape' || event.key === 'Enter') event.preventDefault(); return; }
      if (document.activeElement === search) return; // the search field owns its keys (Escape above)
      const shown = visible();
      const current = Math.max(0, shown.findIndex(entry => openingActors.indexOf(entry) === selected));
      if (event.key === 'Escape') { event.preventDefault(); if (query) { search.value = ''; query = ''; render(openingActors[selected]!); } else if (panes.unwind()) { /* pane closed */ } else menu(); }
      else if (event.key === '/') { event.preventDefault(); search.focus(); }
      else if (event.key === 'q' || event.key === 'Q') { mode = 'political'; applyMode(); render(openingActors[selected]!); }
      else if (event.key === 'e' || event.key === 'E') { mode = 'titles'; applyMode(); render(openingActors[selected]!); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!shown.length) return;
        const next = (current + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
        select(openingActors.indexOf(shown[next]!), true);
      }
      else if (event.key === 'Enter' && (document.activeElement?.matches('.ui-card') || document.activeElement === document.body)) { event.preventDefault(); openConfirm(); }
    }, { signal });
    applyMode();
    render(openingActors[selected]!);
    cards.get(openingActors[selected]!.actorId)?.focus();
  }

  /** Post-start campaign map (task12, Unity R4). The E0 occupancy surface keeps its placement receipts
   * on the root but is no longer shown here; production entry integration is task15. */
  function world(actor: Actor, surface: HTMLElement): void {
    screen?.abort(); screen = new AbortController();
    parent.replaceChildren();
    parent.dataset.scenario = openingAdmission.scenarioId; parent.dataset.actor = actor.actorId;
    parent.dataset.spawn = surface.dataset.mapId + ':' + surface.dataset.tileX + ',' + surface.dataset.tileY;
    // Task13: only the designator (K002) holds the communal right to issue retainer mandates.
    const map = mountCampaignMap(parent, { view: mapView as unknown as MapView, identity: identityMap as unknown as IdentityMap,
      actor, onBack: () => title(),
      onOrders: actor.actorId === 'K002' ? () => { void openOrders(actor, surface); } : undefined });
    screen.signal.addEventListener('abort', map.release);
    el<HTMLButtonElement>('#cm-mode-political').focus();
  }

  /** Retainer command composer/detail (task13). Opening it never pauses or changes the clock;
   * the runtime is constructed once from the admitted served pack and survives screen changes. */
  async function openOrders(actor: Actor, surface: HTMLElement): Promise<void> {
    const button = parent.querySelector<HTMLButtonElement>('#cm-orders');
    if (!button || button.dataset.loading === 'true') return;
    button.dataset.loading = 'true'; button.setAttribute('aria-busy', 'true');
    try {
      const { content, app } = await loadCampaignRuntime();
      screen?.abort(); screen = new AbortController();
      const orders = mountCampaignOrders(parent, { app, content,
        actor: { actorId: actor.actorId, name: actor.name, title: actor.title },
        onBack: () => world(actor, surface) });
      screen.signal.addEventListener('abort', orders.release);
      parent.querySelector<HTMLElement>('[data-pick]')?.focus();
    } catch (error) {
      delete button.dataset.loading; button.removeAttribute('aria-busy');
      // Console plus a visible, machine-readable failure state; no fabricated fallback runtime.
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error('[orders] runtime failed', detail);
      parent.dataset.ordersFailure = detail;
      button.textContent = ordersStrings.runtimeFailed;
      button.title = detail;
      button.disabled = true;
    }
  }

  title();
}
