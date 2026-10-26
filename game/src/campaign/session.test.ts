import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignSession } from './session.ts';
import { CampaignTab } from './tab.ts';
import { BattleConflict } from '../battle/realtime.ts';
import { content, e0 } from './testFixtures.ts';
import type { PeaceSpeed } from './session.ts';
import { integer } from '../domain/ids.ts';
import type { CampaignState } from './state.ts';

for (const speed of [0, 1, 2, 4] satisfies PeaceSpeed[]) {
  test(`advances at the admitted conversion when speed is ${speed}`, () => {
    // Given the admitted S01 state and a controllable monotonic source.
    let now = 0;
    const session = new CampaignSession({ content, state: e0, now: () => now });
    session.setSpeed(speed);
    // When one actual second elapses.
    now = 1000; session.reconcile();
    // Then only the approved multiplier is applied.
    assert.equal(session.state.clock.worldMilliseconds, 6000 * speed);
  });
}

test('preserves exact state when elapsed frames are repartitioned', () => {
  // Given independent sessions with the same monotonic origin and speed.
  let now = 100;
  const whole = new CampaignSession({ content, state: e0, now: () => now });
  const split = new CampaignSession({ content, state: e0, now: () => now });
  whole.setSpeed(4); split.setSpeed(4);
  // When equal time arrives as a throttled callback or uneven fractional frames.
  for (const at of [100.001, 103.007, 119.999, 207.031, 1007.003]) { now = at; split.reconcile(); }
  whole.reconcile();
  // Then complete boundaries, including fractional carry and revision, agree.
  assert.deepEqual(whole.state, split.state);
  assert.equal(split.state.clock.worldMilliseconds, 21768);
  assert.equal(split.state.clock.subWorldMicroseconds, 72);
});

test('delivers exact ordered boundaries when one wakeup contains several event times', () => {
  // Given a synthetic event schedule supplied through the task 8 reducer seam.
  let now = 0;
  const events = [201, 202, 601, 1199, 1200, 1201, 2399];
  const wholeEvents: number[] = [], splitEvents: number[] = [];
  const reducer = (log: number[]) => (state: CampaignState, until: CampaignState['clock']['worldMilliseconds']) => {
    const due = events.filter(at => at > state.clock.worldMilliseconds && at <= until);
    log.push(...due);
    return { ...state, clock: { ...state.clock, sequence: state.clock.sequence + due.length } };
  };
  const whole = new CampaignSession({ content, state: e0, now: () => now, advance: reducer(wholeEvents) });
  const split = new CampaignSession({ content, state: e0, now: () => now, advance: reducer(splitEvents) });
  whole.setSpeed(4); split.setSpeed(4);
  // When one interval and several frames cover the same event horizon.
  for (const at of [3, 8, 40, 51, 70, 100]) { now = at; split.reconcile(); }
  whole.reconcile();
  // Then every exact event is delivered once in source order, independent of frames.
  assert.deepEqual(wholeEvents, events);
  assert.deepEqual(splitEvents, events);
  assert.deepEqual(whole.state, split.state);
  assert.equal(whole.state.clock.worldMilliseconds, integer('WorldMilliseconds', 2400));
});

test('settles old speed before a rapid speed change without rounding away elapsed time', () => {
  // Given a running session.
  let now = 0;
  const session = new CampaignSession({ content, state: e0, now: () => now });
  session.setSpeed(1);
  // When speed changes at fractional boundaries and finally pauses.
  now = .1; session.setSpeed(2);
  now = .2; session.setSpeed(4);
  now = .3; session.setSpeed(0);
  now = 100000; session.reconcile();
  // Then .6 + 1.2 + 2.4 world milliseconds survive and pause adds nothing.
  assert.equal(session.state.clock.worldMilliseconds, 4);
  assert.equal(session.state.clock.subWorldMicroseconds, 200);
});

test('delegates one elapsed interval to an event-aware reducer instead of fixed subframes', () => {
  // Given a reducer that already owns exact causal event boundaries.
  let now = 0, calls = 0;
  const session = new CampaignSession({ content, state: e0, now: () => now,
    advance: (state, until) => { calls += 1; return { ...state, clock: { ...state.clock, worldMilliseconds: until } }; } });
  session.setSpeed(4);
  // When a delayed callback covers one real second.
  now = 1000; session.reconcile();
  // Then it is one reducer interval, without changing elapsed units or host tick identity.
  assert.equal(calls, 1);
  assert.equal(session.state.clock.worldMilliseconds, 24000);
});

test('ignores wall clock skew and rejects a regressed monotonic source atomically', () => {
  // Given monotonic and wall clocks which are independent.
  let now = 0;
  const session = new CampaignSession({ content, state: e0, now: () => now });
  session.setSpeed(1);
  const original = Date.now;
  // When wall time jumps years forward and backwards.
  try {
    Date.now = () => 999999999999999;
    now = 100; session.reconcile();
    Date.now = () => 0;
    now = 200; session.reconcile();
  } finally { Date.now = original; }
  const before = session.state;
  now = 199;
  // Then elapsed remains monotonic-only and invalid input cannot mutate it.
  assert.equal(before.clock.worldMilliseconds, 1200);
  assert.throws(() => session.reconcile(), error => error instanceof BattleConflict && error.reason === 'monotonic-regression');
  assert.deepEqual(session.state, before);
});

test('uses fresh origin and only explicit saved progress after reopening', () => {
  // Given a saved running boundary followed by unsaved progress.
  let now = 0;
  const first = new CampaignSession({ content, state: e0, now: () => now });
  first.setSpeed(2); now = 1000;
  const saved = first.checkpoint();
  now = 2000; first.close();
  // When a new session opens much later from that explicit checkpoint.
  now = 9000000;
  const reopened = new CampaignSession({ content, state: saved, now: () => now });
  reopened.reconcile();
  // Then neither unsaved nor closed-session time is credited.
  assert.deepEqual(reopened.state, saved);
  assert.throws(() => first.setSpeed(4), error => error instanceof BattleConflict && error.reason === 'stale-clock');
});

test('continues beyond support expiry when timers are throttled', () => {
  // Given no automatic pause at either scenario deadline.
  let now = 0;
  const session = new CampaignSession({ content, state: e0, now: () => now });
  session.setSpeed(4);
  // When one late callback reconciles an entire open interval.
  now = 230000; session.reconcile();
  // Then time crosses both deadlines without inventing effects or pausing.
  assert.equal(session.state.clock.worldMilliseconds, 5520000);
  assert.equal(session.state.clock.speed, 4);
  assert.deepEqual(session.state.inventories, e0.inventories);
});

test('permits exactly one writer and requires explicit takeover from saved state', async () => {
  // Given two tabs using the platform lock manager and one durable checkpoint.
  let now = 0, saved = e0, writes = 0;
  const options = { key: 'test:' + crypto.randomUUID(), content, locks: navigator.locks, now: () => now,
    readCheckpoint: () => saved, writeCheckpoint: (state: typeof e0) => { saved = state; writes += 1; } };
  const first = new CampaignTab(options), second = new CampaignTab(options);
  try {
    assert.equal(await first.takeOver(), true);
    assert.equal(await second.takeOver(), false);
    first.setSpeed(1); now = 1000; first.save();
    // When the original owner leaves after further unsaved time.
    now = 2000; first.leave();
    assert.equal(second.status, 'read-only');
    assert.throws(() => second.save(), error => error instanceof BattleConflict && error.reason === 'read-only-session');
    // The lock callback releases asynchronously; acquire/release a shared barrier before explicit takeover.
    await navigator.locks.request('campaign:' + options.key, () => {});
    assert.equal(await second.takeOver(), true);
    // Then the new writer starts at the saved boundary with no closed gap or stale writer.
    assert.deepEqual(second.state, saved);
    assert.equal(writes, 1);
    assert.throws(() => first.save(), error => error instanceof BattleConflict && error.reason === 'read-only-session');
    await assert.rejects(second.takeOver(), error => error instanceof BattleConflict && error.reason === 'clock-owned');
  } finally { first.close(); second.close(); }
});
