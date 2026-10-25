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

## Scenario opening (Unity UI port, task22 wave 1)

Tokens: `unity-theme.css` copies the Unity source `Data/Ui/Source/ui-tokens.json`
(Dark and Light themes, type display72/h1 32/h2 24/h3 20/body18/label16/caption14,
space 4-80, radii, elevations, button/menu/candidate/panel/key-cap components,
48px header, 303px docks at 1280x720, margin16/gutter12). Fonts are the Unity
NotoSansKR Regular/Medium/Bold OTFs under SIL OFL 1.1 (`fonts/LICENSE.txt`,
copied to output as `fonts/NotoSansKR-OFL.txt`). Selection follows Unity
color.focus: menu left bar, 2px candidate frame, separate keyboard focus outline,
confirmation opens with Cancel focused.

Layout: title - fullscreen canvas -> centred mark/subtitle/entry between two rules at Unity centre offsets; scroll owner: none; anti-patterns: host-document article as title.
Layout: menu - centred modal panel -> heading, New Game, disabled continue/settings/quit/account, Back; scroll owner: none; anti-patterns: enabling placeholders.
Layout: selection - 48px header + 303px left candidate dock + centre stage + 303px right detail dock at 1280x720; scroll owners: candidate list and detail bio, no document scroll; anti-patterns: radio rows, clipped action footer, fake campaign map. Below 760px the docks stack and the document scrolls (390 is a new candidate, not Unity parity).

Primary action: title any key/click -> 새 게임 -> 이 인물로 시작한다 -> 시작한다.
Priorities: selected person, actual start placement, start action. Required
content: K002 이서담, K568 백산석, K616 성달현; title and place; map, tile,
facing, liege; source/status distinction; after start, each missing input and
affected action. Left out: portraits, campaign map, faction filters, search and
biography (no approved web data); fabricated stats.
Runtime uses named occupancy labels; appearance remains unapproved, so no
TESTINPUT sprite becomes a person. The post-start world view is token-styled
but not a Unity-ported surface.

Accessibility: native landmarks/links, explicit preview limitations, readable
wrapping, keyboard operation. Existing runtime accessibility/mobile limitations
are inherited, not silently represented as new approval. No new game rules.
