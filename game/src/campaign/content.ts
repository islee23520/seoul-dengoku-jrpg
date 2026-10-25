import { z } from '../../../engine/node_modules/zod/index.js';
import { sha256 } from '../../../engine/node_modules/@noble/hashes/sha2.js';
import { summaryHash } from '../domain/eventLedger.ts';
import { CampaignBoundaryError, ownInput, requireBoundary } from './errors.ts';
import { atlasShape, identityShape, manifestShape, operationShape, projectionShape, scenarioShape } from './contentSchemas.ts';

/** Exact artifacts admitted by tasks 2, 3 and 25, not caller-supplied approval flags. */
const campaignPackageHashes = Object.freeze({
  manifest: '5d97dfaa5fd0d642c6898b06bb1686f297c6a2a48f5a3e2363fdcf2d08e6f7d9',
  atlas: 'ea193b6e780d0c75770e2dd2b99f5f2cf40d484dbbfb77dd2a8a499a93d47edc',
  identities: '292d76e1c9f0c3b31e9a40bb061df5f7812510a3199ab2494283d6135b0371e7',
  scenario: '90b123be955ddcd46d71c6c0a3d4dd5926e66cfb3867f81b82682b9ec5e5dfc9',
  projection: '5a5f0d7e13fe8f70855df873cab368e18cbefe3d026a3356502690aba72e56dc',
  operations: '08465058ccfab3d21847441c181a765b8bee363cb5f9deb8d4988ba25f701400',
} as const);
const packageShape = z.strictObject({ manifest: z.string(), atlas: z.string(), identities: z.string(), scenario: z.string(), projection: z.string(), operations: z.string() });
const contentShape = z.strictObject({ manifest: manifestShape, atlas: atlasShape, identities: identityShape, scenario: scenarioShape, projection: projectionShape, operations: operationShape }).readonly();
type ContentData = z.infer<typeof contentShape>;
const admissionKey = Symbol('campaign-admission');
const admitted = new WeakSet<object>();

function freezeContent(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const item of Object.values(value)) freezeContent(item);
  Object.freeze(value);
}

/** Immutable trusted data capability; no caller can construct an admitted instance. */
export class CampaignContent {
  readonly #admission = admissionKey;
  readonly data: ContentData;
  readonly hashes = campaignPackageHashes;
  private constructor(data: ContentData, key: symbol) {
    requireBoundary(key === this.#admission, 'content-admission');
    freezeContent(data); this.data = data; Object.freeze(this);
  }
  static parse(input: unknown): CampaignContent {
    ownInput(input);
    const envelope = packageShape.safeParse(input);
    if (!envelope.success) throw new CampaignBoundaryError('shape');
    const parsed: Record<string, unknown> = {};
    for (const key of Object.keys(campaignPackageHashes)) {
      const name = z.enum(['manifest', 'atlas', 'identities', 'scenario', 'projection', 'operations']).parse(key);
      const bytes = envelope.data[name];
      const hash = Array.from(sha256(new TextEncoder().encode(bytes)), n => n.toString(16).padStart(2, '0')).join('');
      requireBoundary(hash === campaignPackageHashes[name], 'content-hash');
      parsed[name] = JSON.parse(bytes);
    }
    const result = contentShape.safeParse(parsed);
    if (!result.success) throw new CampaignBoundaryError('shape');
    const data = result.data;
    assertContentLinks(data);
    const content = new CampaignContent(data, admissionKey);
    admitted.add(content);
    return content;
  }
}

export function assertAdmittedContent(content: unknown): asserts content is CampaignContent {
  requireBoundary(typeof content === 'object' && content !== null && admitted.has(content), 'content-admission');
}

export function assertContentLinks(data: ContentData): void {
  const { atlas, manifest, identities, scenario: s, projection: p, operations: o } = data;
  requireBoundary(atlas.source.manifestSha256 === campaignPackageHashes.manifest && identities.source.manifestSha256 === campaignPackageHashes.manifest && atlas.edition === identities.edition, 'content-link');
  requireBoundary(summaryHash(atlas.selection) === summaryHash(manifest.selection), 'content-link');
  requireBoundary(atlas.edges.every(e => atlas.stations.some(n => n.id === e.a) && atlas.stations.some(n => n.id === e.b)), 'content-link');
  requireBoundary(o.authority.siteId === manifest.selection.site.id && o.authority.regionId === manifest.selection.site.regionId && o.authority.holdingId === manifest.selection.holding.id, 'content-link');
  requireBoundary(p.scenarioId === s.id && s.siteId === o.authority.siteId && s.regionId === o.authority.regionId, 'content-link');
  requireBoundary(s.sites.every(n => n.anchorRef === s.siteId && n.regionId === s.regionId) && p.nodes.every(n => s.sites.some(site => site.id === n.id) && p.scenes.some(scene => scene.id === n.sceneId && scene.siteId === s.siteId)), 'content-link');
  requireBoundary(o.routes.edges.every(e => p.nodes.some(n => n.id === e.from) && p.nodes.some(n => n.id === e.to)), 'content-link');
  requireBoundary(s.actors.every(a => manifest.selection.persons.some(person => person.id === a.id && person.disposition === 'active') && identities.persons.some(person => person.newId === a.id) && o.authority.actorPlacements[a.id] === a.at && p.actors.some(actor => actor.actorId === a.id && actor.nodeId === a.at)), 'person-scope');
  requireBoundary(s.rights.basis.issuer === o.authority.issuer && s.ledger.owner === o.authority.issuer && s.ledger.custodianAtE0 === o.authority.duty, 'authority-source');
  requireBoundary(o.authority.mandates.every(m => m.grants.every(id => s.rights.grants.some(g => g.id === id && g.issuer === o.authority.issuer && (g.recipient === o.authority.designator || g.recipient === m.recipient)))), 'authority-source');
}

/** Content-addressed adapter version, explicitly not scenario.version or a new grant. */
export function sourceGrantVersion(grant: ContentData['scenario']['rights']['grants'][number]): string {
  return summaryHash({ sourceHash: campaignPackageHashes.scenario, grant });
}
