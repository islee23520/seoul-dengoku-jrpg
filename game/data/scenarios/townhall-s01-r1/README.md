# Townhall scenario provenance

`scenario.json` uses the sentinel `REPO_ROOT` for `provenance.evidenceRoot`.
Resolve provenance references (including their optional JSON pointer fragments)
relative to the game repository root, not this scenario package. The tests derive
that root from `import.meta.url`; `TOWNHALL_EVIDENCE_ROOT` may point to the main
game repository when its private `.omo` evidence is shared with a worktree.

`wiki-sync.json` retains `databasePath` as an external deferred-sync identifier
in `repository:relative-reference` form. It is not a local filesystem path and
does not authorize synchronization or a database write.
