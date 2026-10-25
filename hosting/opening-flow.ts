import { openingActors, selectOpeningActor, openingAdmission } from '../game/src/runtime/openingScenario.ts';
import { t } from './ui-strings.ts';
import { describeStartFailure } from './opening-errors.ts';
import { mountCampaignMap } from '../game/ui/campaignMap.ts';
import type { MapView, IdentityMap } from '../game/ui/campaignMap.ts';
import { mountCampaignOrders } from '../game/ui/campaignOrders.ts';
import { loadCampaignRuntime } from './campaign-content.ts';
import { ordersStrings } from '../game/ui/campaignOrdersModel.ts';
import mapView from '../game/data/campaign/map-view.json';
import identityMap from '../game/data/campaign/identity-map.json';

type Actor = (typeof openingActors)[number];
type Spawn = (id: unknown, surface: HTMLElement) => Promise<void>;

/** Unity flow ported from MainTitleCanvas / CharacterSelectLayer: title -> menu -> selection -> confirm -> world. */
export function mountOpening(parent: HTMLElement, spawn: Spawn): void {
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
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.continue') + '</button>'
      + '<p class="ui-menu__status">' + t('ui.main-menu.save-status.empty') + '</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.settings') + '</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.quit') + '</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>' + t('ui.main-menu.account') + '</button>'
      + '<p class="ui-menu__note">' + t('ui.main-menu.placeholder-note') + '</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" id="menu-back" type="button">' + t('ui.main-menu.back') + '</button></section>');
    const newGame = el<HTMLButtonElement>('#menu-new'), back = el<HTMLButtonElement>('#menu-back');
    const active = [newGame, back];
    const mark = (target: HTMLButtonElement): void => { for (const b of active) b.classList.toggle('is-selected', b === target); target.focus(); };
    for (const b of active) {
      b.addEventListener('focus', () => mark(b), { signal });
      b.addEventListener('pointerenter', () => mark(b), { signal });
    }
    newGame.addEventListener('click', () => selection(0), { signal });
    back.addEventListener('click', () => title(), { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); title(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault(); mark(document.activeElement === newGame ? back : newGame);
      }
    }, { signal });
    mark(newGame);
  }

  function selection(initial: number): void {
    const signal = enter('selection', '<div class="ui-select">'
      + '<header class="ui-select__header"><h1 class="ui-select__title" tabindex="-1">' + t('ui.character-select.title') + '</h1>'
      + '<p class="ui-select__scenario">야간 배급 창구 · 신정2동 · 세 번째 급수계약 개막일</p>'
      + '<p class="ui-select__hint"><kbd class="ui-key-cap">' + t('ui.key.move') + '</kbd></p></header>'
      + '<aside class="ui-select__dock ui-panel" aria-label="후보 인물"><p class="ui-select__count"></p><div class="ui-select__list" role="listbox" aria-label="개막 인물"></div></aside>'
      + '<div class="ui-select__stage" aria-hidden="true"></div>'
      + '<section class="ui-select__dock ui-select__detail ui-panel" aria-live="polite" aria-label="선택한 인물"><div class="ui-select__bio"></div>'
      + '<footer class="ui-select__actions"><button class="ui-button ui-button--menu" id="select-back" type="button"><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.character-select.back') + '</button>'
      + '<button class="ui-button ui-button--primary" id="select-confirm" type="button"><kbd class="ui-key-cap ui-key-cap--on-primary">' + t('ui.key.submit') + '</kbd> ' + t('ui.character-select.confirm') + '</button></footer>'
      + '<output class="ui-select__status" role="status"></output></section></div>');
    const list = el('.ui-select__list'), bio = el('.ui-select__bio'), status = el<HTMLOutputElement>('.ui-select__status');
    el('.ui-select__count').textContent = t('ui.character-select.count', String(openingActors.length));
    // Liege names come only from admitted opening actors; K001 has no admitted name, so its rows are omitted.
    const liegeName = (actor: Actor): string | undefined => openingActors.find(other => other.actorId === actor.liege)?.name;
    let selected = initial; let dialog: AbortController | null = null; let preparing = false;
    const cards = openingActors.map((actor, index) => {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'ui-card'; card.setAttribute('role', 'option'); card.dataset.actor = actor.actorId;
      const name = document.createElement('span'); name.className = 'ui-card__name'; name.textContent = actor.name;
      const role = document.createElement('span'); role.className = 'ui-card__title'; role.textContent = actor.title;
      const meta = document.createElement('span'); meta.className = 'ui-card__meta'; meta.textContent = actor.place;
      name.append(' ', role); card.append(name, meta);
      card.addEventListener('click', () => { if (selected === index) openConfirm(); else select(index, true); }, { signal });
      list.append(card); return card;
    });
    const fact = (label: string, value: string): string => '<div class="ui-fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    const text = (value: string): string => { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; };
    function render(actor: Actor): void {
      bio.innerHTML = '<h2 class="ui-select__name">' + text(actor.name) + '</h2><p class="ui-select__role">' + text(actor.title) + '</p>'
        + '<dl class="ui-select__facts">' + fact(t('ui.character-select.dialog.start'), text(actor.place))
        + (liegeName(actor) ? fact(t('ui.character-select.label.liege'), text(liegeName(actor)!)) : '') + '</dl>';
    }
    function select(index: number, focus: boolean): void {
      selected = (index + cards.length) % cards.length;
      cards.forEach((card, i) => { card.classList.toggle('is-selected', i === selected); card.setAttribute('aria-selected', String(i === selected)); card.tabIndex = i === selected ? 0 : -1; });
      render(openingActors[selected]);
      if (focus) cards[selected].focus();
    }
    function openConfirm(): void {
      if (dialog || preparing) return;
      const actor = openingActors[selected];
      dialog = new AbortController();
      const restore = document.activeElement instanceof HTMLElement ? document.activeElement : cards[selected];
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
        world(actor, surface);
      } catch (error) {
        preparing = false;
        const failure = describeStartFailure(error);
        console.error('[opening] start failed', failure.code, error);
        status.textContent = failure.text;
        const confirm = el<HTMLButtonElement>('#select-confirm');
        confirm.disabled = false;
        // The start dialog is gone; return focus to the action that opened it.
        confirm.focus();
      }
    }
    el('#select-back').addEventListener('click', () => { if (!preparing) menu(); }, { signal });
    el('#select-confirm').addEventListener('click', openConfirm, { signal });
    document.addEventListener('keydown', event => {
      if (dialog || event.defaultPrevented) return;
      if (preparing) { if (event.key === 'Escape' || event.key === 'Enter') event.preventDefault(); return; }
      const onCard = cards.includes(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); menu(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); select(selected + (event.key === 'ArrowDown' ? 1 : -1), true); }
      else if (event.key === 'Enter' && (onCard || document.activeElement === document.body)) { event.preventDefault(); openConfirm(); }
    }, { signal });
    select(initial, true);
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
