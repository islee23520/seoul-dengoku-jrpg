# Campaign negative scenarios

`campaign-negative.mjs` is a private loopback fixture harness. It imports the production
runtime, command scheduler, authority, checkpoint, report and migration modules. It never
ships in the production build and never installs a debug route in the game. Every invocation
uses a fresh in-memory storage object and actual Node Web Locks. Production `start('new')`
and `start('saved')` are exercised before and across fixture boundaries.

Run the six fixture cases through the reusable campaign-smoke entry (plan task-17 acceptance
command) against the actually served artifact:

```sh
node scripts/qa/campaign-smoke.mjs --url http://127.0.0.1:4173/ --scenario legacy-migration --evidence <owned-directory>
```

Other names are `invalid-save`, `revoke-cut-return`, `stale-report`, `reject-conflict`, and
`finite-support`. The URL supplies the actual admitted content pack; the runner fetches those
bytes, parses them through the hash-bound `CampaignContent` boundary, and executes the
checkout's production modules through the private loopback fixture boundary below. This is
headless production-module proof, not browser UI proof. The mutated counterpart for each of the
six is:

```sh
node scripts/qa/campaign-smoke.mjs --url http://127.0.0.1:4173/ --scenario legacy-migration --negative-probe observation --run-id mutant --evidence <owned-directory>
```

which corrupts one observation while keeping the same assertion and must exit 1. The same
fixture boundary is directly reachable as `node scripts/qa/campaign-negative.mjs --url …
--scenario <name> [--mutate]` for loopback-only debugging; both entries share one harness.

Run the UI-reachable case against unchanged served artifact bytes:

```sh
node scripts/qa/campaign-smoke.mjs --url http://127.0.0.1:4173/ --scenario clock-tabs --evidence <owned-directory>
```

The native Aside run uses ordinary speed controls, saves and reloads, refuses the second
writer, closes the owned writer, subscribes to its actual Web Lock release, and explicitly
continues in the second tab. It compares the paused durable checkpoint before and after
takeover. Existing tabs and storage are preserved.

## Coverage

- `legacy-migration`: current exact Guro and authenticated Seoul alias, both excluded IDs,
  original bytes, RNG/clock/world facts, and historical settlement receipts.
- `invalid-save`: rehashed missing custody, missing execution order, and cyclic physical
  predecessor; storage map and active checkpoint remain identical after rejection.
- `revoke-cut-return`: saves immediately before and after report receipt; lawful carrying
  cut at 780 seconds; authority revokes immediately, notice arrives at 810 seconds, and
  narrow safe return retains original ownership and unresolved return. Reloads before and
  after notice delivery match uninterrupted effect IDs, events, reports, custody and knowledge.
- `stale-report`: unseen observations, truth version changed in transit, immutable old
  report knowledge, one work result and one unapplied award candidate throughout transit,
  receipt and later replay. No XP is invented without admitted growth inputs.
- `reject-conflict`: terminal ingress rejection, unchanged original state, independent
  compatible recipient readiness, no queued losing mandate, and no hidden error fields.
- `finite-support`: simultaneous food/water completion, resource conservation, exact duty
  arrival cutoff, close at 3600 seconds, continued clock after 5400 seconds, rejected new
  unsupported activity, and no automatic refill.

The carrying-cut API intentionally requires accepted return consent and a specific carrying
edge. It cannot legally revoke through that API before the 684-second report receipt.
Accordingly the before/after report reloads precede the 780-second cut; this harness does not
weaken the API or claim an impossible pre-receipt carrying-cut execution.

## Mutation sensitivity

`--mutate` runs each fixture case with one deliberately corrupted **observation** while
retaining the same assertion. It exits 1 with an AssertionError. These are assertion-harness
sensitivity checks, not claims that production-source mutants were generated or killed.

| Scenario | Observation mutation |
| --- | --- |
| legacy-migration | Observe old Seoul ID instead of authenticated target Seoul Station. |
| invalid-save | Observe forged checksum instead of the surviving active checksum. |
| revoke-cut-return | Drop the actual delayed notice receipt. |
| stale-report | Leak current truth version into received knowledge. |
| reject-conflict | Observe acceptance instead of the actual conflict rejection. |
| finite-support | Add one unearned food pack to conserved total. |
| clock-tabs | Append offline credit to the observed takeover checksum. |

For clock-tabs use `--negative-probe offline-credit --run-id mutant`. The command must exit 1
at the takeover equality assertion. The six fixture cases have neighboring Node tests that
exercise the private loopback boundary and require both the normal pass and mutation failure.
