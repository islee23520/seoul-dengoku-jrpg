import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import type { EventLedger } from '../domain/eventLedger.ts';
import { applyResult, summaryHash } from '../domain/eventLedger.ts';
import { integer } from '../domain/ids.ts';
import { parseCampaignState } from './state.ts';
import { projectGrowth } from '../domain/growth.ts';
import type { GrowthState } from '../domain/growth.ts';

/** A deterministic adapter over durable completion receipts, never lifecycle snapshots. */
export function campaignWorkLedger(input: CampaignState, content: CampaignContent): EventLedger {
  const state = parseCampaignState(input, content);
  let ledger: EventLedger = { schemaVersion: integer('SchemaVersion', 1), ruleVersion: state.rulesRevision,
    contentVersion: state.packages.manifest, entries: [], pendingResultIds: [] };
  for (const result of state.results.filter(r => r.kind === 'work')) {
    const order = state.mandates.find(m => m.orderId === result.orderId)!;
    ledger = applyResult(ledger, { command: 'work-resolution', resultId: result.id, causeId: result.causeId,
      actor: order.recipientId, target: order.orderId, worldTime: integer('WorldTick', result.at),
      ruleVersion: ledger.ruleVersion, contentVersion: ledger.contentVersion, payload: { ...result },
      beforeHash: ledger.entries.at(-1)?.afterHash ?? summaryHash(null), afterHash: summaryHash(result) }).ledger;
  }
  return ledger;
}

/** S01 has no admitted growth inputs. Preserve XP and the unapplied candidate IDs. */
export function campaignWorkGrowth(state: CampaignState, growth: GrowthState, content: CampaignContent) {
  const ledger = campaignWorkLedger(state, content);
  return Object.freeze({ projection: projectGrowth(growth, ledger), pendingApplicability: Object.freeze(ledger.entries
    .filter(e => e.actor === growth.person && !growth.appliedResults.includes(e.resultId)).map(e => e.resultId)) });
}
