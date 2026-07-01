# S01 — Screen Inventory & Audit Rubric

*Produced July 1, 2026 from a scan of the live `rinkd_live` codebase (47 screens in
`src/pages/`, 54 routes in `src/App.js`).*

---

## Mission restatement (proof of absorbed ground truth)
Rinkd is the **social/engagement layer for all of hockey** — the "Platform Layer
Play." We do NOT replace SportsEngine, Crossbar, GameSheet, TeamSnap, or LeagueApps;
we sit on top of them so an operator's stack gets stickier. The app is already live
with both pillars built (associations + fans). The job of this program is to
**elevate execution to A+**, never to rebuild.

The 5 North Stars (from `DESIGN_MANIFESTO.md`) govern every grade: Stupid-Proof
Simple · Intuitively Familiar · Social-First Flow · Engaging · Shareable & Sticky.

**Already shipped — do NOT re-propose** (from `BUILD_PRIORITY.md`): Event-Centric
Home ("Home Ice"), Featured-hero-at-top, global-feed demotion, GS-6 compliance,
league/tournament divisions, tap-to-pick scorer, growth-share cards, ADS-1 sponsors,
live-stream links, STATS-3, youth privacy, unified schedule, GameSheet sync, the
design-token system, and the `components/ui` library.

---

## The audit rubric (used in S02)

Grade every screen **A+ / A / B / C / D**. A screen earns **A+ only if ALL** hold:

| # | Criterion | A+ bar |
|---|-----------|--------|
| 1 | **Obvious** (Grandparent Test) | First try, one-handed, no tutorial; one unmistakable primary action |
| 2 | **Premium** | Feels expensive; broadcast-grade hierarchy, type, spacing |
| 3 | **Fewer taps** | No removable step remains |
| 4 | **On-system** | Imports `lib/tokens.js`; uses `components/ui/*`; **no** local `const C` palette, **no** hardcoded hex |
| 5 | **State resilience** | Real loading (geometric skeleton), empty (an invitation), error (says what to do next) |
| 6 | **Stress-safe** | Survives 60-char name, 5-sentence text, 14–0 score, no image, no data |
| 7 | **Scalable** | No polling (Realtime), no full-list fetch (cursor pagination), no blocking render |
| 8 | **Apple-shippable** | Would pass an Apple design review |

**Grade bands:**
- **A+** — all 8 pass.
- **A** — functions and looks great; 1 minor gap (usually criterion 4 partial).
- **B** — solid and shippable, but off-system styling (local `const C`/hex) and/or a
  polish gap on hierarchy or a state. *This is where most of the app sits today.*
- **C** — a real usability, resilience, or scale gap a user would notice.
- **D** — broken under stress data, missing core states, or confusing.

## How grades were derived (method + honesty note)
Grades in S02 are a **first-pass** built from: (a) an automated per-screen scan
(token import, local-palette redeclaration, hardcoded-hex count, `SectionHeader` /
`EmptyState` / `ErrorState` / `Skeleton` / `StatNumber` usage, spinner strings,
`setInterval`, Realtime subscriptions, file size), plus (b) targeted reads of the
front-door and game-day screens. Each elevation sprint (S03–S10) re-opens its screens
line-by-line and confirms/adjusts the grade. Treat S02 as the **map**, not the final
verdict.

---

## The inventory (grouped by surface)

### A. First impression (cold open — evaluators, new users)
`Landing.js` · `Home.js` (Home Ice) · `Auth.js` · `OnboardingModal.js` (component) ·
`ComingSoon.js`

### B. Fan / social
`Feed.js` · `Discover.js` · `Profile.js` (+ `/profile/:userId`) · `Team.js` ·
`Teams.js` · `Notifications.js` · `Messages.js` · `Store.js` · `Crease.js` ·
`CreaseShow.js` · `CreaseEpisode.js` · `Rinkside.js` · `RinksideArticle.js` ·
`RinksideEditor.js` · `Survey.js`

### C. Game day
`GameDetail.js` · `PublicGame.js` · `ScorerView.js` (+ league-scorer route)

### D. Association / operator
`Leagues.js` · `League.js` · `LeagueCreate.js` · `LeagueManage.js` ·
`LeagueRegister.js` · `Tournaments.js` · `Tournament.js` · `TournamentCreate.js` ·
`TournamentManage.js` · `TournamentRegister.js` · `TeamManage.js` ·
`VolunteerCoordinator.js` · dues tracker

### E. Admin / system
`AdminPanel.js` · `AdminActivations.js` · `AdminAnalytics.js` · `AdminFeedback.js` ·
`AdminModeration.js` · `Settings.js` · `Pricing.js` · `Legal.js` · `NotFound.js` ·
`ResetPassword.js` · `AcceptTeamInvite.js` · `AcceptLeagueInvite.js`

---

## Headline finding (drives the whole program)
The app **functions well and its state-resilience is genuinely strong** — geometric
skeletons (`components/Skeletons.js`) are used widely, and several screens carry
explicit "no spinner, no layout shift" patterns. The **dominant gap is design-system
adoption**: ~40 of 47 screens do not import `lib/tokens.js`, ~35 redeclare a local
`const C = {…}` palette, and only `Home.js` and `Survey.js` use `ui/SectionHeader`.
That single gap caps most otherwise-good screens at **B**. Closing it (Collection
C01) is the cheapest path to lifting the whole app's grade — which is exactly why the
roadmap front-loads it.
