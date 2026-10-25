// Noncanonical TESTINPUT only. This is not a production actor or task-9 approval.
export const naturalCharset = {
  key: 'TESTINPUT-natural-base',
  label: 'TESTINPUT - noncanonical 32x48 base',
  url: 'game/assets/charsets/testinput-natural-base.png',
  frameConfig: { frameWidth: 32, frameHeight: 48 },
  sheetWidth: 96,
  sheetHeight: 192,
  // The native sheet is down, up, right, left; do not use RM2000 row order.
  animations: {
    down: { stand: 1, walk: [0, 1, 2, 1] },
    up: { stand: 4, walk: [3, 4, 5, 4] },
    right: { stand: 7, walk: [6, 7, 8, 7] },
    left: { stand: 10, walk: [9, 10, 11, 10] },
  },
};

// Phaser's native spritesheet loader accepts these dimensions; uploaded charset
// registration in engine/src/assets/bundled.ts requires 288x256 and is NOT used.
export function preloadNaturalCharset(scene, url = naturalCharset.url) {
  scene.load.spritesheet(naturalCharset.key, url, naturalCharset.frameConfig);
}

export function createNaturalCharsetAnimations(scene) {
  for (const [direction, mapping] of Object.entries(naturalCharset.animations)) {
    scene.anims.create({
      key: `${naturalCharset.key}-stand-${direction}`,
      frames: [{ key: naturalCharset.key, frame: mapping.stand }],
      frameRate: 1,
      repeat: 0,
    });
    scene.anims.create({
      key: `${naturalCharset.key}-walk-${direction}`,
      frames: mapping.walk.map(frame => ({ key: naturalCharset.key, frame })),
      frameRate: 8,
      repeat: -1,
    });
  }
}
