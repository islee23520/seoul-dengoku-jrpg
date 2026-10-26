import { CampaignSession } from './session.ts';
import type { PeaceSpeed, SessionOptions } from './session.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CommandState } from './commands.ts';
import { requireBoundary } from './errors.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { requestS01Care } from './s01Care.ts';
import { s01VisibleState } from './s01View.ts';
import { lordKnowledge } from './reports.ts';
import { submitCampaignCommand } from './commandIngress.ts';
import { advanceCampaignCommands } from './commandAdvance.ts';
export { submitCampaignCommand } from './commandIngress.ts';
export { advanceCampaignCommands } from './commandAdvance.ts';

/** Game-owned facade. The mutable state and clock remain inside CampaignSession. */
export class CampaignApplication {
  readonly #session: CampaignSession;
  readonly #content: CampaignContent;
  constructor(options: Omit<SessionOptions, 'advance'>) {
    this.#content = options.content;
    this.#session = new CampaignSession({ ...options, advance: (state, until) => advanceCampaignCommands(state, until, options.content, true) });
  }
  submit(input: unknown) {
    let receipt: CommandState['receipts'][number] | undefined;
    this.#session.command(state => { const result = submitCampaignCommand(state, input, this.#content); receipt = result.receipt; return result.state; });
    requireBoundary(receipt !== undefined, 'cross-link');
    return receipt;
  }
  /** Atomic compose-and-issue/cancel window: the draft is composed from the reconciled state inside the
   * session command, so a running clock cannot invalidate the expected revision between review and issue.
   * Every task8 boundary check still runs; callers supply identifiers only, never authority or effects. */
  submitComposed(request: { readonly kind: 'issue'; readonly operation: 'S01-L' | 'S01-O'; readonly issuerPersonId: string; readonly recipientId: string; readonly commandId: string }
    | { readonly kind: 'request-cancellation'; readonly issuerPersonId: string; readonly orderId: string; readonly commandId: string }) {
    let receipt: CommandState['receipts'][number] | undefined;
    this.#session.command(state => {
      // An existing receipt for this command id replays verbatim even while the clock runs on.
      const replay = state.commands.receipts.find(r => r.command.commandId === request.commandId);
      if (replay) { const result = submitCampaignCommand(state, replay.command, this.#content); receipt = result.receipt; return result.state; }
      const command = request.kind === 'issue'
        ? { kind: 'issue' as const, commandId: request.commandId, issuerPersonId: request.issuerPersonId, recipientId: request.recipientId,
            operation: request.operation, expectedRevision: state.revision,
            expectedCompositeVersion: composeCampaignAuthority(state, { operation: request.operation, issuerPersonId: request.issuerPersonId,
              recipientId: request.recipientId, expectedRevision: state.revision }, this.#content).compositeVersion }
        : { kind: 'request-cancellation' as const, commandId: request.commandId, issuerPersonId: request.issuerPersonId,
            orderId: request.orderId, expectedRevision: state.revision };
      const result = submitCampaignCommand(state, command, this.#content);
      receipt = result.receipt; return result.state;
    });
    requireBoundary(receipt !== undefined, 'cross-link');
    return receipt;
  }
  care(input: unknown): void { this.#session.command(state => requestS01Care(state, input, this.#content)); }
  settlement(personId: string) { return s01VisibleState(this.#session.state, personId, this.#content); }
  knowledge(input: unknown) { return lordKnowledge(this.#session.state, input); }
  view(personId: string) {
    const state = this.#session.state;
    return Object.freeze({ revision: state.revision, worldMilliseconds: state.clock.worldMilliseconds, speed: state.clock.speed,
      orders: Object.freeze(state.mandates.filter(m => m.issuerPersonId === personId).map(m => Object.freeze({ orderId: m.orderId,
        operation: m.operation, recipientId: m.recipientId,
        stage: m.stage === 'result-applied' && !state.knowledge.find(k => k.personId === personId)?.records.some(r =>
          state.reports.some(report => report.id === r.reportId && report.fact.orderId === m.orderId)) ? 'executing' : m.stage,
        receivedAt: m.receivedAt, acceptedAt: m.acceptedAt,
        cancellationPending: state.commands.executions.some(e => e.orderId === m.orderId && e.cancellation !== null && e.cancellation.receivedAt === null) }))) });
  }
  subscribe(listener: (state: CampaignState) => void): () => void { return this.#session.subscribe(listener); }
  reconcile(): void { this.#session.reconcile(); }
  setSpeed(speed: PeaceSpeed): void { this.#session.setSpeed(speed); }
  checkpoint(): CampaignState { return this.#session.checkpoint(); }
  close(): void { this.#session.close(); }
}
