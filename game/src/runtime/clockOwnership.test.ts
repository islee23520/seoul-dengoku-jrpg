import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeHost, runtimeSchema } from './realtimeHost.ts';
import { BattleConflict, startBattle } from '../battle/realtime.ts';
import type { BattleContext } from '../battle/realtime.ts';

test('rejects second clock owners and stale capabilities before settlement', () => {
  // Given one claimed host and a presentation binding.
  let settlements = 0;
  const host = new RealtimeHost({ state: runtimeSchema.parse({ worldTick: 0, worldTime: 0, clockCarry: 0,
    encounterAccumulator: 0, encounterSerial: 0, purposeRngStates: {}, battle: null, campaignState: null }),
    mode: 'TESTINPUT', rules: { intervalMs: 10, worldUnitsPerStep: 2, provenance: 'TESTINPUT', approvedInputsHash: 'test',
      battle: null, encounter: null, validateApproval: () => false, advanceWorld: state => state },
    settle: state => { settlements += 1; return state; } });
  const scene = host.bind(), clock = host.claimClock();
  // When alternate owners and a released capability attempt mutations.
  for (const action of [() => host.claimClock(), () => scene.elapsed(10), () => host.replace(host.state), () => host.setSpeed(0)]) {
    assert.throws(action, error => error instanceof BattleConflict && error.reason === 'clock-owned');
  }
  clock.elapsed(10); clock.release();
  assert.throws(() => clock.elapsed(10), error => error instanceof BattleConflict && error.reason === 'stale-clock');
  // Then only the live exclusive capability settled once.
  assert.equal(settlements, 1);
  assert.equal(host.state.worldTime, 2);
});

test('forces one times speed and rejects pause while an admitted battle is active', () => {
  // Given an explicitly synthetic admitted battle (S01 has no battle admission).
  const context: BattleContext = {
    schemaVersion: 1, provenance: 'TESTINPUT', rulesHash: 'test:rules', contentHash: 'test:content', approvedInputsHash: 'test:approval',
    battleId: 'test:battle', encounterId: 'test:encounter', worldStartTick: 0, worldStartTime: 0,
    persons: [], heroes: [], squads: [], commandGrants: {}, formations: {}, navigation: {}, objective: {},
    supplyReservations: {}, legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: {},
  };
  const host = new RealtimeHost({ mode: 'TESTINPUT',
    state: runtimeSchema.parse({ worldTick: 0, worldTime: 0, clockCarry: 0, encounterAccumulator: 0, encounterSerial: 0,
      purposeRngStates: {}, battle: null, campaignState: null }),
    rules: { intervalMs: 10, worldUnitsPerStep: 2, provenance: 'TESTINPUT', approvedInputsHash: context.approvedInputsHash,
      validateApproval: () => true, encounter: null, advanceWorld: state => state,
      battle: { rulesHash: context.rulesHash, authorize: () => { throw new BattleConflict('test-no-command'); },
        resolve: () => ({ effects: [], positions: [], rngCursors: {}, evaluationReceipts: [], terminal: null }) } },
    settle: state => state,
  });
  host.setSpeed(4);
  host.replace({ ...host.state, battle: startBattle(context) });
  // When pause/fast requests and an elapsed interval arrive during battle.
  for (const speed of [0, 2, 4] as const) assert.throws(() => host.setSpeed(speed), error => error instanceof BattleConflict && error.reason === 'battle-speed-locked');
  host.elapsed(10);
  // Then the battle and world advance one normal interval, not four.
  assert.equal(host.state.worldTime, 2);
  assert.equal(host.state.battle?.stepIndex, 1);
});
