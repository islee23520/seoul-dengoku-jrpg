/** Settlement execution view model (task14). Pure projection of the live campaign runtime
 * (task9 positions/custody/activity, task10 received knowledge) into the people / place / custody
 * layout of the approved task26 design contract §5. No DOM, no world mutation: reading this
 * model grants no knowledge beyond what the lord-visible projection already contains. */
import type { CampaignContent } from '../src/campaign/content.ts';
import type { CampaignState } from '../src/campaign/stateSchemas.ts';
import { s01VisibleState } from '../src/campaign/s01View.ts';
import { lordKnowledge } from '../src/campaign/reports.ts';
import { openingActors } from '../src/runtime/openingScenario.ts';
import type { CampaignErrorCode } from '../src/campaign/errors.ts';
import { id } from '../src/domain/ids.ts';

/** Names and titles come only from the admitted task31 identity list; ids stay visible where no name exists. */
const personNames: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(openingActors.map(actor => [actor.actorId, actor.name])));
const personTitles: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(openingActors.map(actor => [actor.actorId, actor.title])));
/** scenario.ledger.name/custodianNature are not exposed by the parsed content schema; these strings are
 * copied verbatim from the admitted scenario package (game/data/scenarios/townhall-s01-r1/scenario.json). */
const ledgerName = '신정2동 야간 배급·수위 대조 원장 (L01)';
const dutyRoleText = '주민센터 당직 기록보관 기능, 새 K 인물·궁정 임명 아님';

export const settlementStrings = {
  people: '사람',
  place: '장소와 업무',
  custody: '원장 보관',
  dutyRole: '야간 기록 당직(기능)',
  deskTask: '접수·판단·보고 수신',
  unknownPlace: '마지막 수신 위치 없음',
  lastKnown: '마지막 수신',
  asOf: '기준 시각',
  noWork: '진행 중인 위임 업무가 없다',
  supportAvailable: '지원 계속',
  supportExpired: '지원 만료(5400세계초) — 새 미지원 행위 거부',
  closed: '폐관 시각 도달 — 진행 중 의무는 유지된다',
  command: '수행자에게 지시',
  commandUnavailable: '명령 작성 화면(과제 13)이 아직 연결되지 않았다. 이 화면에서는 위임할 수 없다.',
  reports: '수신 보고함',
  whole: '원본 전체 1건',
  sealSealed: '봉인 유지',
  sealOpened: '개봉',
} as const;

export interface SettlementPersonRow {
  readonly id: string; readonly name: string; readonly role: string;
  readonly task: string; readonly place: string; readonly asOf: number; readonly returning: boolean;
  readonly food: string; readonly water: string;
}
export interface SettlementWorkRow {
  readonly orderId: string; readonly operation: string; readonly recipientId: string;
  readonly recipientName: string; readonly stage: string; readonly activity: string;
}
export interface SettlementCustodyRow {
  readonly assetId: string; readonly name: string; readonly owner: string; readonly custodian: string;
  readonly container: string; readonly seal: string; readonly returnState: string;
  readonly unresolvedReturn: boolean; readonly visible: boolean; readonly asOf: number;
}
export interface SettlementView {
  readonly place: { readonly siteId: string; readonly name: string };
  readonly clockMs: number; readonly speed: number;
  readonly people: readonly SettlementPersonRow[];
  readonly works: readonly SettlementWorkRow[];
  readonly custody: SettlementCustodyRow | null;
  readonly support: 'available' | 'expired' | null; readonly closed: boolean | null;
}

const activityLabel: Readonly<Record<string, string>> = Object.freeze({
  waiting: '대기', walking: '이동', carrying: '운반', stationary: '업무', resting: '휴식', eating: '식사', drinking: '급수',
});
const stepLabel: Readonly<Record<string, string>> = Object.freeze({
  walk: '이동', 'archive-check': '서고 사전 확인', pickup: '원장 수령', deliver: '접수대 전달', compare: '대조(행별)',
  observe: '현장 관측', report: '대면 보고', 'return-pickup': '반환 수령 대기', handover: '문밖 인계', reseal: '재봉인',
  notice: '철회 통지', retreat: '후퇴 이동',
});
const stageLabel: Readonly<Record<string, string>> = Object.freeze({
  proposed: '발행됨(전달 중)', delivered: '전달됨', received: '수신(응답 전)', consent: '수락', refused: '거부',
  reserved: '예약됨', executing: '집행 중', 'result-applied': '결과 반영', receipt: '완료 영수',
  cancelled: '철회됨', interrupted: '중단됨', expired: '만료',
});
export const labelStep = (kind: string): string => stepLabel[kind] ?? activityLabel[kind] ?? kind;
export const labelStage = (stage: string): string => stageLabel[stage] ?? stage;
export const labelActivity = (activity: string): string => activityLabel[activity] ?? activity;

/** Safe readable reason for a lawful refusal or blocked control. Never discloses hidden world values. */
const reasonText: Readonly<Record<string, string>> = Object.freeze({
  'rejected-conflict': '동시에 진행 중인 당직 업무와 충돌하여 거부됐다. 기존 위임은 그대로다.',
  'recipient-unavailable': '수행자가 현재 이 지시를 받을 수 없다.',
  'duty-unavailable': '당직 기능이 다른 업무에 배정돼 있다.',
  'body-unavailable': '수행자 신체 조건이 이 업무를 허용하지 않는다.',
  'tool-unavailable': '필요한 기록 도구를 지금 쓸 수 없다.',
  'support-unavailable': '지원(급양·보수)이 만료되어 새 미지원 행위를 거부한다.',
  'authority-revoked': '근거 권한이 철회되었다.',
  'authority-expired': '근거 권한이 만료되었다.',
  'stale-version': '상태가 이미 바뀌었다. 최근 상태로 다시 검토한다.',
  'command-conflict': '같은 명령이 이미 발행되어 있다.',
  'consent-required': '독립적인 응답(승낙)이 필요하다.',
});
export function describeReason(code: CampaignErrorCode | string): string {
  return reasonText[code] ?? '허용되지 않는 요청이다.';
}

export function nodeLabel(content: CampaignContent, nodeId: string): string {
  return content.data.scenario.sites.find(site => site.id === nodeId)?.name ?? nodeId;
}

/** People/work/custody rows for the settlement docks. Custody is shown only while it is in the
 * lord's own scene (s01VisibleState.original); a remote original stays unknown, never guessed. */
export function buildSettlementView(state: CampaignState, content: CampaignContent, personId: string): SettlementView {
  const visible = s01VisibleState(state, personId, content);
  const scenario = content.data.scenario;
  const lordSceneActors = new Map<string, (typeof visible.actors)[number]>(visible.actors.map(actor => [actor.entityId as string, actor]));
  const people: SettlementPersonRow[] = state.bodies
    .filter(body => body.entityId.startsWith('K'))
    .map(body => {
      const local = lordSceneActors.get(body.entityId);
      const nodeId = body.location.kind === 'node' ? body.location.nodeId : body.location.kind === 'edge-progress'
        ? body.location.to : null;
      return {
        id: body.entityId, name: personNames[body.entityId] ?? body.entityId,
        role: personTitles[body.entityId] ?? settlementStrings.deskTask,
        task: local ? labelStep(local.task) : activityLabel[body.activity] ?? body.activity,
        place: local && nodeId ? nodeLabel(content, nodeId) : settlementStrings.unknownPlace,
        asOf: local ? state.clock.worldMilliseconds : 0,
        returning: local?.returning ?? false,
        food: local?.food === 'uncovered' ? '급양 만료' : local ? '급양 유지' : '',
        water: local?.water === 'uncovered' ? '급수 만료' : local ? '급수 유지' : '',
      };
    });
  const dutyBody = state.bodies.find(body => body.entityId === content.data.operations.authority.duty);
  const dutyLocal = lordSceneActors.has(content.data.operations.authority.duty);
  const dutyNode = dutyBody?.location.kind === 'node' ? dutyBody.location.nodeId : dutyBody?.location.kind === 'edge-progress' ? dutyBody.location.to : null;
  if (dutyBody) people.push({
    id: dutyBody.entityId, name: settlementStrings.dutyRole,
    role: dutyRoleText,
    task: dutyLocal ? labelStep(lordSceneActors.get(dutyBody.entityId)!.task) : labelActivity(dutyBody.activity),
    place: dutyNode && dutyLocal ? nodeLabel(content, dutyNode) : settlementStrings.unknownPlace,
    asOf: dutyLocal ? state.clock.worldMilliseconds : 0, returning: false, food: '', water: '',
  });
  const knowledge = lordKnowledge(state, { personId: id('PersonId', personId) });
  const works: SettlementWorkRow[] = state.mandates.filter(order => order.issuerPersonId === personId).map(order => {
    const local = lordSceneActors.get(order.recipientId);
    return {
      orderId: order.orderId, operation: order.operation, recipientId: order.recipientId,
      recipientName: personNames[order.recipientId] ?? order.recipientId,
      stage: order.stage === 'result-applied' && !knowledge.reports.some(r => r.fact.orderId === order.orderId) ? 'executing' : order.stage,
      activity: local ? labelStep(local.task) : labelStage(order.stage),
    };
  });
  const original = visible.original ?? null;
  const custody: SettlementCustodyRow | null = state.custody.length ? {
    assetId: state.custody[0]!.assetId, name: ledgerName,
    owner: scenario.ledger.owner, custodian: original ? original.custodian : state.custody[0]!.custodian,
    container: nodeLabel(content, scenario.ledger.container),
    seal: (original ?? state.custody[0]!).seal === 'sealed' ? settlementStrings.sealSealed : settlementStrings.sealOpened,
    returnState: (original ?? state.custody[0]!).returnState,
    unresolvedReturn: (original ?? state.custody[0]!).unresolvedReturn,
    visible: original !== null, asOf: original ? state.clock.worldMilliseconds : 0,
  } : null;
  return Object.freeze({
    place: { siteId: scenario.siteId, name: siteName(scenario) },
    clockMs: state.clock.worldMilliseconds, speed: state.clock.speed, people: Object.freeze(people),
    works: Object.freeze(works), custody, support: visible.support, closed: visible.closed,
  });
}
function siteName(scenario: CampaignContent['data']['scenario']): string {
  // The settlement is the whole admitted site (신정2동 주민센터 anchor), named by its reception desk's site entry.
  const desk = scenario.sites.find(site => site.id === 's01:townhall:desk');
  return desk ? '신정2동 주민센터 · ' + desk.name : scenario.siteId;
}

/** Whole seconds of world time since E0 as a readable duration, never a raw millisecond dump. */
export function formatWorldSeconds(clockMs: number): string {
  const total = Math.floor(clockMs / 1000), m = Math.floor(total / 60), s = total % 60;
  return m + '분 ' + String(s).padStart(2, '0') + '초';
}
