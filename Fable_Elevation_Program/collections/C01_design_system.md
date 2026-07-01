# COLLECTION C01 — Design System Adoption Audit

**Objective:** Drive the app to 100% adoption of the existing design system. This is
a **migration, not a redesign** (per BUILD_PRIORITY.md the system is built and
correct — screens just don't all use it yet).

**Source of truth:** `src/lib/tokens.js` (colors/type/space/radii/shadows/motion) +
`src/components/ui/*` (`Button`, `Card`, `SectionHeader`, `EmptyState`, `ErrorState`,
`Skeleton`, `StatNumber`, `Tag`, `Img`, `Icon`, `BounceNumber`, `MotionProvider`,
`RouteTransition`, `ToastHost`).

**Scope (300+ instances across ~47 screens):**
- Find every local `const C = {...}` / hard-coded hex / inline font-family and
  replace with a `tokens.js` import. Zero local palettes should remain.
- Replace every hand-rolled section header with `ui/SectionHeader`; every one-off
  empty/error/loading block with `ui/EmptyState` / `ui/ErrorState` / `ui/Skeleton`;
  every raw stat with `ui/StatNumber`; every `<button>` with `ui/Button`.
- Catalog any component that SHOULD exist in `ui/` but is duplicated across pages —
  promote it into the library once, then reuse.

**Method:** grep for `#`, `const C =`, `fontFamily`, `<button`, "No results"/empty-
state strings, and spinner usages; produce a table (file → violation → replacement).
Ship safe cross-cutting passes first (tokens, SectionHeader, EmptyState, Button).

**Deliverable:** `audits/C01_design_system_adoption.md` (the violation table + %
adoption before/after) and the migration PRs. **Guardrail:** pure migration — no new
tokens, no visual redesign, behavior unchanged. Stress-test each migrated screen.
