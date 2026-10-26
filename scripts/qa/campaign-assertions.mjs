import assert from 'node:assert/strict';
import { parseCampaignSave } from '../../game/src/campaign/saveCheckpoint.ts';
import { summaryHash } from '../../game/src/domain/eventLedger.ts';
import { s01Steps } from '../../game/src/campaign/s01Steps.ts';

/** Check durable effects independently of the browser's success marker or UI labels. */
export function assertCampaignSave(input, content, phase) {
  const saved = parseCampaignSave(input, content);
  const state = saved.state;
  assert.equal(state.clock.speed, 0, 'checkpoint must be paused');
  assert.equal(state.custody.length, 1, 'one original, never duplicated');
  assert.equal(state.custody[0].owner, content.data.scenario.ledger.owner);
  assert.equal(new Set(state.appliedResultIds).size, state.appliedResultIds.length);
  for (const result of state.results) assert.match(result.payloadHash, /^[a-f0-9]{64}$/);
  for (const body of state.bodies) for (const region of body.regions) {
    assert.ok(Number.isFinite(region.effortMilliseconds));
    assert.ok(region.effortMilliseconds >= 0);
  }
  for (const inventory of state.inventories) {
    for (const key of ['foodPacks', 'waterMl', 'paperSheets', 'consumedPaperSheets']) {
      assert.ok(Number.isSafeInteger(inventory[key]) && inventory[key] >= 0, key);
    }
  }
  if (phase === 'complete') {
    assert.equal(state.mandates.length, 2);
    assert.deepEqual(state.mandates.map(m => [m.operation, m.recipientId, m.stage]),
      [['S01-L', 'K568', 'receipt'], ['S01-O', 'K616', 'receipt']]);
    assert.equal(state.reports.length, 6);
    assert.equal(state.knowledge.find(k => k.personId === 'K002').records.length, 6);
    assert.ok(state.reports.every(r => r.receivedAt !== null));
    const ledger = state.reports.filter(r => r.source === 'K568');
    const observation = state.reports.filter(r => r.source === 'K616');
    assert.equal(ledger.length, 4);
    assert.equal(observation.length, 2);
    assert.ok(Math.max(...ledger.map(r => r.receivedAt)) < Math.min(...observation.map(r => r.receivedAt)));
    for (const report of observation) {
      assert.equal(report.fact.evidence.kind, 'raw-observation');
      assert.equal(report.fact.evidence.measurementValue, null);
      assert.equal(report.fact.evidence.calibrationReceipt, null);
      assert.equal(report.uncertainty, 'partial-evidence');
    }
    assert.equal(state.results.filter(r => r.kind === 'work').length, 2);
    const reseal = state.results.find(r => r.safeReturn?.action === 'reseal');
    const returned = state.commands.events.find(e => e.kind === 'return-completed');
    assert.ok(reseal && returned, 'physical reseal and return receipt required');
    assert.equal(returned.effectId, reseal.id);
    assert.ok(reseal.at <= returned.at);
    assert.equal(state.custody[0].seal, 'sealed');
    assert.equal(state.custody[0].returnState, 'resealed');
    assert.equal(state.custody[0].custodian, content.data.operations.authority.duty);
    assert.equal(state.custody[0].location.nodeId, content.data.scenario.ledger.container);
    assert.equal(state.custody[0].unresolvedReturn, false);
    const dutyTrack = state.s01.tracks.find(t => t.lane === 'duty-return');
    assert.equal(dutyTrack?.status, 'done');
    const dutyEnd = Math.max(...state.s01.activities.filter(a => a.trackId === dutyTrack.id).map(a => a.completedAt));
    assert.ok(state.mandates[1].issuedAt >= dutyEnd, 'second mandate waits for actual duty return');
    for (const mandate of state.mandates) {
      const track = state.s01.tracks.find(t => t.orderId === mandate.orderId && t.lane === 'investigation');
      assert.ok(track);
      const steps = s01Steps(track, state, content);
      const activities = state.s01.activities.filter(a => a.trackId === track.id);
      assert.equal(activities.length, steps.length, 'every authored physical step completed');
      for (const activity of activities) {
        const step = steps[activity.step];
        assert.equal(activity.progress, step.duration);
        assert.ok(activity.completedAt > activity.startedAt);
        assert.ok(step.people.every(p => Object.hasOwn(activity.finalEffort, p.id)));
      }
    }
  }
  return { checksum: saved.checksum, stateHash: summaryHash(state), worldMilliseconds: state.clock.worldMilliseconds,
    effectIds: state.appliedResultIds, eventIds: state.commands.events.map(e => e.id),
    reportIds: state.knowledge.find(k => k.personId === 'K002').records.map(r => r.reportId) };
}

export function assertRestore(before, after) {
  assert.deepEqual(after, before, 'explicit reload must preserve the entire paused checkpoint, including effect IDs');
}
