# SPRINT S09 — Micro-interactions & Motion Physics

> Prereq: master prompt + S02 audit. Everything must feel responsive, premium,
> purposeful — using the motion vocabulary that already exists in `tokens.js`.

---

List every interaction in Rinkd and identify every opportunity to improve delight —
using ONLY the existing motion system. Do not invent new durations or easings; the
vocabulary is already defined.

### The existing motion vocabulary (from `src/lib/tokens.js` — use these, don't add)
- Durations (ms): `press` 100 · `exit` 200 · `tab` 200 · `score` 200 ·
  `entrance` 250 · `pulseStep` 300 · `sheet` 350 · `numberChange` 400 ·
  `reveal` 560 (one-time) · `pulse` 1500 (infinite live ring).
- Easings: `out` (entrances) · `in` (exits) · `inOut` (tab indicator) ·
  `puck` (goal — hard hit + overshoot) · `sheet` (slide up).
- Runtime reduced-motion helpers live in `src/lib/motion.js` / `MotionProvider` /
  `RouteTransition`. Every animation must degrade via these.

### Inventory every interaction and specify its motion
Buttons (`ui/Button.js` — press scale(0.97) @ `press`) · cards (tap → open, hover
lift `shadows.hover`) · lists · tabs (indicator slide @ `tab`/`inOut`) · loading
(skeletons, never spinners) · scrolling · pull-to-refresh (`PullToRefresh.js`) ·
notifications · messages · likes/reactions (optimistic + `BounceNumber`) · comments
· uploads (`RosterUpload.js`, image) · sheets/modals (slide @ `sheet`) · route
transitions (`RouteTransition.js`) · number changes (`BounceNumber` @ `numberChange`)
· the goal moment (`score` + `puck`).

For each, specify: **duration · easing · physics · haptic (`lib/haptics.js`) ·
sound (`lib/sound.js`, opt-in) · accessibility (reduced-motion behavior)**. Flag any
interaction that currently has *no* feedback, or feedback that's slower than its
token allows.

### Guardrails
- Every animation communicates meaning. If you can't say what a motion *tells* the
  user, remove it. (Never-Do.)
- 60fps target; nothing janky; nothing that delays the primary action.
- All four button states everywhere: resting / active / loading / success-or-error.

### Deliverable
`Fable_Elevation_Program/audits/S09_micro_interactions.md` — the full interaction
inventory table (interaction → tokens → haptic/sound → reduced-motion) + a punch
list of missing/laggy feedback. Ship the button/card/reaction/refresh polish as a
scoped PR that adds no new tokens.
