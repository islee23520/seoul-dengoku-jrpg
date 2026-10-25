import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyCheckpoint, legacyContext } from './legacySaveFixtures.ts';
import { migrateLegacySave, parseLegacyWorldSave } from './saveMigration.ts';
import { campaignSchema, checkpoint, CheckpointCorrupt } from '../save/campaignCheckpoint.ts';
import { restoreWorld } from '../runtime/worldClock.ts';
import { executionSchema, mandateSchema } from '../runtime/orderExecution.ts';
import { order } from '../domain/fixtures/opening.ts';
import { createCampaignSave, parseCampaignSave } from './saveCheckpoint.ts';
import { content, e0 } from './testFixtures.ts';
import { summaryHash } from '../domain/eventLedger.ts';

test('quarantines an active previous-edition route without guessing placement', () => {
  // Given an actual v1 worldClock execution with unfinished route progress.
  const legacy = legacyCheckpoint('Guro');
  const campaign = campaignSchema.parse(legacy.runtime.campaignState);
  const world = restoreWorld(campaign.facts, legacyContext.worldRules);
  const execution = executionSchema.parse({ mandate: { ...mandateSchema.unwrap().strip().parse(order),
    issuerLocation: 'Guro', recipientLocation: 'Guro', physicalLocation: 'Guro', communicationRoute: ['Guro'] },
    serial: 0, journey: { path: ['Guro'], leg: 0, elapsed: 0 }, workPath: ['Guro'], reportPath: ['Guro'], workElapsed: 0, reservationKeys: [] });
  const envelope = checkpoint({ ...legacy.runtime, campaignState: { ...campaign, facts: { ...world, orders: [execution] } } },
    { versions: legacy.versions, engineProjection: null });
  // When the whole old checkpoint is imported.
  const result = migrateLegacySave(JSON.stringify(envelope), legacyContext);
  // Then no route/body placement or permission is invented.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.equal(result.reason, 'unsupported-active-route');
  assert.deepEqual(result.legacy, envelope);
});

test('rejects a rehashed migration that changes the historical runtime', () => {
  // Given a migrated actual v1 payload.
  const result = migrateLegacySave(JSON.stringify(legacyCheckpoint('Guro')), legacyContext);
  assert.equal(result.kind, 'migrated');
  const { checksum: _checksum, ...payload } = result.save;
  const forged = { ...payload, legacy: { ...payload.legacy, runtime: { ...payload.legacy.runtime, worldTime: 1002000 } } };
  // When a caller tries to bless rewritten history with a fresh outer digest.
  // Then original-byte derivation rejects the replacement.
  assert.throws(() => parseLegacyWorldSave({ ...forged, checksum: summaryHash(forged) }, legacyContext), CheckpointCorrupt);
});

test('rejects an omitted durable field rather than repairing it through schema defaults', () => {
  // Given a fully valid current save with defaultable data removed without a new checksum.
  const saved = createCampaignSave(e0, content);
  const { subWorldMicroseconds: _carry, ...clock } = saved.state.clock;
  const incomplete = { ...saved, state: { ...saved.state, clock } };
  // When the complete checkpoint parser sees the incomplete envelope.
  // Then defaults cannot make the deleted persisted field invisible.
  assert.throws(() => parseCampaignSave(incomplete, content), CheckpointCorrupt);
});

test('quarantines a substitute legacy graph even when its station names match', () => {
  // Given a caller trying to replace authenticated legacy topology.
  const context = { ...legacyContext, legacyGraphSource: JSON.stringify(legacyContext.worldRules.graph) };
  // When old graph bytes do not match task2 provenance.
  const result = migrateLegacySave(JSON.stringify(legacyCheckpoint('Guro')), context);
  // Then migration cannot authorize a caller-invented graph.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.equal(result.reason, 'legacy-graph-hash');
});
