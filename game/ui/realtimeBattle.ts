import type { RealtimeHost } from '../src/runtime/realtimeHost.ts';
import { intentSchema } from '../src/battle/realtime.ts';
import type { CommanderIntent } from '../src/battle/realtime.ts';

/** Render-only surface. Preview/cancel never acquires a clock or changes authority. */
export function mountRealtimeBattle(parent: HTMLElement, host: RealtimeHost): () => void {
  const panel = document.createElement('section'); panel.dataset['realtimeBattle'] = 'true';
  const state = document.createElement('pre'); panel.append(state); parent.append(panel);
  const field = document.createElement('canvas'); field.width = 640; field.height = 360;
  field.style.maxWidth = '100%'; field.setAttribute('aria-label', 'Battlefield squad and hero positions'); panel.prepend(field);
  let preview: CommanderIntent | null = null;
  const confirm = document.createElement('button'); confirm.textContent = 'Confirm current intent';
  confirm.onclick = () => { if (preview) { host.confirm(preview); preview = null; } };
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel preview'; cancel.onclick = () => { preview = null; };
  const receive = (event: Event): void => { if (event instanceof CustomEvent) preview = intentSchema.parse(event.detail); };
  panel.addEventListener('commander-preview', receive); panel.append(confirm, cancel);
  const render = (): void => {
    state.textContent = JSON.stringify({ tick: host.state.worldTick, battle: host.state.battle }, null, 2);
    const ink = field.getContext('2d'); if (!ink) return;
    ink.fillStyle = '#151d22'; ink.fillRect(0, 0, field.width, field.height);
    const battle = host.state.battle; if (!battle) return;
    const units = [...battle.squads, ...battle.heroes];
    const minX = Math.min(0, ...units.map(u => u.x)); const minY = Math.min(0, ...units.map(u => u.y));
    const spanX = Math.max(1, ...units.map(u => u.x - minX)); const spanY = Math.max(1, ...units.map(u => u.y - minY));
    for (const unit of units) {
      const x = 24 + (unit.x - minX) / spanX * (field.width - 96);
      const y = 24 + (unit.y - minY) / spanY * (field.height - 72);
      ink.fillStyle = 'population' in unit ? '#82c6af' : '#f6ce79'; ink.fillRect(x, y, 12, 12);
      ink.fillStyle = '#ffffff'; ink.fillText(unit.id, x, y + 26);
    }
  };
  const unsubscribe = host.subscribe(render); render();
  return () => { unsubscribe(); panel.remove(); };
}
