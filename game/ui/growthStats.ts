import { parameterKeys, parseGrowthFocus } from '../src/domain/growth.ts';
import type { GrowthProjection } from '../src/domain/growth.ts';

export type StatRow = { readonly key: string; readonly label: string; readonly value: string; readonly blocked: boolean };

/** Read-only projection. Absence of an initialized state is not a zero-valued actor. */
export function growthStatRows(growth: GrowthProjection | null): readonly StatRow[] {
  const state = growth?.state;
  const focus = state?.focus ?? parseGrowthFocus({ focus: null, perks: [] });
  const missing = '차단 · GrowthState 미초기화 / GrowthRules 미승인';
  const rows: StatRow[] = [];
  switch (growth?.kind) {
    case undefined:
      rows.push({ key: 'status', label: '성장 상태', value: missing, blocked: true });
      break;
    case 'blocked':
      rows.push({ key: 'status', label: '성장 상태', value: '차단 · ' + growth.error.ruleKey, blocked: true });
      break;
    case 'applied':
      rows.push({ key: 'status', label: '성장 상태', value: '반영됨', blocked: false });
      break;
    default: growth satisfies never;
  }
  rows.push({ key: 'focus', label: 'Focus · 1슬롯', value: state ? focus.focus ?? '미선택' : missing, blocked: !state });
  for (const slot of [0, 1, 2]) rows.push({ key: 'perk-' + slot, label: 'Perk · 슬롯 ' + (slot + 1),
    value: state ? focus.perks[slot] ?? '비어 있음' : missing, blocked: !state });
  for (const [key, label, value] of [
    ['xp', '누적 XP', state?.xp], ['appliedResults', '반영 결과 수', state?.appliedResults.length], ['level', '레벨', state?.level],
    ...parameterKeys.map(key => [key, key, state?.parameters[key]] as const),
  ] as const) rows.push({ key, label, value: value === undefined ? missing : String(value), blocked: value === undefined });
  return rows;
}

export function mountGrowthStats(parent: HTMLElement, actor: {
  readonly person: string; readonly name: string; readonly growth: GrowthProjection | null;
}): void {
  const open = document.createElement('button'); open.type = 'button'; open.textContent = '스탯 / 성장 상태';
  const dialog = document.createElement('dialog'); dialog.className = 'growth-stats'; dialog.id = 'growth-stats';
  dialog.setAttribute('aria-labelledby', 'growth-stats-title'); dialog.dataset['person'] = actor.person;
  const title = document.createElement('h2'); title.id = 'growth-stats-title'; title.textContent = actor.name + ' · 스탯';
  const identity = document.createElement('p'); identity.textContent = actor.person;
  const list = document.createElement('dl');
  for (const row of growthStatRows(actor.growth)) {
    const term = document.createElement('dt'); term.textContent = row.label;
    const value = document.createElement('dd'); value.textContent = row.value;
    value.dataset['stat'] = row.key; value.dataset['blocked'] = String(row.blocked);
    list.append(term, value);
  }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'primary'; close.textContent = '닫기';
  close.onclick = () => dialog.close();
  dialog.append(title, identity, list, close); parent.append(open, dialog);
  open.onclick = () => dialog.showModal();
}
