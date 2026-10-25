import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { createCampaignE0, parseCampaignState } from '../../game/src/campaign/state.ts';
import { CampaignApplication, advanceCampaignCommands, submitCampaignCommand } from '../../game/src/campaign/application.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { revokeS01ForwardRoute } from '../../game/src/campaign/s01Effects.ts';
import { requestS01Care } from '../../game/src/campaign/s01Care.ts';
import { integer } from '../../game/src/domain/ids.ts';
import type { CampaignState } from '../../game/src/campaign/stateSchemas.ts';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/qa/s01-physical.ts --scenario s01-sequential|revoke-cut-return|finite-support');
} else {
  assert.equal(args.length, 2, 'expected --scenario NAME');
  assert.equal(args[0], '--scenario');
  assert.ok(['s01-sequential', 'revoke-cut-return', 'finite-support'].includes(args[1] ?? ''), 'unknown scenario');
  const data = new URL('../../game/data/', import.meta.url);
  const files = { manifest: 'campaign/source-manifest.json', atlas: 'campaign/atlas.json', identities: 'campaign/identity-map.json',
    scenario: 'scenarios/townhall-s01-r1/scenario.json', projection: 'scenarios/townhall-s01-r1/projection.json', operations: 'scenarios/townhall-s01-r2/operations.json' };
  const packages = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, path]) => [name, await readFile(new URL(path, data), 'utf8')])));
  const content = CampaignContent.parse(packages), e0 = createCampaignE0(content);
  const command = (state: CampaignState, operation: 'S01-L' | 'S01-O') => {
    const recipientId = operation === 'S01-L' ? 'K568' : 'K616';
    const basis = composeCampaignAuthority(state, { operation, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
    return { kind: 'issue', commandId: operation, issuerPersonId: 'K002', recipientId, operation, expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion };
  };
  const advance = (state: CampaignState, at: number) => advanceCampaignCommands(state, integer('WorldMilliseconds', at), content, true);
  let result: unknown;
  if (args[1] === 's01-sequential') {
    let hostTime = 0;
    const app = new CampaignApplication({ content, state: e0, now: () => hostTime });
    app.submit(command(app.checkpoint(), 'S01-L')); app.setSpeed(1);
    hostTime = 167000; app.reconcile();
    const ledger = app.checkpoint(), duty = ledger.bodies.find(b => b.entityId === content.data.operations.authority.duty);
    assert.equal(ledger.clock.worldMilliseconds, 1002000);
    assert.equal(duty?.location.kind === 'node' && duty.location.nodeId, 's01:townhall:desk');
    assert.equal(ledger.custody[0]?.returnState, 'resealed');
    app.submit(command(ledger, 'S01-O'));
    hostTime = 267000; app.reconcile();
    const final = app.checkpoint();
    assert.equal(final.clock.worldMilliseconds, 1602000);
    assert.equal(final.reports.filter(r => r.fact.orderId === 'S01-O' && r.receivedAt === 1602000).length, 2);
    assert.deepEqual(parseCampaignState(JSON.parse(JSON.stringify(final)), content), final);
    result = { scenario: args[1], clock: 'CampaignApplication/CampaignSession', dutyDeskAt: ledger.clock.worldMilliseconds,
      original: final.custody, effort: final.bodies.map(b => ({ entityId: b.entityId, regions: b.regions })), inventories: final.inventories,
      receipts: final.commands.events.filter(e => e.effectId !== null), readings: final.reports.filter(r => r.fact.orderId === 'S01-O'),
      visible: app.settlement('K002') };
    app.close();
  } else if (args[1] === 'revoke-cut-return') {
    let state = advance(submitCampaignCommand(e0, command(e0, 'S01-L'), content).state, 780000);
    const cutLocation = state.custody[0]?.location;
    state = revokeS01ForwardRoute(state, { id: 'cut', orderId: 'S01-L', issuer: content.data.operations.authority.issuer,
      grantId: content.data.operations.authority.mandates[0]!.grants[1], expectedRevision: state.revision, backwardRouteSafe: true, returnConsent: true }, content);
    const notice = advance(state, 810000), final = advance(notice, 816000);
    assert.equal(notice.notices[0]?.receivedAt, 810000);
    assert.equal(final.custody[0]?.custodian, 'K568');
    assert.equal(final.custody[0]?.location.kind === 'node' && final.custody[0].location.nodeId, 's01:townhall:desk');
    result = { scenario: args[1], cutLocation, notices: final.notices, original: final.custody, receivedReports: final.reports.map(r => r.receivedAt) };
  } else {
    let state = advance(e0, 3480000);
    for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':food', entityId: body.entityId, kind: 'food', expectedRevision: state.revision, consent: true }, content);
    state = advance(state, 3540000);
    for (const body of state.bodies) state = requestS01Care(state, { id: body.entityId + ':water', entityId: body.entityId, kind: 'water', expectedRevision: state.revision, consent: true }, content);
    state = advance(state, 5400001);
    assert.equal(state.consumption.length, 8);
    assert.equal(state.inventories.reduce((sum, i) => sum + i.foodPacks, 0), 4);
    assert.equal(state.inventories.reduce((sum, i) => sum + i.waterMl, 0), 0);
    result = { scenario: args[1], at: state.clock.worldMilliseconds, consumption: state.consumption, inventories: state.inventories, bodies: state.bodies };
  }
  console.log(JSON.stringify({ status: 'passed', appendixSha256: content.data.operations.approval.candidateSha256, result }, null, 2));
}
