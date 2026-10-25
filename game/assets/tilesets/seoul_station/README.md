# Seoul station input package

Kenney, Roguelike Modern City 2.0: https://kenney.nl/assets/roguelike-modern-city (CC0). Cropped cells remain unscaled. See provenance.json for every source rectangle; original-layer-spec.json owns every new pixel layer. No engine bundle pixels used.

Atlas: 128x48, 24 tiles, 16px cells. tileset.json uses engine directional passability. Import PNG as uploaded asset id seoul_station-atlas; combine tileset with template maps. Transparent furniture is placed in upperTiles and blocks via its directional flags. Default platform/corridor and three station overrides are game/maps/templates/seoul_station. Preserve task-6 graph events when consuming these inputs. application.json is an application contract, not an automatic rewrite.

The converter applies this package to all 334 maps: 331 default layouts and three station overrides, preserving the source graph and its 409 edges. Task 7 passed map-only runtime QA in the actual player: three station views, 103 keyboard receipts, wall collision, four authorized transfers, no direct shortcut and no missing textures. That QA used a noncanonical stone actor in a TEST-ONLY fixture; the production project was not changed by the QA. This is not task 9 canonical character approval or whole-game approval. The production project remains unplayable.
