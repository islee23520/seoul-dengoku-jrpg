#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENGINE_DIR="$ROOT_DIR/engine"
LEDGER_TOOL="$ROOT_DIR/scripts/tools/asset-ledger-validate.mjs"
PARAMS_TOOL="$ROOT_DIR/scripts/tools/gp-params-validate.mjs"
CANON_TOOL="$ROOT_DIR/scripts/tools/canon-manifest-check.mjs"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--help | --dry-run]

게임 리포 게이트 스크립트 (strict validation)

Options:
  --help     Show this help and exit (0)
  --dry-run  List all gate steps without executing (0)
  (no flag)  Run all validation steps. Pending items cause nonzero exit.

Steps (in order):
  0. engine present check (test -e engine/.git)
  1. npm ci in engine/
  2. npm run typecheck:app
  3. npm run build:player
  4. engine vitest (non-interactive)
  5. engine playwright (non-interactive)
  6. asset ledger validate (requires ASSET_PROOF_MAP)
  7. gp-params validate
  8. canon manifest check
  9. independent map check (requires SEOUL_WORLD_GRAPH_SOURCE)
  10. game smoke (PENDING: no dedicated game smoke CLI exists)

Inputs: ASSET_PROOF_MAP must name an external acquisition map (equivalent to
--proof-map in the ledger/map CLIs). Missing proofs fail closed.
SEOUL_WORLD_GRAPH_SOURCE must name the licensed graph JSON (equivalent to
--source in the map CLI); there is no private absolute default.
See docs/gate-validation.md for local/CI invocation and external fixtures.

Real run with missing steps prints PENDING and exits nonzero at end.
EOF
}

DRY_RUN=0
if [[ $# -gt 1 ]]; then
  echo "Error: expected at most one flag" >&2
  usage >&2
  exit 1
fi
if [[ $# -eq 1 ]]; then
  case "$1" in
    --help) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "Error: unknown flag '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
fi

echo "=== Gate script starting (dry-run=$DRY_RUN) ==="

PENDINGS=()
FAILURES=0
STEP=0

run_step() {
  local name="$1"
  local cmd="${2:-}"
  local pending_msg="${3:-}"

  echo "[$STEP] $name"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  (dry-run: would run)"
    STEP=$((STEP+1))
    return 0
  fi

  if [[ -n "$pending_msg" ]]; then
    echo "  $pending_msg"
    PENDINGS+=("$pending_msg")
    echo "  exit code: not run (PENDING)"
    STEP=$((STEP+1))
    return 0
  fi

  set +e
  (eval "$cmd")
  local ec=$?
  set -e
  echo "  exit code: $ec"
  if [[ $ec -ne 0 ]]; then
    echo "  FAILED (step $STEP)"
    FAILURES=$((FAILURES+1))
  fi
  STEP=$((STEP+1))
  return 0
}

# Step 0: engine present check (accepts submodule .git file)
run_step "0. engine present check" 'test -e "$ENGINE_DIR/.git" && echo "  engine/.git found" || { echo "  engine/.git NOT found"; exit 1; }'

# Step 1-5: engine steps (will fail naturally if engine missing)
run_step "1. npm ci in engine/" 'cd "$ENGINE_DIR" && npm ci'
run_step "2. npm run typecheck:app" 'cd "$ENGINE_DIR" && npm run typecheck:app'
run_step "3. npm run build:player" 'cd "$ENGINE_DIR" && npm run build:player'
run_step "4. vitest default suite" 'cd "$ENGINE_DIR" && npm run test -- --run'
run_step "5. playwright default" 'cd "$ENGINE_DIR" && npx playwright test --project=chromium'

# Tool paths and data paths are rooted in this checkout, not the caller's cwd.
run_step "6. asset-ledger-validate" 'cd "$ROOT_DIR" && node "$LEDGER_TOOL" --ledger game/assets/ledger/ledger.json'
run_step "7. gp-params-validate" 'cd "$ROOT_DIR" && node "$PARAMS_TOOL"'
run_step "8. canon-manifest-check" 'cd "$ROOT_DIR" && node "$CANON_TOOL"'
run_step "9. independent map check" 'cd "$ROOT_DIR" && node scripts/tools/seoul-map-check.mjs --generated game'
run_step "10. game smoke" "" "PENDING: no dedicated game smoke CLI exists; map checks and unit tests do not prove interactive play (todo 23)"

echo ""
if [[ $DRY_RUN -eq 1 ]]; then
  echo "SUMMARY: DRY-RUN (no steps executed)"
  exit 0
elif [[ $FAILURES -gt 0 ]]; then
  echo "SUMMARY: FAIL ($FAILURES failed, ${#PENDINGS[@]} pending steps) - see above"
  exit 1
elif [[ ${#PENDINGS[@]} -gt 0 ]]; then
  echo "SUMMARY: PENDING (${#PENDINGS[@]} steps) - see above"
  exit 1
else
  echo "SUMMARY: PASS"
  exit 0
fi
