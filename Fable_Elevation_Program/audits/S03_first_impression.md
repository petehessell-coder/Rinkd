# S03 — First Impression: Audit + Change Plan

*July 1, 2026. Line-by-line read of Landing.js (233), Home.js (913), Auth.js (603),
OnboardingModal.js (437), Skeletons.js / ui/Skeleton.js — post-C01, so everything
is already on tokens. Track A: this audit IS the spec; Gate 1 = Pete approves below.*

## Honest baseline
These surfaces are **already B+/A−**, not broken: Home is the Jun-30 broadcast
rebuild (ticker, live hero, tile board, real skeleton, Realtime), Landing has the
arena-photo hero + single red CTA, Onboarding has the locker→tunnel cinematic with
a proper geometric skeleton, ui/Skeleton is manifesto-correct. S03 is a **polish
delta**. No spinners exist anywhere in scope. No nav/data changes proposed.

## Findings → changes (all token-vocabulary only)

### A. Landing.js — the cold open
- **A1 (motion).** Zero entrance motion — the splash pops in. Add a one-time staged
  entrance (logo → headline → CTA, `motion.duration.entrance` + `easing.out`,
  ~60ms stagger), fully disabled under `prefers-reduced-motion`.
- **A2 (stress).** Headline is fixed `fontSize: 64` — "WHERE HOCKEY" measures
  ~317px at 64px condensed; it clips on a 320px iPhone SE. Fix:
  `clamp(44px, 16vw, 64px)`.
- **A3 (interaction).** The red CTA has no press state. Add manifesto press physics
  (scale 0.97, shadow collapse) — shared with Home's `.home-tap` pattern.
- **A4 (content — needs sign-off).** The stat bar is industry vanity stats
  ("1.18M+ NA Players · 23M+ NHL Tickets"). Pete already replaced the same vanity
  stats on the Auth hero with the 8-item feature grid (Jun 27). Proposal: replace
  the Landing stat bar with a compact 2×2 feature-chip grid (Live scoring ·
  Schedules & RSVP · Team pages · Stats & leaderboards) so the splash sells what
  the app DOES. **Decision D-S03-1.**

### B. Auth.js — the form
- **B1 (manifesto compliance — needs sign-off).** All primary submit buttons are
  10px rounded rects with no glow. Manifesto: buttons are **pill (999)** with the
  red-glow shadow + press collapse. Convert the 3 submit buttons (+ the small
  mode-switch CTAs keep their text style). **Decision D-S03-2.**
- **B2 (interaction).** Add press state to submit buttons; keep the existing
  loading text swaps ('Signing In…' — contextual copy, allowed).
- No skeleton needed — the form paints instantly. Leave Turnstile, COPPA,
  check-email flows untouched (correctness-critical, out of S03's emotional layer).

### C. Home.js — Home Ice
- **C1 (perceived speed).** `HomeSkeleton` blocks don't match the real layout
  (hero renders ~212px tall incl. footer bar; skeleton is 150; no SectionHeader
  stubs, no ticker strip). Rebuild the skeleton to mirror the true first fold —
  zero layout shift on hydrate.
- **C2 (motion).** Hydrated content pops in. Add a one-time staged section
  entrance (fade + translateY(-8px), `entrance`/`easing.out`), reduced-motion
  gated. First paint of Featured stays eager — motion never delays content.
- **C3 (cleanup).** `DatePill` (line 838) is dead code — delete.
- PickYourTeam (new-user branch) already reads as an invitation with a demo-league
  tour link — leaving as-is (honest call: rewriting it is churn, not elevation).

### D. OnboardingModal.js — first run
- **D1 (motion).** The locker-room card mounts with no entrance. Add the ice-rise
  entrance (fade + rise, `entrance` duration; the 560ms `reveal` stays reserved
  for the feed rise after the tunnel) + a 200ms step-change crossfade. Both
  reduced-motion gated. The tunnel itself is untouched.
- **D2 (D1-token application).** `#fff` on primary buttons in files being touched
  → `colors.onAccent` (approved D1 boundary; opportunistic, zero visual change).

### E. Skeletons — no changes
`ui/Skeleton` + `Skeletons.js` are manifesto-correct (shimmer, reduced-motion
fallback, geometric). Home's local `.home-sk` visual is equivalent; converging it
to ui/Skeleton is churn with no user-visible gain — skipped.

## Decisions for Gate 1
- **D-S03-1:** Landing stat bar → feature-chip grid (mirrors Pete's Jun-27 Auth
  call)? Or keep vanity stats?
- **D-S03-2:** Auth submit buttons → manifesto pill + red glow? (Visible change on
  a shipped form.)
- Everything else (A1–A3, B2, C1–C3, D1–D2) is motion/stress/skeleton polish with
  no content or behavior change.

## QA plan (stage 3)
Stress data on Landing (320px viewport, 60-char event names in Home tiles),
reduced-motion audit on every added animation, skeleton-vs-hydrated layout diff,
build + bundle check. No route, nav, or query changes to verify.
