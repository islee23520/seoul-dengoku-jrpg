# Explicit campaign checkpoints

Current S01 saves use `seoul-composed-campaign-v2`, envelope version 2.
`createCampaignSave` validates the whole composed state; `persistCampaignSave`
validates again, writes an immutable content-addressed payload, reads it back,
validates it, then switches the active pointer with one atomic Storage.setItem.
`loadCampaignSave` validates the pointer namespace, payload checksum and all
campaign links. Failed staging leaves the prior pointer active. A process killed
after the pointer commit has saved successfully; one killed before it has not.
The adapter requires the browser Storage contract: a failed setItem leaves that
key unchanged. It cannot provide atomicity for an adapter that partially writes
the active pointer and then throws. No autosave or recovery journal is added.

Use `CampaignSession.restore(save.state)` on an owned live session, or construct
a new `CampaignApplication` from the saved state. Restore validates before its
single host replacement, restores the exact world milliseconds, speed and
fractional carry, and samples a fresh monotonic origin. It never reconciles the
discarded session first or credits closed time. Application/owned-tab integration
and ordinary save/load controls belong to tasks 15/16. The snapshot includes all
commands, physical journals, authority revisions, custody, reports, knowledge,
notices, disputes, provisions, result identifiers and the explicit S01 RNG state.

## Previous edition

The historical writer is commit `ce876fb`, `game/src/save/campaignCheckpoint.ts`
lines 39-41; its complete envelope is defined at lines 13-18. It persists
`RuntimeState`, generic campaign facts and settlement receipts, plus an arbitrary
engine projection. `hosting/realtime-entry.ts` lines 59-70 produces that projection
using the engine save writer. Its loader (lines 73-90) parses and applies the engine
snapshot before replacing the host. Those contracts do not contain composed S01
state, S01 speed, S01 body effects, or an approved legacy-to-S01 conversion.

`migrateLegacySave` therefore does not create an S01 campaign. It first uses the
real v1 reader and `restoreWorld`, with the previous build's versions and world
rules supplied explicitly. The legacy graph bytes must match the authenticated
identity map's legacy graph digest. Station identities are resolved using only
the authenticated exact/alias entries, with target existence and collision
checks. The old runtime, ledger and receipt payloads remain byte-meaning-identical;
the original import string and separate resolution provenance are saved under
`seoul-legacy-world-v2`. Neither the v1 pointer nor its payload is overwritten.
`restoreLegacyWorldSave` validates then replaces a compatible legacy host exactly;
it accepts no elapsed/offline time. Callers rebind the host after replacement.

Station-level world facts without an active route can resolve an authenticated
alias. This is **identity resolution**, not local tile placement migration. Task 2
marks alias placement unsupported; the importer does not grant placement approval.
Excluded/unknown/ambiguous identities, active routes, battle state, and any engine
projection quarantine the whole input. Quarantine returns the original string
for export and, when the old envelope validates, its unchanged engine snapshot
for isolated legacy inspection. It never installs that snapshot into the current
campaign. Starting a new campaign is a separate explicit user action. Invalid or
foreign inputs cannot change live state or any active pointer.

Legacy clocks such as 990000 or 1590000 remain exactly those values in their old
units. The provisional S01 correction to 1002000/1602000 is not a conversion rule:
there is no +12000 shift, inferred completion, generated report, or rewritten
historical receipt. Current saves explicitly bind
`section2-route-r2-pending-ratification`. Old incompatible composed states fail
the current cross-link validation rather than being silently repaired.

## Verification

Run the plan acceptance command:

```sh
node --test game/src/save/campaignCheckpoint.test.ts game/src/campaign/saveMigration.test.ts
```

Related recovery cases are in `game/src/campaign/saveRecovery.test.ts`. Backend
CLI scenarios use the actual production pack and checkpoint API:

```sh
node scripts/qa/campaign-save.ts --scenario save-reload
node scripts/qa/campaign-save.ts --scenario invalid-save
node scripts/qa/campaign-save.ts --scenario legacy-migration
```

The legacy CLI requires explicit old versions/rules from its fixture, identified
as TESTINPUT. It is not evidence of an old production S01 campaign that never
existed. Browser UI proof remains assigned to tasks 15/16.
