/** Private QA-only generator, loaded on Vite's Node side; never imported by a production entry.
 * Seeds follow application.test.ts / authorityReadiness.test.ts, not a player debug API.
 * No domain state is forged to manufacture a successful investigation or received report. */
import assert from 'node:assert/strict';
import { content, e0, reportedState } from '../../game/src/campaign/testFixtures.ts';
import { changedGrant } from '../../game/src/campaign/authorityFixtures.ts';
import { submitCampaignCommand, advanceCampaignCommands } from '../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { CampaignBoundaryError } from '../../game/src/campaign/errors.ts';
import { parseCampaignState } from '../../game/src/campaign/state.ts';
import type { CampaignState } from '../../game/src/campaign/state.ts';
import { integer } from '../../game/src/domain/ids.ts';
import { summaryHash } from '../../game/src/domain/eventLedger.ts';
import { buildInboxView, newerReceivedVersion } from '../../game/ui/campaignReportsModel.ts';
import { buildSettlementView } from '../../game/ui/campaignSettlementModel.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const advance = (state: CampaignState, at: number) =>
  advanceCampaignCommands(state, integer('WorldMilliseconds', at), content, true);
function issue(state: CampaignState, commandId: string) {
  const basis = composeCampaignAuthority(state, { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: state.revision }, content);
  return { kind: 'issue' as const, commandId, operation: 'S01-L' as const, issuerPersonId: 'K002', recipientId: 'K568',
    expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion };
}
function rejection(state: CampaignState, input: unknown, expected: string) {
  const before = summaryHash(state);
  let code: string | null = null;
  try { submitCampaignCommand(state, input, content); }
  catch (error) { if (!(error instanceof CampaignBoundaryError)) throw error; code = error.code; }
  assert.equal(code, expected);
  assert.equal(summaryHash(state), before, 'rejected request must not mutate its checkpoint');
  return `${expected} · 경계 거부 · 체크포인트 변경 없음`;
}
const command = issue(e0, 'qa:revoked');
const delivered = advance(submitCampaignCommand(e0, command, content).state, 36000);
const revoked = advance(changedGrant(delivered, 'revoked'), 66000);
assert.equal(revoked.mandates[0]?.stage, 'refused');
assert.equal(revoked.commands.events.at(-1)?.reason, 'authority-revoked');
assert.equal(revoked.reservations.length, 0);
const tired = parseCampaignState({ ...delivered, bodies: delivered.bodies.map(body => body.entityId !== 'K568' ? body : {
  ...body, regions: body.regions.map(region => region.region === 'head' ? { ...region, effortMilliseconds: 1800000 } : region),
}) }, content);
const refused = advance(tired, 66000);
assert.equal(refused.mandates[0]?.stage, 'refused');
assert.equal(refused.commands.events.at(-1)?.reason, 'body-unavailable');
assert.equal(refused.mandates[0]?.acceptedAt, null);
const staleInput = { ...issue(e0, 'qa:stale-rights'), expectedCompositeVersion: 'f'.repeat(64) };
const staleReceipt = rejection(e0, staleInput, 'grant-version');
const supportShort = advance(e0, 3000000);
const supportShortReceipt = rejection(supportShort, issue(supportShort, 'qa:short-support'), 'support-unavailable');
const supportExpired = advance(e0, content.data.operations.clock.supportUntilSeconds * 1000);
assert.equal(buildSettlementView(supportExpired, content, 'K002').support, 'expired');
// At 5400s the admitted pack's 3600s authority deadline has already passed. Do not fake
// support-unavailable by bypassing compose: the actual admission outcome is authority-expired.
const expiredReceipt = rejection(supportExpired, { ...issue(e0, 'qa:expired-support'), expectedRevision: supportExpired.revision }, 'authority-expired');

function eventReceipt(state: CampaignState): string {
  return state.commands.events.filter(event => ['issued', 'delivered', 'received', 'accepted', 'refused', 'interrupted'].includes(event.kind))
    .map(event => `${event.kind} @ ${event.at / 1000}세계초${event.reason ? ` · ${event.reason}` : ''}`).join(' → ');
}
const domain = (id: string, label: string, screen: 'orders' | 'settlement', state: CampaignState, receipt: string, note: string) => ({
  id, label, screen, mode: 'real-domain' as const, state, receipt, note,
});
const cases = [
  domain('orders-revoked', '명령 · 권한 철회', 'orders', revoked, eventReceipt(revoked),
    '실제 발행·대면 전달 후 authorityFixtures.changedGrant로 철회 이력을 추가하고 실제 reducer가 거부했다. 명령 행을 눌러 사유와 경과를 연다.'),
  domain('orders-stale-rights', '명령 · 오래된 권한 검토', 'orders', e0, staleReceipt,
    '실제 submitCampaignCommand에 낡은 합성 권한 판본을 제출했다. 정상 권한 화면은 현재 근거이며, 거부된 과거 검토는 아래 QA 영수에만 남는다. 가짜 발행 명령은 만들지 않는다.'),
  domain('orders-refused', '명령 · 신체 조건 거부', 'orders', refused, eventReceipt(refused),
    '실제 전달 체크포인트에 기존 테스트와 같은 head effort 1800초 음성 조건을 넣고 실제 reducer가 거부했다. 수락·예약은 발생하지 않는다.'),
  domain('orders-support-expired', '명령 · 지원 만료 5400초', 'orders', supportExpired, expiredReceipt,
    '실제 시간 reducer로 지원 만료에 도달했다. 이 pack은 3600초 폐관이 먼저이므로 실제 명령 경계는 authority-expired다. support-unavailable로 위장하지 않는다.'),
  domain('orders-support-unavailable', '명령 · 남은 지원 부족', 'orders', supportShort, supportShortReceipt,
    '3000세계초: 권한은 아직 유효하지만 실제 전체 업무 완료에 남은 지원 시간이 부족해 새 명령이 support-unavailable로 거부된다.'),
  domain('settlement-support-expired', '정착지 · 지원 만료', 'settlement', supportExpired,
    '실제 reducer → 5400세계초 · buildSettlementView.support = expired · 새 명령: authority-expired(폐관 선행)',
    'E0에서 실제 reducer로 5400초까지 경과했다. 업무 완료·새 지식·원장 이동을 만들어내지 않는다.'),
  domain('settlement-revoked', '정착지 · 권한 철회 후 거부', 'settlement', revoked, eventReceipt(revoked),
    '명령 발행·전달·철회 후 실제 reducer가 만든 refused 상태를 생산 정착지 투영으로 표시한다.'),
];

// Explicit readonly UI-negative snapshot, NOT a reconstructed lawful gameplay receipt.
// Start from the existing received test fixture, then present two separately labelled inbox
// versions solely to exercise the production older-version UI. Never parse or load this as world state.
const baseline = buildInboxView(reportedState(true), content, 'K002');
const old = baseline.rows[0];
assert.ok(old);
const originalPayload = JSON.stringify(old);
const newer = freeze({ ...old, reportId: 'qa:readonly:newer-report', version: old.version + 1,
  receivedAt: old.receivedAt + 1000, title: old.title + ' · QA 읽기 전용 후속 판본',
  evidence: { ...old.evidence, lines: [...old.evidence.lines, 'QA 전용 후속 판본 표식 — 실제 새 관측·수신이 아님'] },
});
const inbox = freeze({ clockMs: baseline.clockMs + 1000, rows: [old, newer] });
assert.equal(newerReceivedVersion(old, inbox.rows)?.reportId, newer.reportId);
assert.equal(Reflect.set(old, 'version', 99), false);
assert.equal(Reflect.set(old.evidence.lines, '0', 'rewritten'), false);
assert.equal(JSON.stringify(old), originalPayload, 'old received payload must stay byte-for-byte identical');
export const negativeFixture = freeze({ cases, reports: {
  id: 'reports-older', label: '보고 · 이전 수신 판본(읽기 전용 QA 스냅숏)', mode: 'readonly-ui-snapshot' as const,
  inbox, oldReportId: old.reportId, oldPayload: originalPayload,
  receipt: `읽기 전용 UI 음성 스냅숏 · v${old.version} 원본 유지 · v${newer.version} 별도 행 · 원본 판본/증거 수정 시도 거부`,
  note: '기존 testFixtures.reportedState(true)의 수신 행을 그대로 보존했다. 높은 판본은 UI 음성 검사용 별도 읽기 전용 행이며 실제 게임 수신/관측으로 주장하지 않는다. 이전 행과 새 행을 번갈아 눌러 원본이 바뀌지 않는지 확인한다.',
} });
export type NegativeFixture = typeof negativeFixture;
