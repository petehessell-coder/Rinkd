# SPRINT S10 — Enterprise Polish (the acquisition audit)

> Prereq: all prior sprints. Final pass. Pretend Apple (or a strategic acquirer /
> GameSheet-scale platform) is doing technical + design diligence on Rinkd.

---

Perform a final, exhaustive audit. Nothing is too small. Do not stop until every
screen meets enterprise software standards and the app is internally consistent.

### Audit dimensions (rate every screen on each)
Typography · spacing · contrast · accessibility · empty states · loading states ·
performance · touch targets · responsive layouts · search · forms · filters · error
messages · offline support · motion · visual consistency · component reuse · design
tokens · interaction consistency · performance budgets.

### The reality this sprint must close (from BUILD_PRIORITY.md)
The design system (`src/lib/tokens.js` + `src/components/ui/*`) is built and correct,
but **adoption is incomplete** — screens still redeclare local palettes, hand-roll
section headers, and use one-off empty states. This sprint is the **migration to the
system**, not a redesign:
- Every screen imports color/type/space/motion from `tokens.js` — **zero** local
  `const C = {...}` palettes remain.
- Every section header is `ui/SectionHeader`; every empty state is `ui/EmptyState`;
  every error is `ui/ErrorState`; every stat number is `ui/StatNumber`; every button
  is `ui/Button`; every skeleton is `ui/Skeleton`.
- Audit-confirm: no generic spinners; no polling; no full-list fetches; all lists
  cursor-paginated; images optimized before serving; hot paths on Edge Functions.

### Method
- Produce a **scorecard**: rows = every screen, columns = the audit dimensions,
  cells = pass / needs-work with a one-line note and the file:line.
- Fix the mechanical, low-risk migrations app-wide (tokens, SectionHeader,
  EmptyState, Button) — these are safe cross-cutting passes.
- Verify accessibility: 44×44px targets, WCAG AA contrast on the navy palette, color
  never the only state signal, keyboard support where relevant,
  `prefers-reduced-motion` disables all animation.
- Confirm the Saturday Night Test on every list and live surface.

### Deliverable
`Fable_Elevation_Program/audits/S10_enterprise_scorecard.md` (the full scorecard) +
the design-system migration PR(s). Target state: **every screen A+** against the S01
rubric. Anything still below A+ gets a named follow-up ticket.
