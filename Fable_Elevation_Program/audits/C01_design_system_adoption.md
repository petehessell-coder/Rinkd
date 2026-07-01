# C01 — Design-System Adoption: Migration Table

*Produced July 1, 2026 from an app-wide hex + palette scan of `src/` (pages,
components, lib). This is the pre-work for Collection C01 so the migration sprint
starts with a map, not a blank page.*

---

## TL;DR
- The design system (`lib/tokens.js` + `components/ui/*`) is correct; **adoption is
  the gap.** ~40/47 screens don't import tokens; ~35 redeclare a local `const C`.
- **Good news:** the on-token brand colors already dominate usage — the 9 canonical
  values account for the top of the frequency list. Most of the migration is a
  **safe find/replace**.
- **The one real decision:** amber `#f59e0b` (71 uses) and green `#22c55e` (65 uses)
  are de-facto **warning** and **success** colors with **no token**. C01 should add
  `colors.warning` + `colors.success` to `tokens.js` rather than forcing them onto
  gold/red. Everything else is drift that collapses to an existing token.

---

## Part 1 — Exact-match map (SAFE mechanical find/replace)
These hex values already equal a token. Replace the literal with the token import.
(Counts are app-wide occurrences.)

| Hex (any case) | Uses | Token | Semantic |
|---|---|---|---|
| `#0b1f3a` | 108 | `colors.bg` / `C.navy` | app background |
| `#0a1e38` | 4 | `colors.bg` | manifesto navy — same ground (tokens.js standardizes on `#0b1f3a`) |
| `#0f2847` | 71 | `colors.surface` / `C.card` | standard card |
| `#162f55` | 13 | `colors.surfaceElevated` | elevated / featured / live cards |
| `#07111f` | 90 | `colors.surfaceDeep` / `C.dark` | deepest inset |
| `#d72638` | 175 | `colors.red` / `C.red` | action / urgency / live ONLY |
| `#2e5b8c` | 103 | `colors.blue` / `C.blue` | rink-light accent |
| `#c9a84c` | 10 | `colors.gold` / `C.gold` | milestones / awards ONLY |
| `#f4f7fa` | 215 | `colors.ice` / `C.ice` | primary text |
| `#8ba3be` | 106 | `colors.muted` / `C.steel` | secondary text |

## Part 2 — Drift map (off-token → nearest token; quick judgment per use)
These are near-duplicates of tokens. Collapse to the token noted. Where a use is a
border vs a fill, pick `border` vs `surface*` accordingly.

| Hex | Uses | → Token | Notes |
|---|---|---|---|
| `#1a3050` | 58 | `surface` / `surfaceElevated` | navy card variant |
| `#1e3a5c` | 25 | `borderAccent` or `surfaceElevated` | Auth/Store `border` drift |
| `#112236` | 22 | `surface` | Auth/Store `card` drift (should be `#0f2847`) |
| `#11253e` `#0d1f35` `#152e54` `#1a2f4a` `#06101e` `#060c15` `#080f1c` | ~20 | `surfaceDeep` / `surface` | dark navy variants |
| `#1a4a7a` `#245070` `#1f3553` `#1a3a5c` | ~19 | `surfaceElevated` / `blue` | elevated navy/blue |
| `#7c8b9f` `#9bb5d6` `#cdd9e6` `#c5d2e1` `#9ec3ec` | ~34 | `muted` | steel/text variants |
| `#0ea5e9` `#5b9fe2` `#4a93e6` `#60a5fa` | ~26 | `blue` | sky-blue drift (see decision D3 re: link-blue) |
| `#e26b6b` `#ff6b6b` `#ff0000` | 29 | `red` | red drift (see D2 re: soft/deep red) |
| `#b51e2e` `#6b1520` | 7 | `red` (deep/pressed) | dark-red hover states |
| `#000` `#0a0a0a` | 12 | `surfaceDeep` | near-black fills (keep `rgba(0,0,0,x)` for overlays) |
| `#fff` `#ffffff` `#fffefa` | 293 | see **Decision D1** | pure white — mostly `color:'#fff'` text |

## Part 3 — Semantic gaps → NEW tokens (the real decision)
Used widely and consistently across 15+ files each — these are semantic roles, not
random drift. Add them to `tokens.js` so they're first-class:

| Hex family | Uses | Proposed token | Role |
|---|---|---|---|
| `#f59e0b` (+`#e0a93b` `#e08a1e` `#f5b301`) | ~76 | `colors.warning` | warnings, pending, "needs attention" |
| `#22c55e` (+`#5bcf8e` `#1f9e6b`) | ~70 | `colors.success` | success, complete, paid, live-good |

Files using these today (migrate together): AdminActivations, AdminAnalytics,
AdminPanel, AdminFeedback, Profile, Team, TeamManage, Feed, Discover, League,
LeagueCreate, LeagueRegister, LeagueManage, TournamentCreate, GameDetail, Store,
Crease, Home, Landing, + more.

---

## Decisions to make BEFORE the mechanical pass (don't skip)
- **D1 — White text rule.** `#fff` is used ~293× (mostly `color:'#fff'`). Recommend
  adding `colors.onAccent = '#FFFFFF'` for text/icons *on* saturated surfaces (red
  CTA, blue chip, colored avatar) and standardizing all other white text to
  `colors.ice` (`#f4f7fa`). Decide the boundary once; then it's mechanical.
- **D2 — Red variants.** Do we want `redSoft` (error text on dark, `~#e26b6b`) and
  `redDeep` (pressed/hover, `~#b51e2e`)? Or collapse all to `red`? Recommend adding
  both variants to `tokens.js` since ~36 uses want a not-pure-`red` red.
- **D3 — Link/sky blue.** `#0ea5e9`/`#5b9fe2` (~26×) read as links/interactive.
  Collapse to `blue`, or add `colors.link`? Recommend collapse to `blue` unless a
  visible link color is wanted.
- **D4 — Crease/premium purple.** `#8b5cf6`/`#9333ea` (~10×, `Crease`/video) is an
  intentional premium accent with no token. Add `colors.premium` (purple) or fold to
  `gold`? Recommend a scoped `premium` token so the video tier has an identity.
  *(Note: `#9146ff` if present is Twitch brand — keep as-is on provider buttons.)*

**After D1–D4 are answered, ~90% of C01 is safe find/replace + deleting local
`const C` blocks.**

---

## Part 4 — The `const C` replacement pattern
Every page with a local palette does essentially this:
```js
const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA',
            steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'...' };
```
Replace with:
```js
import { C } from '../lib/tokens';   // same keys, one source of truth
```
This also **fixes drift for free** — e.g. `Auth.js` and `Store.js` currently ship
`card:'#112236'` and `border:'#1E3A5C'` (wrong); the shared `C` gives them the
correct `#0f2847` / token border. Spot-check each screen visually after swapping,
since a couple used off-value cards intentionally-or-not.

## Part 5 — Component adoption (pairs with the color pass)
Beyond color, adopt the primitives (from S02 scan):
- **`ui/SectionHeader`** — only `Home` + `Survey` use it. Every screen with a
  hand-rolled section title migrates.
- **`ui/EmptyState` / `ui/ErrorState`** — good coverage on Feed/Discover/League/
  Tournament/Messages/Admin*, missing on the big ops screens (LeagueManage,
  TournamentManage, TeamManage, Create flows).
- **`ui/StatNumber`** — only `Profile` uses it; every stat/score elsewhere should.
- **`ui/Skeleton` / `Skeletons.js`** — already strong; fill gaps on Create/Manage/
  Settings/Admin screens with no skeleton.

---

## Suggested migration order (safe → high-value)
1. **Add the new tokens** (`warning`, `success`, and per D1–D4: `onAccent`,
   `redSoft`/`redDeep`, `link?`, `premium?`) to `lib/tokens.js`. One PR, no UI change.
2. **Cross-cutting safe pass:** delete every local `const C`, replace with the token
   import; run the Part 1 exact-match replacements globally. Visual spot-check.
3. **Drift pass (Part 2):** per-file, collapse variants to nearest token.
4. **Semantic pass:** swap amber/green literals to `warning`/`success`.
5. **Component pass (Part 5):** SectionHeader / EmptyState / StatNumber adoption,
   starting with the operator + front-door + game-day screens (the S02 worklist
   order: LeagueManage, TournamentManage, ScorerView, League, Tournament, Profile,
   Home, GameDetail).

## Guardrails
Pure migration — **no visual redesign, no behavior change.** Every migrated screen
gets a visual spot-check against the stress data (60-char name, 14–0 score, no
image). Report % adoption before/after (target: 0 local `const C`, 0 raw hex outside
`tokens.js`, except intentional third-party brand colors).
