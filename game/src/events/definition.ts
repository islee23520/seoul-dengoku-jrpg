import { z } from '../../../engine/node_modules/zod/index.js';

const ref = z.string().trim().min(1);
const predicate = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('trait'), trait: ref, present: z.boolean() }).readonly(),
  z.strictObject({ kind: z.literal('switch'), switchId: ref, value: z.boolean() }).readonly(),
]);
const effect = z.strictObject({
  kind: z.literal('setSwitch'), switchId: ref, value: z.boolean(),
}).readonly();
const schema = z.strictObject({
  id: ref,
  provenance: z.literal('TESTINPUT'),
  title: ref,
  speaker: ref,
  body: ref,
  stakes: ref,
  portrait: z.strictObject({ resourceId: ref }).readonly(),
  traits: z.array(ref).readonly(),
  trigger: z.array(predicate).readonly(),
  once: z.boolean(),
  options: z.array(z.strictObject({
    id: ref, text: ref, requires: z.array(predicate).readonly(),
    effects: z.array(effect).min(1).readonly(),
  }).readonly()).min(1).readonly(),
}).readonly();

export type EventDefinition = z.infer<typeof schema>;
export type Predicate = z.infer<typeof predicate>;
export type SwitchEffect = z.infer<typeof effect>;

export class EventDataError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`Invalid event: ${detail}`);
    this.name = 'EventDataError';
    this.detail = detail;
  }
}

export function completionSwitch(event: EventDefinition): string {
  return `event:${event.id}:completed`;
}

/** Parse the entire JSON boundary, including hidden branches, before presentation. */
export function loadEvent(input: unknown, knownTraits: ReadonlySet<string>): EventDefinition {
  const result = schema.safeParse(input);
  if (!result.success) throw new EventDataError(result.error.message);
  const event = result.data;
  const declared = new Set(event.traits);
  if (declared.size !== event.traits.length) throw new EventDataError('duplicate trait reference');
  for (const trait of declared) {
    if (!knownTraits.has(trait)) throw new EventDataError(`unknown trait reference: ${trait}`);
  }
  for (const condition of [...event.trigger, ...event.options.flatMap(option => option.requires)]) {
    switch (condition.kind) {
      case 'trait':
        if (!declared.has(condition.trait)) throw new EventDataError(`missing trait reference: ${condition.trait}`);
        break;
      case 'switch': break;
      default: assertNever(condition);
    }
  }
  if (new Set(event.options.map(option => option.id)).size !== event.options.length) {
    throw new EventDataError('duplicate option id');
  }
  if (!event.options.some(option => option.requires.length === 0)) {
    throw new EventDataError('unconditional fallback option required');
  }
  if (event.options.some(option => option.effects.some(command => command.switchId === completionSwitch(event)))) {
    throw new EventDataError('completion switch is reserved');
  }
  return event;
}

export function assertNever(value: never): never {
  throw new EventDataError(`unsupported variant: ${String(value)}`);
}
