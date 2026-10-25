import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, e0 } from './testFixtures.ts';
import { CampaignSession } from './session.ts';
import { createCampaignSave, parseCampaignSave, persistCampaignSave, loadCampaignSave, CAMPAIGN_SAVE_NAMESPACE } from './saveCheckpoint.ts';
import { CheckpointCorrupt } from '../save/campaignCheckpoint.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import type { CheckpointStorage } from '../save/campaignCheckpoint.ts';
import { checkpoint, persistCheckpoint, SAVE_NAMESPACE } from '../save/campaignCheckpoint.ts';
import { migrateLegacySave, persistLegacyWorldSave, loadLegacyWorldSave } from './saveMigration.ts';
import { legacyCheckpoint, legacyContext } from './legacySaveFixtures.ts';
import { campaignSchema } from '../save/campaignCheckpoint.ts';
import { contextSchema, startBattle } from '../battle/realtime.ts';

class StorageFixture implements CheckpointStorage {
  readonly values = new Map<string, string>();
  failure: 'none' | 'payload' | 'partial' | 'readback' | 'pointer' = 'none';
  getItem(key: string): string | null {
    return this.failure === 'readback' && key.includes(':payload:') ? '{' : this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (key.includes(':payload:') && this.failure === 'partial') {
      this.values.set(key, value.slice(0, value.length / 2));
      throw new DOMException('injected termination', 'QuotaExceededError');
    }
    if ((key.includes(':payload:') && this.failure === 'payload') || (key.endsWith(':active') && this.failure === 'pointer')) {
      throw new DOMException('injected quota', 'QuotaExceededError');
    }
    this.values.set(key, value);
  }
}

for (const failure of ['payload', 'partial', 'readback', 'pointer'] as const) {
  test('keeps the committed save when staging fails at ' + failure, () => {
    // Given a durable save and a different pending save.
    const storage = new StorageFixture(), first = createCampaignSave(e0, content);
    persistCampaignSave(storage, first, content);
    const pointer = storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active');
    const next = createCampaignSave({ ...e0, revision: 1 }, content);
    storage.failure = failure;
    // When storage fails before the commit point.
    assert.throws(() => persistCampaignSave(storage, next, content), CheckpointCorrupt);
    storage.failure = 'none';
    // Then both active pointer and committed payload survive.
    assert.equal(storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'), pointer);
    assert.deepEqual(loadCampaignSave(storage, content), first);
    persistCampaignSave(storage, next, content);
    assert.deepEqual(loadCampaignSave(storage, content), next);
  });
}

test('rejects rehashed invalid custody before replacing a durable save', () => {
  // Given a valid save with a checksum-consistent forged custody link.
  const storage = new StorageFixture(), saved = createCampaignSave(e0, content);
  persistCampaignSave(storage, saved, content);
  const { checksum: _checksum, ...payload } = saved;
  const forged = { ...payload, state: { ...e0, custody: [] } };
  // When the payload passes its outer checksum but fails its state boundary.
  assert.throws(() => persistCampaignSave(storage, { ...forged, checksum: summaryHash(forged) }, content), CheckpointCorrupt);
  // Then no replacement is installed.
  assert.deepEqual(loadCampaignSave(storage, content), saved);
});

test('restores an earlier boundary exactly without crediting elapsed offline time', () => {
  // Given an explicit save and a live session that has advanced farther.
  let now = 0;
  const session = new CampaignSession({ content, state: e0, now: () => now });
  session.setSpeed(2); now = 1000;
  const saved = createCampaignSave(session.checkpoint(), content);
  now = 2000; session.reconcile();
  // When the same save is restored twice much later.
  now = 900000;
  session.restore(saved.state);
  session.restore(saved.state);
  // Then the restored clock is exact and a new origin prevents offline accrual.
  assert.deepEqual(session.state, saved.state);
  session.reconcile();
  assert.deepEqual(session.state, saved.state);
  session.close();
});

test('rejects inherited save options before reading their values', () => {
  // Given an inherited envelope, not an own-data checkpoint.
  const saved = createCampaignSave(e0, content);
  const inherited: unknown = Object.create(saved);
  // When / Then the trust boundary rejects it.
  assert.throws(() => parseCampaignSave(inherited, content), CheckpointCorrupt);
});

for (const station of ['Guro', '서울']) test('migrates real v1 stationary world facts without rewriting history: ' + station, () => {
  // Given the actual v1 writer output, not an invented composed-in-v1 payload.
  const legacy = legacyCheckpoint(station), original = JSON.stringify(legacy);
  const storage = new StorageFixture();
  persistCheckpoint(storage, legacy);
  const originalPointer = storage.getItem(SAVE_NAMESPACE + ':active');
  // When the identity-only world snapshot is migrated and staged in its separate namespace.
  const result = migrateLegacySave(original, legacyContext);
  assert.equal(result.kind, 'migrated');
  persistLegacyWorldSave(storage, result.save, legacyContext);
  // Then runtime/facts/receipts/clock/RNG retain their previous meaning and old bytes survive.
  const restored = loadLegacyWorldSave(storage, legacyContext);
  assert.deepEqual(restored.legacy, legacy);
  assert.equal(restored.original, original);
  assert.equal(restored.provenance.stations[0]?.newId, station === '서울' ? '서울역' : 'Guro');
  assert.equal(storage.getItem(SAVE_NAMESPACE + ':active'), originalPointer);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_NAMESPACE + ':payload:' + legacy.checksum) ?? 'null'), legacy);
});

for (const worldTime of [989000, 990000, 1001000, 1590000]) test('preserves legacy timeline units at ' + worldTime, () => {
  // Given an old runtime clock below the corrected 1002/1602 second endpoints.
  const legacy = legacyCheckpoint('Guro', worldTime);
  // When legacy facts migrate without a conversion receipt.
  const result = migrateLegacySave(JSON.stringify(legacy), legacyContext);
  // Then no invented +12 seconds, replay or completed S01 work is added.
  assert.equal(result.kind, 'migrated');
  assert.deepEqual(result.save.legacy.runtime, legacy.runtime);
});

test('quarantines an excluded station with exportable original and no storage writes', () => {
  // Given an authentic old graph identity that the current edition excludes.
  const original = JSON.stringify(legacyCheckpoint('석수'));
  // When the importer resolves the complete checkpoint.
  const result = migrateLegacySave(original, legacyContext);
  // Then the whole checkpoint remains an export, not a nearest-station replacement.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.equal(result.reason, 'unsupported-station-identity');
  assert.equal(result.original, original);
});

test('quarantines engine snapshots without discarding the previous engine projection', () => {
  // Given exactly the projection field persisted by the v1 writer.
  const legacy = legacyCheckpoint('Guro');
  const snapshot = { version: 1, session: { mapId: 'station-4775726f', x: 3, y: 4, gold: 17 } };
  const envelope = checkpoint(legacy.runtime, { versions: legacy.versions, engineProjection: snapshot });
  const original = JSON.stringify(envelope);
  // When there is no approved local-tile compatibility map.
  const result = migrateLegacySave(original, legacyContext);
  // Then the original snapshot is available under quarantine, never transplanted into S01.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.deepEqual(result.legacy?.engineProjection, snapshot);
  assert.equal(result.original, original);
});

for (const mutate of [
  (raw: string) => raw.slice(0, -4),
  (raw: string) => raw.replace('"envelopeVersion":1', '"envelopeVersion":9'),
  (raw: string) => raw.replace('TESTINPUT:content', 'FOREIGN:content'),
]) test('keeps invalid or foreign original bytes exportable', () => {
  // Given a truncated, future or foreign v1 import.
  const original = mutate(JSON.stringify(legacyCheckpoint('Guro')));
  // When importing without touching the active namespace.
  const result = migrateLegacySave(original, legacyContext);
  // Then readable quarantine retains the exact input.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.ok(result.reason.length > 0);
  assert.equal(result.original, original);
});

test('rejects inherited migration configuration without evaluating getters', () => {
  // Given inherited old-edition inputs.
  const inherited: typeof legacyContext = Object.create(legacyContext);
  // When migration receives options that were not explicitly supplied.
  const result = migrateLegacySave(JSON.stringify(legacyCheckpoint('Guro')), inherited);
  // Then it quarantines without accepting inherited version/graph authority.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.equal(result.reason, 'inherited-option');
});

test('preserves historical settlement receipts during station identity migration', () => {
  // Given a real v1 writer output with a past settlement receipt.
  const legacy = legacyCheckpoint('서울');
  const campaign = campaignSchema.parse(legacy.runtime.campaignState);
  const receipts = [{ resultId: 'legacy:result', battleId: 'legacy:battle', payloadHash: 'historical-payload',
    beforeCampaignHash: 'historical-before', afterCampaignHash: 'historical-after', ledgerPosition: 1 }];
  const envelope = checkpoint({ ...legacy.runtime, campaignState: { ...campaign, settlementReceipts: receipts, ledgerCursor: 1 } },
    { versions: legacy.versions, engineProjection: null });
  // When the current identity map resolves the old station separately.
  const result = migrateLegacySave(JSON.stringify(envelope), legacyContext);
  // Then no historical hash, ID or payload is rewritten.
  assert.equal(result.kind, 'migrated');
  assert.deepEqual(result.save.legacy.runtime.campaignState, envelope.runtime.campaignState);
});

test('quarantines a valid old battle rather than manufacturing current combat admission', () => {
  // Given a valid battle persisted by the actual v1 writer.
  const legacy = legacyCheckpoint('Guro');
  const context = contextSchema.parse({ battleId: 'legacy:battle', encounterId: 'legacy:encounter', worldStartTick: 0, worldStartTime: 0,
    schemaVersion: 1, ...legacy.versions, provenance: 'TESTINPUT', persons: [], heroes: [], squads: [], commandGrants: {}, formations: {},
    navigation: {}, objective: {}, supplyReservations: {}, legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: { combat: 2 } });
  const envelope = checkpoint({ ...legacy.runtime, battle: startBattle(context) }, { versions: legacy.versions, engineProjection: null });
  // When migration has no approved battle compatibility.
  const result = migrateLegacySave(JSON.stringify(envelope), legacyContext);
  // Then the full original stays quarantined and available for export.
  assert.equal(result.kind, 'quarantined');
  if (result.kind !== 'quarantined') assert.fail();
  assert.equal(result.reason, 'unsupported-legacy-battle');
  assert.deepEqual(result.legacy, envelope);
});
