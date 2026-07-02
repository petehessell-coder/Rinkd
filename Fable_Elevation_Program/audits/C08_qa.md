# C08 — Adversarial QA (Stage 3) · PRs A / B / D

**Reviewer:** Opus 4.8 (fresh session, did not build these). **Date:** 2026-07-02.
**Method:** hostile diff review vs approved scope (`audits/C08_performance.md` §3),
byte-level SQL diff vs the original migration + live prod `pg_get_functiondef`,
prod RLS/ACL verification via read-only Supabase MCP, PGlite prod-shape harness,
and a full anon browser test of PR-B on the demo league + demo tournament + `/o/demo`.

Scope reference: PR-A = migration `20260702200000` (5 RPC bounds + 4 FK indexes +
comment-only cron docs); PR-B = event-page per-tab deferral + `cached()`; PR-D =
shared `subscribeGame`, narrow `loadHomeLive`, chunked push edge fns, gated
`subscribeInbox`.

---

## PR-A · `perf/c08-a-stats-bounds` (#34) — **PASS (mergeable), 1 NOTED**

### What was verified
1. **Byte-for-byte body diff vs `20260621130000_…sql`** (scripted, whitespace-exact)
   for all 4 leaderboard RPCs: `get_league_skater_stats`, `get_league_goalie_stats`,
   `get_tournament_skater_stats`, `get_tournament_goalie_stats`. Result:
   **BODY BYTE-IDENTICAL** ignoring the single added `LIMIT greatest(1, least(p_limit,500))`
   line. Headers (returns table, `language sql stable security definer set search_path
   to 'public'`) identical minus the added `p_limit int default 100` param. The
   youth-shield `CASE` logic (`migration 20260702200000:160-161, 268-274, 384-385,
   518-525`), `shield_minor_player_id(...)`, `is_youth_tournament(...)`,
   `is_minor_profile(...)` are untouched. **No drift.**
2. **`get_season_game_pucks` reproduction vs prod** (`pg_get_functiondef`, 2026-07-02):
   **byte-perfect** — the branch body equals the live prod definition with only
   `p_limit` + the LIMIT line added (`20260702200000_…sql:549-593`).
3. **Overloads dropped, not duplicated:** each RPC does `drop function if exists`
   the OLD signature, then `create or replace` the new one (`:48, 186, 296, 411, 547`).
   Harness confirms **exactly 5 signatures, each carrying `p_limit integer`, no
   lingering old arity.**
4. **PGlite prod-shape harness** (`scripts/c08-smoke/pglite-migrations.mjs`):
   **all checks green** — idempotent (2 passes), `p_limit=3`→3 rows, `p_limit=0/-5`
   clamp up to 1, `p_limit=100000` clamps ≤500, default (no arg) returns all rows,
   and the **youth vs adult output is byte-identical pre/post-migration** (jersey-7
   youth shielded to `#7`; adult jersey-10 shows real name; minor-in-adult jersey-99
   shielded via `is_minor_profile`). All 4 FK indexes created.
5. **ORDER BY determinism (LIMIT top-N stability):** every recreated SELECT keeps a
   trailing `ORDER BY` before the LIMIT (`:177, 287, 402, 537, 592`). Ordering keys:
   skaters `points desc, goals desc, pim asc`; league goalies `gaa asc nulls last`;
   tournament goalies `gaa asc nulls last, save_pct desc`; pucks `pucks_won desc,
   jersey asc`. Not *fully* total orders, so **ties AT the LIMIT cutoff are
   nondeterministic** — but the default limit is 100 and real event boards are far
   smaller (demo league = 108 skaters is the largest observed, still < the 500 clamp
   ceiling and only cut by the client's own display slicing, not by this LIMIT at
   100+ for goalies/pucks). This matches the audit's own budget ("RPC payload ≤ 100
   rows"). **Acceptable** — same ordering the un-bounded original used; the LIMIT
   never bites at pilot scale. No fix required.

### NOTED (PR-A)
- **Grant drift vs the migration's own claim.** Prod ACL today is
  `=X/postgres | postgres | anon | authenticated | service_role` — i.e. **PUBLIC has
  EXECUTE**. The new migration does `revoke all … from public` then grants only
  `anon, authenticated, service_role` (`:180-181, 290-291, 405-406, 540-541, 595-596`).
  This **removes the PUBLIC grant** the header claims is "preserved exactly." It is
  functionally **safe and arguably better** (anon + authenticated still execute, which
  is all PostgREST needs; it's a tightening), but the comment "grants preserved
  exactly" is inaccurate. Either drop the claim or add `grant … to public` to match
  prod. Not a blocker.

**Verdict: mergeable.** Migration is correct, idempotent, prod-shape-tested, youth
shield intact. Apply after merge per the runbook; then run the post-apply
`pg_get_function_identity_arguments` check in the migration header.

---

## PR-B · `perf/c08-b-event-page-cache` (#35) — **PASS (mergeable), 2 NOTED**

**Build:** `CI=false GENERATE_SOURCEMAP=false npm run build` → **clean** (only the
pre-existing react-datepicker critical-dependency warning).

### Browser test (anon, demo league `934dd511-…`, demo tournament `7f93f4f1-…`, `/o/demo`)
All via the `rinkd` dev server; screenshots captured; **zero console errors** across
every step (only pre-existing React-Router-v7 future-flag warnings).

- **(a) Default landing (Schedule) paints:** header stat bar **12 / 36 / 30 / 6**
  correct; GameRows show each side's W-L-T (`3-2-0`, `2-2-0-1`) → `standings` loaded
  and `recordByLt` populated.
- **(b) Tab activation with skeleton, no blank flash:** Standings → full table
  (GP/W/L/OTL/T/GF/PTS); Teams → 12 teams across 3 divisions; Stats → Game Pucks +
  Skaters(108) + Goalies(12) with real adult names (cached RPCs). Each loads on first
  activation.
- **(c) Cold deep link `?tab=standings`:** standings paint directly, header stats
  still correct.
- **(d) Header + hero on a NON-games landing tab (`?tab=info`):** header shows the
  **correct 12/36/30/6 from the eager `getLeagueStatusCounts` head:true fallback**
  even though `games`/`teams` arrays never loaded; hero pill "IN SEASON"
  (`statusCounts.live=0`). This is the load-bearing correctness check for the whole
  deferral design — **it holds.**
- **(e) `/o/demo`** renders (events + LIVE NOW strip) — `operators.js` invalidatePrefix
  change didn't break the read path.
- **Demo tournament:** lands on Standings (default), hero **● LIVE** pill (eager
  `liveCount`); **Bracket tab champion derivation works** ("🏆 TOURNAMENT CHAMPION /
  ICE HOGS", full bracket tree). `champion`/`bracketGames` derive from the lazy games
  array and render only inside the gated Bracket tab.
- **Stress:** rapid 9-tab switch + cold deep links → no double-fire crashes (the
  `*Loading` guards hold), no console errors.

### Independently traced consumers of `games`/`standings`/`teams` (the risk surface)
Verified every consumer OUTSIDE the deferred tab bodies is either (i) fed by the eager
head:true counts, or (ii) only rendered inside a gated tab:
- **Header stat bar** (`League.js:840-848`) → `teamsLoaded ? teams.length : statusCounts.*`
  fallback. ✅
- **Hero LIVE pill** (`League.js:736-741`, `Tournament.js:683`) → `gamesLoaded ?
  liveGames… : statusCounts.live / liveCount`. ✅
- **`PublicLeagueLanding` / `PublicTournamentLanding`** (anon-non-demo only) → `load()`
  eagerly fetches the full arrays for that branch (`League.js:364-368`,
  `Tournament.js:283-292`). ✅
- **`LiveGameStrip`** (Tournament Feed tab) → the tab-activation effect loads games on
  `activeTab === 'Feed'` (`Tournament.js:519-525`); `liveGames` passed is `[]` until
  loaded, then hydrates. ✅
- **Bracket champion** → gated inside Bracket tab. ✅
- **`?division` filtering** (`scopedGames`/`divisionGames`, `scopedStandings`) → derived
  vars consumed only inside tabs. ✅
- **SEO** → League `<SEO>` description is static (`league.name`), no games/standings;
  Tournament has no `<SEO>`. ✅

### loadLive realtime hygiene (verified)
- League `loadLive` reads `gamesLoadedRef`/`standingsLoadedRef` (refs, not state) →
  stays `[id]`-stable (`League.js` callback closes on `[id]`); realtime effect deps
  unchanged. A goal tick before any tab loads → `jobs` empty → only `invalidatePrefix`
  + status-count refresh; **no crash, no wasted games fetch.**
- Tournament `loadLive` `[id]`-stable (`Tournament.js:395`), realtime effect
  `[id, loadLive]` (`:450`) → channel re-subscribes only on `id` change. ✅

### cache.js contract (verified)
- **`lib/cache.js` was NOT modified.** The builder made the *fetchFns* throw
  (`if (error) throw error`), so a transient Supabase error is never memoized: the
  `.then(store.set)` is skipped and `.finally` clears the inflight entry. Existing
  `cached()` callers (`leagueDivisions`, `operators`) already used the same throw
  shape — **no regression.** StatLeaderboards wraps the whole thing in try/catch →
  sets the error state (`StatLeaderboards.js:245-260`); `getSeasonGamePucks` rethrows,
  same as pre-PR-B.

### Cache-key ↔ invalidation match (string-for-string, verified)
- Keys written: `stats:${source}:${id}:${divKey}:skater|goalie`
  (`StatLeaderboards.js:246,252`) and `stats:${normScope}:${scopeId}:all:pucks`
  (`gamePucks.js:157`), where `source`/`normScope` ∈ {`league`,`tournament`} (props
  passed from `League.js:890` / `Tournament.js:889`).
- Invalidation: `invalidatePrefix('stats:league:'+id)` / `('stats:tournament:'+id)`
  (`League.js` loadLive, `Tournament.js` loadLive). `'stats:league:<uuid>:all:skater'`
  **starts with** `'stats:league:<uuid>'` → **matches, incl. every division key and
  the pucks key.** Confirmed string-for-string. ✅

### NOTED (PR-B)
1. **`invalidatePrefix` prefix has no trailing `:`** — `invalidatePrefix('stats:league:'
   + id)` (no trailing colon) would, in principle, also match a different id that is a
   string-prefix of this one. In practice ids are full same-length UUIDs, so one can't
   prefix another — **safe today.** A trailing `:` on the prefix (or on the key layout)
   would make it robust by construction. Cosmetic.
2. **`_lastCtx`/mid-session team-follow freshness (cross-cutting w/ PR-D)** — n/a here
   (that's PR-D's `home.js`); flagged under PR-D.

**Verdict: mergeable.** This is the biggest behavioral change and it holds up under
anon browser testing on both event types + the operator page, with correct header
fallbacks on every landing tab, correct realtime hygiene, and correct cache
invalidation. No MUST-FIX.

---

## PR-D · `perf/c08-d-realtime-push` (#37) — **PASS (mergeable), 1 NOTED**

**Build:** clean.

### 1. `gameRealtime.js` — game_penalties addition (verified)
- Default `postgres_changes` path now also watches `game_penalties`
  (`gameRealtime.js:60-61`) when `kind !== 'team'` — matches the old GameDetail inline
  behavior. **Broadcast path (`REACT_APP_GAME_BROADCAST=1`) is unaffected**: it
  re-fetches the full snapshot on any ping (`:42-45`), so penalties are covered there
  with no mapping change. ✅
- **PublicGame impact:** PublicGame uses `subscribeGame` and now receives penalty pings
  it didn't before, but it debounces every ping into a 400ms full reload
  (`PublicGame.js:177-178`) — **harmless coalesced refetch.** ✅

### 2. GameDetail kind derivation (verified — all 3 kinds)
- Old: `rowTable = isLeague ? 'league_games' : isTeamGame ? 'team_games' : 'games'`;
  goals+penalties when `!isTeamGame`.
- New: `kind = isLeague ? 'league' : isTeamGame ? 'team' : 'tournament'`
  (`GameDetail.js:220`) → `subscribeGame`'s `ROW_TABLE = {league:'league_games',
  team:'team_games', tournament:'games'}` (`gameRealtime.js:30`) gives the **identical
  row table for every kind**, and goals+penalties added when `kind !== 'team'` =
  old `!isTeamGame`. **Byte-equivalent selection.** ✅
- Debounce 400ms preserved; `unsub()` + `clearTimeout` on unmount / gameId change; deps
  `[gameId, isLeague, isTeamGame, load]` unchanged. ✅

### 3. `home.js` loadHomeLive + `_lastCtx` (verified, 1 NOTED)
- `loadHomeLive` re-runs exactly the 3 live layers — `getGamedayGames(userId,
  {windowHours:168, ctx})` (the **same signature** as the mount path at `home.js:347`),
  `getFeaturedEvent()` (returns `{...base, isLive}`, `:105-109`), `getLiveTicker(12)`.
  Merge keys `live / upcoming / ticker / featured.isLive` **match Home.js state shape
  exactly** (consumed at `Home.js:139,151,164,323`). Featured merge guards
  `prev.featured && d.featuredIsLive !== undefined` → null-featured stays null. ✅
- Merge never blanks the board: `if (!prev) return prev`; catch keeps last good state
  (`Home.js:78-98`). ✅
- **_lastCtx staleness — NOTED, not a bug:** `_lastCtx` is set only by full `loadHome`
  (`home.js:344`). The realtime channel subscribes solely to
  `follow.tournamentIds`/`leagueIds` (`Home.js:104-110`) — **team follows never open a
  subscription**, and a newly-followed tournament/league can't ping until a full
  `loadHome` reruns (which updates BOTH `followIds` and `_lastCtx`). So the subscription
  set and `_lastCtx` move in lockstep. The only gap: follow a new *team* mid-session
  with Home kept mounted → a live game for that team wouldn't surface in the live tiles
  until the next mount. Home is route-based (remounts on navigation, and following
  happens on League/Tournament/Team pages), so in practice `_lastCtx` is fresh on every
  Home view. **Minor freshness gap, self-heals on remount.** Acceptable.

### 4. Edge functions — chunking (all 3 verified)
`send-recap-push`, `send-league-recap-push`, `send-gameday-hype`:
- **BATCH_SIZE = 100** in all three; sequential `for` loop over 100-slices, each
  `await Promise.allSettled(batch.map(sendOne))`. ✅
- **Stale-sub cleanup EXACTLY preserved:** `sendOne` still pushes `s.user_id` to
  `stale` on 410/404 and on JSON-parse failure; the `delete().in('user_id', stale)`
  runs **once after all batches** (correctly hoisted outside the loop). `sent++` on
  success preserved; ledger/return JSON shape unchanged. ✅
- **`Promise.all` → `Promise.allSettled`** is strictly *safer* (each `sendOne`
  already swallows its own errors, so neither rejects; allSettled removes any residual
  reject-propagation risk). **No `await` dropped** that changes error propagation to the
  HTTP response — the response is still emitted after all batches + the stale delete.
  ✅
- Only other changes: added `failed` counter + a `console.log('…done', …)` line. No
  payload / VAPID / auth / query changes. ✅

### 5. `messages.js` hasAnyConversations (RLS verified on prod, fail-closed)
- Prod RLS on `conversation_participants`: **enabled** (`relrowsecurity=true`); policy
  `cp_select` (SELECT) `USING is_conversation_participant(conversation_id)` for role
  `{-}` (all roles). `is_conversation_participant` = `SECURITY DEFINER` selecting
  `where … user_id = current_profile_id()`. → a bare `count(*)` head:true returns **only
  the caller's participant rows**, so `count > 0` ⇔ caller has ≥1 conversation. The
  RLS-scoping claim **holds.** ✅
- **Fail-closed:** anon / no session → `current_profile_id()` NULL → policy false for
  every row → count 0 → `hasAnyConversations()` false → `subscribeInbox` never opens.
  `hasAnyConversations` also catches errors → false; MessagesIcon `.catch(() => {})`
  keeps polling-only. The async gate checks `cancelled` before subscribing and `unsub`
  defaults to `() => {}` — **no channel leak on unmount-first or on zero-DM users.** ✅

### NOTED (PR-D)
- **Operational:** the 3 edge functions must be **redeployed** for the chunking to take
  effect (code-only change; not a merge blocker but belongs in the merge runbook).
- `_lastCtx` mid-session team-follow freshness gap (detailed above) — accept & log.

**Verdict: mergeable.** Realtime consolidation is byte-equivalent for all three game
kinds, the narrow Home reload merges correctly and can't blank the board, the edge
chunking preserves stale-sub pruning and error isolation exactly, and the inbox gate
is RLS-correct and fail-closed. No MUST-FIX.

---

## Prioritized fix list

### MUST-FIX (blocks merge)
- **None** across PR-A, PR-B, PR-D. All three are mergeable as-is.

### SHOULD-FIX
- **[PR-A]** Reconcile the grant statement with the "grants preserved exactly" claim:
  either re-add `grant execute … to public` (prod has PUBLIC EXECUTE today) or amend
  the header comment to state that PUBLIC is intentionally dropped (tightening).
  Functionally safe either way; it's a truthfulness/consistency fix on a
  correctness-critical migration.

### NOTED (accept & log; no code change required)
- **[PR-A]** LIMIT top-N ties at the cutoff are nondeterministic (non-total ORDER BY),
  but the LIMIT never bites at pilot board sizes and matches the original ordering.
- **[PR-B]** `invalidatePrefix('stats:{source}:{id}')` omits a trailing `:`; safe with
  full-UUID ids, but a trailing colon would make it collision-proof by construction.
- **[PR-D]** `home.js` `_lastCtx` can be stale after a mid-session *team* follow while
  Home stays mounted; self-heals on remount (Home is route-based, team follows don't
  open a subscription). 
- **[PR-D]** Redeploy `send-recap-push`, `send-league-recap-push`, `send-gameday-hype`
  after merge (add to runbook).

---

## Per-PR verdict summary
| PR | Verdict | MUST-FIX | SHOULD-FIX | NOTED |
|----|---------|----------|------------|-------|
| **A** #34 stats bounds | ✅ mergeable | 0 | 1 (grant claim) | 1 |
| **B** #35 event-page cache | ✅ mergeable | 0 | 0 | 2 |
| **D** #37 realtime + push | ✅ mergeable | 0 | 0 | 2 |
