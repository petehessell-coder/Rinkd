# COLLECTION C07 — Information Architecture

**Objective:** Navigation, search, discoverability, and progressive disclosure that a
first-time parent understands in seconds. Extends S04 into the full IA.

**Real surfaces & files:** `Layout.js` (`NAV`), `MoreDrawer.js`, `NavPins.js` +
`lib/navPins.js`, `PinToNavButton.js`, in-page tab bars in `League.js`/`Tournament.js`,
global search entry on `Home.js`, `Discover.js`, back/deep-link behavior,
`RouteAnalytics.js`.

**Scope:**
- **Search:** one persistent search that finds any team / league / tournament /
  player / event — the navigation guarantee. Audit it for speed, ranking, and
  zero-result states.
- **Progressive disclosure:** primary actions up front; complexity hidden in More /
  manage views until needed. Nothing important buried; nothing trivial promoted.
- **NavPins:** confirm the multi-pin need (multi-kid parent pins several teams/events)
  — `lib/navPins.js` is still the one-pin-per-type version; scope the multi-pin
  upgrade if it earns its place.
- **Consistency:** in-page tabs, back behavior, and deep links behave identically
  across League, Tournament, Team, Profile.

**Deliverable:** `audits/C07_information_architecture.md` — the IA map (what lives
where and why), the search audit, and a progressive-disclosure checklist per surface.
**Guardrail:** no new nav paradigms; honor the Decision Log (feed demoted, Home Ice
default).
