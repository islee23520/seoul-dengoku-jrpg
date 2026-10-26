# Production hosting: S01 campaign entry

The default production entry is the admitted S01 lord campaign, not the map
preview. Build the publication artifact from the repository root with the
engine submodule checked out at `6d4907e65e315787ce49b0d20dd48b68e1277395`
and its locked dependencies installed
(`cd engine && npm ci --ignore-scripts --no-audit --no-fund`):

```sh
node scripts/tools/build-campaign-game.mjs --out campaign-dist
python3 -m http.server 8080 --directory campaign-dist --bind 127.0.0.1
```

Open http://127.0.0.1:8080/. `/` and `campaign.html` are the campaign entry;
the labelled legacy map preview stays reachable at `legacy/` inside the same
artifact. Deploy commands must publish `campaign-dist` — `vercel.json` builds
exactly that — and publishing `web-dist` alone ships only the old preview,
which is not a game release. Validate the artifact with the dedicated gate:

```sh
CAMPAIGN_MANIFEST=game/data/campaign/source-manifest.json \
ASSET_PROOF_MAP=/absolute/external/proof-map.json \
bash scripts/gate-campaign.sh --artifact campaign-dist --evidence <dir>
```

The builder rejects before packaging on an unknown or modified campaign data
input, an engine or patch pin mismatch, a changed approved pack file, or a
non-empty output directory. The receipt (`campaign-build.json`, also printed
to stdout) binds the build, source, operation, patch and engine identities,
attribution and sizes. Every served file stays under the 25 MiB Pages limit
(the builder guard is stricter at 20 MiB) and no node-only dependency ships
in the campaign chunks. No upload, login, paid service or deployment is
performed by the build.

## Deployment identity, preview URLs and rollback

The currently published, fully verified artifact is one build on two
non-production preview branches:

- buildId `32aab3c679c87d5e715bcb69e7de106ea95876f92db52c76f55ffacc2b34e21b`
- source commit `eb9773dde3f72dcc659b8fc38692c67cc5c5fb95` (main), engine pin
  `6d4907e65e315787ce49b0d20dd48b68e1277395`, patch SHA-256
  `4c7343235d6adc046f03ff3b1f69a16ab201b805b5d62292828a1d0db4f99f3c`
- content pack identical to the task-18/19 admissions: source manifest
  `5d97dfaa…`, operations `08465058…`
- alias https://campaign.seoul-dengoku-jrpg.pages.dev (branch `campaign`)
- alias https://campaign-map.seoul-dengoku-jrpg.pages.dev (branch `campaign-map`)

`scripts/qa/campaign-remote-verify.mjs` proved 548/548 served files SHA-256
identical on both aliases; real remote play receipts live in
`.omo/evidence/seoul-dengoku-campaign-map/task-19/follow-up-redeploy/` and
`task-19/followup-eb9773d/`, and the independent UI/scenario verification of
this exact build in `task-23-unity-ui/final-eb9773d/`.

Rollback: production `seoul-dengoku-jrpg.pages.dev` still serves the
pre-campaign map preview (deployment `cadc43fb`, captured body SHA-256
`cfe036ce…` in `task-19/deploy/production-before.json`). It was never
replaced, so the campaign rollback position is simply "production was not
touched"; promotion happens only after the final gates and the owner's
explicit release okay. A bad preview deploy is rolled back by rebuilding the
previously recorded artifact identity from its recorded commit and
redeploying the same branch (`docs/campaign-pages-deploy.md`) — never by
force-push or deployment deletion.

## Source extraction (read-only wiki)

The admitted source manifest and imported pack are reproducible from the
read-only wiki checkout; never write to the wiki. With Node 24.15+:

```sh
node --test scripts/tools/test/campaign-source-selectors.test.mjs
node scripts/tools/campaign-source-selectors.mjs --wiki-root "$WIKI_ROOT" --check
(cd "$WIKI_ROOT" && npm run cast:verify -- --db data/canonical/wiki-cast.sqlite)
(cd "$WIKI_ROOT" && npm run cast:build -- --output "$RUN_TMP/wiki-export/wiki-cast.sqlite")
node scripts/tools/campaign-source-manifest.mjs --wiki-root "$WIKI_ROOT" \
  --export-db "$RUN_TMP/wiki-export/wiki-cast.sqlite" --out "$RUN_TMP/source-manifest.json"
node scripts/tools/campaign-content-import.mjs --manifest "$RUN_TMP/source-manifest.json" \
  --out "$RUN_TMP/campaign-import"
```

`game/data/campaign/source-manifest.json` and the imported pack are committed;
regenerating them must stay byte-identical. The campaign gate re-runs the
manifest/import parity tests against a fresh `cast:build` export when
`WIKI_ROOT` is exported, and records `notrun` otherwise — a skipped parity is
never reported as a pass. Missing, dirty, ambiguous or unknown source inputs
fail with typed `E_*` errors and empty stdout before any output is written.
Regeneration parity is defined against the wiki state pinned inside the
manifest. If the live wiki moves past those pins, the parity step fails
closed with `E_IMPORT_SOURCE` — the 2026-10-27 fresh-clone rehearsal
recorded exactly this against wiki head `eafafbd8` (receipt:
`task-20/fresh-clone/drift/source-drift.json`). A drifted wiki requires a
new, independently confirmed manifest admission; it is never silently
refreshed by the gate.

## Save migration boundary

`seoul-composed-campaign-v2` explicit checkpoints are the only current save
format: validate, staged readback, then one atomic pointer switch. Saves are
manual; there is no autosave, offline-time accrual or recovery journal. Legacy
v1 saves resolve through the authenticated exact/alias identity map only;
excluded, ambiguous, active-route or battle inputs quarantine the whole
checkpoint with the original exportable and the active pointer unchanged —
never a silent reset into a new campaign. Full contract:
`docs/campaign-saves.md`.

## QA resource ownership and cleanup

Every QA run owns and cleans what it starts. The campaign gate and the smoke
runner own their ephemeral HTTP server, port and `mktemp` scratch and remove
them on exit (their logs are the receipts). Task-owned run roots such as
`/tmp/campaign-*` are removed only after their evidence is copied into the
canonical `.omo/evidence/seoul-dengoku-campaign-map/` store in the main
worktree. Never copy `.omo` ledgers or evidence between worktrees — the main
worktree's store is the only canonical copy. Worktrees retained for open PRs
or rejected patches are listed explicitly in the task-20 cleanup receipt.

## Legacy map preview (secondary route)

The legacy preview under `legacy/` is produced by the same build through
`scripts/tools/build-web-game.mjs`, which can also run standalone:

```sh
node scripts/tools/build-web-game.mjs
node --test scripts/tools/test/build-web-game.test.mjs
python3 -m http.server 8080 --directory web-dist --bind 127.0.0.1
```

The hosting Vite configuration extends the pinned engine player
configuration. Bundled tileset JSON modules remain complete synchronous ESM
dependencies, with one data chunk per tileset instead of a combined 49 MB
shared chunk. No engine patch or revision change is required. The engine
commit timestamp replaces the build wall clock in version metadata. Runtime
and asset notices ship with the output.

Only map navigation is available there. Production actors/start state remain
absent. The separate public preview marker is noncanonical and is not the
task7 QA actor or a person. It grants no character, title, vocation, or GP
approval. Lord selection, mandates, real-time combat and remote reports
remain blocked.

The build copies an explicit runtime dependency set and a derived Project;
it does not copy the ledger, source database, external proofs, or receipts.
Proof validation is an external publication-preflight responsibility, not a
permission boolean in this build.

Current limitations: this artifact is the scoped S01 investigation chapter
only. It carries the approved S01 operational values (1 real second = 6 world
seconds, pause/1x/2x/4x, Eclose 3600 / support limit 5400 world seconds with
no automatic clock stop and no fabricated rescue), manual-save recovery, and
makes no full-game balance, combat, economy or recruitment claim. Campaign
surfaces were verified at 1280×720/1440×900 desktop and 390×844 mobile with
both themes (task-23 independent verification); engine-wide suite failures
outside the campaign gate remain separately disclosed by `scripts/gate.sh`.
