/** Narrative dialogue view model (task22 wave3), per the approved task26 design contract §7.
 * The surface renders a snapshot prepared by the real events pipeline
 * (game/src/events) and never writes switches itself; only a revalidated
 * chooseEvent result reaches the host through onEffects. Production has no
 * admitted narrative document today (the schema admits TESTINPUT provenance
 * only), so the blocked/empty states are the honest production reality. */
import { EventDataError } from '../src/events/definition.ts';
import type { EventDefinition } from '../src/events/definition.ts';
import { matches, prepareEvent } from '../src/events/pipeline.ts';
import type { EventContext } from '../src/events/pipeline.ts';

export const dialogueStrings = {
  blockedTitle: '사건 대화',
  blocked: '인준된 사건 대화 문서가 없다. 본보기 대사를 지어내 보여 주지 않는다.',
  blockedReason: '문서를 검증할 수 없다',
  empty: '현재 상태에서 표시할 수 있는 사건이 없다. 다시 열리면 현재 상태로 새로 준비한다.',
  speaker: '화자',
  narrative: '서술',
  choices: '선택지',
  portraitFallback: '초상 자리 · 실제 자료 없음',
  portraitResource: '초상 자원',
  provenance: '출처 표기',
  eventId: '사건 ID',
  onceNote: '한 번 사건 · 선택이 확정되면 다시 열리지 않는다',
  stakesHeading: '걸림',
  selectedHeading: '선택한 선택지',
  requiresHeading: '요건 (제작 공개)',
  requiresMet: '충족',
  requiresUnmet: '미충족',
  requirementTrait: '특성',
  requirementSwitch: '전환',
  confirmChoice: '선택 확인',
  close: '닫기 (보류)',
  deferNote: '닫아도 어떤 선택도 기록되지 않는다. 다시 열리면 현재 상태로 새로 준비한다.',
  confirmTitle: '선택을 확인한다',
  cancel: '취소',
  selectFirst: '선택지를 선택하면 확인할 수 있다.',
  staleChoice: '선택한 선택지를 이제 선택할 수 없다. 목록을 새로 고쳤고 어느 효과도 남지 않았다.',
  eventUnavailable: '이 사건은 이미 확정됐거나 더 이상 열리는 조건이 아니다.',
  appliedHeading: '기록된 전환',
};

export type DialogueRequirement = {
  readonly kind: 'trait' | 'switch';
  readonly reference: string;
  readonly expected: boolean;
  readonly met: boolean;
};

export type DialogueOptionRow = {
  readonly id: string;
  readonly text: string;
  /** Authored disclosure: the option's declared predicates evaluated against the current context. */
  readonly requires: readonly DialogueRequirement[];
};

export type DialogueView =
  | { readonly kind: 'blocked'; readonly reason?: string }
  | { readonly kind: 'empty' }
  | {
    readonly kind: 'ready';
    readonly eventId: string;
    readonly title: string;
    readonly speaker: string;
    readonly provenance: string;
    readonly portraitResourceId: string;
    readonly once: boolean;
    readonly body: readonly string[];
    readonly stakes: string;
    readonly options: readonly DialogueOptionRow[];
  };

function requirement(predicate: EventDefinition['trigger'][number], context: EventContext): DialogueRequirement {
  return predicate.kind === 'trait'
    ? { kind: 'trait', reference: predicate.trait, expected: predicate.present, met: matches(predicate, context) }
    : { kind: 'switch', reference: predicate.switchId, expected: predicate.value, met: matches(predicate, context) };
}

/** Prepared snapshot for rendering: null event is the blocked state, a null prepare is the empty state. */
export function buildDialogueView(event: EventDefinition | null, context: EventContext | null): DialogueView {
  if (!event) return { kind: 'blocked' };
  if (!context) return { kind: 'empty' };
  const prepared = prepareEvent(event, context);
  if (!prepared) return { kind: 'empty' };
  return {
    kind: 'ready',
    eventId: event.id,
    title: event.title,
    speaker: event.speaker,
    provenance: event.provenance,
    portraitResourceId: event.portrait.resourceId,
    once: event.once,
    body: event.body.split('\n'),
    stakes: event.stakes,
    options: prepared.options.map(option => ({
      id: option.id,
      text: option.text,
      requires: option.requires.map(predicate => requirement(predicate, context)),
    })),
  };
}

/** Readable Korean cause for a failed revalidation; the view refreshes and keeps the reason visible. */
export function describeDialogueFailure(error: unknown): string {
  if (error instanceof EventDataError) {
    if (error.detail.startsWith('event unavailable')) return dialogueStrings.eventUnavailable;
    if (error.detail.startsWith('option unavailable')) return dialogueStrings.staleChoice;
    return dialogueStrings.blockedReason + ' · ' + error.detail;
  }
  return dialogueStrings.blockedReason + (error instanceof Error ? ' · ' + error.message : '');
}
