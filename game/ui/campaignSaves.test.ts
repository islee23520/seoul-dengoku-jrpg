import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../src/campaign/content.ts';
import { createCampaignE0 } from '../src/campaign/state.ts';
import { createCampaignSave, CAMPAIGN_SAVE_NAMESPACE, parseCampaignSave } from '../src/campaign/saveCheckpoint.ts';
import { buildSavesView, describeSaveFailure } from './campaignSavesModel.ts';
import type { SavesStorageReader } from './campaignSavesModel.ts';

const data = new URL('../data/', import.meta.url);
const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
  scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await readFile(new URL(path, data), 'utf8')])));
const content = CampaignContent.parse(packages);

/** In-memory CheckpointStorage double: only the atomic pointer/payload contract is simulated. */
function fakeStorage(): Storage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return Object.assign(Object.create(Storage.prototype), {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  }) as never;
}
function reader(storage: Storage): SavesStorageReader {
  return {
    readActive: () => storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'),
    readPayload: key => storage.getItem(key),
    parseSave: raw => parseCampaignSave(raw, content),
  };
}

test('empty storage is an honest empty state, not a fabricated slot', () => {
  const view = buildSavesView(reader(fakeStorage()), content, 0, 1);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0]!.kind, 'current');
  assert.equal(view.rows[0]!.status, 'missing');
  assert.equal(view.rows.find(row => row.kind === 'previous')!.status, 'missing');
  assert.equal(view.hasValidCurrent, false);
  assert.equal(view.error, null);
});

test('a persisted save exposes current + previous rows without ever inventing a wall-clock save time', () => {
  const storage = fakeStorage();
  const first = createCampaignSave(createCampaignE0(content), content);
  const key1 = CAMPAIGN_SAVE_NAMESPACE + ':payload:' + first.checksum;
  storage.setItem(key1, JSON.stringify(first));
  storage.setItem(CAMPAIGN_SAVE_NAMESPACE + ':active', JSON.stringify({ current: key1, previous: null }));
  const view = buildSavesView(reader(storage), content, 1000, 1);
  assert.equal(view.hasValidCurrent, true);
  assert.equal(view.rows[0]!.status, 'ok');
  assert.equal(view.rows[0]!.checksum, first.checksum);
  assert.match(view.rows[0]!.worldSecondsText!, /^0분 /);
  assert.equal(view.rows.find(row => row.kind === 'previous')!.status, 'missing');
  assert.equal(view.error, null);
  assert.ok(view.versions.some(entry => entry.value.length > 0), 'content hashes are shown verbatim');
});

test('a corrupt active payload blocks load review and names its reason', () => {
  const storage = fakeStorage();
  const save = createCampaignSave(createCampaignE0(content), content);
  const key = CAMPAIGN_SAVE_NAMESPACE + ':payload:' + save.checksum;
  storage.setItem(key, JSON.stringify({ ...save, checksum: '0'.repeat(64) }));
  storage.setItem(CAMPAIGN_SAVE_NAMESPACE + ':active', JSON.stringify({ current: key, previous: null }));
  const view = buildSavesView(reader(storage), content, 0, 1);
  assert.equal(view.hasValidCurrent, false);
  assert.ok(view.error !== null);
  assert.equal(view.error!.readable, describeSaveFailure('checksum'));
});

test('an invalid pointer file is reported without guessing a checkpoint', () => {
  const storage = fakeStorage();
  storage.setItem(CAMPAIGN_SAVE_NAMESPACE + ':active', '{not json');
  const view = buildSavesView(reader(storage), content, 0, 1);
  assert.equal(view.hasValidCurrent, false);
  assert.equal(view.error!.reason, 'invalid-pointer');
  assert.equal(view.rows.length, 1);
});

test('unknown failure codes stay visible instead of being masked by a wrong guess', () => {
  assert.match(describeSaveFailure('future-mode-9'), /future-mode-9/);
  assert.match(describeSaveFailure('storage-QuotaExceededError'), /저장소/);
});
