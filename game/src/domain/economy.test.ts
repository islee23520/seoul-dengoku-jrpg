import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, integer } from './ids.ts';
import { InvariantViolation, MissingRuleInput } from './errors.ts';
import { applyResult } from './eventLedger.ts';
import type { EventLedger, LedgerEntry } from './eventLedger.ts';
import { economyEntry, transitionEconomy } from './economy.ts';
import type { EconomyContext, EconomyRules } from './economy.ts';
import { economySchema } from './stationGoods.ts';
import type { EconomyEvent, StationEconomy } from './stationGoods.ts';
import { basicMarketFacts, observePrices, marketInfoLedger, remoteMarketInfo } from './priceObservation.ts';

const investor = id('PersonId', 'TESTINPUT:investor'), representative = id('PersonId', 'TESTINPUT:representative');
const versions = { schemaVersion: integer('SchemaVersion', 1), ruleVersion: 'TESTINPUT:economy', contentVersion: 'TESTINPUT:content' };
// TESTINPUT only: neither these rates nor investment thresholds approve GP values.
const rules: EconomyRules = {
  provenance: 'TESTINPUT', ruleVersion: versions.ruleVersion,
  price: ({ good }) => good.price + 7,
  investment: ({ sector }) => {
    switch (sector) {
      case 'commercial': return { threshold: 10, allowedTrust: ['friend'], facilities: ['workshop'], materials: ['parts'], defense: 0, share: 3, visibleChange: 'workshop-open' };
      case 'military': return { threshold: 10, allowedTrust: ['friend'], facilities: [], materials: [], defense: 2, share: 1, visibleChange: 'barricade-built' };
    }
  },
};
const context: EconomyContext = { rules, representative, relations: { trust: [{ from: representative, to: investor, value: 25 }], facts: [] } };
function initial(): StationEconomy {
  return economySchema.parse({ stationId: 'TESTINPUT:station',
    goods: [{ id: 'food', basePrice: 100, price: 100, stock: 20, quality: 'standard', demandTags: ['food'] },
      { id: 'tools', basePrice: 200, price: 200, stock: 5, quality: 'fine', demandTags: ['repair'] }],
    conditions: [], investments: [], availableFacilities: ['workshop'], unlockedFacilities: [], materials: [], defense: 0,
    visibleChanges: [], priceChanges: [], appliedResultIds: [] });
}
function condition(serial: string, kind: 'power-outage' | 'contamination' | 'faction-demand' | 'stock-response' = 'power-outage'): EconomyEvent {
  const cause = kind + ':' + serial;
  return { kind: 'condition', condition: { kind, goodId: 'food', cause }, cause,
    resultId: id('ResultId', serial), causeId: id('CauseId', 'TESTINPUT:' + serial) };
}
function investment(serial: string, amount: number, sector: 'commercial' | 'military' = 'commercial'): EconomyEvent {
  return { kind: 'investment', investor, amount, sector, cause: 'TESTINPUT:investment',
    resultId: id('ResultId', serial), causeId: id('CauseId', 'TESTINPUT:' + serial) };
}
function metadata(ledger: EventLedger): Omit<LedgerEntry, 'target' | 'payload' | 'resultId' | 'causeId' | 'afterHash'> {
  return { ...versions, actor: investor, command: 'economy', worldTime: integer('WorldTick', ledger.entries.length), beforeHash: ledger.entries.at(-1)?.afterHash ?? 'TESTINPUT:genesis' };
}
function settle(state: StationEconomy, event: EconomyEvent, input: { readonly ledger: EventLedger; readonly context: EconomyContext }): { readonly state: StationEconomy; readonly ledger: EventLedger } {
  const entry = economyEntry(state, event, { context: input.context, metadata: metadata(input.ledger) });
  const { ledger } = applyResult(input.ledger, entry);
  return { state: transitionEconomy(state, event, { ledger, context: input.context }), ledger };
}
const emptyLedger: EventLedger = { ...versions, entries: [], pendingResultIds: [] };

for (const kind of ['power-outage', 'contamination', 'faction-demand'] as const) test('price changes expose the condition cause when ' + kind + ' is committed', () => {
  // Given a local market and a labeled condition.
  const event = condition(kind, kind);
  // When the committed condition is applied.
  const next = settle(initial(), event, { ledger: emptyLedger, context }).state;
  // Then only the affected good changes with an exact causal receipt.
  assert.deepEqual(next.goods.map(g => g.price), [107, 200]);
  assert.deepEqual(next.priceChanges, [{ resultId: event.resultId, goodId: 'food', before: 100, after: 107, cause: event.cause }]);
});

test('commercial investment unlocks a station-specific place when threshold and directional trust qualify', () => {
  // Given an investment below its injected threshold.
  const first = settle(initial(), investment('first', 4), { ledger: emptyLedger, context });
  assert.deepEqual(first.state.unlockedFacilities, []);
  // When the same investor reaches the threshold.
  const next = settle(first.state, investment('second', 6), { ledger: first.ledger, context }).state;
  // Then the place, material access and share change together.
  assert.deepEqual(next.unlockedFacilities, ['workshop']); assert.deepEqual(next.materials, ['parts']);
  assert.deepEqual(next.visibleChanges, ['workshop-open']); assert.equal(next.investments[0]?.share, 3);
});

test('military investment changes defense when its injected threshold qualifies', () => {
  // Given an eligible station.
  const state = initial();
  // When military investment resolves.
  const next = settle(state, investment('military', 10, 'military'), { ledger: emptyLedger, context }).state;
  // Then defense changes visibly without commercial facilities.
  assert.equal(next.defense, 2); assert.deepEqual(next.visibleChanges, ['barricade-built']); assert.deepEqual(next.unlockedFacilities, []);
});

test('unlock stays gated when trust is neutral even though reverse trust is friendly', () => {
  // Given directional trust just below the canon friend boundary.
  const gated = { ...context, relations: { trust: [{ from: representative, to: investor, value: 24 }, { from: investor, to: representative, value: 25 }], facts: [] } };
  // When investment exceeds the monetary threshold.
  const next = settle(initial(), investment('gated', 20), { ledger: emptyLedger, context: gated }).state;
  // Then base trade stays open but no facility is granted.
  assert.deepEqual(next.unlockedFacilities, []); assert.equal(basicMarketFacts(next).open, true);
});

test('repeated route trades decrease stock without guessing price coefficients', () => {
  // Given a market without approved economic rates.
  let state = initial(), ledger = emptyLedger;
  const structural: EconomyContext = { representative, relations: { trust: [], facts: [] } };
  // When the same route buys twice using distinct ledger results.
  for (const serial of ['route-one', 'route-two']) {
    const result = settle(state, { kind: 'trade', goodId: 'food', route: 'TESTINPUT:A-B', quantity: 3,
      cause: 'TESTINPUT:route-purchase', resultId: id('ResultId', serial), causeId: id('CauseId', serial) }, { ledger, context: structural });
    state = result.state; ledger = result.ledger;
  }
  // Then stock falls structurally and a numeric stock response is fail-closed.
  assert.equal(state.goods[0]?.stock, 14); assert.equal(state.goods[0]?.price, 100);
  assert.throws(() => economyEntry(state, condition('response', 'stock-response'), { context: structural, metadata: metadata(ledger) }), MissingRuleInput);
});

test('unexplained price changes are rejected when a ledger payload is forged', () => {
  // Given a legitimate condition entry with a tampered next price.
  const state = initial(), event = condition('forged');
  const entry = economyEntry(state, event, { context, metadata: metadata(emptyLedger) });
  const payload = { economyBeforeHash: 'forged', event, economy: { ...state, goods: state.goods.map(g => ({ ...g, price: 999 })) } };
  const ledger = applyResult(emptyLedger, { ...entry, payload }).ledger;
  // When world facts are transitioned from that forged payload.
  // Then the exact causal-chain check rejects it.
  assert.throws(() => transitionEconomy(state, event, { ledger, context }), InvariantViolation);
});

test('missing numerical rules reject conditions and investments before any transition', () => {
  // Given no approved price or investment policy.
  const missing: EconomyContext = { representative, relations: { trust: [], facts: [] } };
  // When either operation requests a numerical resolution.
  // Then both fail closed, as does investment with price rules but no unlock policy.
  assert.throws(() => economyEntry(initial(), condition('missing'), { context: missing, metadata: metadata(emptyLedger) }), MissingRuleInput);
  assert.throws(() => economyEntry(initial(), investment('missing', 10), { context: missing, metadata: metadata(emptyLedger) }), MissingRuleInput);
  assert.throws(() => economyEntry(initial(), investment('no-policy', 10), { context: { ...context, rules: { ...versions, provenance: 'TESTINPUT', price: ({ good }) => good.price } }, metadata: metadata(emptyLedger) }), MissingRuleInput);
});

test('basic facts remain free while remote observations require injected payment rules', () => {
  // Given an observed market with no payment and an unrelated observer record.
  const state = initial(), observedAt = integer('WorldTick', 1);
  const record = observePrices(state, { observer: investor, observedAt });
  const other = observePrices(state, { observer: representative, observedAt });
  // When basic facts and the player ledger are queried.
  const basic = basicMarketFacts(state), records = marketInfoLedger([record, other], investor);
  // Then basic facts are free, player records are separate, and remote detail is not free by accident.
  assert.equal(basic.cost, 0); assert.equal(basic.open, true); assert.deepEqual(records, [record]);
  assert.throws(() => remoteMarketInfo(record, { paid: 10 }), MissingRuleInput);
  assert.throws(() => remoteMarketInfo(record, { paid: 0, fee: () => 2 }), InvariantViolation);
  assert.equal(remoteMarketInfo(record, { paid: 2, fee: () => 2 }), record);
});

test('observations stay historical when six monthly condition results change world facts', () => {
  // Given a player observation before six synthetic monthly resolutions.
  let state = initial(), ledger = emptyLedger;
  const record = observePrices(state, { observer: investor, observedAt: integer('WorldTick', 0) });
  // When six distinct causal events settle (not a calendar or approved monthly-rate rule).
  for (let month = 1; month <= 6; month += 1) {
    const next = settle(state, condition('month-' + month), { ledger, context }); state = next.state; ledger = next.ledger;
  }
  // Then every price movement has a result and the player's old observation does not become omniscient.
  assert.equal(state.goods[0]?.price, 142); assert.equal(state.priceChanges.length, 6);
  assert.equal(record.goods[0]?.price, 100); assert.deepEqual(record.sourceResultIds, []);
  assert.deepEqual(state.priceChanges.map(p => p.resultId), state.appliedResultIds);
});

test('invalid numerical output and unavailable facilities fail closed', () => {
  // Given injected rules with invalid outputs.
  const invalidPrice = { ...context, rules: { ...rules, price: () => Number.NaN } };
  const invalidFacility = { ...context, rules: { ...rules, investment: () => ({ threshold: 1, allowedTrust: ['friend'] as const, facilities: ['absent'], materials: [], defense: 0, share: 1, visibleChange: 'absent-open' }) } };
  // When each invalid operation is projected.
  // Then invalid values cannot reach a ledger entry.
  assert.throws(() => economyEntry(initial(), condition('nan'), { context: invalidPrice, metadata: metadata(emptyLedger) }), InvariantViolation);
  assert.throws(() => economyEntry(initial(), investment('absent', 10), { context: invalidFacility, metadata: metadata(emptyLedger) }), InvariantViolation);
});

test('reused results, missing ledger entries and empty causes cannot change economy', () => {
  // Given an already applied causal condition.
  const state = initial(), event = condition('once'), result = settle(state, event, { ledger: emptyLedger, context });
  // When callers replay, omit commitment, or erase the explanation.
  // Then no second world effect or unexplained entry is accepted.
  assert.throws(() => transitionEconomy(result.state, event, { ledger: result.ledger, context }), InvariantViolation);
  assert.throws(() => transitionEconomy(state, event, { ledger: emptyLedger, context }), InvariantViolation);
  assert.throws(() => economyEntry(state, { ...event, cause: '' }, { context, metadata: metadata(emptyLedger) }));
});
