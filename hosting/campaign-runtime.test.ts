import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../game/src/campaign/content.ts';
import { createCampaignE0 } from '../game/src/campaign/state.ts';
import { createCampaignSave, CAMPAIGN_SAVE_NAMESPACE } from '../game/src/campaign/saveCheckpoint.ts';
import { CampaignEntryError, ProductionCampaign } from './campaign-runtime.ts';

const data = new URL('../game/data/', import.meta.url);
const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
  scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await readFile(new URL(path, data), 'utf8')])));
const content = CampaignContent.parse(packages);

function fakeStorage(): Storage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return Object.assign(Object.create(Storage.prototype), {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  }) as never;
}
/** Minimal LockManager double: grants immediately and keeps the request pending like a real held lock. */
function fakeLocks(): LockManager {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  return {
    request: (_name: string, _options: LockOptions, callback: (lock: Lock) => unknown) => {
      void Promise.resolve(callback({ name: _name, mode: 'exclusive' } as Lock)).then(resolve, reject);
      return promise;
    },
  } as never;
}
async function startedRuntime(): Promise<{ runtime: ProductionCampaign; storage: Storage & { readonly map: Map<string, string> }; now: number }> {
  let fakeNow = 1000;
  const storage = fakeStorage();
  const runtime = new ProductionCampaign({ content, storage, locks: fakeLocks(), now: () => fakeNow });
  assert.equal(await runtime.start('new'), true);
  return { runtime, storage, get now() { return fakeNow; }, set now(value: number) { fakeNow = value; } };
}

test('restoreSaved before any start is the honest read-only refusal, not a silent no-op', async () => {
  const runtime = new ProductionCampaign({ content, storage: fakeStorage(), locks: fakeLocks(), now: () => 0 });
  assert.throws(() => runtime.restoreSaved(), error => error instanceof CampaignEntryError && error.code === 'read-only');
});

test('restoreSaved replaces the live session with the checkpoint boundary under the same lock', async () => {
  const harness = await startedRuntime();
  const { runtime, storage } = harness;
  const saved = runtime.save();
  const savedWorldMs = saved.state.clock.worldMilliseconds;
  // Unsounded progress after the save: run the world for 60s at 1x.
  runtime.app.setSpeed(1); harness.now += 60_000; runtime.reconcile();
  const progressed = runtime.state.clock.worldMilliseconds;
  assert.ok(progressed > savedWorldMs, 'world advanced past the checkpoint before restore');
  let notifications = 0;
  const unsubscribe = runtime.subscribe(() => { notifications += 1; });
  const restored = runtime.restoreSaved();
  assert.equal(restored.checksum, saved.checksum, 'restore returns the validated checkpoint identity');
  assert.equal(runtime.state.clock.worldMilliseconds, savedWorldMs, 'restored clock is the checkpoint boundary');
  assert.equal(runtime.state.clock.speed, 0, 'restored speed is the checkpoint speed, not the live one');
  assert.ok(notifications >= 1, 'subscribers learn about the restored state');
  assert.equal(runtime.active, true, 'the same held lock keeps the session writable');
  assert.ok(runtime.save().checksum.length > 0, 'saving still works after a restore');
  unsubscribe();
});

test('a corrupt current payload refuses the restore and keeps the live session untouched', async () => {
  const harness = await startedRuntime();
  const { runtime, storage } = harness;
  runtime.save();
  runtime.app.setSpeed(1); harness.now += 30_000; runtime.reconcile();
  const progressed = runtime.state.clock.worldMilliseconds;
  const pointer = JSON.parse(storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active')!);
  storage.setItem(pointer.current, '{not-json');
  assert.throws(() => runtime.restoreSaved(), /저장|checkpoint|checksum|JSON/i);
  assert.equal(runtime.state.clock.worldMilliseconds, progressed, 'failed restore never rewinds the live session');
  assert.equal(runtime.active, true);
});

test('the persisted envelope round-trips through createCampaignSave exactly once per pointer', async () => {
  const storage = fakeStorage();
  const save = createCampaignSave(createCampaignE0(content), content);
  const key = CAMPAIGN_SAVE_NAMESPACE + ':payload:' + save.checksum;
  storage.setItem(key, JSON.stringify(save));
  storage.setItem(CAMPAIGN_SAVE_NAMESPACE + ':active', JSON.stringify({ current: key, previous: null }));
  const runtime = new ProductionCampaign({ content, storage, locks: fakeLocks(), now: () => 0 });
  assert.equal(await runtime.start('saved'), true);
  assert.equal(runtime.state.clock.worldMilliseconds, save.state.clock.worldMilliseconds);
});

test('explicit previous restore is independent of corrupt current and does not move the active pointer', async () => {
  const harness = await startedRuntime();
  const first = harness.runtime.save();
  harness.runtime.app.setSpeed(1); harness.now += 2_000; harness.runtime.reconcile();
  harness.runtime.save();
  const rawPointer = harness.storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active')!;
  const pointer = JSON.parse(rawPointer);
  harness.storage.setItem(pointer.current, '{broken');
  const restored = harness.runtime.restoreSaved('previous');
  assert.equal(restored.checksum, first.checksum);
  assert.equal(harness.runtime.state.clock.worldMilliseconds, first.state.clock.worldMilliseconds);
  assert.equal(harness.storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'), rawPointer);
  assert.equal(harness.runtime.app.view('K002').worldMilliseconds, first.state.clock.worldMilliseconds);
  harness.runtime.close();
});
