# Engine Baseline

Engine HEAD and committed gitlink are both
`6d4907e65e315787ce49b0d20dd48b68e1277395`. The engine is detached at that
requested upstream commit. This report distinguishes recovered historical
receipts from fresh verification; it does not claim a full build or a passing
test suite from interrupted output.

## Recovered command receipts

These commands ran on Darwin arm64 with Node 26.4.0 and npm 12.0.2. Times below
are UTC command-start receipts from the original npm log filenames, not a
reconstructed 07:32 execution timeline.

| Command | Start (2026-10-24 UTC) | Retained terminal result |
| --- | --- | --- |
| `npm ci --no-audit --prefer-offline` | 07:08:12.314 | npm exit 0 |
| `npm run typecheck:app` | 07:08:15.750; 07:13:30.787 | npm exit 0 for both |
| `npm run build:player` | 07:08:23.763; 07:14:47.367 | npm exit 0 for both |
| `npm run check:runtime-assets` (build child) | 07:08:23.834; 07:14:47.844 | npm exit 0 for both |
| `npm test -- --run` | 07:08:39.060; 07:16:44.171 | incomplete; no trustworthy Vitest terminal exit |

The historical test logs stop at invocation. Earlier runs were reported as
interrupted, but retained logs contain neither a final suite summary nor a
termination receipt. Their exit codes are unknown; they are not evidence of
named upstream assertion failures. No known upstream assertion inventory was
available before this attempt.

The inherited planning observation of 33 audit findings (1 moderate, 32 high)
was not measured by this `npm ci --no-audit` invocation. No new audit was run.
The successful player build is not a successful full `npm run build` receipt.
The old 2,664,201-byte `dist/export-player/player.js` artifact has a later
mtime and cannot independently establish the claimed earlier build timeline
or source identity. Individual historical commands did not capture source
SHAs or full stdout; these gaps remain explicit.

## Default Vitest baseline, attempt 2

The default package command is
`node scripts/run-vitest.mjs run --configLoader bundle`. README requires Node
24 LTS. Attempt 2 uses an already installed Node 24.19.0 binary with its
directory first in PATH. No runtime was installed or changed
globally. No tests, suite exclusions, runner configuration or engine source
were changed. The default wrapper retains its normal heap behavior.

The fresh command started at 2026-10-24T07:48:15.059Z against the exact engine
SHA above. It did not produce a terminal Vitest summary within the 900-second
harness bound. At 08:03:15.170Z the harness sent SIGTERM to its owned process
group 32967; the wrapper closed at 08:03:17.312Z with code `null`, signal
`SIGTERM`. The evidence harness's own terminal code is 124, not a Vitest
assertion exit. Status: **needs-fix/harness, PARTIAL**. Task 1's completed-test
acceptance criterion remains unsatisfied; no passing baseline is claimed.

Retained output includes named failures and a happy-dom teardown AbortError,
but no final failure details or suite totals. Those observations are not a
complete inventory of pre-existing assertions and cannot satisfy the plan's
completed-failure exception. Node 24 also exhibits the AbortError, so Node 26
alone is not established as its cause. The concrete limitation is failure
to finish the unchanged default suite within the captured 900-second bound;
the precise underlying cause remains unproven. No timeout is classified as
an assertion failure, and no test was weakened, edited or skipped by this task.

## Evidence and worktree preservation

The private task 1 attempt 2 evidence is retained outside the public delivery.
The filenames below identify audit records, not public download links.

- `npm-logs/` contains all nine genuine original debug logs.
- `historical-receipts.json` records their SHA-256 hashes, byte lengths,
  actual arguments, start receipts and available terminal markers.
- `fresh-state.md` records runtime discovery, source/config hashes and
  preservation of the sibling gate work.
- `run-baseline.mjs`, `vitest.stdout.log`, `vitest.stderr.log`,
  `vitest.combined.log` and `vitest-receipt.json` capture the fresh command,
  its output, environment, source SHA and real terminal status.

The earlier `commands.log` contains Git setup only; it never held the promised
assertion inventory. The earlier advertised `exit-codes.txt` was absent.
Neither is used as evidence of a completed test suite.

All nine recovered logs were byte/hash-verified before removing only the
owned, untracked `engine/.verification/` cache at 07:50:11Z. No engine ignore
policy, user cache, gate script, lockfile, tracked engine file or gitlink was
modified. The sibling gate correction was already committed as `a72123e` at
the start of this attempt; its SHA-256 is retained for comparison.

Post-run probes at 08:03:35Z and a subsequent source-state check found no vitest/run-baseline
processes, no process in owned group 32967 and no port-9999 listener. The
harness's post-close group SIGKILL attempt returned EPERM; the independent
process probes, not that unsuccessful kill, establish current cleanup.
Tracked engine state is clean and source/config/gate hashes still match.
Concurrent untracked sibling UI/font/parameter-validation files are preserved
and excluded from this documentation-only commit. See `cleanup-verification.md`
and `output-hashes.json` in the evidence directory for the final receipts.

## Later harness recovery

The subsequent unchanged default-inventory run also reached its 900-second
bound: SIGTERM, harness exit 124, worker V8 heap exhaustion and no final Vitest
summary. This is a partial harness result, not a passing suite. The separate
targeted run completed with exit 1: 14 failed and 101 passed of 115 tests. Those
totals do not replace the unfinished default inventory. The retained private
task 1 harness-recovery report records independent cleanup and unchanged engine
source. Task 1 remains stopped; historical install, typecheck and player-build
successes do not establish a green full build or playable production game.
