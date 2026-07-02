# C06 — Game Day Experience · Delta Audit (Gate 1)

**Date:** 2026-07-02 · **Track A** (elevation — this audit IS the spec) · **Pilots:** Jul 24 / Aug 1
**Method:** 3 parallel code auditors (scorekeeper · fan flow · after-the-buzzer) + live
prod verification (stream coverage, RSVP row counts, RPC definitions via
`pg_get_functiondef`). Delta audit on top of S05/S06/S08 + GS-1 offline + C08 — only
what is true TODAY and what is LEFT.
**Status: 🚦 GATE 1 — no code changed. Ranked wins below for Pete's sign-off.**

---

## 1. The two bars, measured

**Scorekeeper `<5s` goal: ✅ MET on the happy path.** From the live scorer screen a
known-roster goal is **3 taps** (tap team side → tap jersey chip → Save; team
pre-selected, period defaulted, assists optional — `ScorerView.js:722,1829`). Wake
lock fully wired (`useWakeLock` engaged on mount, re-acquires on visibility return,
honest fallback banner on unsupported browsers). Offline is genuinely bulletproof:
client UUIDs before network, order guard, 5s→60s captive-portal backoff, SW
background sync, merge-on-reload, dead-letter split by 4xx/5xx — no vanish or
double-apply path found. **The bar breaks only when there's no lineup** (jersey chips
degrade to typed digit entry) and on penalties (native `<select>`s vs tap-chips).

**Fan `<10s` to stream: ❌ FAILS — not on taps, on content.** The taps are already
minimal: logged-in cold open → Live Now hero → score = **1 tap + ~2s**; anon share
link → score = **0 taps**; stream = 1 more tap **when a stream URL exists**. But
measured live on prod: **only 7 of 61 league games (11.5%) in the last 30 days carry
a `youtube_url`; the tournament `games` table has NO stream column at all; and all 7
`rinks.live_barn_venue_id` values are the seeded placeholders — LiveBarn is 100% dark
in production.** ~9 in 10 real games have no "in the stream" leg. The button honestly
disappears (show-only-when-present ✅) — the gap is schema + content ops, not UI.

---

## 2. P0 — Youth-privacy guardrail breaches (the C06 guardrail, hit 4 ways)

The collection's guardrail is "no minor PII in public galleries." The audit found the
S06 pattern — *share-card suppression ≠ display suppression* — recurring in four
places, one of them server-side:

| # | Leak | Evidence |
|---|---|---|
| **PII-1** | **`get_game_recap_card` (SECURITY DEFINER, prod-only, untracked in repo) returns real scorer names with ZERO youth check** — `goals[].name` coalesces profiles.name → invite_name → team_members name. `RecapCard.js:214-231` renders it unconditionally on Home/Feed/League/Tournament/TeamFeed. Every youth final auto-posts a recap that prints minors' names to any viewer of a public league feed. Verified via live `pg_get_functiondef` 2026-07-02. | The widest blast radius: the FIRST beat of the ritual, on the highest-traffic surfaces. (The SHARE path in `gameCardData.js:44-63` is correctly gated — display path is not.) |
| **PII-2** | **Season Game Pucks leaderboard lists a minor winner's real name publicly** — `settle_game_puck` writes `winner_name` unconditionally; `get_season_game_pucks` returns `player_name` with no youth check; `SeasonGamePucks.js:44-47` renders it raw and its callers (`League.js:1023`, `Tournament.js:996`) pass no youth prop — unlike the adjacent `StatLeaderboards` call 3 lines below which does it correctly. | Anon-visible on the public Stats tab, permanent. |
| **PII-3** | **Game Puck vote chips print candidates' real names on youth events** — `GamePuckCard.js:100-121` builds `candidatesByTeam` from raw `lineupByTeam`, bypassing the `hideNames`-aware helpers that the settled-winner display correctly uses (`:172`). | One-line fix; same file already has the right pattern. |
| **PII-4** | **Gallery has no youth awareness at all** — tab renders unconditionally on League/Tournament (`League.js:1090`, `Tournament.js:1027`); `posts_select_all` RLS only gates `team_id`-scoped rows, not `league_team_id`/`tournament_team_id` gallery tags; free-text captions + uploader names render raw to anon (`Gallery.js:371-433`). A caption "Great game Jake #23!" on a youth event publishes verbatim to anonymous visitors. | The literal guardrail sentence in the collection. |

**Fixes (PR-1, Opus 4.8 — DEFINER RPC + youth semantics = correctness-critical):**
1. Shield `get_game_recap_card` **server-side** (null `goals[].name` when the parent
   event is youth: `is_youth_tournament()` for tournaments, `feature_profile`
   check for leagues — mirror the leaderboard RPCs' shield), AND commit the prod
   definition as a tracked migration (ends the audit blind spot). `RecapCard.js`
   falls back to `#jersey` when name is null (verify it already does).
2. Shield `get_season_game_pucks` server-side the same way + pass
   `youth={areScorersHidden(parent?.settings)}` into `SeasonGamePucks` (belt +
   suspenders, mirroring `StatLeaderboards.js:357-379`).
3. `GamePuckCard.js:106` — route candidate names through `hideNames`.
4. Gallery: gate the tab for ANON visitors behind `isPublicSharingEnabled(settings)`
   on youth events (the same key that gates public game pages); suppress uploader
   name + caption for anon when `areScorersHidden`; add the `classifyImage()` stub
   call to the upload path (parity with every other upload surface, so Gallery gets
   moderation for free when Sightengine ships).
PGlite prod-shape test for both RPC changes (byte-identical adult behavior, shielded
youth fixture); youth QA matrix before merge.

---

## 3. P0 — Ritual correctness bugs (found live, all three verified on prod)

| # | Bug | Evidence |
|---|---|---|
| **BUG-1** | **RSVP is functionally broken for league + tournament games.** `team_game_rsvps.game_id` FKs to `team_games.id` only; `HypeCard`/`RsvpBlock` write `league_games`/`games` ids into it → FK violation → optimistic UI silently rolls back. **Prod has exactly 1 RSVP row, ever.** | The "I'm in" loop the game-day ritual is built on has never worked on real games. |
| **BUG-2** | **League recap push opens a broken page** — `send-league-recap-push/index.ts:133` sends `/league-game/${id}` without `?type=league`; `GameDetail.js:91` therefore queries the tournament table and shows "Game not found." | Every league recap push tap, logged-in or not. |
| **BUG-3** | **`ProtectedRoute` drops the deep link** — `App.js:128` redirects unauthenticated (or still-rehydrating, the cold-PWA-launch race) users to bare `/` with no `returnTo`, though the `LoginRedirect`/`?returnTo=` pattern exists 30 lines up. Strands: push-notification taps (fan) AND the scorekeeper's game link on first login (both auditors hit this independently). | One root cause, two personas. |

**Fixes (PR-2, Opus 4.8 — schema + push + auth routing):**
1. RSVP schema per the C12 pattern: add nullable `league_game_id` (FK league_games)
   + `tournament_game_id` (FK games) to `team_game_rsvps`, `num_nonnulls(...)=1`
   check across the three id columns, unique per (user, game) per column; rewire
   `lib/rsvp.js` to write/read the right column by game source; `HypeCard`/
   `RsvpBlock` pass source. Migration PGlite-tested; reminders/.ics readers of the
   table audited before the change.
2. One-line URL fix + redeploy `send-league-recap-push` (v14; verify_jwt true).
3. `ProtectedRoute` → `<Navigate to={`/login?returnTo=${encodeURIComponent(...)}`}>`
   using the existing `readReturnTo` flow; verify Auth.js honors it post-login and
   the still-rehydrating race waits for `loading` before redirecting (it already
   shows the loading screen — only the `!user` branch changes).

---

## 4. P1 — Scorer residue (PR-3, Sonnet 5)

1. **Lineup entry from the scorer's seat** — `LineupCTA`/`LineupModal` are never
   rendered in ScorerView (grep-confirmed); no roster → every event degrades to
   typed jersey digits. Add a "No lineup — tap to add players" affordance opening
   `LineupModal` in place, pre-scoped to the game. The single biggest remaining
   threat to the 5s bar for the volunteer persona.
2. **Finalize confirm** — a solo scorer who fat-fingers Finalize has NO recovery
   (Reopen is director-only + online-only). Per D-S10-1 (ScorerView safety confirms
   stay frictional): put Finalize behind the `ui/ConfirmSheet` primitive. Director
   Reopen unchanged.
3. **Penalty tap-chips** — severity + top ~6 penalty types as chips (goal-flow
   `pickBtnStyle` pattern); full `<select>` remains as overflow.
4. Cosmetics: sticky-header team-name clamp (`ScorerView.js:1344`, wraps at 60
   chars); goal-log collapse affordance past ~8 goals (Finalize drifts off-screen
   in blowouts).

## 5. P1 — Ritual completeness + stream reality (PR-4, Sonnet 5 + Opus for the edge fn)

1. **Tournament stream parity** — add `youtube_url` to `games` (mirror
   `league_games`), surface the field in TournamentManage's game editor, and
   `resolveStreamUrl` picks it up automatically. Small migration + form field.
2. **"Next game" after the final** — `RsvpBlock` is scheduled-only; nothing points
   forward post-final. Add a compact next-game card (team's next scheduled game,
   RSVP-tappable once BUG-1 is fixed) below the share block on GameDetail.
3. **Final-horn notification** — honest assessment of the S06 `game_final` deferral:
   the recap push ALREADY notifies event subscribers with a "🏒 FINAL · …" headline
   the moment the game finalizes — a separate `game_final` kind would double-ping
   them. The real gap is **rostered team members who aren't event subscribers**
   (hype covers them pre-game; nothing covers them at the horn). Recommend: extend
   the two recap-push audiences to include the two teams' rostered members (league
   path; dedup against subscribers; C08 chunking already in place) instead of a new
   push kind. Redeploy = Opus seat.
4. **Recap/Game Puck card caching** — `getRecapCardWithSponsor`/`getGamePuck*` fetch
   uncached per mount; wrap in `cached()` (30s TTL) like `getSeasonGamePucks`.
   (Recap-dense feeds fire N uncached DEFINER RPCs.)

## 6. Ops items (no code, Pete's court)

- **Stream adoption:** the 10s bar is content-limited. For the pilots: get stream
  URLs onto the pilot events (league per-game field exists today; tournament field
  ships in PR-4). One URL per rink camera covers everything via the rink fallback.
- **LiveBarn:** all 7 venue IDs in prod are placeholders — the affordance has never
  rendered for anyone. Either source real venue IDs for the pilot rinks (BAM
  Strongsville etc.) before Jul 24, or it simply stays honestly hidden (no code
  change needed; the gate already works).

## 7. Confirmed DONE (delta verified — do not touch)

3-tap goal entry · wake lock end-to-end · offline queue (order guard, backoff,
background sync, merge-on-reload) · scorer 44px undo per event type · live-score
realtime on all three surfaces (no manual refresh anywhere) · goal moment
(hydration-safe, opt-in horn) · stream button show-only-when-present · 60-char/14-0
stress on fan surfaces · gallery keyset pagination · Game Puck settle cron bounded ·
share-path youth gating (stat cards, recap share, puck share) · settled-winner
display shield.

**Deferred, logged, NOT in C06:** league suspensions parity (explicit P3 scope per
in-code comments) · `/photo/:id` + per-object event OG (S07) · standings projections
(S08) · GamedayStrip-on-Home IA (Home's LiveNow covers the need) · multi-team >5
hydrate cap overflow affordance · league/tournament-level-follow GAME DAY row.

---

## Gate-1 decisions for Pete

| # | Decision | Recommendation |
|---|---|---|
| D-C06-1 | PR plan: PR-1 privacy (P0, Opus) → PR-2 correctness (P0, Opus) → PR-3 scorer (P1, Sonnet) → PR-4 completeness (P1, mixed) | Approve all four; P0s land this week |
| D-C06-2 | RSVP schema = two nullable FK columns + exactly-one check (C12 pattern) | Yes — referential integrity, no embed footgun |
| D-C06-3 | Gallery youth gating = anon loses the tab on youth events (`isPublicSharingEnabled`), captions/names suppressed for anon under `areScorersHidden` | Yes — members keep full gallery; matches the public-game-page gate |
| D-C06-4 | Final-horn push = widen recap-push audience to rostered members (dedup), NOT a new `game_final` kind | Yes — closes the S06 deferral without double-pinging |
| D-C06-5 | Tournament `games.youtube_url` column + manage field | Yes — cheap, unblocks the pilot ops item |
| D-C06-6 | Finalize gets ConfirmSheet (D-S10-1 pattern); director Reopen unchanged | Yes |

**🚦 GATE 1 — awaiting sign-off. On approval: PR-1 → PR-2 → PR-3 → PR-4, each through
build + adversarial QA (P0s + the edge-fn change on the stronger model), migrations
PGlite prod-shape-tested before MCP apply.**
