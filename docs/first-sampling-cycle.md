# First sampling cycle

This pilot imports one generic Korean station sign (two 16px cells reading 구로)
and one short UI sound. It does not complete the larger three-sign/two-effect/BGM
inventory in the original task 21 row.

The sign keeps the registered station atlas geometry and passability. Its new
frame uses the exact Kenney Roguelike Modern City packed rectangle
(128,64,16,16); its inset and glyph strokes are original CC0 work specified in
game/assets/sampling/signage-original-layer.json. No font or transit logo is
redistributed. Generate it with node scripts/tools/sample-assets.mjs (pngjs 7.0.0
from the pinned engine installation). All other atlas cells remain pixel-exact.

The sound is Kenney Interface Sounds 1.0, Audio/open_001.ogg, acquired from
https://kenney.nl/assets/interface-sounds with its archive License.txt. The
registered derivative is MP3 mono 44100Hz, 0.147778 seconds, encoded with ffmpeg
9.0.2 using -c:a libmp3lame -q:a 4. The complete original and acquisition receipt
stay outside Git. The engine accepts uploaded sound/music resources and plays
SE through HTMLAudioElement; MP3 avoids dependence on browser Vorbis support.

game/src/assets/sampling.ts is the deterministic post-conversion applier. It
clones the input, switches only Guro to a separate atlas with identical tile
indices/passability, and registers the sound. It does not rewrite game/project.json,
station maps, events, connections, encounter pacing, or canonical travel.
The realtime host applies it before entering the engine. The 역 안내 button opens
a native dialog and triggers the engine AudioEngine SE path from the user gesture.

Supply an absolute external ASSET_PROOF_MAP containing the existing task 7/task 20
receipts plus this cycle's three proof IDs and external source IDs. Run:

    node scripts/tools/asset-ledger-validate.mjs --ledger game/assets/ledger/ledger.json --proof-map "$ASSET_PROOF_MAP"
    node --test scripts/tools/test/sampling-cycle.test.mjs scripts/tools/test/asset-ledger-validate.test.mjs

The sampling test exercises actual ledger admission and missing-map rejection,
unregistered derivative detection in an isolated checkout, the pinned engine
parser and movement edges, exact PNG pixels, and real MP3 decoding with ffmpeg.
Browser QA must serve both realtime build output and pinned engine/public assets.
Private THREE_STATION_QA=1 entry is TESTINPUT station context, not canonical travel.
