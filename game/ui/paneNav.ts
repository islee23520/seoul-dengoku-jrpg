/** Task26 §3 mobile pane navigation (task22 fix-1): at stacked widths exactly one pane group
 * is visible — the list (rows) OR the detail (center + right) — and returning to the list
 * restores the selected row and its scroll position. Desktop widths keep every pane: the bar
 * is hidden there and data-pane is inert. View Back/Escape handlers call unwind() first so
 * the topmost thing (an open detail pane on mobile) closes before the view itself navigates. */
export interface PaneNavHandle { readonly unwind: () => boolean; readonly showDetail: () => void; readonly current: () => 'list' | 'detail'; readonly release: () => void }

export function mountPaneNav(options: {
  readonly root: HTMLElement;
  readonly listPanes: readonly HTMLElement[];
  readonly detailPanes: readonly HTMLElement[];
  readonly listBody: HTMLElement | null;
  readonly labels: { readonly list: string; readonly detail: string };
  readonly initial?: 'list' | 'detail';
}): PaneNavHandle {
  const stacked = (): boolean => window.matchMedia('(max-width: 1000px)').matches;
  let pane: 'list' | 'detail' = options.initial ?? 'list';
  let listScroll = 0;
  const bar = document.createElement('nav');
  bar.className = 'cs-panes';
  bar.ariaLabel = '화면 전환';
  const listButton = document.createElement('button');
  listButton.type = 'button'; listButton.className = 'ui-button ui-button--menu cs-panes__button'; listButton.textContent = options.labels.list;
  const detailButton = document.createElement('button');
  detailButton.type = 'button'; detailButton.className = 'ui-button ui-button--menu cs-panes__button'; detailButton.textContent = options.labels.detail;
  bar.append(listButton, detailButton);
  options.root.prepend(bar);
  const apply = (): void => {
    options.root.dataset.pane = pane;
    listButton.setAttribute('aria-pressed', String(pane === 'list'));
    detailButton.setAttribute('aria-pressed', String(pane === 'detail'));
  };
  const show = (next: 'list' | 'detail', restoreFocus: boolean): void => {
    if (next === pane) return;
    if (pane === 'list' && options.listBody) listScroll = options.listBody.scrollTop;
    pane = next; apply();
    if (next === 'list' && options.listBody) {
      options.listBody.scrollTop = listScroll;
      if (restoreFocus) {
        const selected = options.listBody.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"], .is-selected');
        (selected ?? listButton).focus();
      }
    }
  };
  listButton.addEventListener('click', () => show('list', true));
  detailButton.addEventListener('click', () => show('detail', false));
  apply();
  return {
    unwind: (): boolean => {
      if (!stacked() || pane === 'list') return false;
      show('list', true);
      return true;
    },
    showDetail: (): void => { show('detail', false); },
    current: (): 'list' | 'detail' => pane,
    release: (): void => { bar.remove(); },
  };
}
