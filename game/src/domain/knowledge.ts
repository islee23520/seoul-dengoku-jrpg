import type { CauseId, PersonId, Revision, WorldTick } from './ids.ts';
import { InvariantViolation, requireCause } from './errors.ts';

export type WorldFact = { readonly id: string; readonly version: Revision; readonly content: string; readonly causeId: CauseId };
export type KnowledgeObject = {
  readonly id: string; readonly content: string; readonly version: Revision; readonly source: string;
  readonly authenticity: string; readonly confidentiality: string; readonly ownership: string; readonly readRights: readonly PersonId[];
};
export type PersonKnowledge = {
  readonly personId: PersonId; readonly records: readonly { readonly factId: string; readonly version: Revision; readonly reportId: string }[];
  readonly understanding: Readonly<Record<string, string>>; readonly practiceProgress: Readonly<Record<string, number>>;
  readonly skills: Readonly<Record<string, number>>; readonly qualifications: readonly string[];
};
export type Report = {
  readonly id: string; readonly fact: WorldFact; readonly recipient: PersonId;
  readonly observedAt: WorldTick; readonly createdAt: WorldTick; readonly deliveredAt: WorldTick | null;
  readonly source: string; readonly omission: readonly string[]; readonly uncertainty: string; readonly causeId: CauseId;
};
export type CameraExposure = { readonly kind: 'camera'; readonly factId: string };
export function assertCameraExposureGrantsNothing(_exposure: CameraExposure): never { throw new InvariantViolation('camera-is-not-knowledge-or-authority'); }
export function receiveReport(knowledge: PersonKnowledge, report: Report, now: WorldTick): PersonKnowledge {
  requireCause(report.causeId);
  if (report.recipient !== knowledge.personId || report.deliveredAt === null || report.observedAt > report.createdAt ||
    report.createdAt > report.deliveredAt || report.deliveredAt > now || !report.source) throw new InvariantViolation('report-not-delivered');
  if (knowledge.records.some(r => r.reportId === report.id)) return knowledge;
  return { ...knowledge, records: [...knowledge.records, { factId: report.fact.id, version: report.fact.version, reportId: report.id }] };
}
export function assertUnreportedFactNotActionable(knowledge: PersonKnowledge, fact: WorldFact): void {
  if (!knowledge.records.some(r => r.factId === fact.id && r.version === fact.version)) throw new InvariantViolation('fact-not-known', [fact.id]);
}
export function inheritDocument(document: KnowledgeObject, heir: PersonId): KnowledgeObject {
  return { ...document, ownership: heir, readRights: [...new Set([...document.readRights, heir])] };
}
export function assertDocumentInheritanceIsNotSkillCopy(before: PersonKnowledge, after: PersonKnowledge): void {
  if (JSON.stringify(before.skills) !== JSON.stringify(after.skills) || JSON.stringify(before.practiceProgress) !== JSON.stringify(after.practiceProgress)) throw new InvariantViolation('document-is-not-skill');
}
