import { orderCausalEvents } from './commands.ts';
import { requireBoundary } from './errors.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { parseCampaignState } from './state.ts';
import { summaryHash } from '../domain/eventLedger.ts';
import { integer } from '../domain/ids.ts';

export type CausalBoundaryEvent = {
  readonly id: string; readonly at: number; readonly phase: 0 | 1 | 2 | 3 | 4 | 5;
  readonly predecessorId: string | null; readonly acceptanceSequence: number;
  /** A game-owned handler, never a UI command payload. */
  readonly apply: (state: CampaignState) => CampaignState;
};

/** Task 9/10 handlers share this atomic six-phase boundary, including arrivals at a cutoff. */
export function settleCampaignBoundary(state: CampaignState, events: readonly CausalBoundaryEvent[], content: CampaignContent): CampaignState {
  requireBoundary(new Set(events.map(e => e.id)).size === events.length, 'duplicate-id');
  const pending = events.filter(event => {
    const { apply: _apply, ...identity } = event;
    const previous = state.commands.handlers.find(h => h.id === event.id);
    if (!previous) return true;
    requireBoundary(summaryHash(previous) === summaryHash(identity), 'command-conflict');
    return false;
  });
  requireBoundary(pending.every(e => e.at === state.clock.worldMilliseconds), 'event-order');
  const ordered = orderCausalEvents(pending, [...state.commands.events, ...state.commands.handlers].map(e => e.id));
  let next = state;
  for (const event of ordered) {
    const { apply, ...identity } = event;
    next = apply(next);
    next = { ...next, commands: { ...next.commands, handlers: [...next.commands.handlers, { ...identity, at: integer('WorldMilliseconds', identity.at) }] } };
  }
  // No externally visible or saveable half-effect. A failure leaves the original untouched.
  return parseCampaignState(next, content);
}
