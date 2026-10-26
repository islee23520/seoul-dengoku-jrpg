/** Task26 §3 mobile list/detail navigation. Snapshot only client presentation state; it never
 * changes selected domain entities, the world clock, or authority. Desktop keeps every pane. */
export interface PaneNavSnapshot {
  readonly mode: 'list' | 'detail';
  readonly selectedId?: string;
  readonly listScrollTop: number;
  readonly focusRef?: string;
}
export interface PaneNavHandle {
  readonly unwind: () => boolean;
  readonly showDetail: () => void;
  readonly current: () => 'list' | 'detail';
  readonly snapshot: () => PaneNavSnapshot;
  readonly restore: (snapshot: PaneNavSnapshot) => void;
  readonly release: () => void;
}

const selectedSelector = '[aria-pressed="true"], [aria-selected="true"], .is-selected';
/** Explicit data-pane-id is preferred; existing callers retain their stable row identities. */
const rowId = (row: HTMLElement): string | undefined => row.dataset.paneId ?? (row.id || undefined)
  ?? row.dataset.pick ?? row.dataset.report ?? row.dataset.actor ?? row.dataset.checkpoint
  ?? row.dataset.optionId ?? row.dataset.pointer ?? row.dataset.option ?? row.dataset.work;

export function mountPaneNav(options: {
  readonly root: HTMLElement;
  readonly listPanes: readonly HTMLElement[];
  readonly detailPanes: readonly HTMLElement[];
  readonly listBody: HTMLElement | null;
  readonly labels: { readonly list: string; readonly detail: string };
  readonly initial?: 'list' | 'detail';
  readonly initialState?: PaneNavSnapshot;
}): PaneNavHandle {
  const doc = options.root.ownerDocument;
  const view = doc.defaultView;
  let pane: 'list' | 'detail' = options.initial ?? 'list';
  let listScroll = options.listBody?.scrollTop ?? 0;
  let frame: number | null = null;
  let released = false;
  const bar = doc.createElement('nav');
  bar.className = 'cs-panes'; bar.ariaLabel = '화면 전환';
  const listButton = doc.createElement('button');
  listButton.type = 'button'; listButton.className = 'ui-button ui-button--menu cs-panes__button';
  listButton.textContent = options.labels.list; listButton.dataset.paneBack = '';
  const detailButton = doc.createElement('button');
  detailButton.type = 'button'; detailButton.className = 'ui-button ui-button--menu cs-panes__button';
  detailButton.textContent = options.labels.detail;
  bar.append(listButton, detailButton); options.root.prepend(bar);
  const stacked = (): boolean => bar.offsetParent !== null;
  const selectedRow = (): HTMLElement | null => options.listBody?.querySelector<HTMLElement>(selectedSelector) ?? null;
  const findRow = (id: string): HTMLElement | undefined => [...(options.listBody?.querySelectorAll<HTMLElement>('button, [role="option"], [data-pane-id]') ?? [])].find(row => rowId(row) === id);
  const apply = (): void => {
    options.root.dataset.pane = pane;
    listButton.setAttribute('aria-pressed', String(pane === 'list'));
    detailButton.setAttribute('aria-pressed', String(pane === 'detail'));
    listButton.setAttribute('aria-label', pane === 'detail' ? options.labels.list + ' · 뒤로' : options.labels.list);
  };
  const focusPane = (): void => {
    if (!stacked()) return;
    (pane === 'detail' ? listButton : selectedRow() ?? listButton).focus({ preventScroll: true });
  };
  const show = (next: 'list' | 'detail', restoreFocus: boolean): void => {
    if (next === pane) return;
    if (pane === 'list' && options.listBody) listScroll = options.listBody.scrollTop;
    pane = next; apply();
    if (next === 'list' && options.listBody) options.listBody.scrollTop = listScroll;
    if (restoreFocus) focusPane();
  };
  const restore = (snapshot: PaneNavSnapshot): void => {
    if (frame !== null && view) view.cancelAnimationFrame(frame);
    const row = snapshot.selectedId === undefined ? undefined : findRow(snapshot.selectedId);
    const stale = snapshot.selectedId !== undefined && !row;
    pane = stale ? 'list' : snapshot.mode;
    listScroll = stale ? 0 : snapshot.listScrollTop;
    if (row && options.listBody) {
      for (const candidate of options.listBody.querySelectorAll<HTMLElement>(selectedSelector)) {
        if (candidate === row) continue;
        if (candidate.hasAttribute('aria-pressed')) candidate.setAttribute('aria-pressed', 'false');
        if (candidate.hasAttribute('aria-selected')) candidate.setAttribute('aria-selected', 'false');
        candidate.classList.remove('is-selected');
      }
      if (row.hasAttribute('aria-pressed')) row.setAttribute('aria-pressed', 'true');
      if (row.hasAttribute('aria-selected')) row.setAttribute('aria-selected', 'true');
    }
    apply();
    const afterAttach = (): void => {
      frame = null;
      if (released || !options.root.isConnected) return;
      if (options.listBody) options.listBody.scrollTop = listScroll;
      // A removed row must never restore focus to a stale identity.
      const active = doc.activeElement;
      if (options.root.hasAttribute('inert') || doc.querySelector('[aria-modal="true"]')) return;
      if (active && options.root.contains(active) && active !== listButton && active !== detailButton
        && !(pane === 'detail' && options.listPanes.some(list => list.contains(active)))) return;
      if (stale) { if (stacked()) listButton.focus({ preventScroll: true }); }
      else focusPane();
    };
    if (view) frame = view.requestAnimationFrame(afterAttach);
    else afterAttach();
  };
  listButton.addEventListener('click', () => show('list', true));
  detailButton.addEventListener('click', () => show('detail', true));
  apply();
  if (options.initialState) restore(options.initialState);
  return {
    unwind: (): boolean => {
      if (!stacked() || pane === 'list') return false;
      show('list', true); return true;
    },
    showDetail: (): void => { show('detail', true); },
    current: (): 'list' | 'detail' => pane,
    snapshot: (): PaneNavSnapshot => {
      const selectedId = selectedRow() ? rowId(selectedRow()!) : undefined;
      const active = doc.activeElement;
      const focusRef = active === listButton ? 'pane-back' : active === detailButton ? 'pane-detail'
        : active && options.root.contains(active) ? rowId(active as HTMLElement) : undefined;
      return { mode: pane, ...(selectedId === undefined ? {} : { selectedId }),
        listScrollTop: pane === 'list' ? options.listBody?.scrollTop ?? listScroll : listScroll,
        ...(focusRef === undefined ? {} : { focusRef }) };
    },
    restore,
    release: (): void => {
      released = true;
      if (frame !== null && view) view.cancelAnimationFrame(frame);
      bar.remove();
    },
  };
}
