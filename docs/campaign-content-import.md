# Campaign content import

Task 2 consumes the task 25 `campaign-source-manifest.v1` manifest. The importer
re-authenticates it against the readonly typed wiki readers and the task 24
selector contract before publishing anything. `WIKI_ROOT` selects the external
wiki explicitly; otherwise the sibling wiki beside the worktree collection is
used. No source provenance path is opened as an input fallback.

```sh
WIKI_ROOT=/path/to/seoul-dengoku-wiki node --test scripts/tools/test/campaign-content-import.test.mjs
WIKI_ROOT=/path/to/seoul-dengoku-wiki node scripts/tools/campaign-content-import.mjs --manifest game/data/campaign/source-manifest.json --out game/data/campaign
```

The output directory's parent must exist. Both output files must be absent;
existing editions are never overwritten. Regeneration comparisons should use a
fresh task-owned directory. `--help` documents the same arguments. Invalid
arguments or source contracts exit 1 with empty stdout and no published files.

`atlas.json` contains only the manifest's admitted map projection, selected
holding/site/person references, attribution, omission records, and source pins.
Geographic county IDs use the source's explicit canonical/public bijection.
Current slots retain their authored unresolved status. Political control and
source passage decisions are not campaign grants or execution admission.
Physical railway geometry is excluded, never converted into movement edges.

`identity-map.json` retains every old station ID with an exact, authenticated
alias, or excluded outcome. New map IDs use the old converter's UTF-8 hex
encoding. An alias does not establish placement compatibility: local tile,
route progress and combat migration remain explicit unsupported cases for the
later checkpoint migration task. That task must preserve and quarantine/export
the original checkpoint rather than guess. Exact station identity is available
without discarding the old edition; `game/data/world/graph.json` and its maps
remain immutable and the identity map binds that graph's byte hash.

The full 9 active / 4 retired court remains present. K001's personal liege
relationship and K029's geographic parent relationship stay separate. Stable
K IDs, `Guro`, `Sindorim`, and `Yeongdeungpo` are not replaced with display names.
