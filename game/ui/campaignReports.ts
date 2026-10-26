/** Received-report inbox screen (task14), per the approved task26 design contract §6:
 * header 48 (received reports / clock / back), received list 303, selected report detail 618,
 * provenance 303, footer 80 ([뒤로] [명령 보기 | 닫기]). RECEIVED-ONLY: the provider snapshot
 * contains only received reports; opening a row changes local unread metadata and nothing else. */
import { t } from '../../hosting/ui-strings.ts';
import { reportsStrings, sortedRows, unreadIds } from './campaignReportsModel.ts';
import type { InboxRow, InboxView } from './campaignReportsModel.ts';
import { formatWorldSeconds, settlementStrings } from './campaignSettlementModel.ts';

export * from './campaignReportsModel.ts';

export interface InboxOptions {
  readonly snapshot: () => InboxView;
  readonly subscribe: (onChange: () => void) => () => void;
  readonly onBack: () => void;
  /** Opens the linked command detail; null means the command surface is lawfully unavailable. */
  readonly onOpenCommand: ((orderId: string) => void) | null;
}

export interface InboxHandle { readonly release: () => void; readonly readCount: () => number }

const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const time = (label: string, ms: number | null): string =>
  '<div class="cs-fact"><dt>' + esc(label) + '</dt><dd>' + (ms === null ? esc(reportsStrings.notDelivered) : formatWorldSeconds(ms)) + '</dd></div>';
const fact = (label: string, value: string): string =>
  '<div class="cs-fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';

export function mountCampaignReports(parent: HTMLElement, options: InboxOptions): InboxHandle {
  const abort = new AbortController(); const { signal } = abort;
  parent.dataset.screen = 'campaign-reports';
  parent.innerHTML = '<div class="cr">'
    + '<header class="cs-nav"><h1 class="cs-nav__place">' + esc(reportsStrings.inbox) + '</h1>'
    + '<output class="cs-nav__clock" id="cr-clock" role="status"></output>'
    + '<div class="cs-nav__trail"><button class="ui-button ui-button--menu cs-nav__button" type="button" id="cr-back"><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.main-menu.back') + '</button></div></header>'
    + '<section class="cs-dock cs-dock--people ui-panel cr-list" aria-labelledby="cr-list-h"><h2 class="cs-h" id="cr-list-h">' + esc(reportsStrings.inbox) + '</h2><div class="cs-body" id="cr-rows" role="list"></div></section>'
    + '<section class="cs-panel cs-panel--place ui-panel" aria-labelledby="cr-detail-h"><h2 class="cs-h" id="cr-detail-h">' + esc(reportsStrings.open) + '</h2><div class="cs-body" id="cr-detail" aria-live="polite"></div></section>'
    + '<section class="cs-dock cs-dock--custody ui-panel" aria-labelledby="cr-prov-h"><h2 class="cs-h" id="cr-prov-h">출처와 한계</h2><div class="cs-body" id="cr-prov"></div></section>'
    + '<footer class="cs-footer">'
    + '<button class="ui-button ui-button--menu" type="button" id="cr-footer-back">' + t('ui.main-menu.back') + '</button>'
    + '<button class="ui-button ui-button--primary" type="button" id="cr-command">' + esc(reportsStrings.linkedCommand) + '</button>'
    + '</footer></div>';

  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Inbox element missing: ' + selector);
    return found;
  };
  const rows = q<HTMLElement>('#cr-rows'), detail = q<HTMLElement>('#cr-detail'), prov = q<HTMLElement>('#cr-prov');
  const clock = q<HTMLElement>('#cr-clock'), commandButton = q<HTMLButtonElement>('#cr-command');
  let selected: string | null = null;
  const read = new Set<string>();

  function render(keepFocus: boolean): void {
    const focusedReport = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.report : undefined;
    const providerView = options.snapshot();
    const view = { clockMs: providerView.clockMs, rows: providerView.rows, unread: unreadIds(providerView.rows, read) };
    const ordered = sortedRows(view);
    clock.textContent = '세계 경과 ' + formatWorldSeconds(view.clockMs);
    rows.innerHTML = ordered.length ? ordered.map(row => '<button class="ui-button cr-row' + (row.reportId === selected ? ' is-selected' : '') + '" type="button" role="listitem" data-report="' + esc(row.reportId) + '" aria-pressed="' + (row.reportId === selected) + '">'
      + '<span class="cr-row__head">' + (view.unread.has(row.reportId) ? '<span class="cr-unread">' + esc(reportsStrings.unread) + '</span>' : '') + esc(row.title) + '</span>'
      + '<span class="cr-row__meta">' + esc(reportsStrings.source) + ' ' + esc(row.sourceName) + ' · ' + esc(reportsStrings.observedAt) + ' ' + formatWorldSeconds(row.observedAt) + '</span>'
      + '<span class="cr-row__id">' + esc(row.reportId) + '</span></button>').join('')
      : '<p class="cs-empty">' + esc(reportsStrings.empty) + '</p>';
    const row: InboxRow | undefined = ordered.find(entry => entry.reportId === selected);
    if (!row) { selected = ordered[0]?.reportId ?? null; }
    const current = ordered.find(entry => entry.reportId === selected);
    if (current) {
      detail.innerHTML = '<h3 class="cr-detail__title">' + esc(current.title) + '</h3>'
        + '<dl class="cs-facts">' + time(reportsStrings.observedAt, current.observedAt) + time(reportsStrings.createdAt, current.createdAt)
        + time(reportsStrings.deliveredAt, current.deliveredAt) + time(reportsStrings.receivedAt, current.receivedAt)
        + fact(reportsStrings.source, current.sourceId) + '</dl>'
        + '<h4 class="cr-sub">' + esc(current.evidence.kind === 'raw-observation' ? reportsStrings.rawEvidence : reportsStrings.ledgerEvidence) + '</h4>'
        + '<ul class="cr-lines">' + current.evidence.lines.map(line => '<li>' + esc(line) + '</li>').join('') + '</ul>'
        + '<p class="cs-warning">' + esc(reportsStrings.partial) + '</p>';
      prov.innerHTML = '<dl class="cs-facts">'
        + '<div class="cs-fact"><dt>' + esc(reportsStrings.fact) + '</dt><dd>' + esc(current.factId) + '</dd></div>'
        + '<div class="cs-fact"><dt>' + esc(reportsStrings.version) + '</dt><dd>v' + current.version + '</dd></div>'
        + '<div class="cs-fact"><dt>연결 명령</dt><dd>' + esc(current.orderId) + '</dd></div></dl>'
        + '<h4 class="cr-sub">' + esc(reportsStrings.omission) + '</h4>'
        + '<ul class="cr-lines">' + (current.omission.length ? current.omission.map(o => '<li>' + esc(o) + '</li>').join('') : '<li>없음</li>') + '</ul>'
        + '<h4 class="cr-sub">' + esc(reportsStrings.uncertainty) + '</h4><p class="cs-note">' + esc(current.uncertainty) + '</p>';
    } else {
      detail.innerHTML = '<p class="cs-empty">' + esc(reportsStrings.empty) + '</p>';
      prov.innerHTML = '';
    }
    // The linked command surface (task13) is not landed on this branch: readable block, no fake view.
    commandButton.disabled = !current || options.onOpenCommand === null;
    commandButton.dataset.blockedReason = !current ? 'no-selected-report' : options.onOpenCommand === null ? 'command-surface-unavailable' : '';
    const reason = parent.querySelector('#cr-command-reason'); reason?.remove();
    commandButton.insertAdjacentHTML('afterend', '<p class="cs-command-reason" id="cr-command-reason">'
      + esc(!current ? reportsStrings.empty : options.onOpenCommand === null ? settlementStrings.commandUnavailable : '') + '</p>');
    if (!keepFocus) { const first = rows.querySelector<HTMLButtonElement>('[data-report]'); if (first) first.focus(); }
    else if (focusedReport) rows.querySelector<HTMLButtonElement>('[data-report="' + CSS.escape(focusedReport) + '"]')?.focus();
  }

  parent.addEventListener('click', event => {
    const row = (event.target as Element).closest<HTMLElement>('[data-report]');
    if (row) { selected = row.dataset.report ?? null; if (selected) read.add(selected); render(true); }
  }, { signal });
  const back = (): void => options.onBack();
  q('#cr-back').addEventListener('click', back, { signal });
  q('#cr-footer-back').addEventListener('click', back, { signal });
  commandButton.addEventListener('click', () => {
    const row = options.snapshot().rows.find(entry => entry.reportId === selected);
    if (row) options.onOpenCommand?.(row.orderId);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); back(); }
  }, { signal });
  const unsubscribe = options.subscribe(() => {
    // A report arriving while the inbox is open is a received-only update: announce it, never move focus.
    render(true);
  });
  signal.addEventListener('abort', unsubscribe);

  render(false);
  // Reading the auto-selected first row marks it read (local metadata only).
  if (selected) read.add(selected);
  return { release: () => abort.abort(), readCount: () => read.size };
}
