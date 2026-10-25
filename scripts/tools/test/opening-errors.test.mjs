import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStartFailure, startFailureText } from '../../../hosting/opening-errors.ts';
import { selectOpeningActor } from '../../../game/src/runtime/openingScenario.ts';
import { MissingRuleInput, BattleConflict } from '../../../game/src/battle/realtime.ts';
import { applySampling } from '../../../game/src/assets/sampling.ts';

const thrown = fn => { try { fn(); } catch (error) { return error; } assert.fail('expected a throw'); };
const cases = [
  ['missing rule input', new MissingRuleInput('approved-GP-content-time-inputs'), startFailureText.rules],
  ['presentation not ready', new BattleConflict('presentation-not-ready'), startFailureText.notReady],
  ['projection conflict', new BattleConflict('projection-mutated-boundary'), startFailureText.conflict],
  ['unknown actor id (zod)', thrown(() => selectOpeningActor('K999')), startFailureText.placement],
  ['unresolved placement', new RangeError('Unresolved scenario placement: node:missing'), startFailureText.placement],
  ['sampling tileset guard', thrown(() => applySampling({ assets: { uploaded: {} }, maps: { 'station-4775726f': { tilesetId: 'absent' } }, tilesets: {} },
    { signageDataUrl: 'data:,', audioDataUrl: 'data:,' })), startFailureText.assets],
  ['sampling audio guard', new Error('Registered sampling audio missing'), startFailureText.assets],
  ['engine or unknown failure', new TypeError('Cannot read properties of undefined (reading map)'), startFailureText.fallback],
  ['non-error throw', 'raw-string-throw', startFailureText.fallback],
];

for (const [label, error, expected] of cases) test('start failure text: ' + label, () => {
  // Given: an error that can reach the opening start catch block.
  // When: it is mapped for the player.
  const failure = describeStartFailure(error);
  // Then: the rendered text is the readable Korean string, and no internal code leaks into it.
  assert.equal(failure.text, expected);
  const message = error instanceof Error ? error.message : String(error);
  assert(!failure.text.includes(message));
  assert.doesNotMatch(failure.text, /[A-Za-z]{3,}|[a-z]+-[a-z]+/);
  assert(failure.code.includes(message), 'internal code kept for console/telemetry');
});
