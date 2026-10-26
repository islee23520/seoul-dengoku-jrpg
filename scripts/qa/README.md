# Production campaign browser QA

Requires Node 24.15 or newer, the initialized engine's locked dependencies,
and the authenticated native `aside-agent` wrapper on PATH. The runner reads
the current native guide and connected profiles. With multiple profiles,
pass `--profile` using an ID returned by `aside-agent host profiles --host local --json`.
It never logs credentials or changes account/profile settings.

Serve the output of `node scripts/tools/build-campaign-game.mjs --out <empty-directory>`
with a local static server, then run:

```sh
node scripts/qa/campaign-smoke.mjs \
  --url http://127.0.0.1:4173/ \
  --scenario s01-sequential \
  --evidence "$EVIDENCE" \
  --run-id run-1
```

Repeat with `--run-id run-2`. Each invocation starts a new ephemeral loopback
proxy origin. Its happy-path bytes must hash identically to the supplied build.
This isolates Web Locks and save storage without clearing user data. The upstream
server belongs to the caller; the runner closes only its own proxy servers and tabs.
The runner never creates a production debug route or injects runtime state.

`s01-sequential` and `save-reload` exercise title, K002 selection, map, the K568
ledger mandate, actual halfway reload, physical return, the K616 observation
mandate, settlement, six received reports, save and exact restore. They also run
second-tab refusal, a separately isolated tampered pack, and 1440x900/390x844
captures. Smaller selectable scenarios are `campaign-entry`, `clock-tabs`,
`pack-tamper`, and `layout`. Unknown scenarios fail with exit 2; task17 must add
its remaining scenario implementations rather than treating a name as coverage.

Every browser step uses a fresh `aside-agent repl` subprocess with a 90-second
deadline. Long progression uses the ordinary 4x control and a preinstalled
`campaign:change` subscription with a 35-second bound, not a polling delay.
Paused explicit saves bridge native one-shot session disposal. CDP/transport
failures are retained verbatim and retried once in a fresh session; assertion
failures never retry. A failed attempt is not accepted as gameplay evidence.
Run native suites serially: simultaneous one-shot sessions on the same Aside
profile can invalidate another session's tab tracking.

Physical assertions parse the ordinary explicit save through the production
boundary and independently inspect original custody, reseal/return ordering,
completed body paths, finite effort/inventory, single work effects, partial
received evidence and restored effect IDs. Public event observation adds only
causal IDs and visible hashes. It does not publish hidden facts into the UI.

The installed native Aside Page API has no viewport-resize method. Responsive
captures therefore use unscaled same-origin iframes with measured document
viewports, explicitly identified in the report. The main campaign flow runs on
the normal production root, not the frame helper. These captures prove responsive
layout, not mobile browser/device emulation or top-level browser resizing.

Output: `<run-id>.json` contains status, action snapshots, causal events, hashes,
checkpoint receipts, exact harness failures, console/network failures and cleanup;
`captures/` holds PNGs. Exit 0 means all requested assertions passed; exit 1
preserves failed evidence; exit 2 means invalid arguments. The caller should retain
failed run IDs; reusing a run ID retains previous results under `priorAttempts`.

```sh
node --test scripts/tools/test/campaign-smoke.test.mjs
```

These fast tests verify assertion sensitivity and origin isolation. They do not
replace the native browser run.
