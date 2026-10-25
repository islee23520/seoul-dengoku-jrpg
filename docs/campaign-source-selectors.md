# Campaign source selector contract

Task 24 is a read-only dependency contract, not a manifest producer or admission.
Task 25 still requires independent confirmation of this checkpoint.

Run with Node 24.15 or later:

```sh
node --test scripts/tools/test/campaign-source-selectors.test.mjs
node scripts/tools/campaign-source-selectors.mjs --wiki-root /path/to/seoul-dengoku-wiki --check
```

The CLI opens canonical SQLite through the wiki's authenticated, typed,
read-only readers. It rejects tracked dirty source, non-SQLite storage,
sidecars, and source head/database changes during the read. Untracked files
are neither opened nor treated as canonical inputs. Source provenance paths
are metadata only: they are not filesystem fallback sources.

Selectors support own-property names, array `*`, and unique equality filters
such as `/titles[id=title:kingdom-s02]`. Each filter must resolve exactly one
row. Empty, ambiguous, unknown, prototype, and executable-looking paths fail.
There are no recursive queries, expressions, unions, implicit aliases, or SQL.
Selectors operate on already authenticated typed rows, not raw source JSON.

The title contract resolves the Yangcheon binding, its K002 title and the K029
parent using actual `id` keys. It checks values and the parent relationship.
The rail declaration is `/stationIdsByCode`, `/lines/*/id`, `/lines/*/paths`.
Paths retain stop codes and names (including names used in omission records).
Validation compares resolved concrete leaf paths and values against that
declaration, not counts of output fields. The consumer receives a detached,
deeply frozen reconstruction with only those declared inputs. Graph station
allowlists and exclusions remain separate consumer arguments; this checkpoint
does not admit the campaign map's station selection or create transport rights.

For negative CLI probes, `--title-selector` replaces the K002 title selector;
`--rail-selectors` supplies comma-separated rail selectors. Missing consumed
fields fail nonzero with empty stdout. The CLI has no output-file option and
never publishes a manifest. Successful stdout contains the resolved title
rows, concrete selected rail dependencies, source pins, and diagnostic
all-source graph count (not campaign-map parity or publication approval).
