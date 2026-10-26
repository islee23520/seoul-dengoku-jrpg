/** Save/load view model (task22 wave2), per the approved task26 design contract §8.
 * Pure projection of the actual checkpoint storage (one active pointer + previous pointer,
 * game/src/save/checkpointStorage.ts) and the admitted content hashes. No DOM, no writes:
 * building this view never saves, loads, repairs or migrates anything. Wall-clock save time
 * is not recorded by the runtime, so it is never invented here. */
import type { CampaignContent } from '../src/campaign/content.ts';
import type { CampaignSave } from '../src/campaign/saveCheckpoint.ts';
import { formatWorldSeconds } from './campaignSettlementModel.ts';

export const savesStrings = {
  title: '저장 · 불러오기',
  checkpoints: '체크포인트',
  current: '현재 수동 저장',
  previous: '이전 포인터',
  detail: '선택한 체크포인트',
  versions: '버전',
  saveTab: '저장',
  loadTab: '불러오기',
  save: '수동 저장',
  loadReview: '불러오기 검토',
  empty: '저장된 체크포인트가 없다. 저장 탭에서 수동 저장한다.',
  checksum: '체크섬',
  worldSeconds: '저장 시점 세계 시각',
  envelopeVersion: '봉투 버전',
  namespace: '저장 이름공간',
  saveTime: '저장 시각(실제 시간)',
  saveTimeNotRecorded: '기록되지 않는다',
  previousUnavailable: '이전 포인터의 저장 내용을 더 이상 읽을 수 없다',
  migrationUnavailable: '이전 버전에서 옮겨오기: 제공되지 않는다',
  corruptTitle: '저장을 읽을 수 없다',
  loadGuidance: '저장된 시작점으로 돌아가려면 제목 화면의 이어하기로 다시 연다. 지금 탭의 진행은 이어하기 전까지 유지된다.',
  overwriteConfirm: '현재 저장을 새 경계로 덮어쓴다. 이전 포인터가 지금 저장을 가리키게 된다.',
  confirmTitle: '확인',
  cancel: '취소',
  proceed: '계속한다',
  saveFailed: '저장 실패',
  saved: '저장됨 · ',
  oneActiveOnly: '한 번에 하나의 진행 저장만 존재한다',
} as const;

export type SavesPointerStatus = 'ok' | 'missing' | 'invalid';

export interface SavesCheckpointRow {
  readonly kind: 'current' | 'previous';
  readonly key: string | null;
  readonly status: SavesPointerStatus;
  readonly checksum: string | null;
  readonly worldSecondsText: string | null;
  readonly envelopeVersion: number | null;
}

export interface SavesView {
  readonly clockMs: number;
  readonly speed: number;
  readonly rows: readonly SavesCheckpointRow[];
  readonly versions: readonly { readonly name: string; readonly value: string }[];
  /** Non-null when the active checkpoint exists but fails validation: honest reason, load blocked. */
  readonly error: { readonly reason: string; readonly readable: string } | null;
  readonly hasValidCurrent: boolean;
}

export interface SavesStorageReader {
  readonly readActive: () => string | null;
  readonly readPayload: (key: string) => string | null;
  readonly parseSave: (raw: unknown) => CampaignSave;
}

const reasonText: Readonly<Record<string, string>> = Object.freeze({
  'missing-checkpoint': '저장된 체크포인트가 없다.',
  'invalid-json': '저장 데이터가 올바른 JSON이 아니다.',
  'invalid-pointer': '활성 포인터가 손상되었다.',
  'missing-payload': '포인터가 가리키는 저장 내용이 없다.',
  'envelope-shape': '저장 봉투 구조가 손상되었다.',
  'incomplete-campaign-envelope': '저장 봉투가 불완전하다.',
  checksum: '체크섬이 일치하지 않는다.',
  'pointer-checksum': '포인터와 저장 내용의 체크섬이 다르다.',
  'payload-key-conflict': '같은 키의 저장 내용이 서로 다르다.',
  'staged-readback': '임시 저장 확인이 실패했다.',
  campaign: '현재 콘텐츠와 저장 상태가 맞지 않는다.',
});

/** Readable, honest failure text: known codes get Korean, unknown codes stay visible verbatim. */
export function describeSaveFailure(reason: string): string {
  if (reasonText[reason]) return reasonText[reason]!;
  if (reason.startsWith('campaign-')) return reasonText.campaign! + ' (' + reason + ')';
  if (reason.startsWith('storage-')) return '브라우저 저장소 오류 (' + reason.slice('storage-'.length) + ')';
  return '알 수 없는 오류 (' + reason + ')';
}

/** row + the concrete failure reason when status!=='ok' (null reason = simply absent). */
type DescribedRow = { readonly row: SavesCheckpointRow; readonly reason: string | null };
function describeRow(kind: 'current' | 'previous', key: string | null, reader: SavesStorageReader): DescribedRow {
  const base: SavesCheckpointRow = { kind, key, status: key === null ? 'missing' : 'ok', checksum: null, worldSecondsText: null, envelopeVersion: null };
  if (key === null) return { row: base, reason: null };
  const raw = reader.readPayload(key);
  if (raw === null) return { row: { ...base, status: 'invalid' }, reason: 'missing-payload' };
  try {
    const value = reader.parseSave(JSON.parse(raw));
    return {
      row: {
        kind, key, status: 'ok', checksum: value.checksum,
        worldSecondsText: formatWorldSeconds(value.state.clock.worldMilliseconds),
        envelopeVersion: value.envelopeVersion,
      },
      reason: null,
    };
  } catch (failure) {
    const reason = failure instanceof Error ? ((failure as Error & { readonly reason?: string }).reason ?? failure.message) : 'corrupt-payload';
    return { row: { ...base, status: 'invalid' }, reason };
  }
}

/** Build the save/load view from the real pointer file and payload entries. Never mutates storage. */
export function buildSavesView(reader: SavesStorageReader, content: CampaignContent, clockMs: number, speed: number): SavesView {
  const rows: SavesCheckpointRow[] = [];
  let error: SavesView['error'] = null;
  let hasValidCurrent = false;
  let currentKey: string | null = null, previousKey: string | null = null;
  const raw = reader.readActive();
  if (raw === null) {
    rows.push(describeRow('current', null, reader).row);
  } else {
    try {
      const pointer = JSON.parse(raw) as { current?: unknown; previous?: unknown };
      if (typeof pointer.current !== 'string') throw new Error('invalid-pointer');
      currentKey = pointer.current;
      previousKey = typeof pointer.previous === 'string' ? pointer.previous : null;
    } catch {
      error = { reason: 'invalid-pointer', readable: describeSaveFailure('invalid-pointer') };
      rows.push({ kind: 'current', key: null, status: 'invalid', checksum: null, worldSecondsText: null, envelopeVersion: null });
    }
  }
  if (error === null && currentKey !== null) {
    const current = describeRow('current', currentKey, reader);
    rows.push(current.row);
    if (current.reason !== null) error = { reason: current.reason, readable: describeSaveFailure(current.reason) };
    else hasValidCurrent = true;
  }
  if (error === null) rows.push(describeRow('previous', previousKey, reader).row);
  const versions = Object.entries(content.hashes).map(([name, value]) => ({ name, value: String(value) }));
  return Object.freeze({
    clockMs, speed, rows: Object.freeze(rows), versions: Object.freeze(versions), error, hasValidCurrent,
  });
}
