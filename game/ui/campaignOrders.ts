/** Retainer command composer/detail (task13, task26 design contract §4): roster 303 / composer 618 /
 * authority 303 docks under the 48px header at 1280x720, inner frame heading48 + body484 + footer80.
 * Wired only to the task8 ingress (CampaignApplication.submit) and task10 lord-visible views; selection
 * and panel state never mutate the world, and opening the screen never changes clock speed. */
import type { CampaignApplication } from '../src/campaign/application.ts';
import type { CampaignContent } from '../src/campaign/content.ts';
import { renderOrderDraft, renderIssuedOrders, renderOrderAuthority } from './campaignOrdersDraft.ts';
import type { CampaignBoundaryError } from '../src/campaign/errors.ts';
import {
  authorityNow, buildOrdersCatalog, orderRows, ordersStrings as s, reasonText,
} from './campaignOrdersModel.ts';
import type { OperationBrief, OrdersCatalog } from './campaignOrdersModel.ts';

export * from './campaignOrdersModel.ts';

export interface CampaignOrdersOptions {
  readonly app: CampaignApplication; readonly content: CampaignContent;
  readonly actor: { readonly actorId: string; readonly name: string; readonly title: string };
  readonly onBack: () => void;
}
export interface CampaignOrdersHandle { readonly release: () => void }

const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const short = (hash: string): string => hash.slice(0, 12);

export function mountCampaignOrders(parent: HTMLElement, options: CampaignOrdersOptions): CampaignOrdersHandle {
  const { app, content, actor } = options;
  const catalog: OrdersCatalog = buildOrdersCatalog(content);
  const abort = new AbortController(); const { signal } = abort;
  parent.dataset.screen = 'campaign-orders';
  /** Session state captured from the subscription; render must never call app.checkpoint()
   * because checkpoint reconciles and reconcile publishes, which would re-enter render. */
  let world = app.checkpoint();

  let selectedPersonId = catalog.court.find(r => r.eligible)?.personId ?? catalog.court[0]?.personId ?? '';
  let rosterFilter: 'named' | 'all' = 'named';
  let selectedOrderId: string | null = null;
  let notice: string | null = null;
  /** Draft intent identity: reused across review retries so rapid retries cannot mint two orders. */
  let draftCommandId: string | null = null;
  let draftKey = '';
  let cancelCommandId: string | null = null;
  let cancelKey = '';
  let modal: null | { readonly kind: 'issue' } | { readonly kind: 'cancel'; readonly orderId: string } = null;
  let modalOpener: HTMLElement | null = null;
  let submitting = false;
  /** Structural signature: when unchanged, a world tick only updates the clock, never rebuilds the DOM
   * (scroll position and focus of the three bodies stay stable while the clock runs). */
  let lastSig = '';

  const q = <T extends Element>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Campaign orders element missing: ' + selector);
    return found;
  };
  const selectedRow = () => catalog.court.find(r => r.personId === selectedPersonId) ?? null;
  const briefFor = (row: { readonly eligible: boolean; readonly operationId: string | null }): OperationBrief | null =>
    row.eligible && row.operationId ? catalog.operations.find(o => o.id === row.operationId) ?? null : null;

  const freshId = (): string => 'command:' + (globalThis.crypto?.randomUUID?.() ?? String(Math.random()));

  function openIssueModal(): void {
    const row = selectedRow(); const brief = briefFor(row ?? { eligible: false, operationId: null });
    if (!row || !brief) return;
    const key = brief.id + '>' + brief.recipientId;
    if (draftKey !== key || draftCommandId === null) { draftCommandId = freshId(); draftKey = key; }
    modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal = { kind: 'issue' }; render();
  }
  function openCancelModal(orderId: string): void {
    const key = orderId;
    if (cancelKey !== key || cancelCommandId === null) { cancelCommandId = freshId(); cancelKey = key; }
    modalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal = { kind: 'cancel', orderId }; selectedOrderId = orderId; render();
  }
  function closeModal(): void {
    if (!modal) return;
    const restore = modalOpener;
    modal = null; modalOpener = null; submitting = false; render();
    if (restore && restore.isConnected) restore.focus();
    else parent.querySelector<HTMLElement>('[data-review]')?.focus();
  }
  /** Rapid retry keeps the SAME commandId: one intent can never mint two orders. A stale-version
   * refusal means the clock moved past the reviewed boundary; re-review and resubmit the same id. */
  function submitIssue(): void {
    const row = selectedRow(); const brief = briefFor(row ?? { eligible: false, operationId: null });
    if (!row || !brief || !draftCommandId || submitting) return;
    submitting = true;
    const commandId = draftCommandId;
    try {
      app.submitComposed({ kind: 'issue', commandId, issuerPersonId: actor.actorId,
        recipientId: brief.recipientId, operation: brief.id });
      notice = null; draftCommandId = null; draftKey = ''; modal = null;
      selectedOrderId = app.view(actor.actorId).orders.at(-1)?.orderId ?? null;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)) throw error;
      notice = reasonText((error as CampaignBoundaryError).code);
      const code = (error as CampaignBoundaryError).code;
      if (code !== 'stale-version' && code !== 'grant-version') { draftCommandId = null; draftKey = ''; modal = null; }
    } finally { submitting = false; render(); }
  }
  function submitCancellation(): void {
    if (!modal || modal.kind !== 'cancel' || !cancelCommandId || submitting) return;
    submitting = true;
    const commandId = cancelCommandId;
    const orderId = modal.orderId;
    try {
      app.submitComposed({ kind: 'request-cancellation', commandId, issuerPersonId: actor.actorId, orderId });
      notice = null; cancelCommandId = null; cancelKey = ''; modal = null;
      submitting = false; render();
      parent.querySelector<HTMLElement>('[data-order="' + CSS.escape(orderId) + '"]')?.focus();
      return;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)) throw error;
      const code = (error as CampaignBoundaryError).code;
      notice = reasonText(code);
      if (code !== 'stale-version') { modal = null; cancelCommandId = null; cancelKey = ''; }
      submitting = false; render();
      parent.querySelector<HTMLElement>('[data-modal-cancel]')?.focus();
    }
  }

  parent.addEventListener('click', event => {
    const control = (event.target as Element).closest<HTMLElement>('[data-pick],[data-review],[data-issue],[data-cancel-request],[data-cancel-confirm],[data-modal-cancel],[data-filter],[data-speed],[data-order]');
    if (!control) return;
    if (control.dataset.pick) { selectedPersonId = control.dataset.pick; notice = null; render(); return; }
    if (control.dataset.order) { selectedOrderId = control.dataset.order; render(); return; }
    if (control.dataset.filter) { rosterFilter = control.dataset.filter === 'all' ? 'all' : 'named'; render(); return; }
    if (control.dataset.speed !== undefined) { app.setSpeed(Number(control.dataset.speed) as 0 | 1 | 2 | 4); render(); return; }
    if (control.hasAttribute('data-review')) { openIssueModal(); return; }
    if (control.hasAttribute('data-issue')) { submitIssue(); return; }
    if (control.hasAttribute('data-cancel-request')) { openCancelModal(control.getAttribute('data-cancel-request') ?? ''); return; }
    if (control.hasAttribute('data-cancel-confirm')) { submitCancellation(); return; }
    if (control.hasAttribute('data-modal-cancel')) { closeModal(); return; }
  }, { signal });

  // The campaign map listens on document; while this screen owns input its keys must be inert.
  // Capture phase at document: the modal branch also owns Escape/Tab because stopPropagation here
  // prevents the overlay's own bubble listener from ever firing.
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const inside = document.activeElement === null || document.activeElement === document.body || parent.contains(document.activeElement) || parent.contains(event.target as Node);
    if (!inside) return;
    if (modal) {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
      else if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = [...parent.querySelectorAll<HTMLButtonElement>('#co-modal button')];
        (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus();
      }
      event.stopPropagation(); return;
    }
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); event.stopPropagation(); release(); options.onBack(); }
  }, { signal, capture: true });

  function render(): void {
    const scrolls = [...parent.querySelectorAll<HTMLElement>('[data-scroll]')].map(el => el.scrollTop);
    const activeElement = document.activeElement instanceof HTMLElement && parent.contains(document.activeElement) ? document.activeElement : null;
    const active = { pick: activeElement?.dataset.pick ?? null, id: activeElement?.id || null,
      modalButton: activeElement?.hasAttribute('data-modal-cancel') ? 'cancel' : activeElement?.hasAttribute('data-issue') || activeElement?.hasAttribute('data-cancel-confirm') ? 'confirm' : null,
      orderId: activeElement?.dataset.cancelRequest ?? activeElement?.dataset.order ?? null };
    const view = app.view(actor.actorId);
    const rows = orderRows(view);
    const row = selectedRow(); const brief = briefFor(row ?? { eligible: false, operationId: null });
    const state = world;
    const basis = brief ? authorityNow(state, brief.id, content) : null;
    // Lord-visible only: received reports are knowledge records; unreceived reports stay hidden.
    const knowledge = state.knowledge.find(k => k.personId === actor.actorId);
    const reportsByOrder = new Map<string, number>();
    for (const record of knowledge?.records ?? []) {
      const report = state.reports.find(r => r.id === record.reportId && r.receivedAt !== null);
      if (!report) continue;
      const orderId = report.fact.orderId;
      reportsByOrder.set(orderId, (reportsByOrder.get(orderId) ?? 0) + 1);
    }
    const worldSeconds = Math.floor(view.worldMilliseconds / 1000);
    const rowHtml = (fact: string, value: string): string => '<div class="co-fact"><dt>' + esc(fact) + '</dt><dd>' + value + '</dd></div>';

    const { rosterRows, composer } = renderOrderDraft({ catalog, selectedPersonId, rosterFilter, row, brief, notice });
    const ordersList = renderIssuedOrders({ rows, reportsByOrder, catalog, selectedOrderId });
    const authority = renderOrderAuthority(basis, catalog);
    parent.innerHTML = '<div class="co">'
      + '<header class="co-header">'
      + '<h1 class="co-header__person">' + esc(actor.name) + '</h1>'
      + '<p class="co-header__place">' + esc(catalog.designator.siteName) + ' · ' + esc(catalog.designator.placeName) + '</p>'
      + '<p class="co-header__clock">' + esc(s.worldClock) + ' <output data-world-seconds="' + worldSeconds + '">' + worldSeconds + '</output>' + esc(s.seconds) + '</p>'
      + '<div class="co-header__speeds" role="group" aria-label="' + esc(s.speedLabel) + '">'
      + [0, 1, 2, 4].map(speed => '<button class="ui-button co-speed" type="button" data-speed="' + speed + '" aria-pressed="' + (view.speed === speed) + '">' + (speed === 0 ? esc(s.pause) : speed + '배') + '</button>').join('') + '</div>'
      + '<button class="ui-button" type="button" data-back>' + esc(s.back) + '</button></header>'
      + '<section class="co-dock co-dock--roster ui-panel" aria-label="' + esc(s.rosterHeading) + '">'
      + '<div class="co-head"><h2>' + esc(s.rosterHeading) + '</h2><div class="co-filter" role="group">'
      + '<button class="ui-button co-chip" type="button" data-filter="named" aria-pressed="' + (rosterFilter === 'named') + '">' + esc(s.rosterNamed) + '</button>'
      + '<button class="ui-button co-chip" type="button" data-filter="all" aria-pressed="' + (rosterFilter === 'all') + '">' + esc(s.rosterAll) + '</button></div></div>'
      + '<div class="co-body" data-scroll="command.roster-body">' + rosterRows + '</div></section>'
      + '<section class="co-dock co-dock--compose ui-panel" aria-label="' + esc(s.composeHeading) + '">'
      + '<div class="co-head"><h2>' + esc(s.composeHeading) + '</h2></div>'
      + '<div class="co-body" data-scroll="command.compose-body">' + composer + '<div class="co-orders"><h3 class="co-subheading">' + esc(s.issuedOrders) + '</h3>' + ordersList + '</div></div>'
      + '<footer class="co-footer"><button class="ui-button" type="button" data-cancel-draft>' + esc(s.cancelDraft) + '</button>'
      + '<button class="ui-button ui-button--primary" type="button" data-review' + (brief ? '' : ' disabled') + '>' + esc(s.review) + '</button></footer></section>'
      + '<section class="co-dock co-dock--authority ui-panel" aria-label="' + esc(s.authorityHeading) + '">'
      + '<div class="co-head"><h2>' + esc(s.authorityHeading) + '</h2></div>'
      + '<div class="co-body" data-scroll="command.authority-body">' + authority + '</div></section>'
      + '</div>';

    if (modal) {
      const overlay = document.createElement('div'); overlay.className = 'co-scrim'; overlay.id = 'co-modal';
      const detail = modal.kind === 'issue' && brief && row
        ? rowHtml(s.recipient, esc(row.name) + ' · <span class="co-id">' + esc(row.personId) + '</span>')
        + rowHtml(s.action, esc(brief.label) + ' · <span class="co-id">' + esc(brief.id) + '</span>')
        + rowHtml(s.target, esc(brief.targetName))
        + (basis && basis.ok ? basis.basis.grants.map(g => rowHtml(s.grants, esc(g.grantId) + ' <span class="co-id">' + esc(short(g.version)) + '</span>')).join('')
          + rowHtml(s.compositeVersion, '<span class="co-id">' + esc(short(basis.basis.compositeVersion)) + '</span>') : '')
        + rowHtml(s.exclusions, esc(brief.exclusions.join(' · ')))
        : modal.kind === 'cancel' ? rowHtml('명령', esc(modal.orderId)) : '';
      const title = modal.kind === 'issue' ? s.confirmTitle : s.confirmCancelTitle;
      const actionLabel = modal.kind === 'issue' ? s.issue : s.requestCancelAction;
      const confirmAttr = modal.kind === 'issue' ? 'data-issue' : 'data-cancel-confirm';
      overlay.innerHTML = '<section class="co-dialog ui-panel" role="alertdialog" aria-modal="true" aria-labelledby="co-dialog-title">'
        + '<h2 id="co-dialog-title" class="co-heading">' + esc(title) + '</h2>'
        + (view.speed !== 0 ? '<p class="co-caption">' + esc(s.timeContinues) + '</p>' : '')
        + '<dl class="co-facts">' + detail + '</dl>'
        + '<div class="co-dialog__actions">'
        + '<button class="ui-button" type="button" data-modal-cancel>' + esc(s.cancelDraft) + '</button>'
        + '<button class="ui-button ui-button--primary" type="button" ' + confirmAttr + (submitting ? ' disabled' : '') + '>' + esc(actionLabel) + '</button></div></section>';
      parent.append(overlay);
      parent.querySelector('.co')?.setAttribute('inert', '');
      const cancel = overlay.querySelector<HTMLButtonElement>('[data-modal-cancel]')!;
      cancel.focus();
    }

    if (active) {
      const again = active.modalButton && modal
        ? parent.querySelector<HTMLElement>(active.modalButton === 'cancel' ? '[data-modal-cancel]' : modal.kind === 'issue' ? '[data-issue]' : '[data-cancel-confirm]')
        : active.pick ? parent.querySelector<HTMLElement>('[data-pick="' + CSS.escape(active.pick) + '"]')
        : active.id ? parent.querySelector<HTMLElement>('[data-back]') : null;
      again?.focus();
    }    q('[data-back]').addEventListener('click', () => { release(); options.onBack(); }, { signal });
    q('[data-cancel-draft]').addEventListener('click', () => { notice = null; draftCommandId = null; draftKey = ''; selectedOrderId = null; render(); }, { signal });
    [...parent.querySelectorAll<HTMLElement>('[data-scroll]')].forEach((el, index) => { el.scrollTop = scrolls[index] ?? 0; });
    lastSig = signature(app.view(actor.actorId), basis);
  }

  const signature = (view: ReturnType<CampaignApplication['view']>, basis: { readonly ok: true; readonly basis: { readonly compositeVersion: string } } | { readonly ok: false; readonly code: string } | null): string => JSON.stringify([
    selectedPersonId, rosterFilter, selectedOrderId, notice, modal && modal.kind, modal && modal.kind === 'cancel' ? modal.orderId : '', submitting,
    view.speed, view.orders.map(o => [o.orderId, o.stage, o.receivedAt, o.acceptedAt, o.cancellationPending]),
    basis ? (basis.ok ? 'ok:' + basis.basis.compositeVersion : 'no:' + basis.code) : '',
  ]);

  /** World tick: unchanged structure only updates the clock; any visible change re-renders with scroll kept. */
  function refresh(): void {
    const view = app.view(actor.actorId);
    const brief = briefFor(selectedRow() ?? { eligible: false, operationId: null });
    const basis = brief ? authorityNow(world, brief.id, content) : null;
    if (signature(view, basis) === lastSig) {
      const secs = String(Math.floor(view.worldMilliseconds / 1000));
      const out = parent.querySelector<HTMLElement>('[data-world-seconds]');
      if (out && out.getAttribute('data-world-seconds') !== secs) { out.setAttribute('data-world-seconds', secs); out.textContent = secs; }
      return;
    }
    render();
  }

  const unsubscribe = app.subscribe(state => { world = state; refresh(); });
  render();
  parent.querySelector<HTMLElement>('[data-pick]')?.focus();
  function release(): void { unsubscribe(); abort.abort(); }
  return { release };
}
