# SPRINT S04 — Navigation (reduce cognitive load)

> Prereq: master prompt + S02 audit. Audit-first; changes must respect the
> already-decided nav model (see Decision Log). **No new nav paradigms.**

---

Audit navigation using Apple's usability principles. Reduce cognitive load, reduce
unnecessary decisions, surface the most important actions first, hide complexity
until needed. A first-time parent should understand every screen within seconds.

### Ground truth (do NOT re-litigate these — they're in the Decision Log)
- Nav is a **single shared array**: `src/components/Layout.js` `NAV` drives BOTH the
  desktop sidebar and the mobile bottom bar. Current primary items: **Home Ice ·
  Teams · Notifications · Profile · More**. "Home Ice" → "Home" on mobile.
- The global chirp feed lives under **More → Discover** (`/feed` / `/discover`),
  intentionally demoted. Do not re-promote it to primary nav.
- Secondary/overflow items live in `src/components/MoreDrawer.js`. Pins live in
  `src/components/NavPins.js`.

### Task
For **every** navigation surface (bottom bar, desktop sidebar, More drawer, in-page
tabs like the League/Tournament tab bars, back behavior, deep links) provide:
- **Current problems** — cite the real file/line.
- **Recommended improvement** — within the existing paradigm.
- **Reasoning** — tied to a North Star or the Grandparent Test.
- **Expected impact** — on friction, discoverability, or operator on-ramp.

### Specific things to pressure-test
- Is the **operator on-ramp** obvious? A commissioner landing cold should find
  "create / manage a league or tournament" without hunting through More.
- Are **in-page tabs** (League has feed/schedule/standings/stats tabs; Tournament
  similar) consistent, labeled, and thumb-reachable?
- Does **back / swipe-back** behave the same everywhere? (Intuitively Familiar.)
- Are the 5 bottom-bar targets each ≥44×44px with label + icon (color never the
  only signal)?
- Does the **More drawer** hide complexity gracefully, or bury things people need?

### Deliverable
`Fable_Elevation_Program/audits/S04_navigation.md` with the four-field analysis per
surface + a prioritized change list. Only implement changes that are unambiguous
wins and consistent with the Decision Log; log any nav change you make.
