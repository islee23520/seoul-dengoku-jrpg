# Production hosting: S01 campaign entry

The default production entry is the admitted S01 lord campaign, not the map
preview. Build the publication artifact from the repository root with the
engine submodule checked out at `6d4907e65e315787ce49b0d20dd48b68e1277395`
and its locked dependencies installed:

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

Current limitations: native runtime menus retain their existing game wording
and HUD; mobile/accessibility and complete visual QA are not certified.
