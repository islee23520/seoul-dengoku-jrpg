#!/usr/bin/env bash
# Dedicated campaign gate: everything the promised S01 campaign actually needs, nothing else.
# scripts/gate.sh keeps the truthful whole-repository semantics (engine suite included); this
# gate never widens it and never renames a failing step green.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
  cat <<EOF
Usage: CAMPAIGN_MANIFEST=<admitted-source-manifest> ASSET_PROOF_MAP=<external-proof-map> \\
       bash $(basename "$0") --artifact <built-campaign-dist> --evidence <output-directory> [options]

캠페인 전용 게이트 (source/operation/schema/migration/domain + typechecks + 실제 브라우저 QA)

Options:
  --artifact <dir>   Built campaign artifact (node scripts/tools/build-campaign-game.mjs --out ...)
  --evidence <dir>   Evidence output; QA reports land under QA/, the full log under gate-campaign.log
  WIKI_ROOT (optional)  Readonly wiki checkout; enables the live source parity step (fresh export +
                      manifest + import tests). Without it that step is recorded as notrun, never skipped silently.
  --help             Show this help and exit 0

Inputs (environment, fail closed with instructions, never a private default):
  CAMPAIGN_MANIFEST  Admitted source manifest; its SHA-256 must equal the artifact's pack hash
  ASSET_PROOF_MAP    External acquisition map outside this checkout (asset ledger + charset/sampling)

Exit: 0 all steps passed, 1 at least one step failed, 2 invalid invocation or missing input.
No step is skipped or softened; a failing step is reported and fails the gate.
EOF
}

ARTIFACT="" EVIDENCE="" QA_SCENARIOS="${QA_SCENARIOS:-campaign-entry s01-sequential save-reload}" PROFILE="${QA_PROFILE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) [[ $# -ge 2 ]] || { echo "--artifact requires a value" >&2; exit 2; }; ARTIFACT="$2"; shift 2 ;;
    --evidence) [[ $# -ge 2 ]] || { echo "--evidence requires a value" >&2; exit 2; }; EVIDENCE="$2"; shift 2 ;;
    --qa-scenarios) [[ $# -ge 2 ]] || { echo "--qa-scenarios requires a value" >&2; exit 2; }; QA_SCENARIOS="$2"; shift 2 ;;
    --profile) [[ $# -ge 2 ]] || { echo "--profile requires a value" >&2; exit 2; }; PROFILE="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

fail_usage() { echo "error: $1" >&2; usage >&2; exit 2; }
[[ -n "$ARTIFACT" && -n "$EVIDENCE" ]] || fail_usage "--artifact and --evidence are required"
[[ -d "$ARTIFACT" ]] || fail_usage "artifact directory not found: $ARTIFACT"
[[ -f "$ARTIFACT/index.html" ]] || fail_usage "artifact has no index.html; build it with scripts/tools/build-campaign-game.mjs"
[[ -n "${CAMPAIGN_MANIFEST:-}" ]] || fail_usage "CAMPAIGN_MANIFEST must name the admitted source manifest"
[[ -f "$CAMPAIGN_MANIFEST" ]] || fail_usage "CAMPAIGN_MANIFEST not found: $CAMPAIGN_MANIFEST"
[[ -n "${ASSET_PROOF_MAP:-}" ]] || fail_usage "ASSET_PROOF_MAP must name the external acquisition proof map"
[[ -f "$ASSET_PROOF_MAP" ]] || fail_usage "ASSET_PROOF_MAP not found: $ASSET_PROOF_MAP"
PROOF_ABS="$(cd "$(dirname "$ASSET_PROOF_MAP")" && pwd)/$(basename "$ASSET_PROOF_MAP")"
case "$PROOF_ABS" in
  "$ROOT_DIR"/*) fail_usage "ASSET_PROOF_MAP must live outside this checkout (private receipts are never committed)" ;;
esac

mkdir -p "$EVIDENCE/QA"
RUN_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/gate-campaign.XXXXXX")"
QA_SERVER_PID=""
cleanup() {
  if [[ -n "$QA_SERVER_PID" ]]; then kill "$QA_SERVER_PID" 2>/dev/null; wait "$QA_SERVER_PID" 2>/dev/null; fi
  rm -rf "$RUN_SCRATCH"
}
trap cleanup EXIT
export RUN_TMP="$RUN_SCRATCH"
export TMPDIR="$RUN_SCRATCH/tmp"; mkdir -p "$TMPDIR"
export NODE_COMPILE_CACHE="$RUN_SCRATCH/node-compile-cache" BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_SCRATCH/bun-transpiler"

LOG="$EVIDENCE/gate-campaign.log"
: > "$LOG"
echo "=== campaign gate starting $(date -u +%FT%TZ) ===" | tee -a "$LOG"
echo "artifact: $ARTIFACT" | tee -a "$LOG"
echo "campaign manifest: $CAMPAIGN_MANIFEST" | tee -a "$LOG"
echo "asset proof map: external to checkout" | tee -a "$LOG"

FAILURES=0
STEP=0
run_step() {
  local name="$1" cmd="$2"
  STEP=$((STEP+1))
  echo "[$STEP] $name" | tee -a "$LOG"
  local ec=0
  bash -c "$cmd" >> "$LOG" 2>&1 || ec=$?
  echo "  exit code: $ec" | tee -a "$LOG"
  [[ $ec -ne 0 ]] && { echo "  FAILED (step $STEP)" | tee -a "$LOG"; FAILURES=$((FAILURES+1)); }
  STEP_RESULTS+=("$(printf '%s\t%s\t%s' "$STEP" "$name" "$ec")")
}

STEP_RESULTS=()

# --- source admission: validated selector contract over the real typed readers (task 24) ---
run_step "source: selector contract tests" \
  "cd '$ROOT_DIR' && node --test scripts/tools/test/campaign-source-selectors.test.mjs"

# --- optional external parity: the live-wiki manifest and import tests read the real source
#     (tasks 25/2); selected by setting WIKI_ROOT, recorded as notrun otherwise. ---
if [[ -n "${WIKI_ROOT:-}" ]]; then
  run_step "source parity: fresh readonly export + manifest + import tests" \
    "mkdir -p '$RUN_SCRATCH/wiki-export' && cd '$WIKI_ROOT' && npm run cast:build -- --output '$RUN_SCRATCH/wiki-export/wiki-cast.sqlite' && cd '$ROOT_DIR' && WIKI_ROOT='$WIKI_ROOT' CAMPAIGN_EXPORT_DB='$RUN_SCRATCH/wiki-export/wiki-cast.sqlite' node --test scripts/tools/test/campaign-source-manifest.test.mjs scripts/tools/test/campaign-content-import.test.mjs"
else
  STEP=$((STEP+1))
  echo "[$STEP] source parity: live wiki manifest + import tests" | tee -a "$LOG"
  echo "  notrun: set WIKI_ROOT to the readonly wiki checkout to enable" | tee -a "$LOG"
  STEP_RESULTS+=("$(printf '%s\t%s\t%s' "$STEP" "source parity (external wiki)" "notrun")")
fi

# --- operation admission: approved S01 pack CLI + hash binding (task 3) ---
run_step "operation: S01 operation pack tests" \
  "cd '$ROOT_DIR' && node --test scripts/tools/test/campaign-operation-pack.test.mjs"

# --- schema/migration/domain + campaign runtime, UI and negative harness suites (tasks 4-17) ---
run_step "domain + schema + migration + campaign suites against the artifact" \
  "cd '$ROOT_DIR' && CAMPAIGN_GAME_OUTPUT='$ARTIFACT' node --test \$(find game/src game/ui -name '*.test.ts' -print) scripts/tools/test/campaign-entry.test.mjs scripts/tools/test/campaign-smoke.test.mjs scripts/tools/test/campaign-browser-hash.test.mjs scripts/tools/test/build-campaign-game.test.mjs scripts/qa/campaign-negative.test.mjs"

# --- typechecks (game + campaign hosting project) ---
run_step "typecheck: game/tsconfig.json" \
  "cd '$ROOT_DIR' && node engine/node_modules/typescript/bin/tsc --noEmit -p game/tsconfig.json"
run_step "typecheck: hosting/tsconfig.campaign.json" \
  "cd '$ROOT_DIR' && node engine/node_modules/typescript/bin/tsc --noEmit -p hosting/tsconfig.campaign.json"


# --- artifact admission: allowlist inventory, pack hashes, CAMPAIGN_MANIFEST equality, limits, privacy ---
run_step "artifact: verifyCampaignArtifact against CAMPAIGN_MANIFEST" \
  "cd '$ROOT_DIR' && node --input-type=module -e \"import { verifyCampaignArtifact } from './scripts/tools/build-campaign-game.mjs'; const r = await verifyCampaignArtifact('$ARTIFACT', { campaignManifest: '$CAMPAIGN_MANIFEST' }); console.log(JSON.stringify({ fileCount: r.fileCount, totalBytes: r.totalBytes, largest: r.largest, buildId: r.receipt.buildId, sourceSha256: r.receipt.sourceSha256, operationsSha256: r.receipt.operationsSha256, patchSha256: r.receipt.patchSha256, engineRevision: r.receipt.engineRevision }));\""

# --- asset admission with the external proof map (ledger + charset/sampling positive paths) ---
run_step "assets: ledger validated against the external proof map" \
  "cd '$ROOT_DIR' && node scripts/tools/asset-ledger-validate.mjs --ledger game/assets/ledger/ledger.json --proof-map '$PROOF_ABS'"
run_step "assets: natural-charset + sampling cycle tests use the external proof map" \
  "cd '$ROOT_DIR' && ASSET_PROOF_MAP='$PROOF_ABS' node --test scripts/tools/test/natural-charset.test.mjs scripts/tools/test/sampling-cycle.test.mjs"

# --- regressions that must not regress: legacy map preview build + patched realtime no-port surface ---
run_step "regression: legacy map preview build + tests" \
  "cd '$ROOT_DIR' && node scripts/tools/build-web-game.mjs '$RUN_SCRATCH/web-pages-dist' && WEB_GAME_OUTPUT='$RUN_SCRATCH/web-pages-dist' node --test scripts/tools/test/build-web-game.test.mjs"
run_step "regression: patched realtime build + entry typecheck (no-port surface)" \
  "cd '$ROOT_DIR' && node --test scripts/tools/test/build-realtime-game.test.mjs"

# --- actual QA: serve the exact artifact and drive it in the real browser ---
QA_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
python3 -m http.server "$QA_PORT" --bind 127.0.0.1 --directory "$ARTIFACT" > "$RUN_SCRATCH/qa-server.log" 2>&1 &
QA_SERVER_PID=$!
READY=1
for _ in $(seq 1 100); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$QA_PORT/index.html"; then READY=0; break; fi
  sleep 0.2
done
if [[ $READY -ne 0 ]]; then
  echo "[QA] owned artifact server failed to become ready" | tee -a "$LOG"
  FAILURES=$((FAILURES+1))
  STEP=$((STEP+1)); STEP_RESULTS+=("$(printf '%s\t%s\t%s' "$STEP" "qa: owned artifact server" "1")")
else
  for SCENARIO in $QA_SCENARIOS; do
    EXTRA=()
    [[ -n "$PROFILE" ]] && EXTRA+=(--profile "$PROFILE")
    run_step "qa: campaign-smoke --scenario $SCENARIO (served artifact)" \
      "cd '$ROOT_DIR' && node scripts/qa/campaign-smoke.mjs --url http://127.0.0.1:$QA_PORT/ --scenario '$SCENARIO' --evidence '$EVIDENCE/QA' --run-id '$SCENARIO' ${EXTRA:+${EXTRA[*]}}"
  done
fi

{
  echo ""
  echo "=== gate summary ==="
  printf 'step\tname\texit\n'
  printf '%s\n' "${STEP_RESULTS[@]}"
  echo "scratch: removed; QA evidence: $EVIDENCE/QA"
} | tee -a "$LOG"

if [[ $FAILURES -gt 0 ]]; then
  echo "SUMMARY: FAIL ($FAILURES failed steps) — full log: $LOG" | tee -a "$LOG"
  exit 1
fi
echo "SUMMARY: PASS ($STEP steps) — full log: $LOG" | tee -a "$LOG"
exit 0
