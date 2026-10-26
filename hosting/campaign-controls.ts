import type { ProductionCampaign } from './campaign-runtime.ts';

declare const __CAMPAIGN_BUILD_ID__: string;

export function mountCampaignControls(parent: HTMLElement, runtime: ProductionCampaign): { readonly release: () => void } {
  const abort = new AbortController();
  const bar = document.createElement('nav'); bar.className = 'campaign-session'; bar.ariaLabel = '캠페인 저장과 정보, 테마';
  const status = document.createElement('output'); status.setAttribute('role', 'status');
  const save = document.createElement('button'); save.className = 'ui-button'; save.textContent = '저장 · 불러오기';
  const info = document.createElement('button'); info.className = 'ui-button'; info.textContent = '캠페인 정보';
  const themeLabel = document.createElement('label'); themeLabel.className = 'ui-theme-control';
  themeLabel.append('테마');
  const theme = document.createElement('select'); theme.className = 'ui-theme-select';
  for (const [value, text] of [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = text; theme.append(option);
  }
  const currentTheme = document.documentElement.dataset.uiTheme;
  theme.value = currentTheme === 'dark' || currentTheme === 'light' ? currentTheme : 'system';
  theme.addEventListener('change', () => {
    if (theme.value === 'system') delete document.documentElement.dataset.uiTheme;
    else document.documentElement.dataset.uiTheme = theme.value;
  }, { signal: abort.signal });
  themeLabel.append(theme);
  save.addEventListener('click', () => {
    // The actual save/load surface (task22 wave2) owns saving, review and confirmations.
    parent.dispatchEvent(new CustomEvent('campaign:open-saves', { bubbles: true }));
  }, { signal: abort.signal });
  let dialog: HTMLDialogElement | null = null;
  info.addEventListener('click', () => {
    dialog = document.createElement('dialog'); dialog.className = 'campaign-info ui-panel';
    const heading = document.createElement('h2'); heading.textContent = '캠페인 정보';
    const body = document.createElement('div'); body.className = 'campaign-info__body';
    const identity = document.createElement('p'); identity.textContent = '빌드 ' + __CAMPAIGN_BUILD_ID__;
    const scope = document.createElement('p'); scope.textContent = 'S01 한정 · 이서담 · 단일 진행 탭. 마지막 명시 저장만 복구하며 닫힌 동안 시간은 적립하지 않는다.';
    const hashes = document.createElement('dl');
    for (const [name, value] of Object.entries(runtime.content.hashes)) {
      const term = document.createElement('dt'); term.textContent = name;
      const detail = document.createElement('dd'); detail.textContent = value; hashes.append(term, detail);
    }
    const preview = document.createElement('a'); preview.href = './legacy/index.html'; preview.textContent = '이전 역 지도 미리보기 (별도 탐색)';
    preview.target = '_blank'; preview.rel = 'noopener';
    const close = document.createElement('button'); close.className = 'ui-button'; close.textContent = '닫기';
    close.addEventListener('click', () => dialog?.close(), { signal: abort.signal });
    body.append(identity, scope, hashes, preview); dialog.append(heading, body, close);
    dialog.addEventListener('close', () => { dialog?.remove(); dialog = null; info.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); close.focus();
  }, { signal: abort.signal });
  // Views replace their own DOM during state updates; session controls are page-owned.
  bar.append(save, info, themeLabel, status); document.body.append(bar);
  return { release: () => { abort.abort(); dialog?.remove(); bar.remove(); } };
}
