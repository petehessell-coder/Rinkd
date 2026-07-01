# SPRINT S03 — First Impression ("This feels expensive")

> Prereq: master prompt + S02 audit. This sprint MAY change code, but only the
> emotional/polish layer — NOT navigation or functionality.

---

Become obsessed with first impressions. Redesign the *emotional* experience of
opening Rinkd. **Do NOT change navigation. Do NOT change functionality.** The goal:
a user says **"this feels expensive"** before they've done anything.

### Surfaces in scope (real files)
- `src/pages/Landing.js` (signed-out) and `src/pages/Home.js` (Home Ice — the
  signed-in front door, an event-centric tile board with the Featured hero at top).
- `src/components/OnboardingModal.js` (first-run reveal — note the one-time
  `motion.duration.reveal` "ice-rise" is already defined in `tokens.js`).
- `src/components/Skeletons.js` and `src/components/ui/Skeleton.js` (loading).
- `src/pages/Auth.js` (sign-in/up).

### Elevate (using ONLY the existing token vocabulary in `src/lib/tokens.js`)
- **Loading states:** replace any generic spinner with a **geometric skeleton** that
  matches the exact final layout (no layout shift on hydrate). Loading copy from the
  brand: "Getting the ice ready." / "Warming up." / "Dropping the puck." Never
  "Loading…".
- **Perceived speed:** skeleton → async load → hydrate. Reserve space with aspect
  ratios. The Featured hero and first tiles must paint instantly.
- **Motion & micro-interaction:** entrances use `motion.duration.entrance` +
  `motion.easing.out`; nothing decorative; everything honors `prefers-reduced-motion`
  via the existing `./motion` helpers / `MotionProvider`.
- **Hero content, spacing, typography, imagery:** make the Featured hero and the
  first fold feel broadcast-grade using `type.hero`, the 4px `space` grid, and the
  brand palette (navy ground, blue accent, red for live only).
- **Home personalization:** the persona branches (family/fan · operator · new user)
  should each feel considered and never empty — new users get an inviting first fold,
  not a dead zone.

### Guardrails
- Import from `tokens.js` and reuse `components/ui/*`. Do not introduce new colors,
  new fonts, or new easings.
- Every change ships with loading/empty/error states and passes the stress data.
- Do not touch the `NAV` array, routes, or any data model.

### Deliverable
A short PR (or a precise change plan if running audit-only) touching only the files
above, plus a note in `Fable_Elevation_Program/audits/` describing before/after
perceived quality and any Decision Log entries needed.
