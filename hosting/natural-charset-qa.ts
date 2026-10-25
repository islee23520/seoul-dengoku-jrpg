/// <reference path="./sampling-assets.d.ts" />
import { createPlayGame } from '@/player/createPlayGame';
import { setExportedProject } from '@/player/exportProjectStoreShim';
import { startSession } from '@/project/session';
import { openingProject } from './opening-project.ts';
import { naturalCharset, preloadNaturalCharset, createNaturalCharsetAnimations } from '../game/src/assets/naturalCharset.mjs';
import sourceUrl from '../game/assets/charsets/testinput-natural-base.png?inline';

/** TESTONLY: emitted only with NATURAL_CHARSET_QA=1. No canonical actor changes. */
export async function bootNaturalCharsetQa(parent: HTMLElement) {
  const project = openingProject('K002');
  setExportedProject(project);
  let ready!: () => void;
  const created = new Promise<void>(resolve => { ready = resolve; });
  const game = await createPlayGame(parent, startSession(project), { onPlaySceneReady: ready });
  await created;
  const scene = game.scene.getScene('PlayScene');
  const loaded = new Promise<void>((resolve, reject) => {
    scene.load.once('complete', resolve);
    scene.load.once('loaderror', () => reject(new Error('Native charset load failed')));
  });
  preloadNaturalCharset(scene, sourceUrl);
  scene.load.start();
  await loaded;
  createNaturalCharsetAnimations(scene);
  // Freeze gameplay, not the renderer. This is a slicing fixture, not a simulation.
  scene.events.removeAllListeners('update');
  scene.children.list.forEach((child: Phaser.GameObjects.GameObject) => { if ('setVisible' in child) (child as Phaser.GameObjects.Sprite).setVisible(false); });
  game.scale.resize(960, 540);
  scene.cameras.main.stopFollow().removeBounds().setViewport(0, 0, 960, 540).setScroll(0, 0).setZoom(1).setBackgroundColor('#172331');
  const sprite = scene.add.sprite(120, 120, naturalCharset.key, 1).setOrigin(0, 0).setScale(3).setDepth(10);
  const label = scene.add.text(12, 12, 'TESTINPUT person | not canonical art approval', { fontSize: '16px', color: '#ffffff' }).setDepth(30);
  const cover = scene.add.rectangle(120, 216, 96, 48, 0x567c68).setOrigin(0).setDepth(20);
  cover.setVisible(false);
  scene.scene.pause();
  const show = async (direction: keyof typeof naturalCharset.animations, phase = -1, occluded = false) => {
    const mapping = naturalCharset.animations[direction];
    const frame = phase < 0 ? mapping.stand : mapping.walk[phase % 4];
    sprite.anims.stop(); sprite.setFrame(frame); cover.setVisible(occluded);
    label.setText(`TESTINPUT person | ${direction} ${phase < 0 ? 'stand' : 'walk ' + phase} | ${occluded ? 'foreground cover' : 'full frame'}`);
    await new Promise<void>(resolve => game.events.once('postrender', resolve));
    const texture = scene.textures.get(naturalCharset.key);
    const slices = Array.from({ length: 12 }, (_, index) => {
      const f = texture.get(index);
      return { index, x: f.cutX, y: f.cutY, width: f.cutWidth, height: f.cutHeight };
    });
    const rect = game.canvas.getBoundingClientRect();
    return { direction, phase, frame, occluded, slices, canvas: { width: game.canvas.width, height: game.canvas.height, left: rect.left, top: rect.top, cssWidth: rect.width, cssHeight: rect.height },
      sprite: { x: sprite.x, y: sprite.y, scale: 3, depth: sprite.depth }, coverDepth: cover.depth,
      path: 'createPlayGame -> PlayScene.load.spritesheet -> Phaser TextureManager SpriteSheet parser -> PlayScene.add.sprite',
      pixels: Array.from((() => {
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        const f = texture.get(frame); ctx.drawImage(texture.getSourceImage() as HTMLImageElement, f.cutX, f.cutY, 32, 48, 0, 0, 32, 48);
        return ctx.getImageData(0, 0, 32, 48).data;
      })()) };
  };
  return { show, close: () => game.destroy(true) };
}
