/// <reference types="../../engine/node_modules/vite/client" />
/// <reference path="./campaign-negative-states.d.ts" />
/** Private readonly negative-state viewer. Only this QA HTML imports the virtual seed module.
 * Browser automation reads ordinary labels, production DOM and visible causal receipts; no
 * global handle, custom event payload, hidden state attribute or production debug ingress. */
import fixture from 'virtual:campaign-negative-states';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { CampaignApplication } from '../../game/src/campaign/application.ts';
import { parseCampaignState } from '../../game/src/campaign/state.ts';
import { mountCampaignOrders } from '../../game/ui/campaignOrders.ts';
import { mountCampaignSettlement, buildSettlementView } from '../../game/ui/campaignSettlement.ts';
import { mountCampaignReports } from '../../game/ui/campaignReports.ts';
import { selectOpeningActor } from '../../game/src/runtime/openingScenario.ts';
import manifest from '../../game/data/campaign/source-manifest.json?raw';
import atlas from '../../game/data/campaign/atlas.json?raw';
import identities from '../../game/data/campaign/identity-map.json?raw';
import scenario from '../../game/data/scenarios/townhall-s01-r1/scenario.json?raw';
import projection from '../../game/data/scenarios/townhall-s01-r1/projection.json?raw';
import operations from '../../game/data/scenarios/townhall-s01-r2/operations.json?raw';
import '../../hosting/unity-theme.css';
import '../../hosting/campaign-orders.css';
import '../../hosting/campaign-settlement.css';
import './campaign-negative-fixture.css';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
freeze(fixture);
const content = CampaignContent.parse({ manifest, atlas, identities, scenario, projection, operations });
const actor = selectOpeningActor('K002');
const frame = document.createElement('main'); frame.id = 'negative-fixture';
frame.innerHTML = '<header class="nfx-header"><h1>비공개 음성 QA · 읽기 전용</h1>'
  + '<p>정상 게임 진행이 아니다. 상태 생성 경로와 실제 경계 거부를 아래에 표시한다.</p>'
  + '<nav id="nfx-cases" aria-label="QA 상태 선택"></nav>'
  + '<label class="nfx-theme-label">화면 테마 <select id="nfx-theme"><option value="dark">어두운 테마</option><option value="light">밝은 테마</option></select></label>'
  + '<p id="nfx-kind"></p><p id="nfx-note"></p>'
  + '<output id="nfx-receipt" aria-live="polite"></output>'
  + '<nav id="nfx-actions" aria-label="읽기 전용 상세 선택"></nav>'
  + '<output id="nfx-assertion" aria-live="polite"></output></header>'
  + '<section id="realtime" class="nfx-stage" aria-label="생산 화면 · 읽기 전용 QA"></section>';
document.body.append(frame);
function required<T extends HTMLElement>(selector: string): T {
  const element = frame.querySelector<T>(selector);
  if (!element) throw new Error('Missing private fixture control: ' + selector);
  return element;
}
const controls = required<HTMLElement>('#nfx-cases');
const actions = required<HTMLElement>('#nfx-actions');
const stage = required<HTMLElement>('#realtime');
const receipt = required<HTMLOutputElement>('#nfx-receipt');
const assertion = required<HTMLOutputElement>('#nfx-assertion');
const theme = required<HTMLSelectElement>('#nfx-theme');
const parameters = new URLSearchParams(location.search);
theme.value = parameters.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.uiTheme = theme.value;
theme.addEventListener('change', () => { document.documentElement.dataset.uiTheme = theme.value; });
let release: (() => void) | null = null;
let app: CampaignApplication | null = null;
let activeCase = '';
let inspectReport: (() => void) | null = null;
function button(label: string, id: string, run: () => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button'; control.className = 'ui-button'; control.textContent = label; control.id = id;
  control.addEventListener('click', run); return control;
}
// Disable world-changing production controls, not list/detail selection or mobile pane navigation.
// The actual production app remains unmodified; its clock uses a fixed monotonic sample.
const mutations = '[data-review],[data-issue],[data-cancel-request],[data-cancel-confirm],[data-speed],#cs-command';
function lockMutationControls(): void {
  for (const control of stage.querySelectorAll<HTMLButtonElement>(mutations)) {
    control.disabled = true; control.title = '비공개 QA 체크포인트: 게임 상태 변경 불가';
  }
}
const observer = new MutationObserver(lockMutationControls);
observer.observe(stage, { childList: true, subtree: true });
stage.addEventListener('click', event => {
  if (event.target instanceof Element && event.target.closest(mutations)) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, { capture: true });
stage.addEventListener('click', () => { if (inspectReport) queueMicrotask(inspectReport); });

function mountCase(id: string): void {
  release?.(); release = null; app?.close(); app = null;
  inspectReport = null; stage.replaceChildren(); actions.replaceChildren(); assertion.textContent = '';
  const entry = fixture.cases.find(candidate => candidate.id === id);
  const selected = entry ?? fixture.reports;
  activeCase = selected.id; frame.dataset.case = activeCase;
  for (const control of controls.querySelectorAll<HTMLButtonElement>('[data-case]')) control.setAttribute('aria-pressed', String(control.dataset.case === activeCase));
  required('#nfx-kind').textContent = selected.mode === 'real-domain'
    ? '실제 도메인 API · 음성 체크포인트 / 생산 화면 · 읽기 전용'
    : 'UI 전용 음성 스냅숏 · 읽기 전용 / 실제 새 수신 이력 아님';
  required('#nfx-note').textContent = selected.note;
  receipt.textContent = '인과 영수: ' + selected.receipt;
  const back = (): void => { assertion.textContent = 'QA 표본 유지 — 다른 상태는 위의 이름 붙은 선택 버튼으로 연다.'; };
  if (entry) {
    const state = parseCampaignState(entry.state, content);
    if (entry.screen === 'orders') {
      app = new CampaignApplication({ content, state, now: () => 0 });
      release = mountCampaignOrders(stage, { app, content, actor, onBack: back }).release;
      if (state.mandates.length) {
        const orderId = state.mandates[0]!.orderId;
        const open = (): void => {
          // Existing production list/detail interaction only; no gameplay mutation or private handle.
          stage.querySelector<HTMLButtonElement>('[data-pick="K568"]')?.click();
          stage.querySelector<HTMLButtonElement>('[data-order="' + CSS.escape(orderId) + '"]')?.click();
        };
        actions.append(button('자기 명령 상세 열기', 'nfx-open-order', open));
        open();
      }
    } else {
      release = mountCampaignSettlement(stage, {
        snapshot: () => buildSettlementView(state, content, 'K002'), subscribe: () => () => {},
        onBack: back, onOpenReports: () => mountCase('reports-older'),
      }).release;
    }
  } else {
    const reports = fixture.reports;
    inspectReport = (): void => {
      const old = reports.inbox.rows.find(row => row.reportId === reports.oldReportId);
      if (!old || !Object.isFrozen(old) || !Object.isFrozen(old.evidence.lines) || JSON.stringify(old) !== reports.oldPayload)
        throw new Error('Readonly old report payload changed');
      const selectedRow = stage.querySelector<HTMLButtonElement>('[data-report][aria-pressed="true"]');
      if (selectedRow?.dataset.report === reports.oldReportId) {
        const detail = stage.querySelector('#cr-detail')?.textContent ?? '';
        if (!old.evidence.lines.every(line => detail.includes(line)) || detail.includes('QA 전용 후속 판본 표식'))
          throw new Error('Old report detail was replaced by the later snapshot');
      }
      assertion.textContent = '불변 확인: 이전 수신 행의 원본 JSON·판본·증거 유지 / 새 행을 열어도 이전 payload 변경 없음';
    };
    release = mountCampaignReports(stage, {
      snapshot: () => reports.inbox, subscribe: () => () => {}, onBack: back, onOpenCommand: null,
    }).release;
    for (const row of reports.inbox.rows) {
      const open = (): void => {
        stage.querySelector<HTMLButtonElement>('[data-report="' + CSS.escape(row.reportId) + '"]')?.click();
        inspectReport?.();
      };
      actions.append(button(row.reportId === reports.oldReportId ? '이전 수신 판본 열기' : '후속 QA 판본 열기',
        row.reportId === reports.oldReportId ? 'nfx-open-old-report' : 'nfx-open-new-report', open));
    }
    actions.querySelector<HTMLButtonElement>('#nfx-open-old-report')?.click();
  }
  lockMutationControls();
}
for (const entry of [...fixture.cases, fixture.reports]) {
  const control = button(entry.label, 'nfx-case-' + entry.id, () => mountCase(entry.id));
  control.dataset.case = entry.id; controls.append(control);
}
try { mountCase(parameters.get('case') ?? fixture.cases[0]!.id); }
catch (error) {
  assertion.textContent = 'QA 오류: ' + (error instanceof Error ? error.message : String(error));
  assertion.setAttribute('role', 'alert'); throw error;
}
