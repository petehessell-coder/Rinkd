# S04 — Navigation Audit + Prioritized Changes

*July 1, 2026. Line-by-line: Layout.js (NAV/back/bottom bar), MoreDrawer.js,
NavPins.js, League.js + Tournament.js tab strips, back behavior, deep links.
Ground truth honored: 5-item NAV array, chirp feed stays demoted, no new
paradigms. NAV-PIN-3 multi-pin is a separate P2 — not touched here.*

## Verdict up front
The nav model is fundamentally sound — one shared `NAV` array, complexity-diet
More drawer, consistent back logic, 44px tab targets already in place. S04 finds
**no structural problems**. What's below is friction polish + one real gap
(deep-linkable tabs) + one strategic recommendation (cold-operator on-ramp).

---

## Surface 1 — Bottom bar + desktop sidebar (`Layout.js`)
- **Problems:**
  1. The More item renders a text glyph `⋯` (`Layout.js:157`) while the other
     four items render lucide icons — inconsistent weight/baseline on the bar.
  2. `BellBadge` red dot + count is good (shape+number, not color-only) ✓.
  3. Tap targets ~50×45px ✓. Labels always present ✓. Active = red dot + weight
     (not color-only) ✓.
- **Improvement:** render `MoreHorizontal` (already imported) through the same
  `NavIcon` path as the other items.
- **Reasoning:** Intuitively Familiar — five items should read as one family.
- **Impact:** small visual-coherence lift on the most-seen surface in the app.

## Surface 2 — Back behavior (`Layout.js:69-110`)
- **Problems:** none functional. `TOP_LEVEL_PATHS` is correct (secondary
  surfaces like /discover//leagues correctly get Back); history-empty fallback
  → /home ✓; mobile top-bar vs desktop back-row dedupe ✓.
- **Note for the drift pass (not S04):** `BackButton` hover uses
  `B.border + '66'` — valid today because Layout's local `B.border` is solid
  hex, but it's the same concat pattern that broke NavPins in C01. When
  Layout/MoreDrawer's drifted `#112236`/`#1E3A5C` converge to tokens, this
  line must change with them.

## Surface 3 — More drawer (`MoreDrawer.js`)
- **Problems:**
  1. **No entrance motion** — the sheet appears instantly. The manifesto
     defines exactly this motion ("Sheet slide up: translateY(100%)→0, 350ms")
     and the token exists (`motion.duration.sheet`, `easing.sheet`).
  2. **Close button tap target ~32px** (`padding: 4`) — below the 44px floor.
  3. Organization is good: Explore(9)/Manage(role)/Admin(staff)/Account —
     complexity hidden gracefully, nothing users need daily is buried
     (Messages+Notifications live in the mobile top bar).
  4. Minor, note only: no focus trap while open (Escape + overlay-click work).
- **Improvement:** manifesto sheet slide-up + backdrop fade (reduced-motion
  gated); close button to 44px.
- **Reasoning:** motion-has-meaning (a sheet that *slides* reads as dismissible
  — Intuitively Familiar); 44px is a Never-Do floor.
- **Impact:** the drawer stops feeling like a page-swap and starts feeling like
  an overlay you can flick away; a11y floor met.

## Surface 4 — In-page tabs (League.js:672-686 · Tournament.js:640-656)
- **Problems:**
  1. **Tabs aren't deep-linkable** — `activeTab` is plain `useState`
     (League.js:240, Tournament.js:127). "Check the standings" can't be
     shared; refresh loses the tab; a commissioner texting parents a stats
     link can't. This is the one real navigation gap S04 found.
  2. Tab order differs (League leads Schedule; Tournament leads Standings) —
     **intentional** (a tournament weekend is standings-centric; a league week
     is schedule-centric). Not a defect; do not unify.
  3. Strip itself: 44px min-height ✓, underline+color active state ✓,
     horizontal scroll works but has no edge-fade affordance on narrow phones
     (7 tabs > 375px). Recommend-only: needs a scroll-aware fade to avoid
     decorating when not scrollable.
- **Improvement:** sync tab to `?tab=` — read on mount (validated against
  TABS, fall back to default), `replaceState` on change (no history spam, back
  button still leaves the page in one tap — Grandparent Test preserved).
- **Reasoning:** Shareable & Sticky — a link that lands exactly where the
  sender meant is the cheapest growth loop in the app.
- **Impact:** every league/tournament tab becomes a shareable destination;
  refresh keeps context. Zero visual change.

## Surface 5 — NavPins (`NavPins.js`)
- **Problems:** none in scope. Explicit pins, fail-soft load, both variants
  render clean. Multi-pin (NAV-PIN-3) stays parked per BUILD_PRIORITY.
- **Improvement:** none this sprint.

## Surface 6 — Operator on-ramp (pressure test)
- **Finding:** a commissioner who ALREADY runs something gets a great ramp
  (Home OperatorBar above Featured + More→Manage). A **cold** operator (no
  events yet → `useUserRole` ≠ commissioner) sees no operator surface on Home;
  their path is More → Leagues/Tournaments → create, or /pricing. That's
  2–3 taps of hunting for the persona that scales the business.
- **Recommendation (needs Pete — not an unambiguous win):** one "Run your
  league or tournament" row at the bottom of More→Explore, visible to
  everyone. One row, no new paradigm, no Home clutter. Counter-argument:
  parents-first priority says don't spend drawer real estate on the rarest
  persona; /pricing already exists for the funnel. **Decision D-S04-2.**

---

## Prioritized change list
| # | Change | Class |
|---|---|---|
| 1 | League+Tournament tabs → `?tab=` deep links (replaceState) | unambiguous win |
| 2 | MoreDrawer manifesto sheet motion + 44px close | unambiguous win |
| 3 | More nav item → real icon via NavIcon | unambiguous win |
| 4 | "Run your league or tournament" drawer row | **D-S04-2, Pete's call** |
| 5 | Tab-strip scroll edge-fade | recommend-only (defer) |
| 6 | Layout/MoreDrawer `#112236`/`#1E3A5C` → tokens (+ fix the `+'66'` concat) | defer to C01 drift pass |

Items 1–3 (+4 if approved) ship this sprint; QA per WORKFLOW; log to Decision Log.
