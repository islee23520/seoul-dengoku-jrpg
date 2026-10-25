import { id, integer } from '../ids.ts';
import type { Character } from '../character.ts';
import type { Grant, ServiceRelation } from '../authority.ts';
import type { Mandate } from '../mandate.ts';
import type { Title } from '../title.ts';
import type { Holding } from '../holding.ts';

// TESTINPUT is the admission label for all constructed runtime fixtures.
// CANON pins below identify observed source fields, NOT approved spawn/rule data.
export const provenance = {
  kind: 'TESTINPUT',
  canon: { kind: 'CANON', source: 'task-31/opening-manifest.json; DB sha256 33fc48dbcf335b05bf64391279faa48dbdeabbb03932e97f07886b683bba7859; /hierarchy, /people/1/holdings/0; source IDs 126/128/129' },
} as const;
export const lord = id('PersonId', 'K002');
export const retainer = id('PersonId', 'K568');
export const specialist = id('PersonId', 'K616');
export const liege = id('PersonId', 'K001');
export const cause = id('CauseId', 'TESTINPUT:cause');
export const tick = integer('WorldTick', 2);
export const revision = integer('Revision', 1);
export const schemaVersion = integer('SchemaVersion', 1);
export const location = id('StationId', 'TESTINPUT:station');
export const applicability = { tense: 'current', from: integer('WorldYear', 2126), until: null, source: provenance.canon.source } as const;
const abilities = { leadership: 12, strategy: 11, negotiation: 12, administration: 13, insight: 12, learning: 9, dexterity: 4, constitution: 7 } as const;
const body = { 'left-arm': 'TESTINPUT:healthy', 'right-arm': 'TESTINPUT:healthy', 'left-leg': 'TESTINPUT:healthy', 'right-leg': 'TESTINPUT:healthy', head: 'TESTINPUT:healthy', torso: 'TESTINPUT:healthy' } as const;
export const character: Character = { id: lord, alive: true, captive: false, conscious: true, agency: true, baseAbilities: abilities, finalAbilities: abilities, skills: {}, traits: [], body: { damage: body, function: body, diseases: [] } };
export const retainerCharacter: Character = { ...character, id: retainer, baseAbilities: { leadership: 5, strategy: 6, negotiation: 9, administration: 8, insight: 8, learning: 7, dexterity: 3, constitution: 8 }, finalAbilities: { leadership: 5, strategy: 6, negotiation: 9, administration: 8, insight: 8, learning: 7, dexterity: 3, constitution: 8 }, skills: { 'discharge-negotiation': 50 } };
export const specialistCharacter: Character = { ...character, id: specialist, baseAbilities: { leadership: 5, strategy: 7, negotiation: 6, administration: 10, insight: 12, learning: 9, dexterity: 3, constitution: 8 }, finalAbilities: { leadership: 5, strategy: 7, negotiation: 6, administration: 10, insight: 12, learning: 9, dexterity: 3, constitution: 8 }, skills: { 'pressure-total-check': 60 } };
export const title: Title = { id: id('TitleId', 'title:duchy-gu-11470-S01'), name: 'Yangcheon duchy', rank: 'duchy', holder: lord, polity: id('PolityId', 'S01'), geographicParentTitle: id('TitleId', 'title:kingdom-s02'), personalLiegePerson: null, recognitionStatus: 'TESTINPUT:observed', applicability, basisEvents: [] };
export const holding: Holding = { id: id('HoldingId', 'holding:yangcheon'), boundTitle: title.id, territoryScope: ['1147051000','1147052000','1147053000','1147054000','1147055000','1147056000','1147057000','1147058000','1147059000','1147060000','1147061000','1147061100','1147062000','1147063000','1147064000','1147065000','1147067000','1147068000'].map(code => id('RegionCode', 'region:' + code)), evidenceStatus: 'current_seoul_evidenced', effectiveControl: [] };
const roster = [
  ['K904', 'retired-current'], ['K568', 'active'], ['K616', 'active'], ['K712', 'active'], ['K856', 'retired-current'], ['K952', 'active'], ['K1001', 'active'], ['K424', 'active'], ['K520', 'active'], ['K760', 'active'], ['K808', 'retired-current'], ['K664', 'retired-current'], ['K472', 'active'],
] as const;
export const services: readonly ServiceRelation[] = roster.map(([person, disposition]) => ({ principal: lord, personId: id('PersonId', person), role: 'household-retainer', disposition, causeId: cause }));
export const grant: Grant = { id: id('GrantId', 'TESTINPUT:grant'), grantor: lord, grantee: retainer, basis: { kind: 'right', id: 'TESTINPUT:right', causeId: cause }, parentAuthorityId: null, version: revision, state: 'valid', basisEvents: [cause], scope: ['TESTINPUT:operate'], assets: ['TESTINPUT:valve'], roster: [retainer], budget: { water: 7 }, subdelegation: true, effectiveAt: integer('WorldTick', 0), expiresAt: integer('WorldTick', 20) };
export const order: Mandate = { ...grant, orderId: id('OrderId', 'TESTINPUT:order'), causeId: cause, issuerPersonId: lord, titleOrOfficeOrCommandBasis: grant.basis, parentAuthorityId: grant.id, parentAuthorityVersion: grant.version, targetId: 'TESTINPUT:valve', targetVersion: revision, recipientId: retainer, goal: 'TESTINPUT:repair', issuerLocation: location, recipientLocation: location, communicationRoute: [location], issuedAt: integer('WorldTick', 0), receivedAt: null, acceptedAt: null, reservations: [], personSchedule: [], stage: 'proposed', progress: 'TESTINPUT:unstarted', physicalLocation: location, custody: [], reportObservedAt: null, reportCreatedAt: null, reportDeliveredAt: null, interruptReason: null, refusalReason: null, revokeReason: null, pendingResultIds: [], appliedResultIds: [] };
