import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductionCampaign, CampaignEntryError } from '../../../hosting/campaign-runtime.ts';
import { content, e0 } from '../../../game/src/campaign/testFixtures.ts';
import { CAMPAIGN_SAVE_NAMESPACE, loadCampaignSave } from '../../../game/src/campaign/saveCheckpoint.ts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CampaignContent } from '../../../game/src/campaign/content.ts';
import { packFiles } from '../../../hosting/campaign-content.ts';

function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('production session retains command effects when view subscriptions are released', async () => {
  // Given one admitted production application and a view subscription.
  let now = 0;
  const runtime = new ProductionCampaign({ content, storage: memory(), locks: navigator.locks, now: () => now });
  try {
    assert.equal(await runtime.start('new'), true);
    const app = runtime.app;
    let updates = 0;
    const release = runtime.subscribe(() => { updates += 1; });
    app.submitComposed({ kind: 'issue', commandId: 'assembly:ledger', issuerPersonId: 'K002', recipientId: 'K568', operation: 'S01-L' });
    app.setSpeed(4);
    release();
    const before = updates;
    // When the surface is unmounted while monotonic time advances.
    now = 8000; runtime.reconcile();
    // Then the same host has received and accepted the order, without notifying the old view.
    assert.equal(runtime.app, app);
    assert.equal(updates, before);
    assert.equal(runtime.state.mandates.length, 1);
    assert.notEqual(runtime.state.mandates[0].acceptedAt, null);
    assert.equal(runtime.state.clock.worldMilliseconds, 192000);
  } finally { runtime.close(); }
});

test('manual reload restores the exact durable state without offline credit', async () => {
  // Given a saved command boundary and later unsaved progress.
  const storage = memory(); let now = 0;
  const options = { content, storage, locks: navigator.locks, now: () => now };
  const first = new ProductionCampaign(options);
  await first.start('new');
  first.app.submitComposed({ kind: 'issue', commandId: 'assembly:reload', issuerPersonId: 'K002', recipientId: 'K568', operation: 'S01-L' });
  first.app.setSpeed(4); now = 1000;
  const saved = first.save();
  now = 2000; first.close();
  await navigator.locks.request('campaign:' + CAMPAIGN_SAVE_NAMESPACE, () => {});
  // When a new page explicitly loads the checkpoint much later.
  now = 9000000;
  const second = new ProductionCampaign(options);
  try {
    assert.equal(await second.start('saved'), true);
    second.reconcile();
    // Then all command IDs/effects and the precise time survive, not the unsaved interval.
    assert.deepEqual(second.state, saved.state);
    assert.deepEqual(loadCampaignSave(storage, content), saved);
  } finally { second.close(); }
});

test('second tab cannot issue or save while the first owns the campaign', async () => {
  // Given two production entries sharing the platform lock.
  const storage = memory();
  const options = { content, storage, locks: navigator.locks, now: () => 0 };
  const first = new ProductionCampaign(options), second = new ProductionCampaign(options);
  try {
    await first.start('new');
    // When a second explicit start competes with the existing writer.
    assert.equal(await second.start('new'), false);
    // Then there is no second host, checkpoint write, or clock.
    assert.equal(second.active, false);
    assert.throws(() => second.save(), error => error instanceof CampaignEntryError && error.code === 'read-only');
    assert.deepEqual(first.state, e0);
    assert.equal(storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'), null);
  } finally { first.close(); second.close(); }
});

test('invalid saved data fails before a runtime exists and leaves original bytes intact', async () => {
  // Given an invalid active pointer, never an approved new game request.
  const storage = memory(); storage.setItem(CAMPAIGN_SAVE_NAMESPACE + ':active', '{broken');
  const runtime = new ProductionCampaign({ content, storage, locks: navigator.locks, now: () => 0 });
  try {
    // When loading the saved campaign.
    await assert.rejects(runtime.start('saved'));
    // Then no E0 fallback or storage repair occurred.
    assert.equal(runtime.active, false);
    assert.equal(storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'), '{broken');
  } finally { runtime.close(); }
});

test('production artifact carries the admitted pack and independently runnable legacy preview', async () => {
  // Given the exact built artifact selected by the acceptance command.
  const output = process.env.CAMPAIGN_GAME_OUTPUT;
  assert.ok(output, 'CAMPAIGN_GAME_OUTPUT must name the built production directory');
  const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => [key, await readFile(path.join(output, file), 'utf8')]));
  // When the browser boundary parses the shipped bytes rather than source files.
  const shipped = CampaignContent.parse(Object.fromEntries(entries));
  // Then every admitted input is present and the secondary route retains its isolated project.
  assert.deepEqual(shipped.hashes, content.hashes);
  const root = await readFile(path.join(output, 'index.html'), 'utf8');
  const campaign = await readFile(path.join(output, 'campaign.html'), 'utf8');
  assert.match(root, /type="module"/);
  assert.equal(root, campaign);
  const preview = JSON.parse(await readFile(path.join(output, 'legacy/map-preview.json'), 'utf8'));
  assert.equal(preview.database.actors[0].id, 'public-map-navigation-marker');
  assert.match(await readFile(path.join(output, 'legacy/preview.html'), 'utf8'), /projectUrl:"\.\/map-preview.json"/);
});
