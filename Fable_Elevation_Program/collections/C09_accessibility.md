# COLLECTION C09 — Accessibility

**Objective:** WCAG AA baseline (reach AAA where cheap), thumb ergonomics, and
reduced-motion safety across the whole app. This is a North Star, not a nice-to-have
(Stupid-Proof Simple applies to everyone).

**Real anchors:** the navy palette in `src/lib/tokens.js` (contrast math), the motion
system + `src/lib/motion.js` (reduced-motion), `MotionProvider`, `ui/Button` (targets),
`ui/Icon`, `SoundToggle.js`.

**Scope (audit every screen):**
- **Tap targets ≥ 44×44px** everywhere (from CLAUDE.md). Flag anything smaller.
- **Contrast:** verify text/`colors.ice` and `colors.muted` on `colors.bg`/`surface`
  meet WCAG AA; fix any that fail. Red is action/urgency only — never rely on it as
  the sole state signal.
- **Color is never the only indicator** — pair with icon + label (live, error,
  success, selected).
- **`prefers-reduced-motion`** disables all non-essential animation via the existing
  helpers — verify on the goal moment, live pulse, route transitions, onboarding
  reveal.
- **Keyboard + screen-reader** support on forms, modals, and the scorer where
  relevant; sensible focus order; alt text on meaningful images.
- **Text scaling:** no `px` font sizes that should scale (Never-Do).

**Deliverable:** `audits/C09_accessibility.md` — a per-screen a11y checklist with
pass/fail + file:line, a contrast table for the palette, and the fix PRs. **Guardrail:**
fixes must not alter the visual system — use the tokens; don't invent lighter/darker
one-offs without adding them to `tokens.js` deliberately.
