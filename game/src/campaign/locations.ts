import { assertNever } from '../domain/errors.ts';
import type { Brand } from '../domain/ids.ts';
import { requireBoundary } from './errors.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignLocation } from './stateSchemas.ts';

export function assertLocation(location: CampaignLocation, content: CampaignContent): void {
  const { atlas, projection, operations } = content.data;
  switch (location.kind) {
    case 'station':
      requireBoundary(atlas.stations.some(s => s.id === location.stationId), 'location-scope'); return;
    case 'site':
      requireBoundary(location.siteId === operations.authority.siteId, 'location-scope'); return;
    case 'scene':
      requireBoundary(projection.scenes.some(s => s.id === location.sceneId && s.siteId === location.siteId), 'location-scope'); return;
    case 'node':
      requireBoundary(location.siteId === operations.authority.siteId && projection.nodes.some(n => n.id === location.nodeId && n.sceneId === location.sceneId), 'location-scope'); return;
    case 'edge-progress': {
      const edge = operations.routes.edges.find(e => (e.from === location.from && e.to === location.to) || (e.from === location.to && e.to === location.from));
      requireBoundary(location.siteId === operations.authority.siteId && edge !== undefined && location.travelledMillimetres < edge.metres * 1000, 'location-scope'); return;
    }
    default: return assertNever(location);
  }
}
export function physicalNodes(location: CampaignLocation): readonly Brand<string, 'CampaignNodeId'>[] {
  switch (location.kind) {
    case 'node': return [location.nodeId];
    case 'edge-progress': return [location.from, location.to];
    case 'station': case 'site': case 'scene': return [];
    default: return assertNever(location);
  }
}
export function nodeLocation(node: string, content: CampaignContent): CampaignLocation {
  const found = content.data.projection.nodes.find(n => n.id === node);
  requireBoundary(found !== undefined, 'location-scope');
  return { kind: 'node', siteId: content.data.operations.authority.siteId, sceneId: found.sceneId, nodeId: found.id };
}
