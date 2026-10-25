# Campaign clock contract

`CampaignTab` acquires an exclusive Web Lock before constructing `CampaignSession`.
The lock name includes the campaign identity supplied by the composition root.
Other tabs remain read-only. They never queue automatic acquisition or expire a
heartbeat. After the writer exits, explicit takeover reads the last explicit
checkpoint and creates a fresh monotonic origin. A missing checkpoint must be
presented as missing, not replaced by a new campaign.

`CampaignSession` owns one `RealtimeHost` clock capability. The host rejects a
second claim, direct clock ingress, replacement, or a presentation-clock ingress
after claiming. A released capability cannot advance or replace the host.
Views subscribe to the session; their teardown only removes their subscription.
The stock no-port engine path retains its existing behavior.

The S01 conversion and maximum integration interval come from admitted task 4
content: 6 world seconds per real second, and at most 100 real milliseconds per
integration interval. Absolute `performance.now()` samples are quantized to
microseconds. The resulting integer world milliseconds and fractional remainder
are preserved at consistent checkpoints. Speed changes first reconcile the old
segment, then apply 0, 1, 2, or 4. No Date or saved wall timestamp enters this flow.
Neither views nor support expiry change speed.

Task 8 supplies `SessionOptions.advance`, a pure reducer which splits the
provided interval at exact causal event times and returns the complete boundary.
The clock does not invent work, arrivals, consumption, or event IDs. It keeps
revision increments independent of frame partitions. Task 11 persists the
complete boundary, including `clock.subWorldMicroseconds`, using its atomic
storage adapter. The default zero remainder allows existing task 4 snapshots to
parse; no old signed runtime checkpoint format is rewritten.

`attachCampaignLifecycle` uses timers only as wakeups. Visibility and freeze/resume
events reconcile elapsed monotonic time without pausing or dropping the origin.
`pagehide` releases ownership and discards unsaved state, including when a page
enters the back-forward cache. Returning requires explicit checkpoint takeover.
OS behavior that stops the monotonic source cannot be reconstructed from wall
time without awarding clock-jump credit, so the UI makes technical suspension
and explicit-save-only recovery limits visible.

S01 has no battle admission and constructs no dummy battle rules. The separate
existing battle host forces active battles to 1x and rejects pause/fast requests.
General campaign battle admission remains outside S01.

## Early browser fixture

Build `scripts/qa/clock-fixture.config.mjs` with the installed Vite and serve the
output's `clock-fixture.html`. It consumes the exact admitted production pack and
the exported clock controls, with a private simple explicit-checkpoint adapter.
It is not the task 11 atomic save adapter or task 15 production entry.
The controls use Unity theme primitives and existing Unity main-menu strings;
Unity's source string table currently has no clock controls. New clock-specific
labels are local to this surface. Full in-game placement belongs to task 15.

The private `campaign-clock` event exposes only the displayed clock, speed,
writer status, visibility, and monotonic observation time. It grants no mutation
API and exposes no hidden world facts.
