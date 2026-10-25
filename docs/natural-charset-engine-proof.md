# Natural charset engine proof (task 37)

The registered `testinput-natural-base` remains the unmodified 96x192 PNG,
SHA-256 `b9bf362f1b1322fc457dcee15235255631e762f68cadf332065994b2a301a7c1`.
No derived sheet is created, so the existing ledger acquisition proof applies.

The pinned engine is `6d4907e65e315787ce49b0d20dd48b68e1277395`.
`src/assets/resourceSlicing.ts` defines uploaded charsets as 288x256 with
24x32 cells. `registerUploadedCharsetTextures` in `src/assets/bundled.ts`
rejects other dimensions and `registerCharsetTextureFrames` hardcodes those
cells. Packing a native 32x48 body into that grid without resampling would
crop it. The fixture instead invokes the task 20 native loader on the actual
engine PlayScene; Phaser's real SpriteSheet parser slices 32x48 frames.

Run `bun scripts/tools/capture-natural-charset.mjs /absolute/evidence/task-37`.
The script builds disposable patched realtime engine sources with
`NATURAL_CHARSET_QA=1`; the normal build does not emit this entry. Node runs
the pinned TypeScript native sync API; Bun.WebView runs the browser. The
fixture boots `createPlayGame`, loads the original PNG using
`PlayScene.load.spritesheet`, then renders a real Phaser sprite. It steps all
four directions through stand and the four walk phases deterministically.
No timing sleeps or asynchronous animation sampling determine a pass.

The proof asserts all loaded frame rectangles and every cropped source pixel,
then checks visible opaque source pixels against the browser PNG. Foreground
cover cases assert the lower 16 source rows are hidden by an opaque higher-depth
Phaser rectangle while the upper body remains source-exact. This proves engine
display-list depth occlusion, not authored furniture/canopy or gameplay collision.

Layout: fixed 960x540 engine canvas in a 1440x1000 CSS-pixel browser viewport;
screenshots retain the browser's actual device-pixel ratio and pixel assertions
map CSS coordinates to that ratio without resampling. The fixture removes map
camera bounds so the full body fits. Document owns scrolling; no application
navigation, production controls, responsive redesign, or new actor presentation.
Brief: inspect source-exact TESTINPUT frames; priorities are direction/phase,
body boundaries, and foreground depth cover. Canonical actor art is left out.
This disposable proof surface has no alternate theme or interactive controls.

Production canonical actors remain transparent with identity text until their
appearance receives approval. A successful fixture is engine-native loading
proof, not uploaded-RM2000 support, canonical art approval, or an editor import
certification. No engine files are edited.

Tests: `node --test scripts/tools/test/natural-charset-engine.test.mjs
scripts/tools/test/natural-charset.test.mjs`. The first invokes the installed
engine Phaser parser directly against decoded PNG bytes, without DOM mocks.
The second retains native hash, directional animation and ledger admission checks.
Supply the existing external acquisition proof map using `ASSET_PROOF_MAP`.
