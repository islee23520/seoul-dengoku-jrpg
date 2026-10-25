import { openingActors, selectOpeningActor, blockedOpeningActions, openingAdmission } from '../game/src/runtime/openingScenario.ts';

type Actor = (typeof openingActors)[number];
type Spawn = (id: unknown, surface: HTMLElement) => Promise<void>;

/** Unity flow ported from MainTitleCanvas / CharacterSelectLayer: title -> menu -> selection -> confirm -> world. */
export function mountOpening(parent: HTMLElement, spawn: Spawn): void {
  let screen: AbortController | null = null;
  const enter = (name: string, html: string): AbortSignal => {
    screen?.abort(); screen = new AbortController();
    parent.dataset.screen = name; parent.innerHTML = html;
    return screen.signal;
  };
  const el = <T extends HTMLElement>(selector: string): T => {
    const found = parent.querySelector<T>(selector);
    if (!found) throw new RangeError('Opening element missing: ' + selector);
    return found;
  };

  function title(): void {
    const signal = enter('title', '<section class="ui-title" aria-label="타이틀"><hr class="ui-title__rule">'
      + '<h1 class="ui-title__mark">서울:전국</h1><p class="ui-title__sub">Seoul Subway States</p>'
      + '<button class="ui-title__entry" type="button" id="title-enter">아무 키나 누르세요</button><hr class="ui-title__rule"></section>');
    el<HTMLButtonElement>('#title-enter').focus();
    const go = (): void => menu();
    parent.addEventListener('click', go, { signal, once: true });
    document.addEventListener('keydown', event => {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(event.key)) return;
      event.preventDefault(); go();
    }, { signal });
  }

  function menu(): void {
    const signal = enter('menu', '<section class="ui-menu ui-panel" role="dialog" aria-modal="true" aria-labelledby="menu-heading">'
      + '<h1 id="menu-heading" class="ui-menu__heading">서울:전국</h1>'
      + '<button class="ui-button ui-button--primary ui-menu__item" id="menu-new" type="button">새 게임</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>이어하기</button>'
      + '<p class="ui-menu__status">저장된 기록이 없다</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>설정</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>종료</button>'
      + '<button class="ui-button ui-button--menu ui-menu__item" type="button" disabled>열쇠</button>'
      + '<p class="ui-menu__note">준비 중인 항목</p>'
      + '<button class="ui-button ui-button--menu ui-menu__item" id="menu-back" type="button">뒤로</button></section>');
    const newGame = el<HTMLButtonElement>('#menu-new'), back = el<HTMLButtonElement>('#menu-back');
    const active = [newGame, back];
    const mark = (target: HTMLButtonElement): void => { for (const b of active) b.classList.toggle('is-selected', b === target); target.focus(); };
    for (const b of active) {
      b.addEventListener('focus', () => mark(b), { signal });
      b.addEventListener('pointerenter', () => mark(b), { signal });
    }
    newGame.addEventListener('click', () => selection(0), { signal });
    back.addEventListener('click', () => title(), { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); title(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') {
        event.preventDefault(); mark(document.activeElement === newGame ? back : newGame);
      }
    }, { signal });
    mark(newGame);
  }

  function selection(initial: number): void {
    const signal = enter('selection', '<div class="ui-select">'
      + '<header class="ui-select__header"><h1 class="ui-select__title" tabindex="-1">인물을 선택한다</h1>'
      + '<p class="ui-select__scenario">야간 배급 창구 · 신정2동 · 세 번째 급수계약 개막일</p>'
      + '<p class="ui-select__hint"><kbd class="ui-key-cap">↑</kbd><kbd class="ui-key-cap">↓</kbd> 인물</p></header>'
      + '<aside class="ui-select__dock ui-panel" aria-label="후보 인물"><p class="ui-select__count"></p><div class="ui-select__list" role="listbox" aria-label="개막 인물"></div></aside>'
      + '<div class="ui-select__stage"><p>캠페인 지도는 아직 연결되지 않았다. 시작 위치는 오른쪽 상세에 표시한다.</p></div>'
      + '<section class="ui-select__dock ui-select__detail ui-panel" aria-live="polite" aria-label="선택한 인물"><div class="ui-select__bio"></div>'
      + '<p class="ui-select__source">인물 원문 draft · current-reviewed / 이 시나리오 시작 승인 / 공개 게시 미승인</p>'
      + '<footer class="ui-select__actions"><button class="ui-button ui-button--menu" id="select-back" type="button"><kbd class="ui-key-cap">Esc</kbd> 뒤로</button>'
      + '<button class="ui-button ui-button--primary" id="select-confirm" type="button"><kbd class="ui-key-cap ui-key-cap--on-primary">Enter</kbd> 이 인물로 시작한다</button></footer>'
      + '<output class="ui-select__status" role="status"></output></section></div>');
    const list = el('.ui-select__list'), bio = el('.ui-select__bio'), status = el<HTMLOutputElement>('.ui-select__status');
    el('.ui-select__count').textContent = openingActors.length + '명';
    let selected = initial; let dialog: AbortController | null = null; let preparing = false;
    const cards = openingActors.map((actor, index) => {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'ui-card'; card.setAttribute('role', 'option'); card.dataset.actor = actor.actorId;
      const name = document.createElement('span'); name.className = 'ui-card__name'; name.textContent = actor.name;
      const role = document.createElement('span'); role.className = 'ui-card__title'; role.textContent = actor.title;
      const meta = document.createElement('span'); meta.className = 'ui-card__meta'; meta.textContent = actor.place;
      name.append(' ', role); card.append(name, meta);
      card.addEventListener('click', () => { if (selected === index) openConfirm(); else select(index, true); }, { signal });
      list.append(card); return card;
    });
    const fact = (label: string, value: string): string => '<div class="ui-fact"><dt>' + label + '</dt><dd>' + value + '</dd></div>';
    const text = (value: string): string => { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; };
    function render(actor: Actor): void {
      bio.innerHTML = '<h2 class="ui-select__name">' + text(actor.name) + '</h2><p class="ui-select__role">' + text(actor.title) + '</p>'
        + '<p class="ui-select__place">' + text(actor.place) + '</p><dl class="ui-select__facts">'
        + fact('시작 지도', text(actor.mapId)) + fact('시작 칸', '(' + actor.tile.x + ', ' + actor.tile.y + ')')
        + fact('방향', text(actor.facing)) + fact('직속 주군', text(actor.liege)) + '</dl>';
    }
    function select(index: number, focus: boolean): void {
      selected = (index + cards.length) % cards.length;
      cards.forEach((card, i) => { card.classList.toggle('is-selected', i === selected); card.setAttribute('aria-selected', String(i === selected)); card.tabIndex = i === selected ? 0 : -1; });
      render(openingActors[selected]);
      if (focus) cards[selected].focus();
    }
    function openConfirm(): void {
      if (dialog || preparing) return;
      const actor = openingActors[selected];
      dialog = new AbortController();
      const restore = document.activeElement instanceof HTMLElement ? document.activeElement : cards[selected];
      const overlay = document.createElement('div'); overlay.className = 'ui-scrim';
      overlay.innerHTML = '<section class="ui-dialog ui-panel" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-summary">'
        + '<h2 id="dialog-title" class="ui-dialog__title"></h2><dl id="dialog-summary" class="ui-select__facts"></dl>'
        + '<div class="ui-dialog__actions"><button class="ui-button ui-button--menu" type="button" data-cancel>취소</button>'
        + '<button class="ui-button ui-button--primary" type="button" data-start>시작한다</button></div></section>';
      overlay.querySelector('#dialog-title')!.textContent = actor.name + '(으)로 시작한다';
      overlay.querySelector('#dialog-summary')!.innerHTML = fact('직위', text(actor.title)) + fact('시작', text(actor.place) + ' · ' + text(actor.mapId) + ' (' + actor.tile.x + ', ' + actor.tile.y + ')');
      const cancel = overlay.querySelector<HTMLButtonElement>('[data-cancel]')!, start = overlay.querySelector<HTMLButtonElement>('[data-start]')!;
      const close = (): void => { dialog?.abort(); dialog = null; overlay.remove(); restore.focus(); };
      cancel.addEventListener('click', close, { signal: dialog.signal });
      start.addEventListener('click', () => { overlay.remove(); dialog?.abort(); dialog = null; void begin(actor.actorId); }, { signal: dialog.signal });
      overlay.addEventListener('click', event => { if (event.target === overlay) close(); }, { signal: dialog.signal });
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'Tab' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); (document.activeElement === cancel ? start : cancel).focus();
        }
      }, { signal: dialog.signal });
      parent.append(overlay); cancel.focus();
    }
    async function begin(id: string): Promise<void> {
      if (preparing) return;
      preparing = true;
      try {
        const actor = selectOpeningActor(id);
        el<HTMLButtonElement>('#select-confirm').disabled = true;
        status.textContent = '시나리오 지도를 불러오는 중';
        const surface = document.createElement('section'); surface.id = 'scenario-world';
        await spawn(actor.actorId, surface);
        world(actor, surface);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        preparing = false;
        status.textContent = '선택 거부: ' + error.message;
        el<HTMLButtonElement>('#select-confirm').disabled = false;
      }
    }
    el('#select-back').addEventListener('click', () => { if (!preparing) menu(); }, { signal });
    el('#select-confirm').addEventListener('click', openConfirm, { signal });
    document.addEventListener('keydown', event => {
      if (dialog || event.defaultPrevented) return;
      if (preparing) { if (event.key === 'Escape' || event.key === 'Enter') event.preventDefault(); return; }
      const onCard = cards.includes(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); menu(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); select(selected + (event.key === 'ArrowDown' ? 1 : -1), true); }
      else if (event.key === 'Enter' && (onCard || document.activeElement === document.body)) { event.preventDefault(); openConfirm(); }
    }, { signal });
    select(initial, true);
  }

  function world(actor: Actor, surface: HTMLElement): void {
    screen?.abort(); screen = null;
    parent.dataset.screen = 'world';
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
  }

  title();
}
