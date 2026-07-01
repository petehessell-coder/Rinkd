# S02 — Screen Audit (A+ → D) + Ranked Worklist

*First-pass grades from the automated rubric scan + targeted reads (see S01 method
note). Each elevation sprint re-opens its screens and confirms line-by-line.*

**Scan legend:** `tok` = imports `lib/tokens.js` · `C` = redeclares local `const C`
palette · `hex` = hardcoded hex count · `ui` = uses `components/ui` primitives
(SectionHeader/EmptyState/etc.) · `RT` = uses Realtime · `states` = loading/empty/
error coverage.

---

## THE RANKED WORKLIST (do these first — impact × cheapness)

Ordered by mission impact × how cheap the fix is. This is the backlog S03–S10 and the
C-collections pull from.

1. **Design-system migration — the operator + front-door + game-day screens**
   *(→ Collection C01; highest leverage in the whole program).* Migrate to
   `tokens.js` + `ui/*`, delete local `const C`. Cheap + mechanical + lifts grades
   app-wide. Priority files: `LeagueManage` (62 hex), `TournamentManage`,
   `ScorerView` (88 hex), `League` (59 hex), `Tournament` (46 hex), `TeamManage`
   (33 hex), `LeagueCreate` (35 hex).
2. **`Home.js` → A+** *(S03)*. Already on-system (imports tokens, 8× SectionHeader).
   It's the front door and the closest to A+ — finish it: hero polish, perceived
   speed, persona-branch empty states. High impact, low effort.
3. **`Landing.js` + `Auth.js` → A+** *(S03)*. Cold-evaluator first impression. Landing
   already imports `C`; Auth still local-palette (607 lines, 10 hex). "This feels
   expensive" must land here. High impact, low effort.
4. **`ScorerView.js` — the <5-second goal** *(S05 + S08 + C06)*. Operator-critical and
   the biggest single file (1,933 lines, 88 hex, local palette, 7× Realtime). Verify
   tap-count/target-size for a goal, mis-tap recovery, offline resilience, then
   broadcast-grade the goal moment. High impact, medium-high effort.
5. **`League.js` + `Tournament.js` → A+** *(S05 + S08)*. Public event pages =
   high-traffic + SEO + operator-facing. Already partly on-system (import tokens, use
   EmptyState + Skeleton + Realtime). Finish tokenizing + broadcast-grade the live
   tabs. High impact, medium effort.
6. **`LeagueManage.js` + `TournamentManage.js` — demo-readiness** *(S05 + C04)*. The
   surfaces you show FWHL/Black Bear/GameSheet. Huge (2,158 / 2,600 lines) but the
   work is mostly mechanical migration + friction removal. High impact, medium effort.
7. **`Profile.js` → A+** *(S07 + C05)*. The hockey identity card. On-system-ish
   (imports tokens, uses StatNumber). Make it the share-worthy ID. High impact, low
   effort.
8. **`GameDetail.js` + `PublicGame.js`** *(S08 + C06)*. Game-day viewing + public
   share/SEO. Tokenize + broadcast treatment + one-tap-to-stream. Medium-high impact.
9. **`Feed.js` + `Discover.js`** *(S07)*. Now demoted surfaces, so lower urgency, but
   cheap to polish; Feed already imports tokens + uses skeletons. Medium impact.
10. **Registration flows** (`LeagueRegister`, `TournamentRegister`) *(S05)*. The
    <3-minute bar. Small files (194/197 lines) — audit tap-count + states. Then admin
    + utility screens as a mechanical migration sweep (C01/C10).

---

## GRADES — by surface

### A. First impression
| Screen | Grade | Basis |
|---|---|---|
| `Home` (Home Ice) | **A−** | On-system (tokens + 8× SectionHeader), Realtime, event-centric front door. Closest to A+; needs hero/perceived-speed polish + new-user empty state → S03. |
| `Landing` | **B+** | Imports `C`, clean decision tree (PWA/mobile/desktop), SEO. Needs premium first-fold polish → S03. |
| `Auth` | **B** | 607 lines, local `const C`, 10 hex, no skeletons. Functional but off-system; first impression for new accounts → S03. |
| `ComingSoon` | **B** | 45 lines, no styling system, generic. Fine but plain. |
| `OnboardingModal` (component) | **B+** | Has the one-time `reveal` motion; confirm it drives to the first meaningful action → S03/C03. |

### B. Fan / social
| Screen | Grade | Basis |
|---|---|---|
| `Feed` | **B+** | Imports tokens, geometric skeletons, EmptyState, good error coverage. `setInterval` is a cosmetic copy-rotator (NOT data polling — cleared). Demoted surface → S07 polish. |
| `Discover` | **B** | 6× EmptyState, 7× skeletons — resilient — but local `const C`, no tokens. → C01. |
| `Profile` | **A−** | Imports tokens, uses StatNumber, identity-critical. Tokenize remaining hex (22) + make share-worthy → S07/C05. |
| `Team` | **B** | Local `const C`, 23 hex, has skeletons. → C01/C05. |
| `Notifications` | **B+** | Imports tokens, EmptyState + skeletons. Light polish. |
| `Messages` | **B** | Local palette; EmptyState + skeletons present. → C01. |
| `Store` | **B** | Local palette, 9 hex, states ok. → C01. |
| `Crease` / `CreaseShow` / `CreaseEpisode` | **B / B / B−** | Premium video surface; local palettes; Crease has EmptyState+skeleton, episode/show thinner. → C01/C10. |
| `Rinkside` / `RinksideArticle` / `RinksideEditor` | **B / B / B−** | Content surfaces; local palettes; Editor has a real "Loading" (271 lines) worth checking. → C01. |
| `Teams` | **B** | 83 lines, thin list; skeletons present, no tokens. → C01. |
| `Survey` | **B** | Uses SectionHeader (7×) but no tokens import + 30 hex; long (807). → C01/C10. |

### C. Game day
| Screen | Grade | Basis |
|---|---|---|
| `GameDetail` | **B+** | Realtime (3×), strong error handling (6× catch), local palette + 22 hex. Broadcast treatment + tokenize → S08. |
| `PublicGame` | **B+** | Explicit "no spinner, no layout shift" pattern, skeletons, Realtime-ready. Local palette. Public/SEO surface → S08/C06. |
| `ScorerView` | **B** | Mission-critical (<5s goal). 1,933 lines, 88 hex, local palette, 7× Realtime, strong error coverage. Functionally deep but off-system + must be verified against the 5-second bar → S05/S08/C06. **Highest strategic screen in the app.** |

### D. Association / operator
| Screen | Grade | Basis |
|---|---|---|
| `League` | **A−** | Imports tokens, EmptyState (4×), skeletons, Realtime (4×) — but 59 hex remain. Public + operator-facing → S05/S08. |
| `Tournament` | **A−** | Imports tokens, EmptyState (4×), skeletons, Realtime (7×); 46 hex remain. → S05/S08. |
| `LeagueManage` | **B** | Operator demo surface. 2,158 lines, local `const C`, 62 hex, deep error coverage but no skeletons/EmptyState visible. Migration + friction pass → S05/C04. |
| `TournamentManage` | **B** | 2,600 lines (largest), local palette, 24 hex. → S05/C04. |
| `TeamManage` | **B** | 917 lines, local palette, 33 hex, strong error coverage. → C04. |
| `LeagueCreate` / `TournamentCreate` | **B / B** | 720/722 lines, no local `const C` but 35/25 raw hex, no tokens import. Form-heavy → S05/C01. |
| `LeagueRegister` / `TournamentRegister` | **B / B** | Small (194/197). The <3-min bar — audit tap-count + states → S05. |
| `Leagues` / `Tournaments` | **B / B** | Thin index lists; skeletons present, no tokens. → C01. |
| `VolunteerCoordinator` | **B−** | 369 lines, no tokens, no local `const C`, only 5 hex + 4 catch. Sparse styling. → C01/C04. |

### E. Admin / system
| Screen | Grade | Basis |
|---|---|---|
| `AdminModeration` | **B+** | 3× EmptyState + 3× skeletons, sensible "neutral loading" note. Local palette. |
| `AdminFeedback` | **B+** | EmptyState + skeletons, neutral-loading note. Local palette. |
| `AdminAnalytics` | **B** | 351 lines, local palette, strong error coverage, no skeletons. |
| `AdminActivations` | **B** | Local palette, error coverage, no skeletons. |
| `AdminPanel` | **B** | 441 lines, intentional neutral loading (no "staff only" flash). Local palette. |
| `Settings` | **B** | 456 lines, local palette, 5× catch, no skeletons. |
| `Pricing` | **B−** | 193 lines, local palette, no states. Marketing surface — worth a polish for evaluators. |
| `ResetPassword` | **C+** | Has a real "Loading" string + only 1 Realtime false-positive; thin states. Low traffic. Verify it's a skeleton not a spinner → C01. |
| `AcceptTeamInvite` / `AcceptLeagueInvite` | **B− / B−** | 101/105 lines, error state only, local palette. Invite = growth surface; make the landing premium → C03. |
| `Legal` / `NotFound` | **B / B** | Tiny utility screens; fine, off-system. Mechanical migration. |

---

## Summary scorecard (first pass)
- **A− (closest to A+):** Home, Profile, League, Tournament. *(4)*
- **B+ / B:** the large majority — solid, shippable, off-system styling is the common
  cap. *(~38)*
- **C+ / B−:** a handful of thin utility/auth surfaces. *(~5)*
- **D:** none found — nothing is broken under stress; the floor is "off-system," not
  "broken."

**The one move that lifts the most grades:** run **C01 (design-system adoption)** —
migrate local `const C`/hex to `tokens.js` + `ui/*`. It's mechanical, low-risk, and
turns a wall of B's into A−/A. Pair it with the S03 front-door polish and the
S05/S08 operator + game-day work, and the app crosses into A+ territory where it
matters most for pilots and partner demos.

**Cleared false alarms (don't chase these):** Feed's `setInterval` is a placeholder-
text rotator, not data polling. Most "spinner" grep hits are comments describing the
*deliberate absence* of spinners. State-resilience is a strength, not a gap.
