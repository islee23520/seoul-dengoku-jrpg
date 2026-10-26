/** Pure view-model for the retainer command composer/detail (task13, task26 design contract §4).
 * Every string shown to the player comes from the admitted scenario/operations pack, the Unity
 * ui-strings subset, or is listed in this file; no runtime world fact beyond the lord-visible
 * projection is read. DOM-free so node --test can cover roster eligibility, reasons and drafts. */
import type { CampaignContent } from '../src/campaign/content.ts';
import type { CampaignErrorCode } from '../src/campaign/errors.ts';
import type { CampaignState } from '../src/campaign/stateSchemas.ts';
import { composeCampaignAuthority } from '../src/campaign/authorityComposition.ts';
import { s01VisibleState } from '../src/campaign/s01View.ts';

export type OperationId = 'S01-L' | 'S01-O';

/** Strings with no Unity ui-strings.json source; listed in the task13 DoneClaim. */
export const ordersStrings = {
  screen: '명령',
  rosterHeading: '궁정 가신',
  rosterNamed: '지정 수신자',
  rosterAll: '전체 궁정',
  retired: '은퇴',
  active: '현역',
  composeHeading: '명령 작성',
  review: '명령 검토',
  issue: '발행',
  cancelDraft: '취소',
  requestCancel: '철회 요청 검토',
  requestCancelAction: '철회 요청',
  recipient: '수신자',
  action: '조치',
  target: '대상',
  scope: '범위',
  exclusions: '금지 사항',
  delivery: '전달',
  response: '독립 응답',
  original: '원장 실물',
  observations: '관측 대상',
  issuedOrders: '발행된 명령',
  noOrders: '아직 발행한 명령이 없다',
  authorityHeading: '권한 근거',
  issuer: '발급 주체',
  grants: '구성 권한',
  compositeVersion: '합성 판본',
  notYet: '아직',
  worldClock: '창구 시각',
  seconds: '초',
  speedLabel: '시간 배속',
  pause: '정지',
  back: '뒤로',
  timeContinues: '창구 시간은 계속 흐른다',
  confirmTitle: '명령을 발행한다',
  confirmCancelTitle: '철회를 요청한다',
  loadingRuntime: '캠페인 기록을 불러오는 중',
  runtimeFailed: '캠페인 기록을 불러오지 못했다',
  retry: '다시 시도한다',
  selectRecipient: '수신자를 선택한다',
  withdrawnPending: '철회 요청 전달 중',
  orderTimeline: '진행',
} as const;

export interface OrderDetailView {
  readonly reason: string | null;
  readonly milestones: readonly { readonly label: string; readonly at: number }[];
  readonly original: CampaignState['custody'][number] | null;
  readonly asOf: number;
}

/** Own issued-command records and scene-scoped custody only. A missing cause is not permission
 * to infer refusal, revocation, expiry, remote custody, or a successful return. */
export function orderDetail(state: CampaignState, personId: string, orderId: string, content: CampaignContent): OrderDetailView | null {
  const order = state.mandates.find(m => m.orderId === orderId && m.issuerPersonId === personId);
  if (!order) return null;
  const events = state.commands.events.filter(e => e.orderId === orderId);
  const terminal = ['refused', 'interrupted', 'expired', 'cancelled'].includes(order.stage);
  const recordedReason = terminal ? events.filter(e => ['refused', 'interrupted', 'cancelled'].includes(e.kind)).at(-1)?.reason : null;
  const labels: Readonly<Record<string, string>> = {
    issued: '발행', delivered: '전달 완료', received: '수신', accepted: '독립 수락',
    refused: '거부', reserved: '예약', executing: '집행 시작',
    'cancellation-requested': '철회 요청', 'notice-received': '철회 통지 수신',
    cancelled: '철회', interrupted: '중단', 'return-accepted': '반환 수락', 'return-completed': '반환 완료',
  };
  const original = order.operation === 'S01-L' ? s01VisibleState(state, personId, content).original : null;
  return {
    reason: terminal ? recordedReason ? reasonText(recordedReason) : '사유 미확인' : null,
    milestones: events.filter(e => labels[e.kind] !== undefined).map(e => ({ label: labels[e.kind]!, at: e.at })),
    original, asOf: state.clock.worldMilliseconds,
  };
}

/** Readable Korean rendering of the typed lawful-unavailable codes. Codes carry no hidden values. */
export const reasonText = (code: CampaignErrorCode | string): string => {
  switch (code) {
    case 'stale-version': return '검토한 시점과 지금 기록 상태가 다르다. 다시 검토한다.';
    case 'rejected-conflict': return '같은 시간에 이미 다른 명령이 같은 사람을 쓰고 있다.';
    case 'authority-expired': return '야간 창구 운영 시간이 끝났다.';
    case 'authority-revoked': return '발급 권한이 철회되었다.';
    case 'recipient-unavailable': return '수신자가 지금 이 명령을 받을 수 없다.';
    case 'body-unavailable': return '수행자의 몸 상태가 지금 명령을 받을 수 없다.';
    case 'duty-unavailable': return '당직자가 동행할 수 없다.';
    case 'tool-unavailable': return '필요한 기록 장비나 조명을 쓸 수 없다.';
    case 'support-unavailable': return '급양 지원이 끝나 새 명령을 낼 수 없다.';
    case 'grant-version': return '권한 판본이 바뀌었다. 다시 검토한다.';
    case 'command-conflict': return '같은 명령 번호로 다른 내용이 이미 접수되었다.';
    case 'consent-required': return '아직 수신자의 수락이 없다.';
    case 'action-scope': return '이 명령의 범위를 벗어난 행동이다.';
    case 'authority-source': return '이 명령의 발급 근거가 더 유효하지 않다.';
    case 'shape': return '명령 형식이 올바르지 않다.';
    case 'custody': return '원장 실물의 보관 상태가 이 행동을 허용하지 않는다.';
    case 'clock': return '시간 경계가 맞지 않다.';
    default: return '지금은 이 명령을 낼 수 없다.';
  }
};

const stageTexts: Record<string, string> = {
  proposed: '대기', delivered: '전달됨', received: '수신됨', consent: '수락됨', refused: '거부됨',
  reserved: '예약됨', executing: '집행 중', 'result-applied': '결과 반영', receipt: '영수',
  cancelled: '철회됨', interrupted: '중단됨', expired: '만료됨',
};
export const stageText = (stage: string): string => stageTexts[stage] ?? stage;

export interface CourtRow {
  readonly personId: string; readonly name: string;
  readonly status: 'active' | 'retired-current';
  readonly eligible: boolean; readonly reason: string | null;
  readonly operationId: OperationId | null;
}
export interface GrantInfo { readonly grantId: string; readonly recipientId: string; readonly recipientName: string; readonly scope: readonly string[] }
export interface OriginalInfo {
  readonly name: string; readonly ownerName: string; readonly custodianName: string;
  readonly containerName: string; readonly keyNote: string; readonly count: number;
}
export interface ObservationInfo { readonly siteName: string; readonly siteId: string }
export interface OperationBrief {
  readonly id: OperationId; readonly label: string;
  readonly recipientId: string; readonly recipientName: string;
  readonly targetName: string; readonly targetSiteId: string;
  readonly scope: readonly string[]; readonly exclusions: readonly string[];
  readonly deliveryNote: string; readonly responseSeconds: number;
  readonly original: OriginalInfo | null; readonly observations: readonly ObservationInfo[];
  readonly grants: readonly GrantInfo[];
}
export interface OrdersCatalog {
  readonly designator: { readonly personId: string; readonly name: string; readonly placeName: string; readonly siteName: string };
  readonly personalLiege: { readonly personId: string; readonly name: string } | null;
  readonly court: readonly CourtRow[];
  readonly operations: readonly OperationBrief[];
  readonly issuerName: string;
}

/** Roster, named recipients, scope and custody copy all derive from the admitted pack, not UI constants. */
export function buildOrdersCatalog(content: CampaignContent): OrdersCatalog {
  const { manifest, scenario, operations, projection } = content.data;
  const persons = new Map(manifest.selection.persons.map(p => [p.id, p.name] as const));
  const siteName = (id: string): string => scenario.sites.find(s => s.id === id)?.name ?? id;
  const mandateOf = new Map(operations.authority.mandates.map(m => [m.recipient, m.id as OperationId] as const));
  const court: CourtRow[] = manifest.selection.court.map(member => {
    const operationId = mandateOf.get(member.personId) ?? null;
    const eligible = member.status === 'active' && operationId !== null;
    const reason = member.status !== 'active' ? '은퇴하여 이 조사의 명령을 받을 수 없다'
      : operationId === null ? '이 조사에서 지정된 두 수신자가 아니다.' : null;
    return { personId: member.personId, name: persons.get(member.personId) ?? member.personId, status: member.status, eligible, reason, operationId };
  });
  const grantInfo = (grantId: string): GrantInfo => {
    const grant = scenario.rights.grants.find(g => g.id === grantId)!;
    return { grantId: grant.id, recipientId: grant.recipient, recipientName: persons.get(grant.recipient) ?? grant.recipient, scope: grant.scope };
  };
  const deliveryNote = scenario.availability.channels.find(c => c.id === 's01:townhall:contact-desk')?.method ?? '';
  const issuerName = '신정2동 야간배급 공동기록체';
  const operationsList: OperationBrief[] = operations.authority.mandates.map(mandate => {
    const recipientName = persons.get(mandate.recipient) ?? mandate.recipient;
    const grants = mandate.grants.map(grantInfo);
    const recipientGrant = grants.find(g => g.recipientId === mandate.recipient)!;
    if (mandate.id === 'S01-L') {
      return {
        id: 'S01-L', label: '원장 대조·운반', recipientId: mandate.recipient, recipientName,
        targetName: scenario.ledger.name, targetSiteId: scenario.ledger.container,
        scope: recipientGrant.scope, exclusions: scenario.rights.forbidden, deliveryNote,
        responseSeconds: operations.durations.response,
        original: {
          name: scenario.ledger.name, ownerName: issuerName,
          custodianName: '주민센터 당직 기록보관 기능',
          containerName: siteName(scenario.ledger.container), keyNote: scenario.ledger.key.operation,
          count: operations.authority.originalCount,
        },
        observations: [], grants,
      };
    }
    return {
      id: 'S01-O', label: '현장 조사·보고', recipientId: mandate.recipient, recipientName,
      targetName: siteName(operations.evidence.observations[0]?.siteId ?? ''), targetSiteId: operations.evidence.observations[0]?.siteId ?? '',
      scope: recipientGrant.scope, exclusions: scenario.rights.forbidden, deliveryNote,
      responseSeconds: operations.durations.response, original: null,
      observations: operations.evidence.observations.map(o => ({ siteName: siteName(o.siteId), siteId: o.siteId })),
      grants,
    };
  });
  const designatorId = operations.authority.designator;
  const placement = operations.authority.actorPlacements[designatorId] ?? projection.actors.find(a => a.actorId === designatorId)?.nodeId ?? '';
  return {
    designator: { personId: designatorId, name: persons.get(designatorId) ?? designatorId, placeName: siteName(placement), siteName: manifest.selection.site.name },
    personalLiege: manifest.selection.holding.directLiegePersonId && persons.has(manifest.selection.holding.directLiegePersonId)
      ? { personId: manifest.selection.holding.directLiegePersonId, name: persons.get(manifest.selection.holding.directLiegePersonId)! } : null,
    court, operations: operationsList, issuerName,
  };
}

export interface AuthorityNow {
  readonly operation: OperationId; readonly recipientId: string;
  readonly grants: readonly { readonly grantId: string; readonly version: string }[];
  readonly compositeVersion: string; readonly expiresAtWorldSeconds: number;
}
export type OrderAuthorityResult = { readonly ok: true; readonly basis: AuthorityNow }
  | { readonly ok: false; readonly reason: string; readonly code: CampaignErrorCode };
/** Composite grant version is the adapter output (task7), never a scenario grant property. */
export function authorityNow(state: CampaignState, operation: OperationId, content: CampaignContent): OrderAuthorityResult {
  const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
  try {
    const basis = composeCampaignAuthority(state, { operation, issuerPersonId: content.data.operations.authority.designator, recipientId, expectedRevision: state.revision }, content);
    return { ok: true, basis: { operation, recipientId, grants: basis.authority, compositeVersion: basis.compositeVersion, expiresAtWorldSeconds: Math.floor(basis.expiresAt / 1000) } };
  } catch (error) {
    if (typeof (error as { code?: unknown })?.code === 'string') return { ok: false, code: (error as { code: CampaignErrorCode }).code, reason: reasonText((error as { code: CampaignErrorCode }).code) };
    throw error;
  }
}

export interface OrderRowView {
  readonly orderId: string; readonly operation: OperationId; readonly recipientId: string;
  readonly stage: string; readonly stageLabel: string;
  readonly receivedAt: string | null; readonly acceptedAt: string | null;
  readonly cancellationPending: boolean; readonly terminal: boolean;
}
export interface OrderListView {
  readonly orders: readonly {
    readonly orderId: string; readonly operation: OperationId; readonly recipientId: string;
    readonly stage: string; readonly receivedAt: number | null; readonly acceptedAt: number | null;
    readonly cancellationPending: boolean;
  }[];
}
export function orderRows(view: OrderListView): readonly OrderRowView[] {
  return view.orders.map(o => ({
    orderId: o.orderId, operation: o.operation, recipientId: o.recipientId, stage: o.stage, stageLabel: stageText(o.stage),
    receivedAt: o.receivedAt === null ? null : String(Math.floor(o.receivedAt / 1000)),
    acceptedAt: o.acceptedAt === null ? null : String(Math.floor(o.acceptedAt / 1000)),
    cancellationPending: o.cancellationPending,
    terminal: ['refused', 'cancelled', 'interrupted', 'expired', 'receipt'].includes(o.stage) && !o.cancellationPending,
  }));
}

/** One intent keeps one immutable command id, so pointer/Enter retries cannot mint a second order. */
export function issueDraft(input: { readonly commandId: string; readonly issuerPersonId: string; readonly brief: OperationBrief; readonly expectedRevision: number; readonly expectedCompositeVersion: string }) {
  return Object.freeze({ kind: 'issue' as const, commandId: input.commandId, issuerPersonId: input.issuerPersonId,
    recipientId: input.brief.recipientId, operation: input.brief.id,
    expectedRevision: input.expectedRevision, expectedCompositeVersion: input.expectedCompositeVersion });
}
export function cancellationDraft(input: { readonly commandId: string; readonly issuerPersonId: string; readonly orderId: string; readonly expectedRevision: number }) {
  return Object.freeze({ kind: 'request-cancellation' as const, commandId: input.commandId, issuerPersonId: input.issuerPersonId,
    orderId: input.orderId, expectedRevision: input.expectedRevision });
}
