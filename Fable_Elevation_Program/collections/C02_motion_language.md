# COLLECTION C02 — Animation & Motion Language

**Objective:** One coherent, purposeful motion language across the whole app — every
transition, easing, duration, gesture, and haptic drawn from the existing system.

**Source of truth:** `motion.duration` + `motion.easing` in `src/lib/tokens.js`;
runtime reduced-motion helpers in `src/lib/motion.js`; `MotionProvider`,
`RouteTransition`, `BounceNumber`, `ui/Skeleton`; `lib/haptics.js`, `lib/sound.js`.

**Scope:**
- Standardize entrances (`entrance`/`out`), exits (`exit`/`in`), tab slides
  (`tab`/`inOut`), sheets (`sheet`), number changes (`numberChange`), the goal
  moment (`score`/`puck`), the live pulse (`pulse`), and the one-time onboarding
  reveal (`reveal`). No screen should use an ad-hoc duration or easing.
- Define the gesture set: pull-to-refresh, swipe-back, tap-to-open, long-press
  menus — consistent everywhere (Intuitively Familiar).
- Define the haptic + sound map: which events fire a haptic, which fire a sound
  (all sound opt-in via `SoundToggle.js`).
- Guarantee `prefers-reduced-motion` disables ALL non-essential motion via the
  existing helpers.

**Deliverable:** `audits/C02_motion_language.md` — a single reference table
(event → duration → easing → haptic → sound → reduced-motion fallback) + PRs that
bring stragglers onto the system. **Guardrail:** add zero new tokens; motion must
communicate meaning or be removed; 60fps.
