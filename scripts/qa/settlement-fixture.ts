/// <reference types="../../engine/node_modules/vite/client" />
/** Task14 settlement/reports QA fixture (not the task15 production entry). Real admitted pack,
 * real CampaignApplication with the task8 command ingress and task6 clock; commands are issued
 * through the same production ingress the CLI uses. Screens are the production view modules. */
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { createCampaignE0 } from '../../game/src/campaign/state.ts';
import { CampaignApplication } from '../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { CampaignBoundaryError } from '../../game/src/campaign/errors.ts';
import { selectOpeningActor } from '../../game/src/runtime/openingScenario.ts';
import { mountCampaignMap } from '../../game/ui/campaignMap.ts';
import { mountCampaignSettlement, buildSettlementView, describeReason } from '../../game/ui/campaignSettlement.ts';
import { mountCampaignReports, buildInboxView } from '../../game/ui/campaignReports.ts';
import mapViewRaw from '../../game/data/campaign/map-view.json?raw';
import identityMapRaw from '../../game/data/campaign/identity-map.json?raw';
import manifest from '../../game/data/campaign/source-manifest.json?raw';
import atlas from '../../game/data/campaign/atlas.json?raw';
import identities from '../../game/data/campaign/identity-map.json?raw';
import scenario from '../../game/data/scenarios/townhall-s01-r1/scenario.json?raw';
import projection from '../../game/data/scenarios/townhall-s01-r1/projection.json?raw';
import operations from '../../game/data/scenarios/townhall-s01-r2/operations.json?raw';
import '../../hosting/unity-theme.css';
import '../../hosting/campaign-map.css';
import '../../hosting/campaign-settlement.css';
import './settlement-fixture.css';

const content = CampaignContent.parse({ manifest, atlas, identities, scenario, projection, operations });
const actor = selectOpeningActor('K002');
const app = new CampaignApplication({ content, state: createCampaignE0(content), now: () => performance.now() });

const frame = document.createElement('main'); frame.id = 'realtime';
const controls = document.createElement('nav'); controls.className = 'sfx-controls'; controls.setAttribute('aria-label', 'QA 하니스 조작');
const message = document.createElement('output'); message.className = 'sfx-message'; message.setAttribute('aria-live', 'polite');
const stage = document.createElement('div'); stage.className = 'sfx-stage';
const h1 = document.createElement('h1'); h1.textContent = '정착지 집행·수신 보고함 QA 하니스 (task14)';
const note = document.createElement('p'); note.textContent = '실제 승인 pack · 생산 진입점 조립은 task 15';
frame.append(h1, note, controls, message, stage); document.body.append(frame);

let screen: 'map' | 'settlement' | 'reports' =
  (new URLSearchParams(location.search).get('screen') as 'map' | 'settlement' | 'reports' | null) ?? 'map';
let release: (() => void) | null = null;
/** Latest world state is captured right after each interval reconcile; snapshots never re-enter
 * reconcile (the session publishes on every reconcile, so a checkpoint inside a subscriber loop would recurse). */
let latest = createCampaignE0(content);
const state = (): typeof latest => latest;
function render(): void {
  try {
    renderScreen();
  } catch (error) {
    // QA harness surfaces real errors in place; never swallow them.
    message.textContent = '화면 오류: ' + (error instanceof Error ? error.message + ' @ ' + String(error.stack).slice(0, 300) : String(error));
    console.error('[settlement-fixture] render failed', error);
  }
}
function renderScreen(): void {
  release?.(); release = null; stage.replaceChildren();
  if (screen === 'map') {
    const map = mountCampaignMap(stage, {
      view: JSON.parse(mapViewRaw), identity: JSON.parse(identityMapRaw), actor,
      onBack: () => { screen = 'map'; render(); },
      onOpenSite: () => { screen = 'settlement'; render(); },
      onOpenReports: () => { screen = 'reports'; render(); },
    });
    release = map.release;
  } else if (screen === 'settlement') {
    const handle = mountCampaignSettlement(stage, {
      snapshot: () => buildSettlementView(state(), content, 'K002'),
      subscribe: listener => app.subscribe(listener), onBack: () => { screen = 'map'; render(); }, onOpenReports: () => { screen = 'reports'; render(); },
    });
    release = handle.release;
  } else {
    const handle = mountCampaignReports(stage, {
      snapshot: () => buildInboxView(state(), content, 'K002'),
      subscribe: listener => app.subscribe(listener), onBack: () => { screen = 'map'; render(); }, onOpenCommand: null,
    });
    release = handle.release;
  }
  frame.dataset.screen = screen;
}

const button = (label: string, run: () => void): HTMLButtonElement => {
  const element = document.createElement('button'); element.type = 'button';
  element.className = 'ui-button ui-button--menu'; element.textContent = label;
  element.addEventListener('click', run); return element;
};
/** The same production ingress the s01-sequential CLI uses; no fixture-only command path.
 * A stale-version refusal between checkpoint and submit is re-reviewed with the fresh revision. */
function issue(operation: 'S01-L' | 'S01-O'): void {
  let resumeSpeed: 0 | 1 | 2 | 4 = 0;
  let paused = false;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const state = app.checkpoint();
        const wasRunning = state.clock.speed !== 0;
        resumeSpeed = state.clock.speed === 0 ? 1 : state.clock.speed;
        // A live clock advances the revision between checkpoint and submit; issue while paused,
        // then resume, exactly as a player pauses to compose a command.
        if (wasRunning) { app.setSpeed(0); paused = true; }
        const at = app.checkpoint();
        const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
        const basis = composeCampaignAuthority(at, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: at.revision }, content);
        app.submit({ kind: 'issue', commandId: operation, issuerPersonId: 'K002', recipientId, operation,
          expectedRevision: at.revision, expectedCompositeVersion: basis.compositeVersion });
        app.setSpeed(resumeSpeed);
        paused = false;
        message.textContent = operation + ' 발행됨';
        message.dataset.code = '';
        return;
      } catch (error) {
        if (!(error instanceof CampaignBoundaryError)) throw error;
        if (error.code === 'stale-version' && attempt < 3) continue;
        throw error;
      }
    }
  } catch (error) {
    if (paused) app.setSpeed(resumeSpeed);
    if (!(error instanceof CampaignBoundaryError)) throw error;
    message.textContent = operation + ' 거부: ' + describeReason(error.code);
    message.dataset.code = error.code;
  }
}
controls.append(
  button('S01-L 발행 (K568 원장 대조·운반)', () => issue('S01-L')),
  button('S01-O 발행 (K616 현장 조사·보고)', () => issue('S01-O')),
  button('정지', () => app.setSpeed(0)), button('1배속', () => app.setSpeed(1)),
  button('2배속', () => app.setSpeed(2)), button('4배속', () => app.setSpeed(4)),
  button('지도', () => { screen = 'map'; render(); }),
  button('정착지', () => { screen = 'settlement'; render(); }),
  button('수신 보고함', () => { screen = 'reports'; render(); }),
);

setInterval(() => { app.reconcile(); latest = app.checkpoint(); }, 100);
app.subscribe(() => {
  try {
    frame.dataset.speed = String(latest.clock.speed);
    frame.dataset.worldMs = String(latest.clock.worldMilliseconds);
    // Private fixture event: visible clock and screen only, no privileged world facts.
    window.dispatchEvent(new CustomEvent('campaign-fixture', { detail: {
      screen, worldMilliseconds: latest.clock.worldMilliseconds, speed: latest.clock.speed,
      receivedReports: latest.knowledge.find(k => k.personId === 'K002')?.records.length ?? 0,
    } }));
  } catch (error) {
    message.textContent = '구독 오류: ' + (error instanceof Error ? error.message + ' @ ' + String(error.stack).slice(0, 300) : String(error));
    console.error('[settlement-fixture] subscribe failed', error);
  }
});
// QA-harness debug handle: visible world facts already exposed through the UI, no privileged access.
(globalThis as { __campaignFixture?: unknown }).__campaignFixture = { get latest() { return latest; }, subscribe: (listener: () => void) => app.subscribe(listener) };
render();
