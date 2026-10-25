/** Received-report inbox view model (task14). RECEIVED-ONLY: membership comes from the task10
 * lord-visible knowledge projection (facts with a receivedAt), never from raw world Report objects.
 * Payloads are the immutable received versions; a later world change never rewrites an old row.
 * Unread/read is local presentation metadata keyed by reportId and changes no world state. */
import type { CampaignContent } from '../src/campaign/content.ts';
import type { CampaignState } from '../src/campaign/stateSchemas.ts';
import { openingActors } from '../src/runtime/openingScenario.ts';
import { formatWorldSeconds } from './campaignSettlementModel.ts';

const personNames: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(openingActors.map(actor => [actor.actorId, actor.name])));

export const reportsStrings = {
  inbox: '수신 보고함',
  open: '보고 열기',
  linkedCommand: '명령 보기',
  close: '닫기',
  empty: '수신된 보고가 없다. 배달 중인 보고의 내용은 수신 전에 보이지 않는다.',
  unread: '읽지 않음',
  read: '읽음',
  source: '출처',
  observedAt: '관측 시각',
  createdAt: '작성 시각',
  deliveredAt: '전달 완료',
  receivedAt: '수신 완료',
  notDelivered: '아직 전달되지 않음',
  omission: '누락',
  uncertainty: '불확실성',
  partial: '부분 증거 — 정상/이상 판단 아님',
  fact: '사실 식별',
  version: '판본',
  cause: '발단',
  ledgerEvidence: '원장 대조 결과',
  rawEvidence: '현장 관측 기록',
  noCalibration: '교정 영수 없음',
  measurementNull: '측정값 없음(정량화되지 않음)',
  back: '뒤로',
} as const;

const omissionLabel: Readonly<Record<string, string>> = Object.freeze({
  'missing-annex': '별지 누락', 'unsigned-slot': '미서명란 존재', 'uncalibrated': '미교정 기기',
  'different-event-time': '상이한 사건 시각', 'small-graduations': '촘촘한 눈금', parallax: '시차',
  'incomplete-work': '미완료 업무',
});
export const labelOmission = (omission: string): string => omissionLabel[omission] ?? omission;

export interface InboxEvidence {
  readonly kind: 'ledger-comparison' | 'raw-observation';
  readonly lines: readonly string[];
}
export interface InboxRow {
  readonly reportId: string; readonly factId: string; readonly version: number;
  readonly orderId: string; readonly sourceId: string; readonly sourceName: string;
  readonly observedAt: number; readonly createdAt: number; readonly deliveredAt: number | null;
  readonly receivedAt: number; readonly omission: readonly string[]; readonly uncertainty: string;
  readonly evidence: InboxEvidence; readonly title: string;
}

/** Ledger rows stay document-internal discrepancies; raw readings stay raw text with null measurement. */
function evidenceLines(fact: { evidence: { kind: string } & Record<string, unknown> }): InboxEvidence {
  const evidence = fact.evidence;
  if (evidence.kind === 'ledger-comparison') {
    const lines = (evidence.rows as Record<string, unknown>[]).map(row => {
      const parts = [String(row.id)];
      if (row.bundles) parts.push('묶음 ' + Object.entries(row.bundles as Record<string, number>).map(([k, v]) => k + ':' + v).join(' '));
      if (row.coverTotal !== undefined) parts.push('표지 총계 ' + row.coverTotal);
      if (row.rawText) parts.push(String(row.rawText));
      if (row.signatureSlots !== undefined) parts.push('서명란 ' + row.signatureSlots + ' 중 ' + String(row.signedSlots) + ' 서명, 별지 ' + (row.attachmentPresent ? '있음' : '없음'));
      return parts.join(' · ');
    });
    return { kind: 'ledger-comparison', lines: Object.freeze(['문서 내부 불일치만 기록(절도 아님)', ...lines]) };
  }
  const lines = [
    '기기 ' + String(evidence.instrumentLabel) + ' · 원문 기록 "' + String(evidence.rawText) + '" (' + String(evidence.unitLabel) + ')',
    evidence.measurementValue === null || evidence.measurementValue === undefined
      ? reportsStrings.measurementNull : '측정값 ' + String(evidence.measurementValue),
  ];
  if (evidence.calibrationReceipt === null || evidence.calibrationReceipt === undefined) lines.push(reportsStrings.noCalibration);
  if (evidence.quality !== undefined && evidence.quality !== null) lines.push('품질 ' + String(evidence.quality));
  return { kind: 'raw-observation', lines: Object.freeze(lines) };
}

export interface InboxView {
  readonly clockMs: number;
  readonly rows: readonly InboxRow[];
}

/** Unread is local presentation metadata keyed by reportId; it never touches world state. */
export function unreadIds(rows: readonly InboxRow[], read: ReadonlySet<string>): ReadonlySet<string> {
  return Object.freeze(new Set(rows.filter(row => !read.has(row.reportId)).map(row => row.reportId)));
}

/** Received facts only: membership is the task10 PersonKnowledge receipt (records[].reportId),
 * and the payload is the immutable CampaignReport as received. Undelivered world reports never enter. */
export function buildInboxView(state: CampaignState, content: CampaignContent, personId: string): InboxView {
  void content;
  const received = new Set(state.knowledge.find(k => k.personId === personId)?.records.map(record => record.reportId) ?? []);
  const rows = state.reports.filter(report => received.has(report.id)).map(report => {
    const sourceName = personNames[report.source] ?? report.source;
    return Object.freeze({
      reportId: report.id, factId: report.fact.id, version: report.fact.version,
      orderId: report.fact.orderId,
      sourceId: report.source, sourceName,
      observedAt: report.fact.observedAt, createdAt: report.createdAt, deliveredAt: report.deliveredAt, receivedAt: report.receivedAt ?? 0,
      omission: Object.freeze(report.omission.map(labelOmission)), uncertainty: report.uncertainty,
      evidence: Object.freeze(evidenceLines({ evidence: report.fact.evidence as { kind: string } & Record<string, unknown> })),
      title: (report.fact.evidence.kind === 'raw-observation' ? reportsStrings.rawEvidence : reportsStrings.ledgerEvidence) + ' · ' + sourceName,
    });
  });
  return Object.freeze({ clockMs: state.clock.worldMilliseconds, rows: Object.freeze(rows) });
}

/** Sorting is newest-received first; ties by reportId for determinism. */
export function sortedRows(view: InboxView): readonly InboxRow[] {
  return [...view.rows].sort((a, b) => b.receivedAt - a.receivedAt || (a.reportId < b.reportId ? -1 : 1));
}

export function timeLabel(ms: number | null, kind: 'elapsed' | 'pending' = 'elapsed'): string {
  if (ms === null || kind === 'pending') return ms === null ? reportsStrings.notDelivered : formatWorldSeconds(ms);
  return formatWorldSeconds(ms);
}
