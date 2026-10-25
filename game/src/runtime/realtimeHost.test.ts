import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { RealtimeHost, captureProjection, runtimeSchema, validateHostContent } from './realtimeHost.ts';
import type { HostRules, RuntimeState } from './realtimeHost.ts';
import { BattleConflict, MissingRuleInput, startBattle } from '../battle/realtime.ts';
import type { BattleContext } from '../battle/realtime.ts';
import { campaignSchema, checkpoint, restoreCheckpoint } from '../save/campaignCheckpoint.ts';

// TESTINPUT: all times, encounter pacing, participants and resolution rules here are synthetic.
const versions = { rulesHash: 'TESTINPUT:rules', contentHash: 'TESTINPUT:content', approvedInputsHash: 'TESTINPUT:approval' };
const step = { mapId: 'TESTINPUT:map', x: 2, y: 3 };
function initial(): RuntimeState {
  return runtimeSchema.parse({ worldTick: 0, worldTime: 0, clockCarry: 0, encounterAccumulator: 0,
    encounterSerial: 0, purposeRngStates: { 'TESTINPUT:encounter': 7 }, battle: null,
    campaignState: { facts: [], settlementReceipts: [], ledgerCursor: 0 } });
}
function context(state: RuntimeState): BattleContext {
  return { ...versions, provenance: 'TESTINPUT', schemaVersion: 1,
    battleId: 'TESTINPUT:battle:' + state.encounterSerial, encounterId: 'TESTINPUT:encounter',
    worldStartTick: state.worldTick, worldStartTime: state.worldTime,
    persons: [{ id: 'TESTINPUT:person', hp: 10, equipment: 4 }], heroes: [],
    squads: [{ id: 'TESTINPUT:squad', population: 12, supply: 9, x: 0, y: 0, meleeLocked: false }],
    commandGrants: {}, formations: {}, navigation: {}, objective: {}, supplyReservations: {},
    legalFallbackRoutes: {}, reinforcementConditions: {}, purposeRng: { 'TESTINPUT:combat': 0 } };
}
function rules(): HostRules {
  return { intervalMs: 10, worldUnitsPerStep: 2, provenance: 'TESTINPUT', approvedInputsHash: versions.approvedInputsHash,
    validateApproval: value => value.approvedInputsHash === versions.approvedInputsHash,
    battle: { rulesHash: versions.rulesHash,
      authorize: () => { throw new Error('TESTINPUT: no commands in this fixture'); },
      resolve: (battle, tick) => ({
        effects: [{ attackId: 'TESTINPUT:attack:' + tick, targetId: 'TESTINPUT:person', kind: 'hp', owner: 'personal', amount: 1 }],
        positions: [{ unitId: 'TESTINPUT:squad', x: tick, y: 0 }],
        rngCursors: { 'TESTINPUT:combat': (battle.rngCursors['TESTINPUT:combat'] ?? 0) + 1 },
        evaluationReceipts: [tick], terminal: null,
      }),
    },
    encounter: state => {
      const accumulator = state.encounterAccumulator + 2;
      return { rate: 2, eligible: true, safe: false, accumulator: accumulator >= 6 ? 0 : accumulator,
        rng: { 'TESTINPUT:encounter': (state.purposeRngStates['TESTINPUT:encounter'] ?? 0) + 1 },
        context: accumulator >= 6 ? context(state) : null };
    },
    advanceWorld: (campaign, tick) => {
      const parsed = campaignSchema.parse(campaign);
      return { ...parsed, facts: { tick } };
    },
  };
}
function host(state = initial(), inputs = rules(), settle: (state: RuntimeState) => RuntimeState = value => value): RealtimeHost {
  return new RealtimeHost({ state, rules: inputs, mode: 'TESTINPUT', settle });
}

test('runtime fixed scheduler is identical across equal elapsed frame partitions', () => {
  // Given an active battle and two independent schedulers.
  const state = { ...initial(), battle: startBattle(context(initial())) };
  const wholeTicks: number[] = [], splitTicks: number[] = [];
  const whole = host(state, rules(), value => { wholeTicks.push(value.worldTick); return value; });
  const split = host(state, rules(), value => { splitTicks.push(value.worldTick); return value; });
  // When equal elapsed time arrives in different frame partitions.
  whole.bind().elapsed(47);
  const binding = split.bind();
  for (const duration of [3, 7, 1, 16, 0, 20]) binding.elapsed(duration);
  // Then world, battle, carry and settlement ticks agree.
  assert.deepEqual(split.state, whole.state);
  assert.deepEqual([wholeTicks, splitTicks], [[1, 2, 3, 4], [1, 2, 3, 4]]);
  assert.deepEqual([split.state.worldTime, split.state.clockCarry], [8, 7]);
  assert.equal(split.state.battle?.persons[0]?.hp, 6);
  assert.equal(split.state.battle?.rngCursors['TESTINPUT:combat'], 4);
});

test('checkpoint restore preserves fractional clock, encounter pacing and purpose RNG', () => {
  // Given a partially accumulated clock and encounter.
  const original = host();
  original.elapsed(17);
  assert.deepEqual(original.completedStep(step), { kind: 'handled-rejected', reason: 'pacing' });
  const envelope = checkpoint(original.state, { versions, engineProjection: { mapId: step.mapId } });
  const restored = host();
  // When a serialized checkpoint is restored and both hosts continue.
  restored.replace(restoreCheckpoint(JSON.parse(JSON.stringify(envelope)), versions).runtime);
  assert.deepEqual(restored.state, original.state);
  assert.deepEqual([restored.state.clockCarry, restored.state.encounterAccumulator], [7, 2]);
  for (const current of [original, restored]) {
    current.elapsed(3);
    assert.deepEqual(current.completedStep(step), { kind: 'handled-rejected', reason: 'pacing' });
    assert.deepEqual(current.completedStep(step), { kind: 'handled-opened', battleId: 'TESTINPUT:battle:0' });
    current.elapsed(10);
  }
  // Then the encounter opens at the same boundary and resolves identically.
  assert.deepEqual(restored.state, original.state);
  assert.equal(restored.state.encounterSerial, 1);
  assert.deepEqual(restored.state.purposeRngStates, { 'TESTINPUT:encounter': 10 });
  assert.deepEqual([restored.state.battle?.context.worldStartTick, restored.state.battle?.stepIndex], [2, 1]);
});

test('replacement invalidates old elapsed and completed-step callbacks', () => {
  // Given a binding captured before replacement.
  const current = host(), stale = current.bind();
  stale.elapsed(4);
  current.replace({ ...initial(), worldTick: 8, worldTime: 16, clockCarry: 6 });
  const boundary = current.state;
  // When stale callbacks run after replacement.
  stale.elapsed(100);
  assert.deepEqual(stale.completedStep(step), { kind: 'handled-rejected', reason: 'stale-generation' });
  // Then only a newly bound presentation can advance the restored clock.
  assert.equal(current.state, boundary);
  current.bind().elapsed(4);
  assert.deepEqual([current.state.worldTick, current.state.clockCarry], [9, 0]);
});

test('only the latest of two presentation bindings can drive simulation', () => {
  // Given two presentation bindings on one host.
  const current = host(), first = current.bind(), latest = current.bind();
  // When the superseded binding attempts to drive the host.
  first.elapsed(30);
  assert.deepEqual(first.completedStep(step), { kind: 'handled-rejected', reason: 'stale-generation' });
  assert.deepEqual(current.state, initial());
  // Then releasing it leaves the latest binding operational.
  first.release();
  latest.elapsed(10);
  assert.equal(current.state.worldTick, 1);
  latest.completedStep(step);
  assert.equal(current.state.encounterAccumulator, 2);
});

for (const inputs of [null, rules(), { ...rules(), provenance: 'CANON' as const, approvedInputsHash: '' }]) {
  test('production refuses missing or unapproved rules: ' + (inputs === null ? 'absent' : inputs.provenance), () => {
    // Given missing or unapproved production inputs.
    let settlements = 0;
    const current = new RealtimeHost({ state: initial(), rules: inputs, mode: 'production', settle: value => { settlements += 1; return value; } });
    const boundary = current.state;
    // When any simulation ingress runs, then it rejects before mutation or settlement.
    for (const action of [() => current.elapsed(10), () => current.completedStep(step), () => current.replace(initial())]) {
      assert.throws(action, error => error instanceof MissingRuleInput && error.ruleKey === 'approved-GP-content-time-inputs');
      assert.equal(current.state, boundary);
    }
    assert.equal(settlements, 0);
  });
}

test('content rejects nested direct save access and authored commands', () => {
  // Given nested authored content, when validated, then save access and command ingress reject.
  for (const save of [true, null, {}, [], 'TESTINPUT:slot', 0]) {
    assert.throws(() => validateHostContent({ pages: [{ save }] }), error => error instanceof BattleConflict && error.reason === 'stock-save-access');
  }
  for (const kind of ['save', 'battleProcessing', 'gainGold', 'gainItem']) {
    assert.throws(() => validateHostContent({ pages: [{ commands: [{ kind }] }] }), error => error instanceof BattleConflict && error.reason === 'authored-command-requires-game-ingress');
  }
  assert.doesNotThrow(() => validateHostContent({ kind: 'TESTINPUT:project', pages: [{ save: false, commands: [], label: 'TESTINPUT:inert' }] }));
});

test('projection rejects boundary mutation and keeps the authoritative state intact', () => {
  // Given a boundary, when a projection mutates its copy, then validation rejects without changing the source.
  const boundary = initial();
  assert.throws(() => captureProjection(boundary, copy => {
    Object.assign(copy, { worldTick: 99 });
    return { tick: copy.worldTick };
  }), error => error instanceof BattleConflict && error.reason === 'projection-mutated-boundary');
  assert.throws(() => captureProjection(boundary, copy => {
    Object.assign(copy, { campaignState: { ...campaignSchema.parse(copy.campaignState), ledgerCursor: 99 } });
    return null;
  }), error => error instanceof BattleConflict && error.reason === 'projection-mutated-boundary');
  assert.deepEqual(captureProjection(boundary, copy => ({ tick: copy.worldTick })), { tick: 0 });
  assert.deepEqual(boundary, initial());
});

test('presentation teardown neither settles an active battle nor advances its clock', () => {
  // Given a live battle with an almost-complete clock interval.
  let settlements = 0;
  const current = host({ ...initial(), battle: startBattle(context(initial())) }, rules(), value => { settlements += 1; return value; });
  const binding = current.bind();
  binding.elapsed(9);
  const boundary = current.state;
  // When teardown and stale callbacks run.
  binding.release();
  binding.elapsed(100);
  assert.deepEqual(binding.completedStep(step), { kind: 'handled-rejected', reason: 'stale-generation' });
  // Then no settlement occurs until a new binding completes the interval.
  assert.equal(current.state, boundary);
  assert.equal(current.state.battle?.outcome, null);
  assert.equal(settlements, 0);
  current.bind().elapsed(1);
  assert.equal(settlements, 1);
  assert.equal(current.state.battle?.stepIndex, 1);
});

// Apply the shipped diff in memory, then execute its real functions without Phaser or a DOM.
// Stock dependencies below are instruments, not copies of the functions under test.
// VM exports have these explicit fixture-owned runtime shapes; no engine objects cross this boundary.
type EncounterFixture = { run: (scene: object) => void; stock: () => number[] };
function patchedSource(path: string): string {
  const root = new URL('../../../', import.meta.url);
  const patch = readFileSync(new URL('patches/realtime-battle-host.patch', root), 'utf8');
  const section = patch.split('diff --git ').find(part => part.startsWith('a/' + path + ' b/' + path + '\n'));
  assert.ok(section, 'patch must include ' + path);
  let source = section.includes('--- /dev/null') ? '' : readFileSync(new URL(path, root), 'utf8');
  for (const hunk of section.split(/^@@ .*@@.*\n/m).slice(1)) {
    const lines = hunk.split('\n').filter(line => /^[ +\-]/.test(line));
    const before = lines.filter(line => !line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n';
    const after = lines.filter(line => !line.startsWith('-')).map(line => line.slice(1)).join('\n') + '\n';
    if (source === '' && section.includes('--- /dev/null')) source = after;
    else {
      assert.ok(source.includes(before), 'patch context must apply: ' + path);
      source = source.replace(before, after);
    }
  }
  return source;
}
function engineFunction(path: string, start: string, end: string): string {
  const source = patchedSource(path);
  const from = source.indexOf(start);
  assert.notEqual(from, -1);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1);
  const declaration = source.slice(from, to).trim().replace(/^export /, '').replace(/^update\(/, 'function update(');
  return stripTypeScriptTypes(declaration);
}

test('patched encounter ingress handles every port admission without touching stock state', () => {
  // Given the actual patched function with instrumented stock guard and pacing state.
  const source = engineFunction('engine/src/player/playSceneMovement.ts',
    'export function maybeTriggerRandomEncounter(', '// runFieldSpawnEventBattle');
  for (const admission of [{ kind: 'handled-opened', battleId: 'TESTINPUT:battle' }, { kind: 'handled-rejected', reason: 'pacing' }]) {
    const steps: unknown[] = [], session = { guardSteps: 3, rng: 7, gold: 11 };
    const scene = { map: { id: step.mapId }, tileX: step.x, tileY: step.y, running: false, session };
    let stockCalls = 0;
    const fixture: EncounterFixture = runInNewContext(`let encounterStepCounter = 4; let encounterAccumulator = 20;
      ${source}
      ({ run: maybeTriggerRandomEncounter, stock: () => [encounterStepCounter, encounterAccumulator] })`, {
      simulationBinding: () => ({ completedStep: (value: unknown) => { steps.push(value); return admission; } }),
      tickEncounterGuard: () => { stockCalls += 1; session.guardSteps -= 1; return { suppress: true }; },
    });
    // When either host admission is returned, then stock state remains untouched.
    fixture.run(scene);
    assert.deepEqual(JSON.parse(JSON.stringify(steps)), [step]);
    assert.deepEqual([stockCalls, ...fixture.stock()], [0, 4, 20]);
    assert.deepEqual(session, { guardSteps: 3, rng: 7, gold: 11 });
  }
});

test('patched encounter without a port still mutates stock guard and pacing state', () => {
  // Given the actual patched function without a simulation port.
  const source = engineFunction('engine/src/player/playSceneMovement.ts',
    'export function maybeTriggerRandomEncounter(', '// runFieldSpawnEventBattle');
  const session = { guardSteps: 3 };
  const fixture: EncounterFixture = runInNewContext(`let encounterStepCounter = 4; let encounterAccumulator = 20;
    ${source}
    ({ run: maybeTriggerRandomEncounter, stock: () => [encounterStepCounter, encounterAccumulator] })`, {
    simulationBinding: () => undefined,
    tickEncounterGuard: () => { session.guardSteps -= 1; return { suppress: true }; },
  });
  // When a suppressed stock step runs, then its guard decrements and pacing resets.
  fixture.run({ running: false, session });
  assert.deepEqual([session.guardSteps, ...fixture.stock()], [2, 0, 0]);
});

test('patched PlayScene readiness gates simulation; bound updates bypass open atlas and all stock writers', () => {
  // Given the actual patched update with an open atlas and instrumented stock writers.
  const source = engineFunction('engine/src/player/PlayScene.ts', '  update(_time:', '  private initialPresentationActivated');
  const calls: unknown[][] = [];
  let pending = true, bound = true;
  const scene = {
    game: { registry: { get: () => pending } },
    worldAtlasController: { isOpen: true, update: () => calls.push(['atlas']) },
    input_: { resetEdges: () => calls.push(['reset']), clearDirectionTaps: () => calls.push(['clear']) },
    perfCounters: { frames: 0 },
  };
  const update: (this: typeof scene, time: number, delta: number) => void = runInNewContext(`${source}\nupdate`, {
    simulationBinding: () => bound ? {
      elapsed: (duration: number) => calls.push(['elapsed', duration]),
      present: (value: unknown, duration: number) => { assert.equal(value, scene); calls.push(['present', duration]); },
    } : undefined,
    updatePlayScene: () => assert.fail('stock movement writer ran'),
    updateGameTime: () => assert.fail('stock clock writer ran'),
    tickNpcSchedules: () => assert.fail('stock NPC writer ran'),
    store: { getCurrent: () => assert.fail('stock projection access ran') },
  });
  // When presentation is pending, then neither simulation nor stock updates run.
  update.call(scene, 0, 17);
  assert.deepEqual(calls, []);
  // When ready and bound, then elapsed and presentation bypass the atlas and stock writers.
  pending = false;
  update.call(scene, 17, 23);
  assert.deepEqual(calls, [['elapsed', 23], ['present', 23]]);
  assert.equal(scene.perfCounters.frames, 0);
  calls.length = 0;
  // When unbound, then the stock atlas early return remains operational.
  bound = false;
  update.call(scene, 40, 9);
  assert.deepEqual(calls, [['atlas'], ['reset'], ['clear']]);
});
