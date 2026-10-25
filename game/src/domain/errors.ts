export class InvariantViolation extends Error {
  readonly code: string;
  readonly facts: readonly string[];
  constructor(code: string, facts: readonly string[] = []) {
    super(code); this.name = 'InvariantViolation'; this.code = code; this.facts = facts;
  }
}
export class MissingRuleInput extends Error {
  readonly ruleKey: string;
  constructor(ruleKey: string) { super(ruleKey); this.name = 'MissingRuleInput'; this.ruleKey = ruleKey; }
}
export class LedgerConflict extends Error {
  readonly resultId: string;
  constructor(resultId: string) { super(resultId); this.name = 'LedgerConflict'; this.resultId = resultId; }
}
export class VersionMismatch extends Error {
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super('version-mismatch'); this.name = 'VersionMismatch'; this.expected = expected; this.actual = actual;
  }
}
export class CheckpointCorrupt extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.name = 'CheckpointCorrupt'; this.reason = reason; }
}
export function assertNever(value: never): never { throw new InvariantViolation('unknown-variant', [String(value)]); }
export function requireCause(cause: string): void {
  if (!cause.trim()) throw new InvariantViolation('missing-cause');
}
