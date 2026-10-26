# Campaign Pages preview deployment

Preview deploys publish the validated campaign artifact to **non-production**
Cloudflare Pages branches of the existing `seoul-dengoku-jrpg` project.
Production (`seoul-dengoku-jrpg.pages.dev`, deployment `cadc43fb`, branch
`main`, the pre-campaign map preview) stays untouched until the final gates
plus the owner's explicit release okay; never deploy `--branch main` for
preview work.

## Build and verify locally first

```sh
node scripts/tools/build-campaign-game.mjs --out "$RUN_TMP/campaign-dist"
CAMPAIGN_MANIFEST=game/data/campaign/source-manifest.json \
ASSET_PROOF_MAP=/absolute/external/proof-map.json \
bash scripts/gate-campaign.sh --artifact "$RUN_TMP/campaign-dist" --evidence "$EVIDENCE/task-N"
```

Record the receipt (`campaign-build.json`, also printed to stdout): buildId,
engine revision, patch SHA-256, source/operation hashes. If main moved since
the last admitted build, rebuild honestly and record the new identity instead
of deploying a stale artifact.

## Deploy (preview branches only)

The owner-designated preview alias is branch `campaign`
(campaign.seoul-dengoku-jrpg.pages.dev); the plan row's `campaign-map` branch
records the same artifact under its own alias. Auth uses the existing stored
wrangler OAuth (task-36 precedent); no credentials are printed and no login
flow is required.

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_EMAIL \
  CLOUDFLARE_ACCOUNT_ID=<account-id> \
  npx wrangler pages deploy "$RUN_TMP/campaign-dist" \
  --project-name seoul-dengoku-jrpg --branch campaign \
  --commit-hash <exact-source-commit>
```

Record the deployment id/URL from the command output and
`wrangler pages deployment list --project-name seoul-dengoku-jrpg`.

## Remote verification

`scripts/qa/campaign-remote-verify.mjs` fetches **every** artifact file from
the deployment, compares SHA-256 against the local build, samples
MIME/cache headers, asserts the default route is the campaign entry (not a QA
or preview page), and probes absent/private paths against the real fallback
body:

```sh
node scripts/qa/campaign-remote-verify.mjs \
  --base https://campaign.seoul-dengoku-jrpg.pages.dev/ \
  --artifact "$RUN_TMP/campaign-dist" --out "$EVIDENCE/task-19/remote-alias"
```

Cloudflare Pages serves an SPA fallback (HTTP 200 with the index body) for
unknown paths; the probe report labels that explicitly as a fallback and never
counts it as a missing-file 404. `/index.html` style paths 308-redirect to
clean URLs; redirects are recorded.

Then run the real browser flow against the deployment with the standard
runner (`s01-sequential`, `save-reload`, optionally `campaign-entry`), and
capture production before/after hashes to prove the production deployment was
not disturbed:

```sh
node scripts/qa/campaign-smoke.mjs --url https://campaign.seoul-dengoku-jrpg.pages.dev/ \
  --scenario s01-sequential --evidence "$EVIDENCE/task-19/remote"
node scripts/qa/campaign-smoke.mjs --url https://campaign.seoul-dengoku-jrpg.pages.dev/ \
  --scenario save-reload --evidence "$EVIDENCE/task-19/remote"
```

If main gains new merged commits (for example UI fixes) after a deployment,
rebuild from the new main, verify the receipt identity, redeploy the preview
branch and re-run the byte verification so the deployed preview and the
recorded source commit always agree.
