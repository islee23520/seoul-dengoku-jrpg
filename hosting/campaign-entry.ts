import { mountOpening } from './opening-flow.ts';
import { loadCampaignContent } from './campaign-content.ts';
import { ProductionCampaign, attachProductionLifecycle } from './campaign-runtime.ts';
import { mountCampaignViews } from './campaign-views.ts';
import { selectOpeningActor } from '../game/src/runtime/openingScenario.ts';

/** Default production entry: admission precedes lock acquisition and every runtime effect. */
export function mountProductionCampaign(parent: HTMLElement): void {
  let runtime: ProductionCampaign | null = null;
  let releaseLifecycle: (() => void) | null = null;
  async function start(mode: 'new' | 'saved'): Promise<void> {
    if (runtime?.active) return;
    const content = await loadCampaignContent(document.baseURI);
    const candidate = new ProductionCampaign({ content, storage: localStorage, locks: navigator.locks, now: () => performance.now() });
    try {
      if (!await candidate.start(mode)) {
        candidate.close();
        throw new Error('다른 탭이 캠페인을 진행 중이다. 읽기 전용이며 저장·명령은 사용할 수 없다. 기존 탭을 닫은 뒤 다시 이어간다.');
      }
      runtime = candidate;
      releaseLifecycle = attachProductionLifecycle(candidate, window);
    } catch (error) {
      candidate.close();
      throw error;
    }
  }
  function enter(actor: ReturnType<typeof selectOpeningActor>): void {
    if (!runtime) throw new Error('campaign-not-started');
    mountCampaignViews(parent, { runtime, actor, onTitle: title });
  }
  function title(): void {
    mountOpening(parent, async id => {
      const actor = selectOpeningActor(id);
      if (actor.actorId !== 'K002') throw new Error('이번 S01 캠페인은 이서담으로 시작한다. 백산석·성달현은 위임 수행자다.');
      if (runtime?.active) throw new Error('이미 진행 중인 캠페인이 있다. 이어하기로 돌아간다.');
      await start('new');
    }, { enter, live: runtime?.active ?? false, continue: async () => { await start('saved'); enter(selectOpeningActor('K002')); } });
  }
  title();
  window.addEventListener('pagehide', () => releaseLifecycle?.(), { once: true });
}

const parent = document.querySelector<HTMLElement>('#realtime');
if (parent) mountProductionCampaign(parent);
