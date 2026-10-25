# Dialogue event pipeline

`loadEvent(JSON.parse(bytes), knownTraits)` parses every branch before any render.
Only boolean `setSwitch` effects are allowed. Unknown commands, unknown or undeclared
trait references, malformed predicates, duplicate IDs and a missing unconditional
fallback reject with `EventDataError`. No numeric GP rules are introduced.

`prepareEvent(event, { actor, switches })` returns either null or a complete
presentation snapshot plus engine-compatible changeFace/text/choices/fork commands.
The actor uses task 12's `Character.traits` (name + causal provenance); no trait
effect rules are copied. Predicates support trait presence/absence and switches.
The caller supplies the authoritative trait registry, not a list derived from
the event being validated. The JSON's `traits` is its reference declaration.

`chooseEvent(event, optionId, currentContext)` rejects hidden options, stale trait
access, inactive triggers and repeats. It returns the engine effects and a new
switch map together; callers persist that switch map as part of the existing
engine session. Completion is recorded only on a successful selection, never
on opening. A once-event consumes its fallback too. Its generated completion
switch cannot be authored as an option effect. For command-driven engine use,
execute the prepared commands as one modal snapshot; reprepare when actor state
changes, and do not execute both those branches and `chooseEvent` effects.

The Korean pilot is explicitly TESTINPUT, not canonical lore or an approved
opening. Its two gated options require synthetic `TESTINPUT-meticulous`; the
fallback is always available when the trigger passes. The slime image is a
nonhuman placeholder, not a portrayal of the speaker. Resource ID
`generated-enemy-slime-king` resolves through engine `pixelEnemyPortraits.ts`
to `assets/generated/pixel-enemy-portraits/slime-king.png`. It stays in the
engine submodule under `engine/ASSET-LICENSE.md` game-use terms; no image is
copied or independently redistributed.

Focused verification: `node --test game/src/events/*.test.ts`.
Browser rendering was not run: `hosting/preview.mjs` only builds a map-only
projection, not an event-injection harness. Follow-up: in an ephemeral copy of
the existing preview project, register the bundled portrait resource, call
`loadEvent` then `prepareEvent` with a labelled TESTINPUT actor and the ready
switch, attach its commands to an action event, and capture the actual player
dialogue at desktop/mobile widths for trait-present and trait-absent contexts.
Do not write the preview actor or event into the production opening.

The plan references `SCRIPTING_GUIDE.md`, but no file by that name exists in
the checked-out engine or workspace. Explicit-state behavior follows the
available engine `types/events.ts` and `player/dialogue.ts` request contracts:
all predicates and branches are prepared before presentation.
