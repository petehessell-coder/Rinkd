# 03 — DECISION LOG

> Every material product decision, with its reasoning, so Fable never proposes a
> contradictory idea later. Append new decisions at the top with a date. These are
> REAL decisions already made on Rinkd — honor them.

---

### 2026-06-30 · Home is event-centric ("Home Ice"), not a global feed
The signed-in front door is `/home` (`src/pages/Home.js`), a persona-aware **tile
board** — NOT the global chirp feed. **Reason:** parents care about *today's hockey*
first, and the global feed read as "empty Instagram for hockey" to operators
evaluating the app. Scoped feeds (team/league/tournament) stay — only the GLOBAL
chirp feed was demoted.

### 2026-06-30 · Global chirp feed demoted to "Discover"
`src/pages/Feed.js` still exists at `/feed` and `/discover`, but it is a secondary
surface reached from the **More** drawer — not primary nav, not the default.
**Reason:** game day > scrolling strangers' chirps; needs consumer density we don't
have yet.

### 2026-06-30 · Featured hero sits at the TOP of Home
A full-width Featured marquee is the first thing a visitor sees (launch featured =
the XRHL league). **Reason:** optimizes for the evaluator/first-time viewer
(operators, association EDs landing cold) — makes the app look alive and legitimate,
and doubles as partner/sponsor inventory. Members' "Your hockey" layer may later
rise above it, but Featured-top ships for everyone now.

### 2026 · Navigation is a single shared array
`src/components/Layout.js` `NAV` drives BOTH the desktop sidebar and the mobile
bottom bar. Primary nav = Home Ice · Teams · Notifications · Profile · More.
"Home Ice" collapses to "Home" on mobile to fit the 5-item bottom bar. **Reason:**
one edit moves both surfaces; keep them in sync.

### 2026 · Player profiles and tournament/league pages are PUBLIC
**Reason:** discovery + SEO. Rinkd is a hockey identity layer; profiles and event
pages must be shareable and indexable. (Minor PII is the exception — see below.)

### 2026 · Minor privacy: youth events gate personal info
Youth teams/rosters/minor profiles/schedule locations are private/members-only by
default; only team-level results (no minor PII) are public. Public youth
leaderboards render **jersey-only** (e.g. "#42"), never a minor's name. Parents
**JOIN** their kid's team (they are not "followers"). **Reason:** COPPA/consent +
child safety. Adult-first everywhere a gate exists.

### 2026 · Tournament stats are shown SEPARATELY from league stats
On a player profile, tournament stats live in their own section and are never
blended into league totals (`get_player_tournament_stats` mirrors the league RPC).
**Reason:** they are different competitive contexts; blending them lies about a
player's record.

### 2026 · Stats attributed by identity, not jersey number (target state)
Current stat RPCs are jersey-based; the durable model attributes by
`player_id`/`user_id` because numbers change per season/tournament/game and beer-
league subs share sweaters. Known future refactor — don't deepen the jersey
dependency.

### 2026 · Real-time = Supabase Realtime, never polling
Score updates and live game state subscribe to Supabase Realtime and unsubscribe on
unmount. Hot paths run on Edge Functions. **Reason:** the Saturday Night Test
(tens of thousands concurrent).

### 2026 · The design system exists — adopt it, don't rebuild
`src/lib/tokens.js` + `src/components/ui/*` are built and correct. The open work is
**migration** (screens still redeclare local palettes / hand-roll headers), not a
redesign. **Reason:** cheap, low-risk, high visible payoff; keeps the whole app
matching Home Ice.

### 2026 · Registration works for a basic pilot; compliance is operator-gated
Team/tournament registration + Stripe (free + paid) + waitlist/approve are shipped.
USA Hockey # capture, payment plans/installments, waiver e-sign, and registry export
are **deferred until a specific operator needs them.** **Reason:** don't build
enterprise compliance ahead of a deal that requires it.

### 2026 · Entity: converting US LLC → Delaware C-Corp
Gates the US VC pipeline. Not a product decision, but it constrains fundraising
sequencing — relevant when prioritizing investor-facing polish.

---

## How to use this log
Before proposing a change that touches home, navigation, feeds, privacy, stats, or
registration, check this log. If your idea contradicts a decision, either (a) don't
propose it, or (b) make the case explicitly for reversing the decision and, if
accepted, add a new dated entry that supersedes the old one.

### 2026-07-01 · C01 token decisions (D1–D4, Pete sign-off)
Added to `tokens.js` colors: `success #22C55E`, `warning #F59E0B`, `onAccent
#FFFFFF` (text/icons ON saturated surfaces; all other white text → `ice`),
`redSoft #E26B6B` (error text on dark), `redDeep #B51E2E` (pressed/hover),
`premium #8B5CF6` (Crease/paid-video tier — Twitch brand `#9146FF` stays as-is
on provider buttons). **Declined:** a `link` token — sky-blue drift collapses to
brand `blue` in the Part-2 drift pass. **Reason:** the amber/green families were
de-facto semantic roles with no token (~146 uses); naming them ends the drift.

### 2026-07-01 · S03 Gate-1 decisions (Pete sign-off)
**D-S03-1:** Landing splash stat bar (industry vanity stats) → 2×2 feature-chip
grid, mirroring the Jun-27 Auth-hero call. **Reason:** the cold open should sell
what the app does, not the sport's size. **D-S03-2:** Auth primary red buttons →
manifesto pill (radius 999) + red-glow shadow + press collapse. **Reason:**
manifesto "Corner Philosophy / Primary buttons" compliance on the highest-stakes
form. Rest of S03 = motion/stress/skeleton polish, no content or nav changes.

### 2026-07-01 · S04 Gate-1 decisions (Pete sign-off)
League/Tournament in-page tabs are **deep-linkable** via `?tab=` (replaceState —
no history spam; back stays one-tap). More drawer gets the manifesto sheet
slide-up; More nav item renders a real icon. **D-S04-2:** the drawer's Pricing
row is reframed as the cold-operator on-ramp — "Run your league or tournament"
→ /pricing (visible to all; no Home clutter; same destination, operator
framing). Tab-order divergence (League leads Schedule, Tournament leads
Standings) confirmed INTENTIONAL — do not unify.
