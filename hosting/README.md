# Static map preview

Build from the repository root with engine submodule checked out at
`6d4907e65e315787ce49b0d20dd48b68e1277395` and its locked dependencies installed:

```sh
node scripts/tools/build-web-game.mjs
node --test scripts/tools/test/build-web-game.test.mjs
python3 -m http.server 8080 --directory web-dist --bind 127.0.0.1
```

Open http://127.0.0.1:8080/. Output is `web-dist/`; use an empty output
directory for each build. Vercel configuration builds this same static folder.
An optional first argument selects a different empty output directory. Tests
accept that directory through WEB_GAME_OUTPUT.

The hosting Vite configuration extends the pinned engine player configuration.
Bundled tileset JSON modules remain complete synchronous ESM dependencies, with
one data chunk per tileset instead of a combined 49 MB shared chunk. No engine
patch or revision change is required. Every served file must be below 25 MiB;
the builder and focused output test enforce that limit for all file types.
The engine commit timestamp replaces the build wall clock in version metadata.
The build receipt includes a SHA-256 of the scoped hosting configuration inputs,
separate from the canonical project hash and pinned engine input inventory.
No upload, login, paid service, or deployment is performed by the build.

Only map navigation is available. Production actors/start state remain absent.
The separate public preview marker is noncanonical and is not the task7 QA
actor or a person. It grants no character, title, vocation, or GP approval.
Lord selection, mandates, real-time combat and remote reports remain blocked.

The build copies an explicit runtime dependency set and a derived Project;
it does not copy the ledger, source database, external proofs, or receipts.
Proof validation is an external publication-preflight responsibility, not a
permission boolean in this build. Runtime and asset notices ship with output.

Current limitations: native runtime menus retain their existing game wording
and HUD; mobile/accessibility and complete visual QA are not certified.
