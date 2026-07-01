# 04 — THINGS RINKD NEVER DOES

> The guardrails. If a proposal violates any of these, it is wrong — no exceptions
> without a logged Decision Log reversal. This list is short on purpose. Memorize it.

## Product & experience
- **Never redesign the app from scratch.** Preserve architecture, navigation, brand.
- **Never remove functionality** to make something look cleaner.
- **Never add a feature because a competitor has it.** Build because hockey needs it.
- **Never require more than three taps** to a screen's primary action.
- **Never make a commissioner feel like they're doing office work.**
- **Never make a parent feel like they're using enterprise software.**
- **Never require a tutorial.** If the flow needs instructions, the flow is wrong.
- **Never clutter.** One primary action per screen.

## Engagement integrity
- **Never use fake urgency, fake scarcity, or dark patterns.**
- **Never auto-play video or audio.**
- **Never hide information the user needs to make a decision.**
- **Never optimize a metric at the cost of a hockey community's trust.**
- **Never prioritize ads over hockey content.**

## Safety & privacy
- **Never expose a minor's name or personal info to the public** — jersey-only on
  public youth surfaces; rosters/locations gated for youth events.
- **Never blend tournament stats into league stats.**

## Engineering (from CLAUDE.md — enforced)
- **Never add a generic spinner.** Use geometric skeletons that match the layout.
- **Never poll for real-time data.** Subscribe via Supabase Realtime; unsubscribe on
  unmount.
- **Never fetch a full list.** Cursor-paginate every list (games, chirps, stats).
- **Never ship a component without its loading, empty, AND error states.**
- **Never ship a component without stress-testing it** against a 60-char name, a
  5-sentence description, a 14–0 score, no image, and no data.
- **Never use `px` for font sizes that should scale.**
- **Never redeclare a local color palette** (`const C = {...}`) — import
  `src/lib/tokens.js`.
- **Never hand-roll a section header, empty state, or button** — use
  `src/components/ui/*`.
- **Never add an animation that doesn't communicate meaning**, and always honor
  `prefers-reduced-motion`.

## Positioning
- **Never position Rinkd as replacing SportsEngine / Crossbar / GameSheet / TeamSnap
  / LeagueApps** in any copy, UI, or partner-facing surface. We are the layer on top.
