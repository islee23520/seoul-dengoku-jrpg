/** Save/load screen (task22 wave2, fix-1 restore), per the approved task26 design contract §8:
 * header 48 (title / clock / close), checkpoint dock 303, selected checkpoint detail 618,
 * versions dock 303, footer 80 ([뒤로] [수동 저장 | 불러오기 검토]). One tab/action prominent
 * at a time; confirmations are cancel-first; opening, saving or restoring never changes clock
 * speed. The runtime owns exactly one active pointer + previous pointer; no numbered slots,
 * autosave, repair or migration is invented. The load review performs the real in-session
 * restore through the runtime (unsaved progress discarded by design) and reports the receipt. */
import { t } from '../../hosting/ui-strings.ts';
import { buildSavesView, savesStrings, describeSaveFailure } from './campaignSavesModel.ts';
import type { SavesCheckpointRow, SavesStorageReader } from './campaignSavesModel.ts';
import type { CampaignContent } from '../src/campaign/content.ts';
import { formatWorldSeconds } from './campaignSettlementModel.ts';
import { mountPaneNav } from './paneNav.ts';

export * from './campaignSavesModel.ts';

export interface SavesOptions {
  readonly reader: SavesStorageReader;
  readonly content: CampaignContent;
  readonly liveClock: () => { readonly clockMs: number; readonly speed: number };
  /** Runtime state notifications; used only to keep the header clock live while the world runs. */
  readonly subscribe?: (listener: () => void) => () => void;
  /** Performs the explicit atomic save; returns the persisted save or throws with a readable reason. */
  readonly save: () => { readonly checksum: string; readonly state: { readonly clock: { readonly worldMilliseconds: number } } };
  /** Performs the real in-session restore of the stored checkpoint (task26 §8); throws with a
   * readable reason when the payload is corrupt/missing. Absent hosts keep the guidance-only state. */
  readonly load?: () => { readonly checksum: string; readonly state: { readonly clock: { readonly worldMilliseconds: number } } };
  readonly onBack: () => void;
  readonly onSaved?: (detail: { readonly checksum: string; readonly worldMilliseconds: number }) => void;
  readonly onLoaded?: (detail: { readonly checksum: string; readonly worldMilliseconds: number }) => void;
}

export interface SavesHandle { readonly release: () => void }

const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const fact = (label: string, value: string): string =>
  '<div class="cs-fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';

function rowHtml(row: SavesCheckpointRow, selected: boolean): string {
  const label = row.kind === 'current' ? savesStrings.current : savesStrings.previous;
  const meta = row.status === 'ok' ? (row.worldSecondsText ?? '')
    : row.status === 'invalid' ? savesStrings.previousUnavailable : savesStrings.empty;
  return '<button class="ui-button cr-row' + (selected ? ' is-selected' : '') + '" type="button" role="listitem" data-checkpoint="'
    + row.kind + '" aria-pressed="' + selected + '">'
    + '<span class="cr-row__head">' + esc(label) + '</span>'
    + '<span class="cr-row__meta">' + esc(meta) + '</span>'
    + '<span class="cr-row__id">' + esc(row.key ?? '—') + '</span></button>';
}

function confirmDialog(kind: 'save' | 'load'): { readonly dialog: HTMLDialogElement; readonly cancel: HTMLButtonElement; readonly proceed: HTMLButtonElement } {
  const dialog = document.createElement('dialog');
  dialog.className = 'campaign-info ui-panel sv-confirm';
  const heading = document.createElement('h2'); heading.textContent = savesStrings.confirmTitle;
  const body = document.createElement('p');
  body.className = 'sv-confirm__body';
  body.textContent = kind === 'save' ? savesStrings.overwriteConfirm : savesStrings.loadGuidance;
  const actions = document.createElement('div'); actions.className = 'sv-confirm__actions';
  const cancel = document.createElement('button'); cancel.className = 'ui-button'; cancel.textContent = savesStrings.cancel;
  const proceed = document.createElement('button'); proceed.className = 'ui-button ui-button--primary'; proceed.textContent = savesStrings.proceed;
  actions.append(cancel, proceed); dialog.append(heading, body, actions);
  return { dialog, cancel, proceed };
}

export function mountCampaignSaves(parent: HTMLElement, options: SavesOptions): SavesHandle {
  const abort = new AbortController(); const { signal } = abort;
  parent.dataset.screen = 'campaign-saves';
  parent.innerHTML = '<div class="sv">'
    + '<header class="cs-nav"><h1 class="cs-nav__place">' + esc(savesStrings.title) + '</h1>'
    + '<output class="cs-nav__clock" id="sv-clock" role="status"></output>'
    + '<div class="cs-nav__trail"><button class="ui-button ui-button--menu cs-nav__button" type="button" id="sv-back"><kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + t('ui.main-menu.back') + '</button></div></header>'
    + '<section class="cs-dock cs-dock--people ui-panel" aria-labelledby="sv-list-h">'
    + '<div class="sv-tabs" role="tablist" aria-label="' + esc(savesStrings.title) + '">'
    + '<button class="ui-button ui-button--menu sv-tab" type="button" role="tab" id="sv-tab-save" aria-selected="true">' + esc(savesStrings.saveTab) + '</button>'
    + '<button class="ui-button ui-button--menu sv-tab" type="button" role="tab" id="sv-tab-load" aria-selected="false">' + esc(savesStrings.loadTab) + '</button>'
    + '</div>'
    + '<h2 class="cs-h" id="sv-list-h">' + esc(savesStrings.checkpoints) + '</h2><div class="cs-body" id="sv-rows" role="list"></div></section>'
    + '<section class="cs-panel cs-panel--place ui-panel" aria-labelledby="sv-detail-h"><h2 class="cs-h" id="sv-detail-h">' + esc(savesStrings.detail) + '</h2><div class="cs-body" id="sv-detail" aria-live="polite"></div></section>'
    + '<section class="cs-dock cs-dock--custody ui-panel" aria-labelledby="sv-versions-h"><h2 class="cs-h" id="sv-versions-h">' + esc(savesStrings.versions) + '</h2><div class="cs-body" id="sv-versions"></div></section>'
    + '<footer class="cs-footer">'
    + '<button class="ui-button ui-button--menu" type="button" id="sv-footer-back">' + t('ui.main-menu.back') + '</button>'
    + '<p class="cs-command-reason" id="sv-reason"></p>'
    + '<button class="ui-button ui-button--primary" type="button" id="sv-action">' + esc(savesStrings.save) + '</button>'
    + '</footer></div>';

  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Saves element missing: ' + selector);
    return found;
  };
  const rows = q<HTMLElement>('#sv-rows'), detail = q<HTMLElement>('#sv-detail'), versions = q<HTMLElement>('#sv-versions');
  const clock = q<HTMLElement>('#sv-clock'), reason = q<HTMLElement>('#sv-reason'), action = q<HTMLButtonElement>('#sv-action');
  const tabSave = q<HTMLButtonElement>('#sv-tab-save'), tabLoad = q<HTMLButtonElement>('#sv-tab-load');
  let tab: 'save' | 'load' = 'save';
  let selected: 'current' | 'previous' = 'current';
  let dialog: HTMLDialogElement | null = null;
  // Success receipt from the last explicit save; cleared by any subsequent user action.
  let receipt: string | null = null;

  function renderClock(): void {
    const live = options.liveClock();
    clock.textContent = '세계 경과 ' + formatWorldSeconds(live.clockMs) + (live.speed === 0 ? ' · 정지' : ' · ' + live.speed + '배속');
  }

  function render(): void {
    const data = buildSavesView(options.reader, options.content, options.liveClock().clockMs, options.liveClock().speed);
    renderClock();
    rows.innerHTML = data.rows.map(row => rowHtml(row, row.kind === selected)).join('');
    const row = data.rows.find(entry => entry.kind === selected) ?? data.rows[0]!;
    if (data.error) {
      detail.innerHTML = '<h3 class="cr-detail__title">' + esc(savesStrings.corruptTitle) + '</h3>'
        + '<dl class="cs-facts">' + fact('사유', data.error.readable) + fact('코드', data.error.reason) + '</dl>'
        + '<p class="cs-warning">' + esc(savesStrings.loadGuidance) + '</p>';
    } else if (row.status === 'ok') {
      detail.innerHTML = '<h3 class="cr-detail__title">' + esc(row.kind === 'current' ? savesStrings.current : savesStrings.previous) + '</h3>'
        + '<dl class="cs-facts">'
        + fact(savesStrings.worldSeconds, row.worldSecondsText ?? '')
        + fact(savesStrings.checksum, row.checksum ?? '')
        + fact(savesStrings.envelopeVersion, 'v' + row.envelopeVersion)
        + fact(savesStrings.saveTime, savesStrings.saveTimeNotRecorded)
        + '</dl>'
        + '<p class="cs-note">' + esc(savesStrings.oneActiveOnly) + '</p>';
    } else if (row.kind === 'current' && row.status === 'missing') {
      detail.innerHTML = '<p class="cs-empty">' + esc(savesStrings.empty) + '</p>';
    } else {
      detail.innerHTML = '<p class="cs-empty">' + esc(savesStrings.previousUnavailable) + '</p>';
    }
    versions.innerHTML = data.versions.map(entry => fact(entry.name, entry.value)).join('')
      + '<p class="cs-note">' + esc(savesStrings.migrationUnavailable) + '</p>';
    tabSave.classList.toggle('is-selected', tab === 'save'); tabSave.setAttribute('aria-selected', String(tab === 'save'));
    tabLoad.classList.toggle('is-selected', tab === 'load'); tabLoad.setAttribute('aria-selected', String(tab === 'load'));
    action.textContent = tab === 'save' ? savesStrings.save : savesStrings.loadReview;
    // Load review is blocked without a valid current checkpoint; the reason stays readable beside the control.
    action.disabled = tab === 'load' && !data.hasValidCurrent;
    reason.textContent = receipt ?? (tab === 'load' && !data.hasValidCurrent
      ? data.error ? data.error.readable : savesStrings.empty
      : tab === 'save' ? savesStrings.overwriteConfirm : savesStrings.loadGuidance);
  }

  function closeDialog(): void { dialog?.close(); }
  function openConfirm(kind: 'save' | 'load'): void {
    const built = confirmDialog(kind);
    dialog = built.dialog;
    const run = (): void => {
      if (kind === 'save') {
        try {
          const saved = options.save();
          options.onSaved?.({ checksum: saved.checksum, worldMilliseconds: saved.state.clock.worldMilliseconds });
          // Success is the changed checkpoint state plus a visible receipt line (H3), not a toast.
          receipt = savesStrings.saved + formatWorldSeconds(saved.state.clock.worldMilliseconds);
        } catch (failure) {
          const text = failure instanceof Error ? describeSaveFailure(failure.message) : savesStrings.saveFailed;
          receipt = savesStrings.saveFailed + ' · ' + text;
        }
      } else if (options.load) {
        // Real restore (task26 §8): the runtime validates the stored checkpoint and replaces the
        // live session under the same lock; unsaved progress is discarded by design.
        try {
          const loaded = options.load();
          options.onLoaded?.({ checksum: loaded.checksum, worldMilliseconds: loaded.state.clock.worldMilliseconds });
          receipt = savesStrings.restored + formatWorldSeconds(loaded.state.clock.worldMilliseconds);
        } catch (failure) {
          const text = failure instanceof Error ? describeSaveFailure(failure.message) : savesStrings.restoreFailed;
          receipt = savesStrings.restoreFailed + text;
        }
      } else {
        receipt = savesStrings.loadGuidance;
      }
      render();
    };
    built.cancel.addEventListener('click', closeDialog, { signal });
    built.proceed.addEventListener('click', () => { closeDialog(); run(); }, { signal });
    // Focus restoration returns to the invoking control (#sv-action); the dialog's own cancel
    // button is already detached when this close handler runs.
    built.dialog.addEventListener('close', () => { dialog?.remove(); dialog = null; action.focus(); }, { once: true });
    document.body.append(built.dialog); built.dialog.showModal(); built.cancel.focus();
  }

  // Task26 §3 mobile: single visible list OR detail pane; selecting a checkpoint opens the detail.
  const panes = mountPaneNav({ root: q('.sv'), listPanes: [q('.cs-dock--people')],
    detailPanes: [q('.cs-panel--place'), q('.cs-dock--custody')], listBody: rows,
    labels: { list: '체크포인트', detail: '상세 · 버전' } });
  const back = (): void => {
    if (dialog) { closeDialog(); return; }
    if (panes.unwind()) return;
    options.onBack();
  };
  parent.addEventListener('click', event => {
    const rowButton = (event.target as Element).closest<HTMLElement>('[data-checkpoint]');
    if (rowButton) { selected = rowButton.dataset.checkpoint === 'previous' ? 'previous' : 'current'; receipt = null; render(); panes.showDetail(); return; }
    const tabButton = (event.target as Element).closest<HTMLElement>('.sv-tab');
    if (tabButton) { tab = tabButton.id === 'sv-tab-load' ? 'load' : 'save'; receipt = null; render(); }
  }, { signal });
  q('#sv-back').addEventListener('click', back, { signal });
  q('#sv-footer-back').addEventListener('click', back, { signal });
  action.addEventListener('click', () => { if (!action.disabled) openConfirm(tab); }, { signal });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    // Escape unwinds only the topmost overlay: while any native dialog (page info dialog or this
    // view's own confirmation) is open, the dialog owns Escape and the view must not also navigate.
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); back(); }
  }, { signal });

  render();
  // The world clock keeps running while this surface is open (contract §3); only the clock line tracks it.
  const unsubscribeClock = options.subscribe?.(() => renderClock());
  return { release: () => { abort.abort(); unsubscribeClock?.(); panes.release(); dialog?.remove(); dialog = null; } };
}
