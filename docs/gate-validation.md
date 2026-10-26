# Gate validation

Run from this checkout. Help and dry run execute no validation and exit 0:

```sh
bash scripts/gate.sh --help
bash scripts/gate.sh --dry-run
```

For validation, set `ASSET_PROOF_MAP` to an absolute acquisition map outside
this checkout and `SEOUL_WORLD_GRAPH_SOURCE` to the licensed original
`SeoulWorldGraph.json`. The equivalent CLI arguments are `--proof-map` and
`--source`; neither graph CLI assumes a personal source checkout. Missing
inputs fail closed with instructions, not a successful admission or a skip.

The local natural-charset and sampling positive-path tests default to
`$HOME/workspace/seoul-dengoku-jrpg/.omo/evidence/seoul-dengoku-jrpg/external-proof-fixtures/proof-map.json`.
`ASSET_PROOF_MAP` overrides that location in CI or another checkout. Provision
the map and actual reviewed receipts outside the tested repository, following
`game/assets/ledger/README.md`; do not generate substitute acquisition claims.
The local fixture map references the preserved task-7, task-20, task-21 and
task-34 receipts and source bytes without copying or changing them. No proof
map, receipt or private original belongs in Git or published output.

```sh
export ASSET_PROOF_MAP="$HOME/workspace/seoul-dengoku-jrpg/.omo/evidence/seoul-dengoku-jrpg/external-proof-fixtures/proof-map.json"
export SEOUL_WORLD_GRAPH_SOURCE="/path/to/licensed/SeoulWorldGraph.json"
bash scripts/gate.sh --dry-run
node --test --test-reporter=tap game/src/domain/*.test.ts game/src/events/*.test.ts game/src/battle/*.test.ts game/src/runtime/*.test.ts game/src/save/*.test.ts scripts/tools/test/*.test.mjs
bash scripts/gate.sh
```

The web-output guard reads canonical `web-pages-dist/`, or `WEB_GAME_OUTPUT`
when supplied. Build that output with
`node scripts/tools/build-web-game.mjs web-pages-dist` into an empty directory.
The recursive 25 MiB served-file guard remains mandatory; stale rejected
`web-dist/` is not the canonical publication artifact.

The real gate executes asset, GP approval, canon and independent map validators.
GP/canon tools retain their documented source contracts and fail on absent or
unapproved inputs. Step 10 remains PENDING because no dedicated game smoke CLI
exists; map validation and unit tests do not establish interactive play. A real
gate run therefore remains nonzero until that tool exists. Dry run is only a
plan listing, never a green admission claim.

## Campaign gate

The dedicated campaign gate validates the promised campaign end to end and
keeps its inputs external. Build the artifact first, then run:

```sh
export ASSET_PROOF_MAP="$HOME/workspace/seoul-dengoku-jrpg/.omo/evidence/seoul-dengoku-jrpg/external-proof-fixtures/proof-map.json"
node scripts/tools/build-campaign-game.mjs --out "$RUN_TMP/campaign-dist"
CAMPAIGN_MANIFEST=game/data/campaign/source-manifest.json ASSET_PROOF_MAP="$ASSET_PROOF_MAP" \
  bash scripts/gate-campaign.sh --artifact "$RUN_TMP/campaign-dist" --evidence "$EVIDENCE/task-18"
```

It runs the source tests (manifest, selector contract, content import), the
approved operation-pack tests, the schema/migration/domain and negative
harness suites plus the campaign entry/browser-hash tests against the actual
artifact, both campaign typechecks, artifact admission (file allowlist, pack
hashes, CAMPAIGN_MANIFEST equality, the 25 MiB per-file limit, private-path
privacy and node-only import absence), the asset ledger and
natural-charset/sampling validation through the external proof map, the
legacy map-preview build regression, the patched realtime no-port build
regression, and real browser QA (campaign-entry, s01-sequential, save-reload
by default; override with `--qa-scenarios`) against the exact served
artifact. Exit 0 means every listed step passed; a failing step stays a
failure. This gate covers the promised campaign only — `scripts/gate.sh`
keeps the whole-repository truth and its pending engine-wide steps.
