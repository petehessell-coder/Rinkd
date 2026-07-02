# C08 — Performance Engineering · The Saturday Night Test Audit (Gate 1)

**Date:** 2026-07-02 · **Pilots:** Oakland **Jul 24**, Little Caesars **Aug 1**
**Method:** 3 parallel code auditors (front door/social · event pages/standings · live
game/infra) + prod performance advisors + live prod cron verification. Every claim
carries file:line. The Jun-2026 scale-hardening pass was verified as still holding —
this audit reports only what is true TODAY.
**Status: 🚦 GATE 1 — audit + prioritized fix plan. No code changed.**

---

## 1. The verdict in one paragraph

The Jun-2026 hardening held: no data-polling loops exist (all `setInterval`s are UI
ticks or documented 5-min reconciliation fallbacks under Realtime), the feed is
properly keyset-paginated, every Home/Gameday query is bounded, channels unsubscribe
cleanly, the scorekeeper offline queue is event-driven and capped, and the service
worker never caches live data. The gaps cluster in four places: **(1) the Stats tab**
— 4 leaderboard RPCs with zero SQL `LIMIT`, 5 uncached queries per open, on exactly
the surface thousands of parents hammer mid-tournament; **(2) event pages load
everything eagerly** — League/Tournament fire 5–6 queries on mount regardless of
landing tab, and none of the three hottest pages use `lib/cache.js` at all; **(3)
unbounded push fan-out** — recap/hype edge functions `Promise.all` every subscriber
in one shot (timeout risk at pilot subscriber counts); **(4) DB-side RLS cost** —
`posts`/`likes`/`comments` each carry 15 multiple-permissive-policy hits, taxing
every feed row read. Everything else is cheap sweeps (one-line lazy-loading misses, a
373KB raw hero JPEG, a 926KB main bundle carrying the canvas share-card composer).

---

## 2. Per-surface table (current state)

Columns: **Poll** (data polling) · **Bound** (every query limited) · **Cursor**
(pagination where list grows) · **RT** (Realtime hygiene) · **Cache** (`lib/cache.js`)
· **Lazy** (below-fold deferral). ✅ compliant · ⚠️ gap · ❌ violation · — n/a.

| Surface | Poll | Bound | Cursor | RT | Cache | Lazy | Worst finding (file:line) |
|---|---|---|---|---|---|---|---|
| **Home Ice** (`Home.js` + `lib/home.js`) | ✅ | ✅ all ≤12 | — | ✅ 1 ch, 20+20 cap, 800ms | ⚠️ none | ✅ | Goal ping re-runs FULL 6-way `loadHome()` (`home.js:344-352`) instead of just live parts |
| **GamedayStrip** (`gameday.js`) | ✅ | ✅ 12/8 caps | — | ✅ | ⚠️ none | ✅ | `getGamedayContext` fetched twice (Home + Strip) per session; duplicate channel (`home.js:341` vs `GamedayStrip.js:33,42`) |
| **Feed** (`Feed.js` + `posts.js`) | ✅ | ✅ | ✅ keyset `.lt(created_at)` | — | ⚠️ | ⚠️ | Sequential waterfall posts→likes→reactions (`Feed.js:466-485`); `getComments` capped 200, NO cursor (`posts.js:330`); follows lookup `.limit(1000)` TODO (`posts.js:39`) |
| **Discover** | ✅ | ✅ ≤40 | ⚠️ no load-more | — | ⚠️ rails uncached | ❌ trending `<img>` eager (`Discover.js:159`) | Fixed-40 dead-end tabs |
| **CommentThread** | ✅ | ⚠️ 200 cap | ❌ none | — | ⚠️ | ✅ lazy on open | "load earlier" self-admitted TODO (`posts.js:330`) |
| **Notifications** | ✅ 5-min fallback only | ✅ 80 | ⚠️ no load-more | ✅ per-user filter | ⚠️ | ⚠️ | Two bell instances each with own timer+channel if co-mounted (`NotificationBell.js:29`, `Layout.js:352`) |
| **DMs** (`messages.js`) | ✅ 5-min fallback | ❌ `list_my_conversations()` bound unverifiable; `getMessages` no cursor (`messages.js:56-69`) | ❌ | ❌ **`subscribeInbox` UNFILTERED on all of `messages`** (`messages.js:131`) — every logged-in user, RLS eval per DM × per subscriber | ⚠️ | ⚠️ | The #1 Realtime fan-out multiplier in the app |
| **Landing** | ✅ | — | — | — | — | ❌ | 373KB raw 1080×1936 JPEG as LCP (`Landing.js:149`, also `Home.js:25`) — no compression/responsive variant |
| **League** (`League.js` + `leagues.js`) | ✅ | ✅ 1000/500 caps | ⚠️ cap-not-cursor | ⚠️ event-WIDE channel: N viewers × M live games RLS evals (`League.js:441`) | ❌ zero `cached()` | ⚠️ Feed lazy, Standings/Schedule/Teams eager | ALL 5 queries fire on mount regardless of landing tab (`League.js:315-319`) |
| **Tournament** (`Tournament.js`) | ✅ | ✅ | ⚠️ | ⚠️ same event-wide channel (`Tournament.js:357`) | ❌ | ⚠️ | Same eager-everything mount (`Tournament.js:218-274`); all-division standings fetched then client-filtered (`:484-491`) |
| **Stats tab** (`StatLeaderboards.js` + `SeasonGamePucks`) | ✅ | ❌ **4 RPCs have ZERO SQL `LIMIT`** (`20260621130000_…sql:134-598`); `get_season_game_pucks` unbounded (`gamePucks.js:153`) | ❌ | — no live path | ❌ 5 fresh queries EVERY open | ✅ tab-gated | **The single largest Saturday-Night failure** — the pilot's hottest surface |
| **Team** (`Team.js` + `teams.js`) | ✅ | ⚠️ 3×200 fetch-then-slice (`teams.js:77-153`, `// TODO: paginate` at `:72`) | ❌ | ❌ **no subscription at all** → parents manually refresh (self-inflicted polling) | ❌ | ⚠️ | Live game never updates on Team page |
| **GameDetail** | ✅ (60s UI tick only) | ✅ | — | ⚠️ **drifted duplicate impl** (`GameDetail.js:216-235`) — bypasses `gameRealtime.js`, silently misses the gated broadcast path | ⚠️ | ✅ | Consolidate to `subscribeGame()` |
| **PublicGame** | ✅ | ✅ | — | ✅ via shared lib | — | ✅ | Clean |
| **ScorerView + syncQueue** | ✅ event-driven, backoff only while pending | ✅ 500/100 caps | — | ✅ | — | ✅ | Clean — already enterprise-grade |
| **Operator `/o/:slug`** | ✅ | ✅ | — | ✅ 20-cap, 600ms | ✅ 60s | ✅ | ⚠️ cache never invalidated on admin writes (`operators.js:65`) — one-liner. **Otherwise the compliance template.** |
| **middleware / api/og** | — | ✅ bot-gated | — | — | ✅ s-maxage 600/86400 | — | Clean |
| **Service worker** | 60s update check (no data) | — | — | — | ✅ static-only, excludes `/api/` + cross-origin | — | Clean |

### Realtime channel inventory (all unsubscribe correctly)
`gameRealtime.js:56` per-game (default O(viewers); broadcast path built but env-gated
off) · `GameDetail.js:224` **duplicate** per-game · `ScorerView.js:619` per-game ·
`Home.js:79` 20+20 filtered · `GamedayStrip.js:42` same (duplicate of Home's) ·
`League.js:441` + `Tournament.js:357` event-wide · `notifications.js:86` per-user
filtered · `messages.js:108` per-conversation filtered · `messages.js:131`
**unfiltered inbox** · `operators.js:161` 20-cap.

### Edge functions + cron — VERIFIED LIVE ON PROD (2026-07-02)
All 12 cron jobs active in `cron.job`: gamesheet `*/3` (jobid 3), hockeyshift live
`*/5` Jul–Aug evenings (8) + daily (9), gameday-hype `*/30` (15), game reminders
hourly (1), lineup reminders hourly (14), onboarding hourly (2), settle-pucks `*/5`
(11), printful daily (4), analytics daily (7), reg4 ×2 (12, 13). Auditor's
"no cron.schedule in repo" finding = **documentation drift, not dead code** — the
schedules were applied via MCP and never recorded as migrations. Fix is paperwork.
**Real edge finding:** `send-recap-push/index.ts:112` + `send-gameday-hype/index.ts:149`
fan out `Promise.all(pushSubs.map(webpush.send))` with **no batching cap** — at pilot
subscriber counts a single recap push risks function timeout with zero backpressure.

### DB-side (prod performance advisors, 182 lints)
- **`posts` / `likes` / `comments`: 15 multiple-permissive-policy hits EACH** — every
  feed row evaluates a stack of permissive RLS policies; the hottest tables carry the
  highest per-row policy tax. `games`/`tournaments`/`follows`/`game_goals` 5 each.
- **14 unindexed FKs**, hot ones: `featured_operator_events` league_id + tournament_id
  (the /o/ page embeds join these), `gamesheet_links.league_id` (the */3 poller),
  `game_puck_results.post_id`. Rest are cold tables.
- 52 unused indexes (write overhead; cleanup only). 3 `auth_rls_initplan` (all on cold
  `integration_authorizations`). Auth server fixed at 10 connections (config note).

---

## 3. Prioritized fix plan — 6 PRs, tiered per WORKFLOW

**P0 = merged before Jul 24 (Oakland). P1 = before Aug 1 (Little Caesars). P2 = after.**
Sonnet 5 = mechanical/tight-spec; Opus 4.8 = SQL/RLS/Realtime/Edge (correctness-critical).
QA on the stronger model for every correctness-critical PR.

### PR-A · P0 · **Opus 4.8** — "Bound the stats stack + hot indexes" (one migration)
1. Add `LIMIT` (+ optional `p_limit` param, default 100) to the 4 leaderboard RPCs —
   `get_league_skater_stats`, `get_league_goalie_stats`, `get_tournament_skater_stats`,
   `get_tournament_goalie_stats` (`20260621130000_…sql:134-598`). Preserve the youth
   name-shield logic byte-for-byte; PGlite prod-shape test before apply.
2. Bound `get_season_game_pucks` (`gamePucks.js:153`).
3. Index the hot unindexed FKs: `featured_operator_events(league_id)`,
   `(tournament_id)`, `gamesheet_links(league_id)`, `game_puck_results(post_id)`.
4. Record the 12 live cron schedules as a documentation migration (comment-only or
   idempotent `cron.schedule` upserts) — kills the drift permanently.

### PR-B · P0 · **Sonnet 5** — "Event pages: cache + per-tab deferral"
1. League/Tournament: defer Schedule/Standings/Teams queries until their tab first
   activates (mirror the existing lazy-Feed pattern, `League.js:401-421`); keep only
   the event row + divisions eager for the header. Realtime `loadLive` behavior
   unchanged.
2. Wrap static data in `cached()`: `getLeague`/`getTournament` row (60s),
   `getLeagueTeams` (60s), divisions (already done), `getTeamMembers` (60s) —
   invalidate on the manage-page writes.
3. Wrap the 5 Stats-tab calls in `cached()` keyed `(source,id,divisionId)`, 60s TTL,
   invalidated by the parent page's existing realtime tick.
4. One-liner: `invalidate('operator:'+slug)` in the two admin operator writes.

### PR-C · P0 · **Sonnet 5** — "Cheap sweeps: images, waterfall, bundle"
1. `loading="lazy"` on `Avatar` img (`Logos.js:251`) — fixes Feed/Comments/
   Notifications/DMs in one line (keep composer's own avatar eager).
2. Compress + resize `/onboarding-ice.jpg` (373KB → target ≤80KB, mobile-sized
   variant); same treatment anywhere it's referenced (`Landing.js:149`, `Home.js:25`).
3. Discover trending images → `ui/Img` lazy (`Discover.js:159`).
4. Feed `load()`: fire `getLikedPosts` + `getReactions` via `Promise.all`
   (`Feed.js:466-485`).
5. `gameCardData.js:9` static `import './shareCard'` → dynamic `import()` — pulls the
   815-line canvas composer out of the eager main bundle (926KB raw / ~260KB gzip).
6. Route `uploadCreativeImage` through `compressImage` + 1yr cacheControl
   (`ads.js:88-96`).

### PR-D · P0 · **Opus 4.8** — "Realtime + push correctness" (correctness-critical)
1. Delete GameDetail's drifted duplicate subscription (`GameDetail.js:216-235`) → use
   shared `subscribeGame()` — so the gated broadcast path covers BOTH game surfaces
   when flipped.
2. Home: realtime ping re-runs only `getGamedayGames` + `getLiveTicker` (+ featured
   LIVE flag), not the full 6-way `loadHome()` (`home.js:344-352`).
3. Chunk push fan-out in `send-recap-push`, `send-league-recap-push`,
   `send-gameday-hype`: batches of ~100 with bounded concurrency; keep per-sub error
   isolation (redeploy the 3 functions).
4. `subscribeInbox`: skip opening the channel when the user has zero conversations
   (most pilot users) — cheap cut of the unfiltered-channel population; full
   recipient-scoped redesign stays P2.

### PR-E · P1 · **Opus 4.8** — "RLS policy consolidation on the feed tables"
Consolidate the multiple permissive policies on `posts` (15), `likes` (15),
`comments` (15) — merge per-role/per-action policy stacks into single policies with
OR'd predicates. Highest-risk change in the plan (feed visibility + youth privacy
live here): full PGlite prod-shape suite + live REST verification matrix (anon /
member / author / admin × global / team / league / tournament feeds) before apply.
Also `follows`/`game_goals`/`games` (5 each) if the pattern generalizes cheaply.

### PR-F · P1 · **Sonnet 5** — "Freshness + pagination debt"
1. Team.js: add the missing realtime subscription (filtered to the team's game rows,
   League.js pattern) + convert `getTeamGames` fetch-then-slice to keyset.
2. `getComments` cursor + "load earlier" in CommentThread (`posts.js:330`).
3. `getMessages` `before` cursor + "load earlier"; add `p_limit` to
   `list_my_conversations` (verify its SQL on prod first — bound currently
   unverifiable from the repo).
4. Notifications + Discover: load-more affordances on the existing bounds.

### P2 / accepted-for-now (logged, no PR yet)
- **Event-wide League/Tournament channels (N×M RLS evals)** — fine at pilot scale
  (one event, ≤~15 concurrent games); the real fix is the already-built, env-gated
  broadcast path — flip it as the dedicated Black-Bear-scale project with load tests.
- DM inbox recipient-scoped broadcast redesign (DM volume ≪ goal volume).
- `getFollowingPosts` server-side join (the `.limit(1000)` follows lookup).
- 52 unused-index cleanup; auth connection-pool percentage strategy.
- Duplicate bell/badge instances — verify never co-mounted, then dedupe.
- Hoist the Home/GamedayStrip duplicate context fetch + channel into a shared
  app-level provider (fold into PR-D only if trivial after D.2).

---

## 4. Performance budgets (the bar each screen must hold)

| Screen | Budget @ first load | Budget on live update |
|---|---|---|
| Home Ice | ≤ 8 queries, skeleton < 100ms, hydrated < 1.5s on 4G | ≤ 3 queries per goal ping (post-PR-D) |
| League/Tournament | header < 1s; ≤ 3 queries before first tab paint; ≤ 3 per tab activation (post-PR-B) | games+standings only, 1.5s debounce |
| Stats tab | ≤ 5 queries **once per 60s** per event+division (cached); RPC payload ≤ 100 rows each | — |
| Live game (GameDetail/PublicGame) | ≤ 4 queries | 1 shared channel; ≤ 2 queries per event, 400ms debounce |
| Feed | ≤ 3 round-trips to first paint (posts ∥ likes ∥ reactions) | keyset page = 1 query |
| Team | ≤ 4 queries | subscribed (post-PR-F), no manual-refresh reliance |
| Push fan-out | any single edge invocation ≤ 100 concurrent sends | — |
| Main bundle | ≤ 200KB gzip (from ~260KB) after PR-C.5 | — |

**Measure before/after:** query counts via the Network tab on throttled 4G for each
budget row; bundle via build output; RPC timing via `explain analyze` on the four
leaderboard functions pre/post LIMIT.

---

## 5. Confirmed solid — do not touch
Feed keyset pagination · scorekeeper offline queue (caps, backoff, page-drain, SW
fallback) · `sync-scorekeeper-queue` hardening (MAX_OPS 200, allowlists) · all
badge polling (5-min documented fallbacks under Realtime) · goal-moment pipeline
(zero extra queries) · `uploadMedia` compression chokepoint · service worker scope ·
standings as server-side views · `/o/:slug` (the template) · middleware/OG edge
caching · Realtime `eventsPerSecond: 10` client cap.

---

**🚦 GATE 1 — awaiting Pete's sign-off on the PR plan above. On approval each PR
ships separately in order A → B → C → D (P0s), each through build + QA; A, D, E get
adversarial QA on the stronger model per WORKFLOW.**
