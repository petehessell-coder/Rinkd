# COLLECTION C10 — Visual Design System (the polish bible in practice)

**Objective:** Every visual detail — typography, spacing, cards, elevation,
iconography, empty/loading states — is consistent, premium, and on-token. Pairs with
C01 (adoption) but focuses on the *craft* of the visuals themselves.

**Source of truth:** `DESIGN_MANIFESTO.md` (visual language) + `src/lib/tokens.js`
(`type`, `space`, `radii`, `shadows`) + `src/components/ui/*`.

**Scope:**
- **Typography:** Barlow Condensed (display: heroes, section heads, stats — italic,
  900) vs Barlow (body/labels/meta). Numbers/stats ALWAYS `type.stat` with tabular
  figures so columns don't jitter. Audit for off-system type.
- **Spacing:** the 4px grid (`space.xs…xxl`). Flag arbitrary margins/paddings.
- **Cards & elevation:** `radii.card` (12) / `radii.hero` (4, sharp = hockey) /
  `radii.button` (999 pill); `shadows.resting/hover/heroRed/heroBlue/live`. Elevation
  should mean something (live > featured > standard).
- **Iconography:** consistent set via `ui/Icon`; labels beat icons for important
  actions.
- **Empty & loading states:** every empty state is an invitation (brand copy), every
  loader is a geometric skeleton matching final layout — catalog and standardize.
- **Color intent:** red = action/urgency/live ONLY; gold = milestones/awards ONLY
  (scarce); blue = elevated accents; navy = ground. Flag any misuse.

**Deliverable:** `audits/C10_visual_system.md` — a craft scorecard (type / spacing /
elevation / icon / empty / loading / color-intent) per surface + the fix PRs. Every
empty and loading state in the app catalogued and on-system.
