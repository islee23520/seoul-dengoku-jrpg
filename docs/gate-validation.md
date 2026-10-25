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
