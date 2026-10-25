# Web player host

The host preserves the existing OPRN runtime rather than reskinning it.
Public entry is a separate map-preview consent screen, never production start.

Tokens: night #05070c, ink #e9ecf3, secondary #b6bece from runtime dark
tokens; neutral hairline rgba(255,255,255,.17). System sans text, monospace
eyebrow, body 17px, heading clamp(28px,5vw,48px). Spacing 8/16/24/32px.
Reading measure 48rem, page inset 24px, minimum target 44px.

Primitives: document main, eyebrow, heading, explanatory paragraph, primary
navigation link, native details credits. Focus-visible uses ink outline;
links underline on hover. No animation, card stripes, or decorative imagery.
One document scroll owner; runtime owns its existing viewport separately.
System light/dark does not change the deliberately dark game canvas.

## Scenario opening

Layout: title/select/start - ordered opening steps -> stack (https://github.com/changeroa/StyleGallery/blob/main/patterns/stacking/stack.md); scroll owner: document; anti-patterns: no nested scrollers or visual reordering.

Primary action: 시작하기, then 선택한 인물로 시작. Priorities: scene title,
approved actor placement, blocked actions. Required content: K002 이서담,
K568 백산석, K616 성달현; placement and facing; source/status distinction;
each missing input and affected action. Left out: portraits and fabricated stats.
Scenario tokens extend the host: surface #0B111C, panel #141C2A, ink #E6EAF0,
secondary #9AA6B2, brass rule #896B43A6, brass ink #C9A227.
Title uses centered type with double horizontal brass rules. Selection uses
native radios and one submit button. Runtime uses named occupancy labels;
appearance remains unapproved, so no TESTINPUT sprite becomes a person.

Accessibility: native landmarks/links, explicit preview limitations, readable
wrapping, keyboard operation. Existing runtime accessibility/mobile limitations
are inherited, not silently represented as new approval. No new game rules.
