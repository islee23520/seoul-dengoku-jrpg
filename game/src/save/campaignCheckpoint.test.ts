import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOutcome, campaignSchema, checkpoint, restoreCheckpoint, persistCheckpoint, loadCheckpoint, SAVE_NAMESPACE, CheckpointCorrupt } from './campaignCheckpoint.ts';
import type { Campaign, CheckpointStorage } from './campaignCheckpoint.ts';
import { runtimeSchema, RealtimeHost } from '../runtime/realtimeHost.ts';
import { contextSchema, startBattle, stepBattle, confirmIntent, intentSchema, hash, BattleConflict } from '../battle/realtime.ts';
import { id } from '../domain/ids.ts';
import { grant, lord } from '../domain/fixtures/opening.ts';

const versions = { rulesHash: 'TESTINPUT:rules', contentHash: 'TESTINPUT:content', approvedInputsHash: 'TESTINPUT:approval' };
const context = contextSchema.parse({ battleId: 'TESTINPUT:battle', encounterId: 'TESTINPUT:encounter', worldStartTick: 0, worldStartTime: 0,
  schemaVersion: 1, ...versions, provenance: 'TESTINPUT', persons: [], heroes: [], squads: [], commandGrants: {}, formations: {}, navigation: {}, objective: {},
  supplyReservations: {}, legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: { combat: 2 } });
const campaign: Campaign = { facts: { supply: 10 }, settlementReceipts: [], ledgerCursor: 0 };
const state = runtimeSchema.parse({ worldTick: 0, worldTime: 0, clockCarry: 3, encounterAccumulator: 0.75, encounterSerial: 1,
  purposeRngStates: { encounter: 5 }, battle: startBattle(context), campaignState: campaign });
const terminal = stepBattle(startBattle(context), 1, { rulesHash: versions.rulesHash,
  authorize() { throw new BattleConflict('unused'); }, resolve: () => ({ effects: [], positions: [], rngCursors: {}, evaluationReceipts: [],
    terminal: { resultId: id('ResultId', 'TESTINPUT:result'), terminalKind: 'ordered-retreat', individualAndHeroFacts: {}, squadLosses: {}, resourceFacts: { supply: -2 }, commandEvaluationFacts: {} } }) });
const outcome = terminal.outcome;
if (outcome === null) throw new BattleConflict('test-terminal');

test('duplicate terminal delivery returns receipt and conflicts never mutate campaign even after reload', () => {
  // Given
  const applied = applyOutcome(campaign, outcome, () => ({ supply: 8 }));
  const saved = checkpoint({ ...state, battle: terminal, campaignState: applied.campaign }, { versions, engineProjection: {} });
  const restored = restoreCheckpoint(JSON.parse(JSON.stringify(saved)), versions);
  const reloaded = restored.runtime.campaignState;
  assert.deepEqual(reloaded, applied.campaign);
  const before = hash(applied.campaign);
  // When
  const duplicate = applyOutcome(applied.campaign, outcome, () => { throw new BattleConflict('duplicate-applied'); });
  // Then
  assert.equal(duplicate.campaign, applied.campaign); assert.equal(duplicate.receipt, applied.receipt);
  const { payloadHash: _payloadHash, ...payload } = outcome;
  const alternate = { ...payload, resultId: id('ResultId', 'TESTINPUT:alternate') };
  assert.throws(() => applyOutcome(applied.campaign, { ...alternate, payloadHash: hash(alternate) }, () => null), BattleConflict);
  assert.throws(() => applyOutcome(applied.campaign, { ...outcome, resourceFacts: {} }, () => null), BattleConflict);
  assert.equal(hash(applied.campaign), before);
});

class MemoryStorage implements CheckpointStorage {
  readonly values = new Map<string, string>();
  failure: 'none' | 'payload' | 'readback' | 'pointer' = 'none';
  getItem(key: string): string | null { return this.failure === 'readback' && key.includes(':payload:') ? 'corrupt' : this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if ((this.failure === 'payload' && key.includes(':payload:')) || (this.failure === 'pointer' && key.endsWith(':active'))) throw new CheckpointCorrupt('injected-write-failure');
    this.values.set(key, value);
  }
}
test('active and settled envelopes restore complete boundary and retain previous payload', () => {
  // Given
  const storage = new MemoryStorage(); const active = checkpoint(state, { versions, engineProjection: { access: { save: false } } });
  persistCheckpoint(storage, active);
  const applied = applyOutcome(campaign, outcome, () => ({ supply: 8 }));
  const settled = checkpoint({ ...state, battle: terminal, campaignState: applied.campaign }, { versions, engineProjection: {} });
  // When
  persistCheckpoint(storage, settled);
  // Then
  assert.deepEqual(loadCheckpoint(storage, versions), settled);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_NAMESPACE + ':payload:' + active.checksum) ?? 'null'), active);
  const pointer = JSON.parse(storage.getItem(SAVE_NAMESPACE + ':active') ?? 'null');
  assert.equal(pointer.previous, SAVE_NAMESPACE + ':payload:' + active.checksum);
  assert.deepEqual(restoreCheckpoint(active, versions).runtime, state);
});
for (const failure of ['payload', 'readback', 'pointer'] as const) test('previous checkpoint remains active when staged ' + failure + ' fails', () => {
  // Given
  const storage = new MemoryStorage(); const first = checkpoint(state, { versions, engineProjection: {} }); persistCheckpoint(storage, first);
  const before = storage.getItem(SAVE_NAMESPACE + ':active');
  const next = checkpoint({ ...state, worldTick: 1 }, { versions, engineProjection: {} }); storage.failure = failure;
  // When / Then
  assert.throws(() => persistCheckpoint(storage, next), CheckpointCorrupt);
  storage.failure = 'none';
  assert.equal(storage.getItem(SAVE_NAMESPACE + ':active'), before); assert.deepEqual(loadCheckpoint(storage, versions), first);
});
test('corruption missing fields and incompatible versions cannot install replacement', () => {
  // Given
  const saved = checkpoint(state, { versions, engineProjection: {} }); const host = new RealtimeHost({ state, rules: null, mode: 'TESTINPUT', settle: s => s });
  const before = host.state;
  // When / Then
  for (const value of [{ ...saved, checksum: 'broken' }, { ...saved, runtime: {} }, { ...saved, stockAutosaveAccess: true }]) {
    assert.throws(() => host.replace(restoreCheckpoint(value, versions).runtime), CheckpointCorrupt);
  }
  assert.throws(() => restoreCheckpoint(saved, { ...versions, contentHash: 'other' }), CheckpointCorrupt);
  assert.equal(host.state, before);
});
test('pending command and carry resume at next shared step then settlement stays exactly once after reload', () => {
  // Given: synthetic rules deliberately terminate on the first shared step.
  const activeContext = contextSchema.parse({ ...context, persons: [{ id: lord, hp: 10, equipment: 3 }],
    squads: [{ id: 'squad', population: 8, supply: 4, x: 0, y: 0, meleeLocked: false }] });
  const battleRules = { rulesHash: versions.rulesHash,
    authorize: () => ({ ...grant, grantor: lord, basis: { ...grant.basis, kind: 'command' as const }, scope: ['move'], assets: ['squad'] }),
    resolve: () => ({ effects: [], positions: [{ unitId: 'squad', x: 2, y: 3 }], rngCursors: { combat: 3 }, evaluationReceipts: [], terminal: outcome }) };
  const pending = confirmIntent(startBattle(activeContext), intentSchema.parse({ commandId: 'pending', originPersonId: lord,
    contextHash: hash(activeContext), observationVersion: 0, selectedUnitIds: ['squad'], kind: 'move', targetOrPath: [2, 3], parentSignalId: 'signal' }), { tick: 0, rules: battleRules });
  const saved = checkpoint({ ...state, battle: pending }, { versions, engineProjection: {} });
  const hostRules = { intervalMs: 10, worldUnitsPerStep: 1, battle: battleRules, provenance: 'TESTINPUT' as const,
    approvedInputsHash: versions.approvedInputsHash, validateApproval: () => true,
    encounter() { throw new BattleConflict('unused'); }, advanceWorld: (facts: import('../battle/realtime.ts').Json) => facts };
  let applications = 0;
  const host = new RealtimeHost({ state: restoreCheckpoint(saved, versions).runtime, rules: hostRules, mode: 'TESTINPUT', settle: next => {
    if (!next.battle?.outcome) return next;
    const settled = applyOutcome(campaignSchema.parse(next.campaignState), next.battle.outcome, () => { applications += 1; return { supply: 8 }; });
    return { ...next, campaignState: settled.campaign };
  } });
  // When
  host.bind().elapsed(7);
  const storage = new MemoryStorage(); persistCheckpoint(storage, checkpoint(host.state, { versions, engineProjection: {} }));
  host.replace(loadCheckpoint(storage, versions).runtime); host.bind().elapsed(20);
  // Then
  assert.equal(host.state.worldTick, 3); assert.equal(host.state.clockCarry, 0);
  assert.equal(host.state.battle?.signalReceipts[0]?.executedAt, 1);
  assert.equal(host.state.battle?.squads[0]?.x, 2);
  assert.equal(campaignSchema.parse(host.state.campaignState).settlementReceipts.length, 1);
  assert.equal(applications, 1);
});
