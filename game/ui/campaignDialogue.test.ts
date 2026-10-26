import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { id } from '../src/domain/ids.ts';
import { completionSwitch, EventDataError, loadEvent } from '../src/events/definition.ts';
import { chooseEvent } from '../src/events/pipeline.ts';
import type { EventContext } from '../src/events/pipeline.ts';
import { buildDialogueView, describeDialogueFailure } from './campaignDialogueModel.ts';

/** The repository's labelled TESTINPUT pilot (game/data/events/testinput-sealed-note.json):
 * self-labelled synthetic content, never canonical narrative. It exercises the real
 * loadEvent/prepareEvent/chooseEvent pipeline exactly like production would. */
const raw: unknown = JSON.parse(readFileSync(new URL('../data/events/testinput-sealed-note.json', import.meta.url), 'utf8'));
const registry = new Set(['TESTINPUT-meticulous']);
const event = loadEvent(raw, registry);
const withTrait: EventContext = {
  actor: { traits: [{ name: 'TESTINPUT-meticulous', causeId: id('CauseId', 'TESTINPUT-fixture') }] },
  switches: { 'TESTINPUT-note-ready': true },
};

test('no admitted document is the honest blocked state, not a fabricated speech', () => {
  const view = buildDialogueView(null, withTrait);
  assert.equal(view.kind, 'blocked');
});

test('ready view renders the prepared snapshot: speaker, ordered narrative, eligible options only', () => {
  const view = buildDialogueView(event, withTrait);
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;
  assert.equal(view.speaker, event.speaker);
  assert.equal(view.title, event.title);
  assert.deepEqual(view.body, event.body.split('\n'));
  assert.equal(view.stakes, event.stakes);
  assert.equal(view.provenance, 'TESTINPUT');
  assert.deepEqual(view.options.map(option => option.id), ['inspect', 'preserve', 'defer']);
  const inspect = view.options[0]!;
  assert.equal(inspect.requires.length, 1);
  assert.equal(inspect.requires[0]!.kind, 'trait');
  assert.equal(inspect.requires[0]!.met, true);
});

test('unmet trait gates hide the option and the disclosure shows the unmet requirement', () => {
  const withoutTrait: EventContext = { ...withTrait, actor: { traits: [] } };
  const view = buildDialogueView(event, withoutTrait);
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;
  assert.deepEqual(view.options.map(option => option.id), ['defer']);
  assert.equal(view.options[0]!.requires.length, 0);
});

test('a consumed once-event prepares to the empty state with a readable return-to-opener cause', () => {
  const chosen = chooseEvent(event, 'defer', withTrait);
  const consumed: EventContext = { ...withTrait, switches: chosen.switches };
  assert.equal(buildDialogueView(event, consumed).kind, 'empty');
  assert.throws(() => chooseEvent(event, 'defer', consumed), EventDataError);
  assert.match(describeDialogueFailure(new EventDataError('event unavailable: TESTINPUT-sealed-note')), /더 이상 열리는 조건/);
});

test('stale trait access fails closed with the refresh explanation and no effect', () => {
  const withoutTrait: EventContext = { ...withTrait, actor: { traits: [] } };
  assert.throws(() => chooseEvent(event, 'inspect', withoutTrait), EventDataError);
  const text = describeDialogueFailure(new EventDataError('option unavailable: inspect'));
  assert.match(text, /새로 고쳤고/);
  assert.match(text, /어느 효과도 남지 않았다/);
});

test('a successful revalidated choice emits branch plus reserved completion once, and only the host applies it', () => {
  const applied: string[] = [];
  const chosen = chooseEvent(event, 'inspect', withTrait);
  for (const command of chosen.commands) applied.push(command.switchId + '=' + command.value);
  assert.deepEqual(applied, ['TESTINPUT-note-opened=true', completionSwitch(event) + '=true']);
  assert.equal(withTrait.switches[completionSwitch(event)], undefined);
});
