import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { locks } from 'node:worker_threads';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductionCampaign } from '../../hosting/campaign-runtime.ts';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { packFiles } from '../../hosting/campaign-content.ts';
import { createCampaignE0, parseCampaignState } from '../../game/src/campaign/state.ts';
import { advanceCampaignCommands, submitCampaignCommand } from '../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { createCampaignSave, persistCampaignSave, loadCampaignSave } from '../../game/src/campaign/saveCheckpoint.ts';
import { migrateLegacySave, persistLegacyWorldSave, loadLegacyWorldSave } from '../../game/src/campaign/saveMigration.ts';
import { legacyCheckpoint, legacyContext } from '../../game/src/campaign/legacySaveFixtures.ts';
import { checkpoint, campaignSchema } from '../../game/src/save/campaignCheckpoint.ts';
import { revokeS01ForwardRoute } from '../../game/src/campaign/s01Effects.ts';
import { requestS01Care } from '../../game/src/campaign/s01Care.ts';
import { lordKnowledge } from '../../game/src/campaign/reports.ts';
import { campaignWorkLedger, campaignWorkGrowth } from '../../game/src/campaign/workResults.ts';
import { summaryHash } from '../../game/src/domain/eventLedger.ts';
import { acceptedOrder, readyState, checkRequest } from '../../game/src/campaign/authorityFixtures.ts';
import { checkCampaignReadiness } from '../../game/src/campaign/authorityReadiness.ts';

export const negativeScenarios = ['legacy-migration', 'invalid-save', 'revoke-cut-return', 'stale-report', 'reject-conflict', 'finite-support'];
export const mutations = {
  'legacy-migration': 'Replace the observed authenticated alias target with its old ID.',
  'invalid-save': 'Replace the observed atomic-save checksum with the rejected forged checksum.',
  'revoke-cut-return': 'Remove the observed delayed notice receipt.',
  'stale-report': 'Expose the current truth version in the observed received knowledge.',
  'reject-conflict': 'Replace the observed rejection with an accepted receipt.',
  'finite-support': 'Credit one unearned food pack in the observed conserved total.',
};

class OwnedStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

/** Private fixture driver. All transitions, validation, locks and persistence are production code.
 * The deliberate mutations corrupt observations, never expected constants or user storage. */
export async function runNegativeScenario(name, content, mutate = false) {
  assert.ok(negativeScenarios.includes(name), 'unknown negative scenario');
  const storage = new OwnedStorage();
  const runtimes = [];
  const traces = [];
  const e0 = createCampaignE0(content);
  const clone = value => JSON.parse(JSON.stringify(value));
  const advance = (state, at) => advanceCampaignCommands(state, at, content, true);
  const issue = (state, operation = 'S01-L', commandId = operation) => {
    const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
    const basis = composeCampaignAuthority(state, { operation, recipientId, issuerPersonId: 'K002', expectedRevision: state.revision }, content);
    return submitCampaignCommand(state, { kind: 'issue', commandId, operation, recipientId, issuerPersonId: 'K002',
      expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion }, content).state;
  };
  const restore = async state => {
    persistCampaignSave(storage, createCampaignSave(state, content), content);
    const runtime = new ProductionCampaign({ content, storage, locks, now: () => 0 });
    runtimes.push(runtime);
    assert.equal(await runtime.start('saved'), true);
    assert.deepEqual(runtime.app.checkpoint(), state);
    runtime.close();
    // Wait for the actual Web Lock release, not a timer or guessed delay.
    await locks.request('campaign:seoul-composed-campaign-v2', () => {});
    return loadCampaignSave(storage, content).state;
  };
  const trace = state => {
    const result = { time: state.clock.worldMilliseconds, hash: summaryHash(state), effects: state.appliedResultIds,
      events: state.commands.events, custody: state.custody, reports: state.reports, knowledge: state.knowledge };
    traces.push(result); return result;
  };
  try {
    const initial = new ProductionCampaign({ content, storage, locks, now: () => 0 }); runtimes.push(initial);
    assert.equal(await initial.start('new'), true);
    assert.deepEqual(initial.app.checkpoint(), e0);
    initial.close(); await locks.request('campaign:seoul-composed-campaign-v2', () => {});
    if (name === 'legacy-migration') {
      const context = { ...legacyContext, content };
      for (const station of ['Guro', '서울']) {
        const old = legacyCheckpoint(station);
        const campaign = campaignSchema.parse(old.runtime.campaignState);
        const receipts = [{ resultId: 'old:result', battleId: 'old:battle', payloadHash: 'old:payload', beforeCampaignHash: 'old:before', afterCampaignHash: 'old:after', ledgerPosition: 1 }];
        const historical = checkpoint({ ...old.runtime, campaignState: { ...campaign, settlementReceipts: receipts, ledgerCursor: 1 } }, { versions: old.versions, engineProjection: null });
        const original = JSON.stringify(historical);
        const migrated = migrateLegacySave(original, context);
        assert.equal(migrated.kind, 'migrated');
        persistLegacyWorldSave(storage, migrated.save, context);
        const saved = loadLegacyWorldSave(storage, context);
        assert.deepEqual(saved.legacy, historical); assert.equal(saved.original, original);
        const target = mutate && station === '서울' ? station : saved.provenance.stations[0].newId;
        assert.equal(target, station === '서울' ? '서울역' : 'Guro');
        traces.push({ station, target, historicalHash: summaryHash(saved.legacy), receipts });
      }
      for (const station of ['석수', '광명사거리']) {
        const original = JSON.stringify(legacyCheckpoint(station)); const before = [...storage.values];
        const result = migrateLegacySave(original, context);
        assert.equal(result.kind, 'quarantined'); assert.equal(result.original, original);
        assert.equal(result.reason, 'unsupported-station-identity'); assert.deepEqual([...storage.values], before);
      }
    } else if (name === 'invalid-save') {
      const state = advance(issue(e0), 780000); const valid = createCampaignSave(state, content);
      persistCampaignSave(storage, valid, content);
      for (const edit of [s => { s.custody = []; }, s => { s.commands.executions[0].orderId = 'missing'; }, s => { s.results[0].physical.previousResultId = s.results[0].id; }]) {
        const { checksum, ...payload } = clone(valid); edit(payload.state);
        const forged = { ...payload, checksum: summaryHash(payload) }; const before = [...storage.values];
        assert.throws(() => persistCampaignSave(storage, forged, content));
        assert.deepEqual([...storage.values], before);
        assert.equal(mutate ? forged.checksum : loadCampaignSave(storage, content).checksum, valid.checksum);
      }
      trace(await restore(state));
    } else if (name === 'revoke-cut-return') {
      const issued = issue(e0);
      // Report-receipt reload boundaries precede the lawful return-consented carrying cut.
      for (const at of [683999, 684000]) {
        const boundary = advance(issued, at);
        assert.deepEqual(trace(advance(await restore(boundary), 780000)), trace(advance(issued, 780000)));
      }
      for (const at of [780000]) {
        const before = advance(issued, at);
        const cut = revokeS01ForwardRoute(before, { id: 'cut:' + at, orderId: 'S01-L', issuer: content.data.operations.authority.issuer,
          grantId: content.data.operations.authority.mandates[0].grants[1], expectedRevision: before.revision, backwardRouteSafe: true, returnConsent: true }, content);
        assert.equal(cut.notices[0].receivedAt, null);
        const pending = advance(cut, at + 29999); assert.equal(pending.notices[0].receivedAt, null);
        const notified = advance(cut, at + 30000);
        assert.equal(mutate ? null : notified.notices[0].receivedAt, at + 30000);
        const until = at + 60000;
        const uninterrupted = advance(cut, until);
        for (const boundary of [cut, pending, notified]) {
          const replay = advance(await restore(boundary), until);
          assert.deepEqual(trace(replay), trace(uninterrupted));
        }
        assert.equal(uninterrupted.custody.length, 1); assert.equal(uninterrupted.custody[0].owner, e0.custody[0].owner);
        if (at === 780000) {
          assert.equal(uninterrupted.custody[0].location.nodeId, 's01:townhall:desk');
          assert.equal(uninterrupted.custody[0].unresolvedReturn, true);
        }
      }
    } else if (name === 'stale-report') {
      const ledger = advance(issue(e0), 1002000); const observing = issue(ledger, 'S01-O');
      const work = advance(observing, 1476000); const before = advance(work, 1601999);
      assert.equal(lordKnowledge(before, { personId: 'K002' }).facts.filter(f => f.source === 'K616').length, 0);
      const changed = parseCampaignState({ ...before, facts: before.facts.map(f => f.sourcePersonId === 'K616' ? { ...f, version: f.version + 1 } : f) }, content);
      const complete = advance(changed, 1602000);
      const known = clone(lordKnowledge(complete, { personId: 'K002' }));
      if (mutate) known.facts.find(f => f.source === 'K616').version++;
      assert.deepEqual(known, lordKnowledge(advance(before, 1602000), { personId: 'K002' }));
      for (const field of ['truth', 'currentVersion', 'stale', 'bodies', 'inventories', 'custody', 'grants', 'results']) assert.equal(Object.hasOwn(known, field), false);
      for (const boundary of [work, before, complete]) {
        const replay = advance(await restore(boundary), 1800000);
        assert.equal(replay.results.filter(r => r.kind === 'work' && r.orderId === 'S01-O').length, 1);
        assert.deepEqual(campaignWorkLedger(replay, content), campaignWorkLedger(work, content));
        const growth = { person: 'K616', xp: 7, level: 1, parameters: { maxHp: 1, maxMp: 1, attack: 1, defense: 1, mind: 1, agility: 1 },
          focus: { focus: null, perks: [] }, appliedResults: [] };
        const candidate = campaignWorkGrowth(replay, growth, content);
        assert.equal(candidate.projection.kind, 'blocked'); assert.deepEqual(candidate.projection.state, growth);
        assert.equal(candidate.pendingApplicability.length, 1);
        assert.deepEqual(trace(replay), trace(advance(boundary, 1800000)));
      }
    } else if (name === 'reject-conflict') {
      const first = issue(e0); const before = summaryHash(first);
      let rejection;
      try { issue(first, 'S01-L', 'conflict'); } catch (error) {
        rejection = error.code;
        assert.ok(Object.keys(error).every(key => ['code', 'name'].includes(key)), 'rejection contains no hidden world fields');
      }
      assert.equal(mutate ? 'accepted' : rejection, 'rejected-conflict');
      assert.equal(summaryHash(first), before);
      const base = readyState();
      const winner = { ...acceptedOrder('S01-L', 'winner'), stage: 'reserved', reservationIds: ['winner-body'] };
      const compatible = parseCampaignState({ ...base, mandates: [acceptedOrder('S01-L', 'second'), winner, acceptedOrder('S01-O', 'independent')],
        reservations: [{ id: 'winner-body', orderId: 'winner', resource: { kind: 'body', entityId: 'K568' }, from: 66000, until: 96000 }] }, content);
      assert.throws(() => checkCampaignReadiness(compatible, checkRequest(compatible), content), /rejected-conflict/);
      const independent = compatible.mandates[2];
      assert.equal(checkCampaignReadiness(compatible, { ...checkRequest(compatible), orderId: independent.orderId,
        expectedCompositeVersion: independent.compositeVersion, until: 78000, action: { kind: 'walk', to: 's01:townhall:entry' } }, content).resources.length, 1);
      const after = advance(first, 200000);
      assert.equal(after.mandates.some(m => m.orderId === 'conflict'), false);
      assert.deepEqual(trace(advance(await restore(after), 300000)), trace(advance(after, 300000)));
    } else if (name === 'finite-support') {
      let state = advance(e0, 3480000);
      const food = state.inventories.reduce((n, i) => n + i.foodPacks, 0);
      const water = state.inventories.reduce((n, i) => n + i.waterMl, 0);
      for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':meal', entityId: body.entityId, kind: 'food', expectedRevision: state.revision, consent: true }, content);
      state = advance(state, 3540000);
      for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':water', entityId: body.entityId, kind: 'water', expectedRevision: state.revision, consent: true }, content);
      state = advance(state, 3600000);
      assert.equal(state.inventories.reduce((n, i) => n + i.foodPacks + i.consumedFoodPacks, mutate ? 1 : 0), food);
      assert.equal(state.inventories.reduce((n, i) => n + i.waterMl + i.consumedWaterMl, 0), water);
      assert.equal(state.consumption.length, 8);
      assert.throws(() => issue(state), /authority-expired|grant-expired|support-unavailable/);
      const expired = advance(await restore(state), 5400001);
      assert.equal(expired.clock.worldMilliseconds, 5400001); assert.deepEqual(expired.inventories, state.inventories);
      assert.throws(() => requestS01Care(expired, { id: 'late', entityId: 'K568', kind: 'rest', expectedRevision: expired.revision, consent: true }, content), /support-unavailable/);
      assert.throws(() => issue(expired));
      // Arrival cutoff: one millisecond before duty arrival cannot admit the next assignment.
      const approaching = advance(issue(e0), 1001999);
      assert.throws(() => issue(approaching, 'S01-O'), /duty-unavailable/);
      assert.doesNotThrow(() => issue(advance(approaching, 1002000), 'S01-O'));
      trace(expired);
    }
    return { status: 'passed', scenario: name, content: content.hashes, mutation: mutate ? mutations[name] : null, traces,
      cleanup: { ownedStorage: true, userStorageTouched: false, runtimesClosed: true } };
  } finally { for (const runtime of runtimes) runtime.close(); }
}

/** Loopback-only fixture boundary; never included in a production build or public debug route. */
export async function runPrivateHarness(name, content, mutate = false) {
  const server = createServer(async (_request, response) => {
    try { response.end(JSON.stringify(await runNegativeScenario(name, content, mutate))); }
    catch (error) { response.writeHead(500).end(JSON.stringify({ status: 'failed', error: error.stack })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { return await (await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(120000) })).json(); }
  finally { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { url: { type: 'string' }, scenario: { type: 'string' }, evidence: { type: 'string' }, mutate: { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) console.log('Usage: node scripts/qa/campaign-negative.mjs --url <served-artifact> --scenario <' + negativeScenarios.join('|') + '> --evidence <directory> [--mutate]\nExit: 0 passed, 1 failed scenario, 2 invalid arguments. Owned in-memory fixtures only.');
    else {
      assert.ok(values.url && values.evidence && negativeScenarios.includes(values.scenario), 'Required: --url --scenario --evidence');
      const url = new URL(values.url); assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
      const entries = await Promise.all(Object.entries(packFiles).map(async ([key, file]) => {
        const response = await fetch(new URL(file, url)); assert.equal(response.status, 200); return [key, await response.text()];
      }));
      const result = await runPrivateHarness(values.scenario, CampaignContent.parse(Object.fromEntries(entries)), values.mutate);
      await mkdir(values.evidence, { recursive: true });
      const output = path.resolve(values.evidence, values.mutate ? 'mutant.json' : 'run.json');
      await writeFile(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, output, error: result.error }));
      process.exitCode = result.status === 'passed' ? 0 : 1;
    }
  } catch (error) { console.error(error.stack); process.exitCode = 2; }
}
