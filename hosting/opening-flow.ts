import { openingActors, selectOpeningActor, blockedOpeningActions, openingAdmission } from '../game/src/runtime/openingScenario.ts';

export function mountOpening(parent: HTMLElement, spawn: (id: unknown, surface: HTMLElement) => Promise<void>): void {
  parent.innerHTML = '<header class="opening-title"><p class="eyebrow">서울 등국 · 2126</p><h1>야간 배급 창구</h1></header><p>신정2동 · 세 번째 급수계약 개막일</p><button class="primary" id="begin">시작하기</button>';
  parent.querySelector('button')?.addEventListener('click', () => {
    parent.innerHTML = '<h1 tabindex="-1">인물 선택</h1><p class="source-state">인물 원문 draft · current-reviewed / 이 시나리오 시작 승인 / 공개 게시 미승인</p><form><fieldset><legend>개막 인물과 배치</legend></fieldset><button class="primary" type="submit">선택한 인물로 시작</button></form><output role="status" aria-live="polite"></output>';
    const form = parent.querySelector('form');
    const fieldset = parent.querySelector('fieldset');
    const status = parent.querySelector('output');
    if (!form || !fieldset || !status) throw new RangeError('Opening form missing');
    for (const actor of openingActors) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'actor'; radio.value = actor.actorId; radio.required = true;
      const text = document.createElement('span');
      text.textContent = actor.actorId + ' ' + actor.name + ' · ' + actor.title;
      const detail = document.createElement('small');
      detail.textContent = actor.place + ' · ' + actor.mapId + ' (' + actor.tile.x + ', ' + actor.tile.y + ') · ' + actor.facing + ' · 주군 ' + actor.liege;
      text.append(detail); label.append(radio, text); fieldset.append(label);
    }
    parent.querySelector('h1')?.focus();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const actor = selectOpeningActor(new FormData(form).get('actor'));
        form.querySelector('button')?.setAttribute('disabled', '');
        status.textContent = '시나리오 지도를 불러오는 중';
        const surface = document.createElement('section'); surface.id = 'scenario-world';
        await spawn(actor.actorId, surface);
        parent.replaceChildren();
        const title = document.createElement('h1'); title.textContent = actor.name + ' · ' + actor.place;
        const placement = document.createElement('output');
        placement.id = 'spawn-state'; placement.textContent = actor.mapId + ' (' + actor.tile.x + ', ' + actor.tile.y + ') · ' + actor.facing;
        const appearance = document.createElement('p'); appearance.textContent = '외형 미승인: 지도 위 이름으로 인물 위치를 표시합니다.';
        const heading = document.createElement('h2'); heading.textContent = '입력 미승인으로 차단된 행동';
        const list = document.createElement('ul'); list.id = 'blocked-actions';
        for (const gap of blockedOpeningActions) {
          const row = document.createElement('li'); row.dataset.action = gap.action; row.dataset.gap = gap.input;
          const button = document.createElement('button'); button.disabled = true; button.textContent = gap.action;
          const reason = document.createElement('small'); reason.textContent = gap.input + ' · ' + gap.category;
          row.append(button, reason); list.append(row);
        }
        parent.dataset.scenario = openingAdmission.scenarioId; parent.dataset.actor = actor.actorId;
        parent.append(title, placement, surface, appearance, heading, list);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        status.textContent = '선택 거부: ' + error.message;
        form.querySelector('button')?.removeAttribute('disabled');
      }
    });
  });
}
