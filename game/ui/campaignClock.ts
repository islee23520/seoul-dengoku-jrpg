import type { CampaignTab } from '../src/campaign/tab.ts';
import type { PeaceSpeed } from '../src/campaign/session.ts';

/** Game-owned controls. Unity theme primitives; mounting is presentation-only. */
export function mountCampaignClock(parent: HTMLElement, tab: CampaignTab): () => void {
  const panel = document.createElement('section'); panel.className = 'ui-panel campaign-clock';
  panel.setAttribute('aria-label', '세계 시간');
  const time = document.createElement('output'); time.dataset['worldMilliseconds'] = '0';
  const controls = document.createElement('div'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '평시 배속');
  const buttons = new Map<PeaceSpeed, HTMLButtonElement>();
  for (const speed of [0, 1, 2, 4] as const) {
    const button = document.createElement('button'); button.className = 'ui-button';
    button.textContent = speed === 0 ? '정지' : speed + 'x';
    button.onclick = () => tab.setSpeed(speed);
    buttons.set(speed, button); controls.append(button);
  }
  const status = document.createElement('p');
  const lifecycle = document.createElement('p');
  lifecycle.textContent = '열린 탭의 단조 경과만 반영합니다. 기술적 중단 뒤에는 재개 시 따라잡습니다. 종료 뒤 시간은 적립하지 않으며, 미저장 진행은 복구하지 않습니다.';
  panel.append(time, controls, status, lifecycle); parent.append(panel);
  const render = () => {
    const state = tab.state;
    time.textContent = state ? (state.clock.worldMilliseconds / 1000).toFixed(3) + ' 세계초' : '실행 중인 세션 없음';
    time.dataset['worldMilliseconds'] = String(state?.clock.worldMilliseconds ?? 0);
    status.textContent = tab.status === 'writer' ? '현재 탭이 시간 진행을 소유합니다.' : '읽기 전용 · 다른 탭을 닫은 뒤 명시적으로 인수하세요.';
    for (const [speed, button] of buttons) {
      button.disabled = tab.status !== 'writer';
      button.setAttribute('aria-pressed', String(state?.clock.speed === speed));
    }
  };
  const release = tab.subscribe(render); render();
  return () => { release(); panel.remove(); };
}
