/** Player-facing text for failures that can reach the opening start action.
 * The Unity string table has no start-failure strings, so these are web-only copy
 * (listed in task22 DoneClaim). Internal codes stay in `code` for console/telemetry only. */
export const startFailureText = {
  rules: '시작에 필요한 규칙이 아직 정해지지 않았다.',
  notReady: '화면이 아직 준비되지 않았다.',
  conflict: '게임 상태가 맞지 않아 시작하지 못했다.',
  placement: '선택한 인물의 시작 위치를 확인하지 못했다.',
  assets: '게임 자료를 불러오지 못했다.',
  fallback: '시작하지 못했다.',
} as const;

export interface StartFailure { readonly text: string; readonly code: string }

export function describeStartFailure(error: unknown): StartFailure {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const code = name + ': ' + message;
  // MissingRuleInput / BattleConflict come from game/src/battle/realtime.ts (bootRealtime path).
  if (name === 'MissingRuleInput') return { text: startFailureText.rules, code };
  if (name === 'BattleConflict') return { text: message === 'presentation-not-ready' ? startFailureText.notReady : startFailureText.conflict, code };
  // selectOpeningActor: zod parse of actor id / placement, or an unresolved scenario site.
  if (name === 'ZodError' || message.startsWith('Unresolved scenario placement')) return { text: startFailureText.placement, code };
  // samplingProject / mountSamplingNotice asset guards.
  if (message.startsWith('Sampling requires') || message.startsWith('Registered sampling')) return { text: startFailureText.assets, code };
  return { text: startFailureText.fallback, code };
}
