# Asset admission ledger

Run `node scripts/tools/asset-ledger-validate.mjs --ledger game/assets/ledger/ledger.json --proof-map "$ASSET_PROOF_MAP"`.
Set `ASSET_PROOF_MAP` to an existing absolute JSON map path outside the checkout.
The environment variable also supplies the map when `--proof-map` is omitted.
The root is derived from the validator location, never the shell directory or ledger path.
`schema.json` declares every entry field. All fields are required; inapplicable derived
filenames and hashes are empty strings. Hashes are lowercase SHA-256 of actual bytes.
The CLI also accepts `--ledger -` for JSON on stdin. Errors exit 1 without a success line.

Repository entries use `usage: "repository"`. Source and derived paths are repository
relative under `game/assets`; privately held source files use `external:<logical-ID>`
resolved by the external map. Absolute asset paths are rejected. Paid originals stay
outside the checkout. Each present file
must exist and match its corresponding hash. Derived entries require change notes.
Unregistered files (including JSON and files inside ledger-named directories) fail.
Only the exact metadata paths shipped here and empty `.gitkeep` files are exempt.
Symlinks are rejected. Validation reads files only and never downloads or deletes them.

Supported policies are CC0-1.0, CC-BY-4.0, CC-BY-SA-4.0 and OPRN-GAME-1.0. Any other
license, including NC/ND, store-wide terms, or bespoke unreviewed permission, fails
closed. The first three require their canonical legalcode URL (without `.txt`) and
the corresponding snapshot under `ledger/licenses`. OPRN uses `engine/ASSET-LICENSE.md`.
`license_snapshot_or_hash` is `sha256:<actual snapshot hash>`; a separately pinned,
newline-normalized digest prevents replacing the notice with invented permission.
Snapshots came from the Creative Commons legalcode.txt endpoints on 2026-10-24.

Schema version 2 replaces `proof_location` with `proof_id`; no legacy path fallback
is accepted. IDs match `[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}`. The external JSON map has
exactly `schema_version: 1`, `root`, `receipts` and `sources`. `root` is an absolute
directory outside the checkout. `receipts` maps ledger proof IDs to relative JSON
filenames under that root; `sources` maps external source IDs to relative filenames.
Unknown IDs, traversal, absolute mapped paths and escaping symlinks fail. The map
itself and every resolved file must be outside the checkout. Missing maps, receipts
or original sources fail closed. URLs and permission assertions are not receipts.

Each actual JSON receipt
binds `asset_id`, `author_or_seller`, `asset_page_url`, `license_name_version` and
`source_hash` to the acquisition record, and declares `paid` as a boolean. Keep the
rights holder's source notice/order evidence alongside that receipt; reviewers must
verify that the notice actually applies to these bytes before setting review_status
to approved. A receipt is a review record, not independently authenticated legal proof.
The validator enforces recognized grants and evidence consistency; it cannot establish
the truth of a fabricated rights-holder identity or acquisition record.

Public clones can inspect the license snapshots, source credits, provenance and
public asset hashes independently. That inspection does not authenticate private
acquisition or replace this admission gate. Verification and deployment preparation
must supply the private map. Never copy that map, receipts, private source files or
their resolved paths into Git or published output. The converter and independent
checker accept `--proof-map` (or `ASSET_PROOF_MAP`) and run the same strict gate
before consuming station assets. Their outputs contain only the asset data, not
the map or receipt objects. No public-license mode bypasses acquisition checks.

The graph input is also explicit: use `--source` or `SEOUL_WORLD_GRAPH_SOURCE` with
both map CLIs. No personal checkout location is assumed. Existing source/derived
hashes are retained; the private packed PNG is not interchangeable with the
public PNG even when their rendered pixels correspond. Documentation revisions
receive a new authoring receipt with the previous receipt/source hashes; never
overwrite an earlier acquisition receipt to pretend it covered new bytes.

Commercial game, editing and game-build permissions must be explicitly true.
Each repository file additionally needs the appropriate original/derivative repository
permission. A true boolean cannot override an unsupported license. CC-BY attribution
retains author, source URL and license URL; derivatives also retain their change notes.
CC-BY-SA requires sharealike_obligation=true. EasyRPG and joseon/Beodeul origins require
attribution even when referenced through the engine. Proprietary KADOKAWA/Enterbrain
RTP identifiers are rejected; EasyRPG's replacement RTP is a distinct source.

OPRN bundle and joseon/Beodeul entries may only use
`usage: "engine-reference(game-use)"`, reference existing `engine/public/assets/`
source files, set both public repository permission booleans false, and have no derived
file/hash. Game distribution permission is not standalone redistribution permission.
No OPRN-derived pixels are admitted to this repository by this validator.

Tests copy the validator and metadata into a fresh owned mkdtemp checkout. Every
fixture mutation and recursive cleanup is confined to that verified temporary owner;
the real product asset tree is never mutated by the suite.
