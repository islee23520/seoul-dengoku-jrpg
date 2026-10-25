import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { createCampaignE0 } from '../../game/src/campaign/state.ts';
import { CampaignSession } from '../../game/src/campaign/session.ts';
import { advanceCampaignCommands, submitCampaignCommand } from '../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { integer } from '../../game/src/domain/ids.ts';
import { summaryHash } from '../../game/src/domain/eventLedger.ts';
import { campaignWorkLedger } from '../../game/src/campaign/workResults.ts';
import { createCampaignSave, persistCampaignSave, loadCampaignSave, CAMPAIGN_SAVE_NAMESPACE } from '../../game/src/campaign/saveCheckpoint.ts';
import { CheckpointCorrupt } from '../../game/src/save/campaignCheckpoint.ts';
import { migrateLegacySave, persistLegacyWorldSave, loadLegacyWorldSave, restoreLegacyWorldSave } from '../../game/src/campaign/saveMigration.ts';
import { legacyCheckpoint, legacyContext } from '../../game/src/campaign/legacySaveFixtures.ts';
import { RealtimeHost } from '../../game/src/runtime/realtimeHost.ts';
import { worldAdvance } from '../../game/src/runtime/worldClock.ts';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/qa/campaign-save.ts --scenario save-reload|invalid-save|legacy-migration');
} else {
  assert.equal(args.length, 2, 'expected --scenario NAME');
  assert.equal(args[0], '--scenario');
  const scenario = args[1];
  assert.ok(scenario === 'save-reload' || scenario === 'invalid-save' || scenario === 'legacy-migration', 'unknown scenario');
  const data = new URL('../../game/data/', import.meta.url);
  const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
    scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
  const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await readFile(new URL(file, data), 'utf8')])));
  const content = CampaignContent.parse(packages), e0 = createCampaignE0(content);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let receipt: unknown;
  switch (scenario) {
    case 'save-reload': {
      const basis = composeCampaignAuthority(e0, { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: e0.revision }, content);
      const issued = submitCampaignCommand(e0, { kind: 'issue', commandId: 'cli-save-L', operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568',
        expectedRevision: e0.revision, expectedCompositeVersion: basis.compositeVersion }, content).state;
      const mid = advanceCampaignCommands(issued, integer('WorldMilliseconds', 780000), content, true);
      const expected = advanceCampaignCommands(mid, integer('WorldMilliseconds', 1002000), content, true);
      persistCampaignSave(storage, createCampaignSave(mid, content), content);
      let now = 1000000;
      const session = new CampaignSession({ content, state: expected, now: () => now,
        advance: (state, until) => advanceCampaignCommands(state, until, content, true) });
      session.restore(loadCampaignSave(storage, content).state);
      session.restore(loadCampaignSave(storage, content).state);
      assert.deepEqual(session.state, mid);
      session.setSpeed(1); now += 37000; session.reconcile();
      const actual = session.state;
      assert.deepEqual(actual.custody, expected.custody);
      assert.deepEqual(actual.reports, expected.reports);
      assert.deepEqual(actual.commands.events, expected.commands.events);
      assert.deepEqual(actual.results, expected.results);
      receipt = { midRoute: mid.custody, restoredAt: mid.clock.worldMilliseconds, continuedAt: actual.clock.worldMilliseconds,
        eventIds: actual.commands.events.map(e => e.id), resultIds: actual.results.map(r => r.id),
        completionIds: campaignWorkLedger(actual, content).entries.map(e => e.resultId),
        reportsHash: summaryHash(actual.reports), custodyHash: summaryHash(actual.custody), noOfflineAccrual: true };
      session.close();
      break;
    }
    case 'invalid-save': {
      const saved = createCampaignSave(e0, content);
      persistCampaignSave(storage, saved, content);
      const key = CAMPAIGN_SAVE_NAMESPACE + ':payload:' + saved.checksum;
      const raw = values.get(key); assert.ok(raw);
      values.set(key, raw.slice(0, -7));
      const before = [...values];
      assert.throws(() => loadCampaignSave(storage, content), CheckpointCorrupt);
      assert.deepEqual([...values], before);
      receipt = { rejected: 'truncated-payload', activePointerUnchanged: true, originalExportAvailable: values.get(key) !== null };
      break;
    }
    case 'legacy-migration': {
      const legacy = legacyCheckpoint('서울', 1590000);
      const result = migrateLegacySave(JSON.stringify(legacy), legacyContext);
      assert.equal(result.kind, 'migrated');
      persistLegacyWorldSave(storage, result.save, legacyContext);
      const host = new RealtimeHost({ state: { ...legacy.runtime, worldTime: 2000000 }, mode: 'TESTINPUT', settle: state => state,
        rules: { intervalMs: 10, worldUnitsPerStep: 1, provenance: 'TESTINPUT', approvedInputsHash: legacy.versions.approvedInputsHash,
          battle: null, encounter: null, validateApproval: () => false, advanceWorld: worldAdvance(legacyContext.worldRules, 'TESTINPUT') } });
      const stale = host.bind();
      restoreLegacyWorldSave(host, loadLegacyWorldSave(storage, legacyContext), legacyContext);
      restoreLegacyWorldSave(host, result.save, legacyContext);
      stale.elapsed(1000000);
      assert.deepEqual(host.state, legacy.runtime);
      const excluded = migrateLegacySave(JSON.stringify(legacyCheckpoint('석수')), legacyContext);
      assert.equal(excluded.kind, 'quarantined');
      receipt = { fixture: 'TESTINPUT real-v1-writer/worldClock contract', provenance: result.save.provenance,
        exactWorldTime: host.state.worldTime, exactClockCarry: host.state.clockCarry, legacyHash: summaryHash(host.state),
        excludedKind: excluded.kind, oldUnitsPreserved: true };
      break;
    }
    default: scenario satisfies never;
  }
  console.log(JSON.stringify({ status: 'passed', scenario, receipt }, null, 2));
}
