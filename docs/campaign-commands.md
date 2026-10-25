# Campaign command boundary

`CampaignApplication` owns a `CampaignSession`, not another clock. Submit an
`issue` command with one stable `commandId`, `issuerPersonId`, `recipientId`,
`operation`, `expectedRevision`, and `expectedCompositeVersion`. Obtain the
composite from `composeCampaignAuthority`. Never send grant objects or stage
strings. `request-cancellation` identifies the issuer and existing order.

Review is outside ingress. Cancel/back before confirmation discards the draft.
Confirm submits that same immutable command. A duplicate returns its original
receipt even after checkpoint restoration; reusing its ID with different data
fails without effects. Refresh a stale review as a new intent, not by changing a
previously submitted command.

The command journal lives inside the typed campaign checkpoint. Contact paths
use the admitted edges, nonzero delivery and response durations, per-body effort,
fatigue thresholds and finite support. Administrative delivery/receipt and
acceptance/reservation/execution labels can share a world timestamp; their causal
receipts remain distinct. A cancellation request does not mutate physical
location or erase effort. A face-to-face notice takes its own thirty seconds.

`settleCampaignBoundary` orders game-owned handlers through phases 0–5. It does
not accept handlers from UI payloads. Arrival precedes reservation, effect and
consumption at the same timestamp; unknown predecessors, cycles and duplicate
IDs reject the boundary. `acknowledgeCommandEffect` consumes actual validated
work/report/custody result IDs exactly once. It does not create those effects.
The ledger report starts a separate timed return response. A report does not
complete physical return; reseal requires a surviving physical custody chain.

Task 9 supplies the investigation/custody handlers after contact enters
`awaiting-effects`. Task 10 supplies report delivery. Task 13 supplies the full
game command composer and receives `view(personId)`, not `checkpoint()`. The
checkpoint API is for persistence/integration, not a player projection. These
downstream tasks are not implemented or claimed by the command boundary.

For local operator use, run `node scripts/tools/campaign-commands.ts --interactive`.
Type `issue S01-L`, then `back` or `confirm`. Use `speed 4` to run the approved
clock, `status` to read the issuer view and `quit` to close without saving.
No console command advances work, changes custody or injects successful results.
The full UI `s01-sequential` proof remains with the downstream composer/effects
integration; this CLI proves actual ingress and timed communication only.
