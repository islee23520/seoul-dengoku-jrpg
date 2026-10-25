import { z } from '../../../engine/node_modules/zod/index.js';
import { runtimeSchema } from '../runtime/realtimeHost.ts';
import type { RuntimeState } from '../runtime/realtimeHost.ts';
import { count, ref, json, hash, canonical, resultId, BattleConflict } from '../battle/realtime.ts';
import type { BattleOutcome, Json } from '../battle/realtime.ts';

export const SAVE_NAMESPACE = 'seoul-realtime-campaign-v1';
const versionsSchema = z.strictObject({ rulesHash: ref, contentHash: ref, approvedInputsHash: ref }).readonly();
export type Versions = z.infer<typeof versionsSchema>;
const receiptSchema = z.strictObject({ resultId, battleId: ref, payloadHash: ref,
  beforeCampaignHash: ref, afterCampaignHash: ref, ledgerPosition: count }).readonly();
export type SettlementReceipt = z.infer<typeof receiptSchema>;
export const campaignSchema = z.strictObject({ facts: json, settlementReceipts: z.array(receiptSchema).readonly(), ledgerCursor: count }).readonly();
export type Campaign = z.infer<typeof campaignSchema>;
const envelopeSchema = z.strictObject({
  envelopeVersion: z.literal(1), versions: versionsSchema, runtime: runtimeSchema,
  engineProjection: json, stockAutosaveAccess: z.literal(false), checksum: ref,
}).readonly();
export type CampaignCheckpoint = z.infer<typeof envelopeSchema>;
export type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem'>;
export class CheckpointCorrupt extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.name = 'CheckpointCorrupt'; this.reason = reason; }
}
export function applyOutcome(campaign: Campaign, outcome: BattleOutcome, apply: (facts: Json, outcome: BattleOutcome) => Json): { readonly campaign: Campaign; readonly receipt: SettlementReceipt } {
  const { payloadHash, ...payload } = outcome;
  if (hash(payload) !== payloadHash) throw new BattleConflict('outcome-hash');
  const previous = campaign.settlementReceipts.find(r => r.resultId === outcome.resultId || r.battleId === outcome.battleId);
  if (previous) {
    if (previous.resultId !== outcome.resultId || previous.battleId !== outcome.battleId || previous.payloadHash !== payloadHash) throw new BattleConflict('settlement-conflict');
    return { campaign, receipt: previous };
  }
  const beforeCampaignHash = hash(campaign.facts);
  const copy = structuredClone(campaign.facts);
  const facts = json.parse(apply(copy, outcome));
  const receipt = { resultId: outcome.resultId, battleId: outcome.battleId, payloadHash, beforeCampaignHash, afterCampaignHash: hash(facts), ledgerPosition: campaign.ledgerCursor + 1 };
  return { campaign: { facts, settlementReceipts: [...campaign.settlementReceipts, receipt], ledgerCursor: receipt.ledgerPosition }, receipt };
}
export function checkpoint(runtime: RuntimeState, input: { readonly versions: Versions; readonly engineProjection: Json }): CampaignCheckpoint {
  const payload = { envelopeVersion: 1 as const, versions: input.versions, runtime: structuredClone(runtime), engineProjection: structuredClone(input.engineProjection), stockAutosaveAccess: false as const };
  return restoreCheckpoint({ ...payload, checksum: hash(payload) }, input.versions);
}
export function restoreCheckpoint(value: unknown, expected: Versions): CampaignCheckpoint {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new CheckpointCorrupt('envelope-shape');
  const envelope = parsed.data;
  const { checksum, ...payload } = envelope;
  if (checksum !== hash(payload)) throw new CheckpointCorrupt('checksum');
  if (canonical(envelope.versions) !== canonical(expected)) throw new CheckpointCorrupt('versions');
  const campaign = campaignSchema.safeParse(envelope.runtime.campaignState);
  if (!campaign.success) throw new CheckpointCorrupt('campaign');
  const receipts = campaign.data.settlementReceipts;
  if (campaign.data.ledgerCursor !== receipts.length || new Set(receipts.map(r => r.resultId)).size !== receipts.length || new Set(receipts.map(r => r.battleId)).size !== receipts.length || receipts.some((r, i) => r.ledgerPosition !== i + 1)) throw new CheckpointCorrupt('receipt-chain');
  const battle = envelope.runtime.battle;
  if (battle) {
    if (battle.context.rulesHash !== expected.rulesHash || battle.context.contentHash !== expected.contentHash || battle.context.approvedInputsHash !== expected.approvedInputsHash) throw new CheckpointCorrupt('battle-versions');
    if (battle.appliedCursor > battle.acceptedLog.length || battle.acceptedLog.some((a, i) => a.sequence !== i + 1 || a.effectiveNextTick !== a.acceptedWorldTick + 1 || a.acceptedWorldTick > envelope.runtime.worldTick || a.intent.contextHash !== hash(battle.context) || battle.signalReceipts[i]?.commandId !== a.intent.commandId || battle.signalReceipts[i]?.sequence !== a.sequence) || battle.signalReceipts.length !== battle.acceptedLog.length || new Set(battle.acceptedLog.map(a => a.intent.commandId)).size !== battle.acceptedLog.length) throw new CheckpointCorrupt('command-cursor');
    if (Object.entries(battle.currentOrders).some(([unit, order]) => order.sequence > battle.appliedCursor || !order.intent.selectedUnitIds.includes(unit) || canonical(order) !== canonical(battle.acceptedLog[order.sequence - 1] ?? null))) throw new CheckpointCorrupt('current-orders');
    if (battle.outcome) {
      const { payloadHash, ...outcome } = battle.outcome;
      if (payloadHash !== hash(outcome) || outcome.battleId !== battle.context.battleId || outcome.contextHash !== hash(battle.context) || outcome.rulesHash !== expected.rulesHash) throw new CheckpointCorrupt('outcome');
    }
  }
  return envelope;
}
export function persistCheckpoint(storage: CheckpointStorage, envelope: CampaignCheckpoint): void {
  restoreCheckpoint(envelope, envelope.versions);
  const key = SAVE_NAMESPACE + ':payload:' + envelope.checksum;
  const payload = canonical(envelope);
  storage.setItem(key, payload);
  const readback = storage.getItem(key);
  if (readback !== payload) throw new CheckpointCorrupt('staged-readback');
  restoreCheckpoint(JSON.parse(readback), envelope.versions);
  const pointerKey = SAVE_NAMESPACE + ':active';
  const previous = storage.getItem(pointerKey);
  const pointer = previous === null ? null : pointerSchema.parse(JSON.parse(previous));
  storage.setItem(pointerKey, canonical({ current: key, previous: pointer?.current ?? null }));
}
const pointerSchema = z.strictObject({ current: ref, previous: ref.nullable() });
export function loadCheckpoint(storage: CheckpointStorage, expected: Versions): CampaignCheckpoint {
  const raw = storage.getItem(SAVE_NAMESPACE + ':active');
  if (raw === null) throw new CheckpointCorrupt('missing-checkpoint');
  const pointer = pointerSchema.parse(JSON.parse(raw));
  if (!pointer.current.startsWith(SAVE_NAMESPACE + ':payload:')) throw new CheckpointCorrupt('namespace');
  const payload = storage.getItem(pointer.current);
  if (payload === null) throw new CheckpointCorrupt('missing-payload');
  return restoreCheckpoint(JSON.parse(payload), expected);
}
