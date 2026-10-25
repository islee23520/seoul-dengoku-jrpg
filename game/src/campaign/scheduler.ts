import { orderCausalEvents } from './commands.ts';
import { requireBoundary } from './errors.ts';
import type { CampaignState } from './stateSchemas.ts';
import type { CampaignContent } from './content.ts';
import { parseCampaignState } from './state.ts';

export type CausalBoundaryEvent = {
  readonly id: string; readonly at: number; readonly phase: 0 | 1 | 2 | 3 | 4 | 5;
  readonly predecessorId: string | null; readonly acceptanceSequence: number;
  /** A game-owned handler, never a UI command payload. */
  readonly apply: (state: CampaignState) => CampaignState;
};

/** Task 9/10 handlers share this atomic six-phase boundary, including arrivals at a cutoff. */
export function settleCampaignBoundary(state: CampaignState, events: readonly CausalBoundaryEvent[], content: CampaignContent): CampaignState {
  requireBoundary(events.every(e => e.at === state.clock.worldMilliseconds), 'event-order');
  const ordered = orderCausalEvents(events, state.commands.events.map(e => e.id));
  let next = state;
  for (const event of ordered) next = event.apply(next);
  // No externally visible or saveable half-effect. A failure leaves the original untouched.
  return parseCampaignState(next, content);
}
