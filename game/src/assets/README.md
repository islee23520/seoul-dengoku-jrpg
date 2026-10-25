# Natural-proportion charset TESTINPUT

`naturalCharset.mjs` imports the unmodified 32x48 base by BlazingMagpie:
https://opengameart.org/content/simple-32x48-base-sprite
CC0-1.0: https://creativecommons.org/publicdomain/zero/1.0/legalcode

The native 96x192 PNG contains three columns and four direction rows: down,
up, right, left. Column 1 is standing; columns 0 and 2 alternate steps.
No resize, smoothing, palette edits, derived PNG, or engine-bundled pixels.
The source hash and logical acquisition proof ID are in the asset ledger;
the existing canonical CC0 legal text is in its licenses directory.

Use `preloadNaturalCharset(scene, servedAssetUrl)` in a Phaser preload and
`createNaturalCharsetAnimations(scene)` after loading. Use nearest filtering
(`pixelArt: true`, `antialias: false`) and a bottom-center origin for preview.
This loader uses Phaser spritesheets, not the engine's uploaded charset path:
that path requires exactly 288x256 and slices 24x32 frames. Native 32x48 does
not pass that guard. No engine support extension is claimed here.

This is a registered, loader-tested **noncanonical TESTINPUT**, not a character
design or protagonist. Any visible preview must keep the TESTINPUT label.
Production actor use, editor crop/occlusion approval and project registration
remain gated by task 9 and a separately authorized engine-format integration.
No actor, map, event, domain or production project is modified here.

Run `ASSET_PROOF_MAP="$ASSET_PROOF_MAP" node --test scripts/tools/test/natural-charset.test.mjs`.
Supply the external proof map that includes the charset acquisition ID and
all pre-existing station IDs. Nothing in the public repository supplies or
bypasses private acquisition receipts. No-map validation fails closed.
