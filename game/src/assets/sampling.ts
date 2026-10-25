import type { Project } from '@/project/types';

/** Pure post-conversion application: only Guro's atlas changes; graph and geometry stay exact. */
export function applySampling(project: Project, assets: {
  readonly signageDataUrl: string; readonly audioDataUrl: string;
}): Project {
  const copy = structuredClone(project);
  copy.assets.uploaded['sampling-ui-open'] = {
    id: 'sampling-ui-open', name: 'Kenney Interface Sounds / open_001 (CC0)',
    kind: 'sound', dataUrl: assets.audioDataUrl, meta: {},
  };
  const map = copy.maps['station-4775726f'];
  if (map) {
    const tileset = copy.tilesets[map.tilesetId];
    if (!tileset) throw new Error('Sampling requires the converted station tileset');
    copy.assets.uploaded['sampling-station-signage'] = {
      id: 'sampling-station-signage', name: 'Guro signage (Kenney + original CC0 strokes)',
      kind: 'tileset', dataUrl: assets.signageDataUrl, meta: { width: 128, height: 48, tileSize: 16 },
    };
    copy.tilesets['sampling-guro'] = { ...tileset, id: 'sampling-guro', name: 'Guro signage / CC0',
      image: { type: 'uploaded', id: 'sampling-station-signage' } };
    map.tilesetId = 'sampling-guro';
  }
  return copy;
}
