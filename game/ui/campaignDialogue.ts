/** Narrative dialogue screen (task22 wave3), per the approved task26 design contract §7:
 * header 48 (event title / live clock / close), speaker dock 303, authored narrative 618
 * (title + body + stakes in order, scroll, no typewriter gate), eligible choices 303,
 * footer 80 ([닫기 (보류)] [선택 확인]). 선택 확인 revalidates through the real events
 * pipeline before any effect; a stale choice refreshes with an explanation and no effect.
 * The outer Close defers the presentation — Escape routes to that Close, never into an
 * option (engine cancelBehavior=disallow is not bypassed). Opening never pauses the clock. */
import { t } from '../../hosting/ui-strings.ts';
import { buildDialogueView, describeDialogueFailure, dialogueStrings } from './campaignDialogueModel.ts';
import type { DialogueOptionRow } from './campaignDialogueModel.ts';
import type { EventDefinition, SwitchEffect } from '../src/events/definition.ts';
import { chooseEvent } from '../src/events/pipeline.ts';
import type { EventContext } from '../src/events/pipeline.ts';
import { formatWorldSeconds } from './campaignSettlementModel.ts';
import { mountPaneNav } from './paneNav.ts';

export * from './campaignDialogueModel.ts';

export interface DialogueOptions {
  /** A document already admitted by loadEvent, or null when no admitted narrative exists (blocked state). */
  readonly event: EventDefinition | null;
  /** Readable cause shown in the blocked state when the document failed admission. */
  readonly blockedReason?: string;
  /** Authoritative actor trait/switch context; re-read before every render and every confirm. */
  readonly context: () => EventContext;
  readonly liveClock: () => { readonly clockMs: number; readonly speed: number };
  /** Runtime state notifications; used only to keep the header clock live while the world runs. */
  readonly subscribe?: (listener: () => void) => () => void;
  /** The only effect path: a successful revalidated choice reaches the owning host, never direct UI mutation. */
  readonly onEffects?: (effects: readonly SwitchEffect[], switches: Readonly<Record<string, boolean>>) => void;
  readonly onBack: () => void;
}

export interface DialogueHandle { readonly release: () => void }

const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const fact = (label: string, value: string): string =>
  '<div class="cs-fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';

function optionHtml(option: DialogueOptionRow, selected: boolean): string {
  return '<button class="ui-button ui-button--menu cd-option' + (selected ? ' is-selected' : '')
    + '" type="button" role="listitem" data-option-id="' + esc(option.id) + '" data-action="dialogue.option.' + esc(option.id)
    + '" aria-pressed="' + selected + '"><span class="cd-option__text">' + esc(option.text) + '</span></button>';
}

export function mountCampaignDialogue(parent: HTMLElement, options: DialogueOptions): DialogueHandle {
  const abort = new AbortController(); const { signal } = abort;
  parent.dataset.screen = 'campaign-dialogue';
  const closeLabel = '<kbd class="ui-key-cap">' + t('ui.key.cancel') + '</kbd> ' + esc(dialogueStrings.close);
  parent.innerHTML = '<div class="cd">'
    + '<header class="cs-nav"><h1 class="cs-nav__place" id="cd-title"></h1>'
    + '<output class="cs-nav__clock" id="cd-clock" role="status"></output>'
    + '<div class="cs-nav__trail"><button class="ui-button ui-button--menu cs-nav__button" type="button" id="cd-close" data-action="dialogue.close">' + closeLabel + '</button></div></header>'
    + '<section class="cs-dock cs-dock--people ui-panel" aria-labelledby="cd-speaker-h"><h2 class="cs-h" id="cd-speaker-h">' + esc(dialogueStrings.speaker) + '</h2><div class="cs-body" id="cd-speaker"></div></section>'
    + '<section class="cs-panel cs-panel--place ui-panel" aria-labelledby="cd-text-h"><h2 class="cs-h" id="cd-text-h">' + esc(dialogueStrings.narrative) + '</h2><div class="cs-body" id="cd-text"></div></section>'
    + '<section class="cs-dock cs-dock--custody ui-panel" aria-labelledby="cd-choices-h"><h2 class="cs-h" id="cd-choices-h">' + esc(dialogueStrings.choices) + '</h2><div class="cs-body" id="cd-choices"></div></section>'
    + '<footer class="cs-footer">'
    + '<button class="ui-button ui-button--menu" type="button" id="cd-footer-close">' + esc(dialogueStrings.close) + '</button>'
    + '<p class="cs-command-reason" id="cd-reason" aria-live="polite"></p>'
    + '<button class="ui-button ui-button--primary" type="button" id="cd-confirm" data-action="dialogue.confirm-choice">' + esc(dialogueStrings.confirmChoice) + '</button>'
    + '</footer></div>';

  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Dialogue element missing: ' + selector);
    return found;
  };
  const title = q<HTMLElement>('#cd-title'), clock = q<HTMLElement>('#cd-clock');
  const speaker = q<HTMLElement>('#cd-speaker'), text = q<HTMLElement>('#cd-text'), choices = q<HTMLElement>('#cd-choices');
  const reason = q<HTMLElement>('#cd-reason'), confirm = q<HTMLButtonElement>('#cd-confirm');
  let selectedId: string | null = null;
  let dialog: HTMLDialogElement | null = null;
  // Receipt from the last successful revalidated choice; survives re-renders like the saves receipt.
  let receipt: string | null = null;
  let notice: string | null = null;

  function renderClock(): void {
    const live = options.liveClock();
    clock.textContent = '세계 경과 ' + formatWorldSeconds(live.clockMs) + (live.speed === 0 ? ' · 정지' : ' · ' + live.speed + '배속');
  }

  function render(): void {
    const view = buildDialogueView(options.event, options.context());
    renderClock();
    confirm.disabled = true;
    if (view.kind === 'blocked') {
      title.textContent = dialogueStrings.blockedTitle;
      speaker.innerHTML = '';
      text.innerHTML = '<p class="cs-empty">' + esc(dialogueStrings.blocked) + '</p>';
      choices.innerHTML = '';
      reason.textContent = options.blockedReason ? dialogueStrings.blockedReason + ' · ' + options.blockedReason : dialogueStrings.deferNote;
      return;
    }
    if (view.kind === 'empty') {
      title.textContent = dialogueStrings.blockedTitle;
      speaker.innerHTML = '';
      text.innerHTML = '<p class="cs-empty">' + esc(dialogueStrings.empty) + '</p>';
      choices.innerHTML = '';
      reason.textContent = receipt ?? dialogueStrings.deferNote;
      return;
    }
    title.textContent = view.title;
    speaker.innerHTML = '<div class="cd-portrait"><p class="cd-portrait__name">' + esc(view.speaker) + '</p>'
      + '<p class="cd-portrait__fallback">' + esc(dialogueStrings.portraitFallback) + '</p></div>'
      + '<dl class="cs-facts">' + fact(dialogueStrings.eventId, view.eventId) + fact(dialogueStrings.provenance, view.provenance)
      + fact(dialogueStrings.portraitResource, view.portraitResourceId) + '</dl>'
      + (view.once ? '<p class="cs-note">' + esc(dialogueStrings.onceNote) + '</p>' : '');
    text.innerHTML = '<h3 class="cd-text__title">' + esc(view.title) + '</h3>'
      + view.body.map(paragraph => '<p class="cd-text__body">' + esc(paragraph) + '</p>').join('')
      + '<h4 class="cd-text__stakes-h">' + esc(dialogueStrings.stakesHeading) + '</h4>'
      + '<p class="cd-text__stakes">' + esc(view.stakes) + '</p>';
    const selected = view.options.find(option => option.id === selectedId) ?? null;
    if (!selected) selectedId = null;
    choices.innerHTML = view.options.map(option => optionHtml(option, option.id === selectedId)).join('')
      + (selected
        ? '<div class="cd-selected"><h3 class="cd-selected__h">' + esc(dialogueStrings.selectedHeading) + '</h3>'
          + '<p class="cd-selected__text">' + esc(selected.text) + '</p>'
          + (selected.requires.length
            ? '<h4 class="cd-selected__requires-h">' + esc(dialogueStrings.requiresHeading) + '</h4><dl class="cs-facts">'
              + selected.requires.map(entry => fact(
                (entry.kind === 'trait' ? dialogueStrings.requirementTrait : dialogueStrings.requirementSwitch) + ' ' + entry.reference + (entry.expected ? '' : ' 없음'),
                entry.met ? dialogueStrings.requiresMet : dialogueStrings.requiresUnmet,
              )).join('') + '</dl>'
            : '')
          + '</div>'
        : '')
      + '<p class="cs-note">' + esc(dialogueStrings.deferNote) + '</p>';
    confirm.disabled = !selected;
    reason.textContent = receipt ?? notice ?? (selected ? selected.text : dialogueStrings.selectFirst);
  }

  function closeDialog(): void { dialog?.close(); }
  function openConfirm(): void {
    // The confirmation repeats the authored option the user sees selected; eligibility is
    // revalidated by chooseEvent on proceed (contract §7), never pre-filtered here — a stale
    // selection must reach the failed confirm, refresh the list and explain, not vanish.
    if (!options.event || !selectedId) return;
    const option = options.event.options.find(entry => entry.id === selectedId);
    if (!option) return;
    dialog = document.createElement('dialog');
    dialog.className = 'campaign-info ui-panel sv-confirm cd-confirm';
    const heading = document.createElement('h2'); heading.textContent = dialogueStrings.confirmTitle;
    const body = document.createElement('p'); body.className = 'sv-confirm__body'; body.textContent = option.text;
    const actions = document.createElement('div'); actions.className = 'sv-confirm__actions';
    const cancel = document.createElement('button'); cancel.className = 'ui-button'; cancel.textContent = dialogueStrings.cancel;
    const proceed = document.createElement('button'); proceed.className = 'ui-button ui-button--primary'; proceed.textContent = dialogueStrings.confirmChoice;
    actions.append(cancel, proceed); dialog.append(heading, body, actions);
    const run = (): void => {
      notice = null;
      try {
        // Revalidate against the current context, never the snapshot the user saw (contract §7).
        const result = chooseEvent(options.event!, selectedId!, options.context());
        receipt = dialogueStrings.appliedHeading + ': ' + result.commands.map(command => command.switchId + '=' + command.value).join(', ');
        selectedId = null;
        options.onEffects?.(result.commands, result.switches);
      } catch (failure) {
        selectedId = null;
        notice = describeDialogueFailure(failure);
      }
      render();
    };
    cancel.addEventListener('click', closeDialog, { signal });
    proceed.addEventListener('click', () => { closeDialog(); run(); }, { signal });
    // Focus returns to the invoking control (#cd-confirm); the dialog's cancel is detached here.
    dialog.addEventListener('close', () => { dialog?.remove(); dialog = null; confirm.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  }

  // Task26 §3 mobile: the authored narrative is the primary pane; choices are the list pane.
  const panes = mountPaneNav({ root: q('.cd'), listPanes: [q('.cs-dock--custody')],
    detailPanes: [q('.cs-dock--people'), q('.cs-panel--place')], listBody: choices,
    labels: { list: '선택지', detail: '서술' }, initial: 'detail' });
  const close = (): void => { if (dialog) { closeDialog(); return; } if (panes.unwind()) return; options.onBack(); };
  parent.addEventListener('click', event => {
    const optionButton = (event.target as Element).closest<HTMLElement>('[data-option-id]');
    if (optionButton) { selectedId = optionButton.dataset.optionId ?? null; notice = null; receipt = null; render(); }
  }, { signal });
  q('#cd-close').addEventListener('click', close, { signal });
  q('#cd-footer-close').addEventListener('click', close, { signal });
  confirm.addEventListener('click', () => { if (!confirm.disabled) openConfirm(); }, { signal });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    // Escape unwinds only the topmost overlay; on the base surface it defers (Close),
    // never a synthetic option cancel (engine cancelBehavior=disallow, contract §7).
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); }
  }, { signal });

  render();
  // The world clock keeps running while this surface is open (contract §3); only the clock line tracks it.
  const unsubscribeClock = options.subscribe?.(() => renderClock());
  return { release: () => { abort.abort(); unsubscribeClock?.(); panes.release(); dialog?.remove(); dialog = null; } };
}
