/// <reference types="../../engine/node_modules/vite/client" />
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { createCampaignE0, parseCampaignState } from '../../game/src/campaign/state.ts';
import { CampaignTab, attachCampaignLifecycle } from '../../game/src/campaign/tab.ts';
import { mountCampaignClock } from '../../game/ui/campaignClock.ts';
import { t } from '../../hosting/ui-strings.ts';
import manifest from '../../game/data/campaign/source-manifest.json?raw';
import atlas from '../../game/data/campaign/atlas.json?raw';
import identities from '../../game/data/campaign/identity-map.json?raw';
import scenario from '../../game/data/scenarios/townhall-s01-r1/scenario.json?raw';
import projection from '../../game/data/scenarios/townhall-s01-r1/projection.json?raw';
import operations from '../../game/data/scenarios/townhall-s01-r2/operations.json?raw';
import '../../hosting/unity-theme.css';
import './clock-fixture.css';

/** Early task 6 fixture, not the task 15 production entry or task 11 save adapter. */
const content = CampaignContent.parse({ manifest, atlas, identities, scenario, projection, operations });
const key = 'campaign-task6-clock:' + content.hashes.operations;
let selected = createCampaignE0(content);
const frame = document.createElement('main');
const heading = document.createElement('h1'); heading.textContent = t('ui.main-menu.heading');
const scope = document.createElement('p'); scope.textContent = 'S01 시계 검증 · 실제 승인 pack · 생산 화면 조립은 task 15';
const actions = document.createElement('nav');
const message = document.createElement('output'); message.setAttribute('aria-live', 'polite');
const tab = new CampaignTab({ key, content, locks: navigator.locks, now: () => performance.now(),
  readCheckpoint: () => selected,
  writeCheckpoint: state => { localStorage.setItem(key, JSON.stringify(state)); message.textContent = '저장 완료'; },
});
const action = (label: string, run: () => void | Promise<void>) => {
  const button = document.createElement('button'); button.textContent = label; button.className = 'ui-button ui-button--primary';
  button.onclick = async () => {
    try { await run(); } catch (error) {
      if (!(error instanceof Error)) throw error;
      message.textContent = error.message;
    }
  };
  actions.append(button);
};
action(t('ui.main-menu.new-game'), async () => { selected = createCampaignE0(content); message.textContent = await tab.takeOver() ? '새 세션 시작' : '다른 탭이 소유 중'; });
action(t('ui.main-menu.continue'), async () => {
  const bytes = localStorage.getItem(key);
  if (bytes === null) { message.textContent = t('ui.main-menu.save-status.empty'); return; }
  selected = parseCampaignState(JSON.parse(bytes), content);
  message.textContent = await tab.takeOver() ? '명시 저장에서 재개' : '다른 탭이 소유 중';
});
action('인수', async () => {
  const bytes = localStorage.getItem(key);
  if (bytes === null) { message.textContent = t('ui.main-menu.save-status.empty'); return; }
  selected = parseCampaignState(JSON.parse(bytes), content);
  message.textContent = await tab.takeOver() ? '명시 저장에서 인수' : '다른 탭이 소유 중';
});
action('저장', () => { tab.save(); });
frame.append(heading, scope, actions, message); document.body.append(frame);
const view = document.createElement('div'); frame.append(view);
let unmount = mountCampaignClock(view, tab);
action('보기 전환', () => { unmount(); unmount = mountCampaignClock(view, tab); });
attachCampaignLifecycle(tab, window);
tab.subscribe(() => {
  const state = tab.state;
  frame.dataset['status'] = tab.status;
  frame.dataset['speed'] = String(state?.clock.speed ?? 0);
  // Private fixture event: visible clock only, no privileged facts or writable debug object.
  window.dispatchEvent(new CustomEvent('campaign-clock', { detail: {
    worldMilliseconds: state?.clock.worldMilliseconds ?? 0, speed: state?.clock.speed ?? 0,
    status: tab.status, monotonic: performance.now(), visibility: document.visibilityState,
  } }));
});
