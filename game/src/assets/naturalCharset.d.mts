export type NaturalDirection = 'down' | 'up' | 'right' | 'left';
export const naturalCharset: {
  key: string;
  label: string;
  url: string;
  frameConfig: { frameWidth: number; frameHeight: number };
  sheetWidth: number;
  sheetHeight: number;
  animations: Record<NaturalDirection, { stand: number; walk: number[] }>;
};
export function preloadNaturalCharset(scene: { load: { spritesheet(key: string, url: string, config: { frameWidth: number; frameHeight: number }): unknown } }, url?: string): void;
export function createNaturalCharsetAnimations(scene: { anims: { create(config: { key: string; frames: { key: string; frame: number }[]; frameRate: number; repeat: number }): unknown } }): void;
