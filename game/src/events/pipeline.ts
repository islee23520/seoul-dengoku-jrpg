import type { Character } from '../domain/character.ts';
import type { EventDefinition, Predicate, SwitchEffect } from './definition.ts';
import { assertNever, completionSwitch, EventDataError } from './definition.ts';

/** Trait presence only: effect formulas remain owned by the character domain. */
export type EventContext = {
  readonly actor: Pick<Character, 'traits'>;
  readonly switches: Readonly<Record<string, boolean>>;
};

/** Supported engine Command subset (events.ts); no new engine command kinds. */
export type EventCommand =
  | SwitchEffect
  | { readonly kind: 'changeFace'; readonly resourceId: string; readonly position: 'left'; readonly flipHorizontally: false }
  | { readonly kind: 'text'; readonly speaker: string; readonly body: string }
  | { readonly kind: 'choices'; readonly prompt: string; readonly cancelBehavior: 'disallow'; readonly options: readonly { readonly text: string; readonly branch: readonly EventCommand[] }[] }
  | { readonly kind: 'fork'; readonly condition: { readonly kind: 'switch'; readonly switchId: string; readonly value: boolean }; readonly then: readonly EventCommand[] };

export function matches(condition: Predicate, context: EventContext): boolean {
  switch (condition.kind) {
    case 'trait': return context.actor.traits.some(trait => trait.name === condition.trait) === condition.present;
    case 'switch': return (context.switches[condition.switchId] ?? false) === condition.value;
    default: return assertNever(condition);
  }
}

function available(event: EventDefinition, context: EventContext): boolean {
  return !(event.once && context.switches[completionSwitch(event)])
    && event.trigger.every(condition => matches(condition, context));
}

function branch(event: EventDefinition, effects: readonly SwitchEffect[]): readonly SwitchEffect[] {
  return event.once
    ? [...effects, { kind: 'setSwitch', switchId: completionSwitch(event), value: true }]
    : effects;
}

/** Snapshot prepared before rendering; opening or abandoning a modal consumes nothing. */
export function prepareEvent(event: EventDefinition, context: EventContext) {
  if (!available(event, context)) return null;
  const options = event.options.filter(option => option.requires.every(condition => matches(condition, context)));
  let commands: readonly EventCommand[] = [
    { kind: 'changeFace', resourceId: event.portrait.resourceId, position: 'left', flipHorizontally: false },
    { kind: 'text', speaker: event.speaker, body: `${event.title}\n${event.body}\n${event.stakes}` },
    { kind: 'choices', prompt: event.stakes, cancelBehavior: 'disallow', options: options.map(option => ({
      text: option.text, branch: branch(event, option.effects),
    })) },
  ];
  // Switch guards also protect queued engine commands against repeat execution.
  for (const condition of event.trigger) {
    switch (condition.kind) {
      case 'switch': commands = [{ kind: 'fork', condition, then: commands }]; break;
      case 'trait': break; // Evaluated from the explicit actor snapshot above.
      default: assertNever(condition);
    }
  }
  if (event.once) commands = [{ kind: 'fork', condition: {
    kind: 'switch', switchId: completionSwitch(event), value: false,
  }, then: commands }];
  return { eventId: event.id, portrait: event.portrait, stakes: event.stakes, options, commands };
}

/** Resolve against current state, not a stale option index from an open modal. */
export function chooseEvent(event: EventDefinition, optionId: string, context: EventContext) {
  if (!available(event, context)) throw new EventDataError(`event unavailable: ${event.id}`);
  const option = event.options.find(candidate => candidate.id === optionId);
  if (!option || !option.requires.every(condition => matches(condition, context))) {
    throw new EventDataError(`option unavailable: ${optionId}`);
  }
  const commands = branch(event, option.effects);
  const switches = { ...context.switches };
  for (const command of commands) switches[command.switchId] = command.value;
  return { commands, switches };
}
