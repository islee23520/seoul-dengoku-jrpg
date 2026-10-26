/** Settlement execution screen (task14), per the approved task26 design contract §5:
 * header 48 (place / clock / back), people dock 303, place+topology body 618, custody dock 303,
 * footer 80 ([뒤로] [수행자에게 지시]). A people/work/custody location view, explicitly NOT a battle
 * outcome screen. View selection only; opening it changes no clock speed and grants no knowledge. */
import { t } from '../../hosting/ui-strings.ts';
import { formatWorldSeconds, labelStage, settlementStrings } from './campaignSettlementModel.ts';
import type { SettlementView } from './campaignSettlementModel.ts';

export * from './campaignSettlementModel.ts';

export interface SettlementOptions {
  /** Live readonly snapshot of the campaign state from the one elapsed owner. */
  readonly snapshot: () => SettlementView;
  /** Re-render subscription; the mount releases it on release(). */
  readonly subscribe: (onChange: () => void) => () => void;
  readonly onBack: () => void;
  readonly onOpenReports: () => void;
  readonly onOrders?: () => void;
}

export interface SettlementHandle { readonly release: () => void }

const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

export function mountCampaignSettlement(parent: HTMLElement, options: SettlementOptions): SettlementHandle {
  const abort = new AbortController(); const { signal } = abort;
  parent.dataset.screen = 'campaign-settlement';
  parent.innerHTML = '<div class="cs">'
    + '<header class="cs-nav"><h1 class="cs-nav__place" id="cs-place"></h1>'
    + '<output class="cs-nav__clock" id="cs-clock" role="status"></output>'
    + '<div class="cs-nav__trail">'
    + '<button class="ui-button ui-button--menu cs-nav__button" type="button" id="cs-reports">' + esc(settlementStrings.reports) + '</button>'
    + '<button class="ui-button ui-button--menu cs-nav__button" type="button" id="cs-back"><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.main-menu.back') + '</button>'
    + '</div></header>'
    + '<section class="cs-dock cs-dock--people ui-panel" aria-labelledby="cs-people-h"><h2 class="cs-h" id="cs-people-h">' + esc(settlementStrings.people) + '</h2><div class="cs-body" id="cs-people" role="list"></div></section>'
    + '<section class="cs-panel cs-panel--place ui-panel" aria-labelledby="cs-place-h"><h2 class="cs-h" id="cs-place-h">' + esc(settlementStrings.place) + '</h2><div class="cs-body" id="cs-work" role="list"></div></section>'
    + '<section class="cs-dock cs-dock--custody ui-panel" aria-labelledby="cs-custody-h"><h2 class="cs-h" id="cs-custody-h">' + esc(settlementStrings.custody) + '</h2><div class="cs-body" id="cs-custody"></div></section>'
    + '<footer class="cs-footer">'
    + '<button class="ui-button ui-button--menu" type="button" id="cs-footer-back">' + t('ui.main-menu.back') + '</button>'
    + '<button class="ui-button ui-button--primary" type="button" id="cs-command">' + esc(settlementStrings.command) + '</button>'
    + '</footer></div>';

  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Settlement element missing: ' + selector);
    return found;
  };
  const people = q<HTMLElement>('#cs-people'), work = q<HTMLElement>('#cs-work'), custody = q<HTMLElement>('#cs-custody');
  const clock = q<HTMLElement>('#cs-clock'), place = q<HTMLElement>('#cs-place');
  const command = q<HTMLButtonElement>('#cs-command');
  let selectedWork = 0;

  function render(): void {
    const view = options.snapshot();
    place.textContent = view.place.name;
    clock.textContent = '세계 경과 ' + formatWorldSeconds(view.clockMs) + (view.speed === 0 ? ' · 정지' : ' · ' + view.speed + '배속');
    parent.dataset.support = view.support ?? ''; parent.dataset.closed = String(view.closed);
    people.innerHTML = view.people.map(person => '<div class="cs-person' + (person.returning ? ' is-returning' : '') + '" role="listitem">'
      + '<h3 class="cs-person__name">' + esc(person.name) + '</h3><p class="cs-person__role">' + esc(person.role) + '</p>'
      + '<dl class="cs-facts"><div class="cs-fact"><dt>현재 업무</dt><dd>' + esc(person.task) + '</dd></div>'
      + '<div class="cs-fact"><dt>위치' + (person.asOf ? ' (' + settlementStrings.lastKnown + ' ' + formatWorldSeconds(person.asOf) + ')' : '') + '</dt><dd>' + esc(person.place) + '</dd></div>'
      + (person.food ? '<div class="cs-fact"><dt>신체 지원</dt><dd>' + esc([person.food, person.water].filter(Boolean).join(' · ')) + '</dd></div>' : '')
      + '</dl></div>').join('') || '<p class="cs-empty">' + esc(settlementStrings.unknownPlace) + '</p>';
    work.innerHTML = view.works.length
      ? view.works.map((row, index) => '<button class="ui-button cs-work' + (index === selectedWork ? ' is-selected' : '') + '" type="button" role="listitem" data-work="' + index + '" aria-pressed="' + (index === selectedWork) + '">'
        + '<span class="cs-work__head">' + esc(row.recipientName) + ' · ' + esc(row.operation) + '</span>'
        + '<span class="cs-work__meta">' + esc(labelStage(row.stage)) + ' · ' + esc(row.activity) + '</span>'
        + '<span class="cs-work__id">' + esc(row.orderId) + '</span></button>').join('')
      : '<p class="cs-empty">' + esc(settlementStrings.noWork) + '</p>';
    const c = view.custody;
    custody.innerHTML = c
      ? '<h3 class="cs-custody__name">' + esc(c.name) + '</h3><p class="cs-caption">' + esc(settlementStrings.whole) + '</p>'
      + '<dl class="cs-facts">'
      + '<div class="cs-fact"><dt>소유</dt><dd>' + esc(c.owner) + '</dd></div>'
      + '<div class="cs-fact"><dt>보관자</dt><dd>' + esc(c.custodian) + (c.visible ? '' : ' (' + settlementStrings.lastKnown + ')') + '</dd></div>'
      + '<div class="cs-fact"><dt>보관함</dt><dd>' + esc(c.container) + '</dd></div>'
      + '<div class="cs-fact"><dt>봉인</dt><dd>' + esc(c.seal) + '</dd></div>'
      + '<div class="cs-fact"><dt>반환 상태</dt><dd>' + esc(c.returnState) + (c.unresolvedReturn ? ' · 미해결 반환' : '') + '</dd></div>'
      + '</dl>' + (c.visible ? '' : '<p class="cs-note">현재 장면 밖 — 즉시 갱신되지 않는다.</p>')
      + '<p class="cs-caption">' + settlementStrings.asOf + ' ' + formatWorldSeconds(c.asOf) + '</p>'
      : '<p class="cs-empty">수신된 보관 정보가 없다.</p>';
    if (view.support === 'expired') custody.insertAdjacentHTML('beforeend', '<p class="cs-warning">' + esc(settlementStrings.supportExpired) + '</p>');
    if (view.closed) custody.insertAdjacentHTML('beforeend', '<p class="cs-warning">' + esc(settlementStrings.closed) + '</p>');
    command.disabled = options.onOrders === undefined;
    command.dataset.blockedReason = options.onOrders ? '' : 'command-surface-unavailable';
    const existing = parent.querySelector('#cs-command-reason');
    existing?.remove();
    if (!options.onOrders) command.insertAdjacentHTML('afterend', '<p class="cs-command-reason" id="cs-command-reason">' + esc(settlementStrings.commandUnavailable) + '</p>');
  }

  parent.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLElement>('[data-work]');
    if (row) { selectedWork = Number(row.dataset.work); render(); q<HTMLElement>('[data-work="' + selectedWork + '"]').focus(); }
  }, { signal });
  q('#cs-back').addEventListener('click', options.onBack, { signal });
  q('#cs-footer-back').addEventListener('click', options.onBack, { signal });
  q('#cs-reports').addEventListener('click', options.onOpenReports, { signal });
  command.addEventListener('click', () => {
    if (options.onOrders) { options.onOrders(); return; }
    // Blocked control still needs a readable state announcement, not silence.
    const reason = parent.querySelector('#cs-command-reason');
    if (reason) reason.setAttribute('aria-live', 'polite');
    command.dataset.lastRefusal = command.dataset.blockedReason ?? '';
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); options.onBack(); }
  }, { signal });

  render();
  const unsubscribe = options.subscribe(render);
  signal.addEventListener('abort', unsubscribe);
  q<HTMLButtonElement>('#cs-back').focus();
  return { release: () => abort.abort() };
}
