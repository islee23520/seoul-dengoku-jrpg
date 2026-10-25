import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { id } from '../domain/ids.ts';
import { completionSwitch, EventDataError, loadEvent } from './definition.ts';
import { chooseEvent, matches, prepareEvent } from './pipeline.ts';
import type { EventCommand, EventContext } from './pipeline.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../../data/events/testinput-sealed-note.json', import.meta.url), 'utf8'));
const registry = new Set(['TESTINPUT-meticulous']);
const event = loadEvent(raw, registry);
const TESTINPUT_WITH_TRAIT: EventContext = {
  actor: { traits: [{ name: 'TESTINPUT-meticulous', causeId: id('CauseId', 'TESTINPUT-fixture') }] },
  switches: { 'TESTINPUT-note-ready': true },
};
const TESTINPUT_WITHOUT_TRAIT: EventContext = { ...TESTINPUT_WITH_TRAIT, actor: { traits: [] } };

test('gated options appear when TESTINPUT actor possesses the trait', () => {
  // Given: the validated pilot and a synthetic trait-bearing actor.
  const context = TESTINPUT_WITH_TRAIT;
  // When: preparing before rendering.
  const prepared = prepareEvent(event, context);
  // Then: both gates and the fallback are available.
  assert.deepEqual(prepared?.options.map(option => option.id), ['inspect', 'preserve', 'defer']);
});

test('gated options are hidden when TESTINPUT actor lacks the trait', () => {
  // Given: a synthetic actor without the declared trait.
  const context = TESTINPUT_WITHOUT_TRAIT;
  // When: preparing before rendering.
  const prepared = prepareEvent(event, context);
  // Then: only the unconditional fallback is available.
  assert.deepEqual(prepared?.options.map(option => option.id), ['defer']);
});

test('selection rejects a gated option when current actor lacks the trait', () => {
  // Given: an option that could have been visible in an earlier snapshot.
  const context = TESTINPUT_WITHOUT_TRAIT;
  // When / Then: stale selection fails closed.
  assert.throws(() => chooseEvent(event, 'inspect', context), EventDataError);
});

test('once completion survives serialized switches when fallback is selected', () => {
  // Given: an available once-event.
  const context = TESTINPUT_WITHOUT_TRAIT;
  // When: selecting the fallback and round-tripping persisted state.
  const result = chooseEvent(event, 'defer', context);
  const restored: EventContext = { ...context, switches: JSON.parse(JSON.stringify(result.switches)) };
  // Then: the choice is recorded and no repeat can be presented or selected.
  assert.equal(result.switches['TESTINPUT-note-deferred'], true);
  assert.equal(result.switches[completionSwitch(event)], true);
  assert.equal(prepareEvent(event, restored), null);
  assert.throws(() => chooseEvent(event, 'defer', restored), EventDataError);
  assert.equal(context.switches[completionSwitch(event)], undefined);
});

test('opening does not consume a once-event when no choice is selected', () => {
  // Given: the original immutable context.
  const context = TESTINPUT_WITH_TRAIT;
  // When: preparing a modal without executing it.
  prepareEvent(event, context);
  // Then: a second preparation remains available.
  assert.notEqual(prepareEvent(event, context), null);
  assert.equal(context.switches[completionSwitch(event)], undefined);
});

test('trigger rejects presentation when the ready switch is absent', () => {
  // Given: the trigger has not fired.
  const context = { ...TESTINPUT_WITH_TRAIT, switches: {} };
  // When: preparing the event.
  const result = prepareEvent(event, context);
  // Then: no presentation exists.
  assert.equal(result, null);
});

test('trait absence predicate matches when the actor lacks the trait', () => {
  // Given: an explicit negative presence predicate.
  const condition = { kind: 'trait', trait: 'TESTINPUT-meticulous', present: false } as const;
  // When: evaluating it against the synthetic actor.
  const result = matches(condition, TESTINPUT_WITHOUT_TRAIT);
  // Then: absence is true.
  assert.equal(result, true);
});

test('repeatable event remains available when once is false', () => {
  // Given: a validated repeatable variant.
  const repeatable = loadEvent({ ...event, once: false }, registry);
  // When: choosing a gated branch.
  const result = chooseEvent(repeatable, 'inspect', TESTINPUT_WITH_TRAIT);
  // Then: only the declared effect is applied, with no completion marker.
  assert.equal(result.switches['TESTINPUT-note-opened'], true);
  assert.equal(result.switches[completionSwitch(event)], undefined);
  assert.notEqual(prepareEvent(repeatable, { ...TESTINPUT_WITH_TRAIT, switches: result.switches }), null);
});

// Minimal engine-contract executor: asserts behavior of composed branches, not DOM.
function execute(commands: readonly EventCommand[], context: EventContext): EventContext {
  let current = context;
  for (const command of commands) {
    switch (command.kind) {
      case 'changeFace': case 'text': break;
      case 'fork':
        if (matches(command.condition, current)) current = execute(command.then, current);
        break;
      case 'choices': {
        const fallback = command.options.at(-1);
        assert.ok(fallback);
        current = execute(fallback.branch, current);
        break;
      }
      case 'setSwitch': current = { ...current, switches: { ...current.switches, [command.switchId]: command.value } }; break;
      default: { const unreachable: never = command; throw new EventDataError(String(unreachable)); }
    }
  }
  return current;
}

test('composed engine branches apply fallback and block a second queued run', () => {
  // Given: prepared engine-compatible commands for an actor without a trait.
  const prepared = prepareEvent(event, TESTINPUT_WITHOUT_TRAIT);
  assert.ok(prepared);
  // When: executing its actual fork/choices/setSwitch composition.
  const result = execute(prepared.commands, TESTINPUT_WITHOUT_TRAIT);
  // Then: effects and completion agree with selection and a replay is inert.
  assert.deepEqual(result.switches, chooseEvent(event, 'defer', TESTINPUT_WITHOUT_TRAIT).switches);
  assert.deepEqual(execute(prepared.commands, result), result);
});

const invalidCases = [
  ['unknown command', { ...event, options: [{ ...event.options[0], effects: [{ kind: 'grantGold', amount: 10 }] }] }],
  ['invalid effect value', { ...event, options: [{ ...event.options[0], effects: [{ kind: 'setSwitch', switchId: 'x', value: 'true' }] }] }],
  ['missing trait reference', { ...event, traits: [] }],
  ['unknown trait reference', { ...event, traits: ['unknown'] }],
  ['malformed predicate', { ...event, trigger: [{ kind: 'trait', present: true }] }],
  ['unknown predicate', { ...event, trigger: [{ kind: 'script', body: 'true' }] }],
  ['missing fallback', { ...event, options: event.options.filter(option => option.requires.length > 0) }],
  ['duplicate option', { ...event, options: [...event.options, event.options[0]] }],
  ['completion override', { ...event, options: [{ id: 'x', text: 'x', requires: [], effects: [{ kind: 'setSwitch', switchId: completionSwitch(event), value: false }] }] }],
] as const;
for (const [name, input] of invalidCases) {
  test(`loader rejects ${name} before rendering`, () => {
    // Given: malformed data, including branches hidden from the current actor.
    const invalid = input;
    // When / Then: the boundary rejects; no prepared render state can exist.
    assert.throws(() => loadEvent(invalid, registry), EventDataError);
  });
}
