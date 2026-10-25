# Campaign source manifest

Run with Node 24.15 or newer after a fresh external `cast:build` export:

```sh
node scripts/tools/campaign-source-manifest.mjs --wiki-root "$WIKI_ROOT" \
  --export-db "$RUN_TMP/wiki-export/wiki-cast.sqlite" --out "$RUN_TMP/source-manifest.json"
node --test scripts/tools/test/campaign-source-manifest.test.mjs
```

Set `WIKI_ROOT` and `CAMPAIGN_EXPORT_DB` for the tests when the wiki is not the
default sibling checkout. Outputs must be absent. Existing outputs are preserved;
regenerate to a new path and review the diff before replacing a tracked edition.
`--generated` selects a comparison snapshot for adversarial tests, not authority.

The CLI reads the exported SQLite through the wiki's existing typed readers.
It checks SQLite magic, schema/application identity, sidecars, canonical/export
byte equality, tracked-source cleanliness and unchanged source bytes/head at the
end. An unrelated untracked wiki file is not read, admitted or published.

Before emitting the manifest it independently projects and compares all 80 title
geometries and dated/current slots, 427 region geometries and selected control
fields, all 312 stations (including alias member control), and all 381 regular
edges with source codes, control and passage decisions. Station exclusions are
checked against the authenticated unsimplified Seoul boundary, not names alone.
Region narrative, population density, physical rail and unrelated landmarks are
not imported. A parity digest binds the selected projection; the generated JSON
hash alone is never sufficient.

The selected identity set contains K001, K002, K029 and the entire 13-member
K002 court, retaining nine active and four retired members. K001's personal
liege relation is separate from K029's parent territorial title. Only the named
S01 site/building is selected. The source union's name and members remain a
revision-bound source grouping with `unresolved-source-binding`, not a new
sovereign ID or authority grant.

Field groups carry source hashes/pointers, transform identifiers and permitted
use references. Wiki-owned content follows the separate Linalab.io content
permission, not software MIT. SGIS 2025 title geometry, the July 2026 boundary,
and the September 2026 atlas OSM snapshot retain distinct versions. Real-person
permission entries intersecting the selected set reject publication. Absence
from that registry is recorded as absence, never consent. Portraits, private
proofs, Soul, biographies and unrelated people are excluded.

Station coordinates bind the preserved `SeoulWorldGraph.json` input hash, not
the atlas-site PBF snapshot. Their external coordinate edition is unknown and
the atlas snapshot bridge is unverified. The OSM attribution remains applicable.
Title geometry retains SGIS provenance separately from factual NEC/election-law
membership and community name/code correspondence. Each source has its own typed
selector; a shared JSON pointer is not used across different document schemas.
The CLI rejects uncovered selected map fields before publication and rejects
inherited JavaScript object-property names as unknown options.

The manifest does not grant campaign execution, communal facility ownership,
passage rights beyond the sourced map decisions, or exact-artifact play-start
approval. Existing upstream import-quality findings remain upstream findings;
storage verification does not imply complete semantic or publication review.
