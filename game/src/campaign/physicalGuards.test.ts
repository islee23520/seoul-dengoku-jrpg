import assert from 'node:assert/strict';
import test from 'node:test';
import { content, e0, rejects } from './testFixtures.ts';
import { safeReturnState, edit } from './guardFixtures.ts';
import { parseCampaignState } from './state.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { nodeLocation } from './locations.ts';
import { assertPhysicalEffect } from './physicalEffects.ts';

const base = safeReturnState.results[1]; assert.ok(base?.physical);
const original = safeReturnState.results[0]; assert.ok(original?.physical);
const corruptions: readonly [string, readonly (string | number)[], unknown, 'custody' | 'inventory'][] = [
  ['predecessor missing', ['previousResultId'], 'missing', 'custody'],
  ['predecessor custody differs', ['before', 'causeId'], 'invented', 'custody'],
  ['original owner changed', ['after', 'owner'], 'K002', 'custody'],
  ['result cause differs', ['after', 'causeId'], 'invented', 'custody'],
  ['holder teleport at handover', ['before', 'location'], nodeLocation('s01:townhall:desk', content), 'custody'],
  ['missing participant', ['bodies'], [], 'custody'],
  ['historical duty absent', ['dutyAvailable'], false, 'custody'],
  ['missing historical regions', ['bodies', 0, 'regions'], [], 'inventory'],
  ['required handover arm exhausted', ['bodies', 0, 'regions', 0, 'effortMilliseconds'], 1800000, 'inventory'],
];
for (const [name, path, value, code] of corruptions) test(`rejects ${name} with a consistently hashed physical receipt`, () => {
  // Given one corrupted physical-history field and an updated payload checksum.
  const physical = edit(base.physical, path, value);
  const candidate = { ...safeReturnState, results: safeReturnState.results.map(r => r.id === base.id ? { ...r, physical, payloadHash: summaryHash(JSON.parse(JSON.stringify(physical))) } : r) };
  // When restoring. Then the physical cross-link itself must reject.
  rejects(() => parseCampaignState(candidate, content), code);
});
test('rejects an altered physical payload without its receipt digest', () => {
  // Given a changed historic witness with its old digest.
  const candidate = edit(safeReturnState, ['results', 1, 'physical', 'dutyAvailable'], false);
  // When restoring. Then the serialized history binding rejects.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects custody predecessor without a physical payload', () => {
  // Given an arbitrary generic custody result, the original residual bypass.
  const candidate = edit(safeReturnState, ['results', 0, 'physical'], null);
  // When restoring. Then a hash with no custody payload is insufficient.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects a work result masquerading as a custody predecessor', () => {
  // Given a work result carrying arbitrary physical fields without a custody event.
  const candidate = edit(safeReturnState, ['results', 0, 'kind'], 'work');
  // When restoring. Then only a verified custody transition establishes the predecessor.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects later current custody reverting to E0 without another receipt', () => {
  // Given the latest handover history but old physical custody.
  const candidate = { ...safeReturnState, custody: e0.custody };
  // When restoring. Then elapsed time alone cannot undo a transfer.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});
test('rejects a custody transition outside the approved pickup sequence', () => {
  // Given a direct duty-to-K002 pickup with matching source and hash.
  assert.ok(original.physical);
  const location = nodeLocation('s01:townhall:desk', content);
  const physical = { ...original.physical, before: { ...original.physical.before, location }, after: { ...original.physical.after, custodian: 'K002', location },
    bodies: e0.bodies.filter(b => b.entityId === 'K002' || b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location })) };
  const candidate = { ...safeReturnState, results: safeReturnState.results.map(r => r.id === original.id ? { ...r, physical, payloadHash: summaryHash(physical) } : r) };
  // When restoring. Then source ownership does not authorize an invented handoff.
  rejects(() => parseCampaignState(candidate, content), 'custody');
});

for (const action of ['protect', 'carry-to-threshold', 'restock'] as const) test(`rejects ${action} relabeling of a handover without its physical action`, () => {
  // Given a valid handover payload mislabeled as another safe-return action.
  const result = { ...base, safeReturn: { ...base.safeReturn, action } };
  // When checking the physical receipt. Then each action's own transition is mandatory.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [safeReturnState, result, content]), 'custody');
});
test('rejects original custody result associated with an observation order', () => {
  // Given a valid custody payload attached to the wrong admitted operation.
  const state = { ...safeReturnState, mandates: safeReturnState.mandates.map(m => ({ ...m, operation: 'S01-O' })) };
  // When checking the physical receipt. Then observation grants cannot carry an original.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [state, original, content]), 'custody');
});
test('rejects at-boundary original movement after the handover without elapsed time', () => {
  // Given matching identity but a simultaneous different physical location.
  const location = nodeLocation('s01:townhall:desk', content);
  const state = { ...safeReturnState, clock: { ...safeReturnState.clock, worldMilliseconds: base.at }, custody: safeReturnState.custody.map(c => ({ ...c, location })) };
  // When checking the current boundary. Then current physical outcome must match exactly.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [state, base, content]), 'custody');
});
test('rejects K002 to K568 return pickup without separate return acceptance', () => {
  // Given a prior lawful K002 delivery and a proposed return pickup at desk.
  assert.ok(original.physical);
  const location = nodeLocation('s01:townhall:desk', content);
  const held = { ...original.physical.after, custodian: 'K002', location, causeId: 'delivered' };
  const deliveredPhysical = { ...original.physical, previousResultId: original.id, before: { ...original.physical.after, location }, after: held };
  const delivered = { ...original, id: 'delivered', at: 1360000, physical: deliveredPhysical, payloadHash: summaryHash(deliveredPhysical) };
  const physical = { previousResultId: 'delivered', before: held, after: { ...held, custodian: 'K568', causeId: 'return-pickup' }, dutyAvailable: true,
    bodies: e0.bodies.filter(b => b.entityId === 'K002' || b.entityId === 'K568').map(b => ({ ...b, location })) };
  const result = { ...original, id: 'return-pickup', causeId: 'return-pickup', at: 1370000, physical, payloadHash: summaryHash(physical) };
  const state = { ...safeReturnState, mandates: safeReturnState.mandates.map(m => ({ ...m, returnAcceptedAt: null })), results: [original, delivered, result], custody: [physical.after] };
  // When checking the transport transfer. Then K568 must have separately accepted it.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [state, result, content]), 'custody');
});

const isolated: readonly [string, readonly (string | number)[], unknown, 'custody' | 'inventory'][] = [
  ['history ordering', ['previousResultId'], 'return', 'custody'],
  ['immutable owner', ['after', 'owner'], 'K002', 'custody'],
  ['receipt cause', ['after', 'causeId'], 'other', 'custody'],
  ['handover terminal state', ['after', 'returnState'], 'return-required', 'custody'],
  ['all body regions retained', ['bodies', 0, 'regions'], original.physical?.bodies[0]?.regions.filter(r => r.region !== 'left-leg'), 'inventory'],
];
for (const [name, path, value, code] of isolated) test(`rejects isolated physical ${name} without later state masking it`, () => {
  // Given a single internally hashed physical receipt corruption.
  const physical = edit(base.physical, path, value);
  const result = { ...base, physical, payloadHash: summaryHash(JSON.parse(JSON.stringify(physical))) };
  const state = { ...safeReturnState, results: [original] };
  // When checking the effect in isolation. Then the historical invariant itself rejects.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [state, result, content]), code);
});
test('rejects an isolated ordinary custody action outside the source path', () => {
  // Given direct duty-to-K002 transfer, with no later predecessor to mask the action check.
  assert.ok(original.physical);
  const location = nodeLocation('s01:townhall:desk', content);
  const physical = { ...original.physical, before: { ...original.physical.before, location }, after: { ...original.physical.after, custodian: 'K002', location },
    bodies: e0.bodies.filter(b => b.entityId === 'K002' || b.entityId === content.data.operations.authority.duty).map(b => ({ ...b, location })) };
  const result = { ...original, physical, payloadHash: summaryHash(physical) };
  // When checking. Then only the approved custody sequence can be restored.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [{ ...safeReturnState, results: [] }, result, content]), 'custody');
});
test('rejects a future predecessor despite matching custody identity', () => {
  // Given matching custody payload but reversed causal event times.
  const state = { ...safeReturnState, results: [{ ...original, at: base.at + 1 }] };
  // When checking the safe effect. Then prior custody must actually precede it.
  rejects(() => Reflect.apply(assertPhysicalEffect, null, [state, base, content]), 'custody');
});
