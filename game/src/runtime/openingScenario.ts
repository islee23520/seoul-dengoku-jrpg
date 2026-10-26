import { z } from '../../../engine/node_modules/zod/index.js';
import projection from '../../data/scenarios/townhall-s01-r1/projection.json' with { type: 'json' };
import scenario from '../../data/scenarios/townhall-s01-r1/scenario.json' with { type: 'json' };
import numeric from '../../data/scenarios/townhall-s01-r1/numeric-gaps.json' with { type: 'json' };

export const approvedActorId = z.enum(['K002', 'K568', 'K616']);
const placementSchema = z.object({
  actorId: approvedActorId, nodeId: z.string(), mapId: z.string(),
  tile: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
  facing: z.enum(['up', 'down', 'left', 'right']),
});
const identities = {
  K002: { name: '이서담', title: '양천 구역장', liege: 'K001', role: 'landed-vassal-lord',
    titleId: 'title:duchy-gu-11470-S01', holdingId: 'holding:yangcheon', courtId: 'court:K002', retainers: ['K568', 'K616'] },
  K568: { name: '백산석', title: '배급구역 서기', liege: 'K002', role: 'direct-retainer',
    titleId: null, holdingId: null, courtId: 'court:K002', retainers: [] },
  K616: { name: '성달현', title: '배급구역 서기', liege: 'K002', role: 'direct-retainer',
    titleId: null, holdingId: null, courtId: 'court:K002', retainers: [] },
} as const;

/** Scenario-scoped start authorized by task 9 dispatch; historical approvals stay intact. */
export function selectOpeningActor(input: unknown) {
  const id = approvedActorId.parse(input);
  const placement = placementSchema.parse(projection.actors.find(actor => actor.actorId === id));
  const site = scenario.sites.find(site => site.id === placement.nodeId);
  if (!site) throw new RangeError('Unresolved scenario placement: ' + placement.nodeId);
  return { ...placement, ...identities[id], place: site.name, regionId: site.regionId };
}
export const openingActors = approvedActorId.options.map(selectOpeningActor);
export const openingAdmission = {
  scenarioId: 'townhall-s01-r1', playableStart: true, publication: false,
  cardStatus: 'draft', identityAdmission: 'current-reviewed', wikiSync: 'deferred',
  appearanceApproved: false,
  authority: 'task9 explicit scenario-scoped dispatch; not historical receipt approval',
  identitySource: 'task31/opening-manifest.json',
  wikiRevision: 'db7ac5ecbd2582ec698821c63df69bc45c95d229',
  databaseSha256: '33fc48dbcf335b05bf64391279faa48dbdeabbb03932e97f07886b683bba7859',
} as const;

/** Only the explicit start approval supersedes its old gap; every numeric gap remains. */
export const blockedOpeningActions = numeric.gaps
  .filter(gap => gap.category !== 'play-start-approval')
  .flatMap(gap => gap.blockedActions.map(action => ({ action, input: gap.id, category: gap.category })));

export function openingAction(input: unknown) {
  const action = z.string().parse(input);
  return { kind: 'blocked', action, gaps: blockedOpeningActions.filter(entry => entry.action === action).map(entry => entry.input) } as const;
}
