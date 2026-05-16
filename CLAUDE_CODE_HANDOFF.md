# Rinkd — Claude Code Handoff

**Created:** May 15, 2026 — supersedes the previous handoff. Self-contained: a fresh Claude Code session should be able to pick up from here without reading the prior doc.
**Last updated:** May 16, 2026 — Demo BLPA Cleveland Bash 2026 tournament seeded end-to-end (§5) and a full UI walkthrough produced a 21-item punch list (§11, NEW). Block-user feature shipped as `0468f8e3` and Report-feature + critical posts.UPDATE security fix shipped as `4a020d07` — both already on `main` and live on Vercel. DB performance pass (§5 + §6) was DB-only via Supabase MCP, no commits needed.
**Source:** continuation of the audit-fix work, all changes shipped this session pushed to `main` and live on Vercel.

---

## 1. What you're working on

Rinkd (rinkd.app) is a mobile-first social platform for the hockey community — players, parents, coaches, fans. **React 18 + React Router 6 (Create React App) + Supabase + Vercel**, shipped as a PWA. Core surfaces: feed ("chirps"), teams, leagues, tournaments, and live game scoring. Solo founder (Pete), pre-seed, moving fast toward a **June 13 BLPA tournament pilot in Cleveland**.

**This repo (`rinkd_live`) is the deployed app.** Edit code here. There is an older app copy inside the `rinkd_v4` folder — ignore it, it does not deploy. Strategy docs live in `rinkd_v4` (BLPA, brand voice, canonical data model, etc.).

---

## 2. How to work with Pete

- **Mandate:** operate as a CTO at a top-tier social enterprise — architect for scale, low latency, zero fixed cost. Communicate in the simplest terms possible.
- **Always give exact, copy-paste terminal commands** — don't describe them, write them.
- **Verify, don't assume.** Check the code, the database (via Supabase MCP), `git log` / `git status`, and the actual deploy before stating something as fact.
- Work in **batches**: make the edits, run the build check, then hand Pete a single commit command. He commits and pushes himself.

---

## 3. Dev workflow & environment

**Git / deploy:**
- Branch is `main`. Push to `main` → **Vercel auto-deploys to production.** There is no staging gate.
- GitHub repo: `petehessell-coder/Rinkd`. Vercel project `prj_fIYsPTQJ0vaYvj1w3kZkodpdqZUH`.
- **Stale `.git/index.lock` quirk:** the commit commands you hand Pete should start with `rm -f .git/index.lock &&`.

**Build check (run before every commit):**
```
BUILD_PATH=/tmp/rinkd-build npx react-scripts build
```
- Do **not** use `CI=true` — there's a pre-existing harmless webpack warning ("Critical dependency: the request of a dependency is an expression") and `CI=true` escalates it to a failure.
- Clean run ends with "Compiled with warnings" (the harmless one) + file-size output. No error block.

**Supabase:**
- Project ID: `tbpoopsyhfuqcbugrjbh`. Use the Supabase MCP — `execute_sql` for read-only checks, `apply_migration` for DDL.
- All current RLS holes flagged in the audit have been closed (two migrations applied this session — see Section 5).

---

## 4. Current state — verified May 15, 2026

`main` HEAD is **`4a020d07`**, pushed and deployed. Recent history:

```
4a020d07  feat: report posts/comments + lock down posts.UPDATE security hole
0468f8e3  feat: block user — user_blocks table + lib/blocks.js + profile/settings UI + read-path filters
02409e96  fix: pilot-readiness audit Surfaces 11-17 — all 14 items + RLS
751715c4  fix: pilot-readiness audit Surfaces 2-10 — all 23 items
69926c6c  fix: auth surface — pilot-readiness pass (A1-A6)
b00298a3  fix: audit medium/low batch 4 — structural
73030215  fix: audit medium/low batch 3 — optimistic UI, perf, error-state sweep
2575928a  fix: audit medium/low batch 2 — swallowed-error sweep
7225c923  fix: audit medium/low batch 1 — quick wins
966a22a4  feat: tournament format presets — BLPA Bash
90302f53  fix: audit highs #11/#12 — N+1 to RPC, Top Scorers RPC
e995f3ef  fix: site-audit pass — 6 Criticals + 10 Highs
37e50791  Tournament pilot ...
```

**Working tree state:** clean for audit-related work. Two pre-existing strays remain uncommitted (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them alone unless Pete asks otherwise.

---

## 5. What got done this session (the full audit)

The Medium/Low audit backlog (Batches 1–4 plus a full platform readiness pass) is **complete**. ~80 distinct findings shipped across:

### Batches 1–4 (audit Medium/Low)
- **Batch 1** (`7225c923`) — quick wins: livebarn field, calendar URLs, duplicate route, dead-end stubs, dead code, +5 small fixes.
- **Batch 2** (`2575928a`) — swallowed-error sweep: 10 files where failed writes never checked their own errors (Feed handlePost, notifications, admin moderation/feedback, crease access, team join, data export).
- **Batch 3** (`73030215`) — optimistic UI & perf: RSVP refocus race fix, TeamFeed race-safe like handler, `getLikedPosts` scoped to visible posts, HelpButton uses `useAuth()` (AuthContext extracted to `src/lib/authContext.js`), Profile upload functional setter, pagination caps on Tournaments/Teams/Leagues + `getTeamGames`, ScorerView `changeScore` functional update, distinct error/retry state on Tournament/Tournaments/Discover (rails + tabs)/Rinkside/Crease.
- **Batch 4** (`b00298a3`) — structural: realtime subscriptions on Tournament public + ScorerView (co-scorer sync), admin role-loading flash fixed (`useUserRole`/`useIsRinkdAdmin` initialize to `null`), Survey submission silent loss fixed, RinksideEditor `published_at` only stamps on transition, manual league games get a rink picker, schedule generation insert-then-delete (atomic-ish), Scoresheet tournament emails wired to `tournament_teams.contact_email` + truthful "managers notified" copy, SW update banner double-reload race removed, `renderMarkdown` URL scheme allowlist (closed a latent stored-XSS), RinksideEditor delete busy guard.

### Surface-by-surface pilot-readiness audit
All 17 surfaces reviewed. ~43 additional findings shipped:

- **Surface 1 — Auth/onboarding** (`69926c6c`, A1–A6): signUp now detects email-confirmation-required and shows a Check-Email screen; `ensureProfileForUser` helper handles deferred profile creation on first sign-in; null guard on the onboarding-close `setProfile`; 10s safety timeout on `supabase.auth.getSession()` to drop to Landing instead of infinite Loading; password minLength 6→8; iPadOS 13+ detection on Landing.
- **Surfaces 2–10** (`751715c4`, 23 items): TournamentCreate cleanup-on-failure; director-role insert error capture; TournamentManage `useCallback(load)` + BracketTab dep + page-level flash banner replacing every `alert()`; Tournament public scorer-button shown to assigned scorers + dead standings sub removed; ScorerView score now **derived from goal log** via `syncScoreFromGoals` (eliminates score/goal drift); +/− rollback on failure; useWakeLock returns `{ supported }` + warning banner; Finalize validates goal-count vs score; TeamManage email lookup `.limit(1)`; approve/deny errors surfaced; Profile saveEdit functional setter; RosterUpload pre-upload cap warning; push.js rolls back browser-side subscription on server upsert failure; RinksideEditor `isAdmin === null` loading gate; League public error/retry UI; tournamentScorers `needs_email` follow-up path for handle-only invites; ScheduleBuilderModal `teamGapHours` default 12 → 4.
- **Surfaces 11–17** (`02409e96`, 14 items): AdminAnalytics try/catch + admin-loading gate; Discover N+1 follow-status query replaced with one batched `.in(...)` lookup + safe ILIKE escape + follow error rollback; Settings export hard-fail when most queries fail; Landing handles `?deleted=1` confirmation toast; RinksideArticle + CreaseShow + CreaseEpisode error/retry UI; CreasePaywall refuses mailto fallback when payments are "live"; service-worker requires `content-type: text/html` to cache shell; `lib/analytics.js` caches user_id in module state (no more `getUser()` round-trip per event).

### DB migrations applied this session (via Supabase MCP)
1. **`pilot_audit_rls_tightening_and_profile_email_unique`** — tightened `games` INSERT (only tournament director/scorer); `league_games` UPDATE/INSERT (only commissioner or scorekeeper) + added missing DELETE policy (was silently no-op); `profiles.email` UNIQUE constraint; dropped duplicate "Users can update own profile" policy.
2. **`surfaces_11_17_rls_volunteer_slots_and_analytics_events`** — `volunteer_slots` UPDATE got a WITH CHECK (was missing — anyone could plant another user into an open slot); `analytics_events` INSERT now requires `user_id IS NULL OR user_id = auth.uid()` (was `true` — anyone could impersonate any user's analytics).

### Evening of May 15 — DB performance pass (Supabase advisor)

Triggered by the "DB index audit" item from the post-pilot roadmap. Pulled the Supabase performance advisor — it surfaced **91 `auth_rls_initplan` WARNs, 90 `multiple_permissive_policies` WARNs, 25 unindexed FKs, 23 unused indexes**. Real workload signal from `pg_stat_statements` was tiny (80% of total exec time is Supabase Realtime internals; hottest app query — unread-notifications badge poll — is 0.09 ms mean), so this pass was prophylactic for pilot scale, not "fix today's slow queries."

Three migrations applied via MCP (no app code changes, so no commit/Vercel deploy — DB is shared, live in prod immediately):

3. **`pilot_audit_fk_indexes_batch`** — added 25 FK-covering indexes. Every FK column flagged by the advisor (e.g. `team_members_user_id_idx`, `notifications_actor_id_idx`, `games_scorekeeper_id_idx`, all 5 `notifications_*` FKs, etc.) now has a covering btree. Pre-pilot tables are tiny so the build was near-instant. `CREATE INDEX IF NOT EXISTS` throughout — idempotent.
4. **`pilot_audit_rls_initplan_rewrite_91_policies`** — every public RLS policy that used bare `auth.uid()` rewritten to use `(select auth.uid())`. Wraps the call so it evaluates **once per query** instead of once per row. 115 bare → 115 wrapped, semantically identical. The script-generated file is `/tmp/rls_initplan_migration.sql` and the generator is `/tmp/gen_rls_migration.py` if you ever need to re-run it.
5. **`pilot_audit_rls_fix_typo_and_is_hidden_bypass`** — two fixes: (a) restored `comments."Users create their own comments"` to INSERT (it had been accidentally rewritten as DELETE in migration #4 due to a paste error — no user impact, two other INSERT policies covered the gap, caught by a post-apply audit script comparing original vs current `pg_policies`); (b) closed the **`is_hidden` moderation bypass** — `comments` and `posts` each had two duplicate `"qual: true"` SELECT policies (`"Comments are viewable by everyone"`, `"Comments viewable by everyone"`, same for posts). Because PERMISSIVE policies OR-combine, those blanket-`true` policies were overriding the `is_hidden = false OR auth.uid() = author_id OR is_commissioner(auth.uid())` filter on `comments_select_all` / `posts_select_all`. Hidden comments/posts were therefore visible to anyone via the API. Dropped the four `true` dupes; now `is_hidden = true` rows are only visible to authors and commissioners. No data was hidden at apply time (verified: 0 NULL `is_hidden`, 0 `is_hidden = true` on either table), so no visible behavior change for current rows.

**Advisor score after this pass:** `auth_rls_initplan` 91 → **0**. `unindexed_foreign_keys` 25 → **0**. `multiple_permissive_policies` 90 → 80 (the −10 is from removing the four dupes above; the remaining 80 are real redundant policies — see §7). `unused_index` 23 → 48 — expected jump, because the 25 new FK indexes haven't been hit by traffic yet; will clear at pilot.

### Late evening of May 15 — Block-user feature (Sprint 4F pre-pilot)

The "Block user" Sprint 4F item from the previous roadmap is **shipped** — schema, lib, two UI surfaces, six read-path filters. Standard social-app behavior: bidirectional invisibility, auto-unfollow on block, dedicated Settings list.

6. **`block_user_feature_user_blocks_table`** — new `public.user_blocks` table with `(blocker_id, blocked_id)` PK, `CHECK (blocker_id <> blocked_id)`, both FKs `ON DELETE CASCADE`, plus a `user_blocks_blocked_id_idx` for reverse-direction lookups. RLS: each side can SELECT rows that involve them (needed so the *blocked* side can filter the *blocker's* content from their feed — standard Twitter/Insta pattern); only the blocker can INSERT or DELETE. All `auth.uid()` references already wrapped as `(select auth.uid())` to stay consistent with the perf pass.

**Code changes (5 modified, 1 new):**
- **New** `src/lib/blocks.js` — module-scoped cache of `Set<uuid>` of all blocked IDs (either direction), refreshed via `onAuthStateChange` (mirrors `lib/analytics.js`). Exports: `blockUser`, `unblockUser`, `isBlockedByMe`, `listMyBlocks`, `getBlockedIds`, `filterBlockedIds`, `excludeBlocked(query, col)`. `blockUser` does a best-effort blocker→blocked unfollow at the same time (reverse direction can't be deleted client-side because of the `follows` RLS — see §9).
- `src/lib/posts.js` — `getPosts`, `getFollowingPosts`, `getTeamPosts`, `getComments` all filter blocked users. The first three use `excludeBlocked(query, 'author_id')` server-side; `getComments` filters client-side (small lists, avoids URL bloat). `getFollowingPosts` strips blocked IDs from the inclusion array *before* `.in('author_id', ids)`, plus early-returns when the filtered list is empty.
- `src/lib/notifications.js` — `listNotifications` filters by `actor_id` client-side (because `actor_id` is nullable for system notifications, a server-side `NOT IN` would incorrectly exclude null-actor rows).
- `src/pages/Discover.js` — Players tab filters search results. Teams/leagues/articles tabs are untouched.
- `src/pages/Profile.js` — Block/Unblock button beside Follow on other-user profiles. Follow button is hidden while blocked (incoherent state). Block triggers a `window.confirm` with explicit copy ("You won't see each other's posts…"). Unblock is silent (symmetric with un-follow). Local state updates the follower count when the auto-unfollow drops a follow row.
- `src/pages/Settings.js` — new "🚫 Blocked Users" section between Notification Preferences and Delete Account. Renders avatar + name + @handle + Unblock button per row; empty state for users who haven't blocked anyone.

**Build:** clean (`Compiled with warnings` + only the expected harmless `Critical dependency` webpack warning). Bundle +1.39 kB.

**Shipped as `0468f8e3`** — migration live in prod, code on Vercel. Smoke test by blocking a second account and walking Feed → Discover → Notifications → Settings → Unblock → Feed.

### Late evening of May 15 — Report feature + critical posts.UPDATE lockdown

**Security finding (Tier 1, exploitable):** While planning the Report feature, spotted that `public.posts` had an RLS policy named `"System can update post counts"` with `qual = true` and no `with_check`. Permissive policies OR-combine, so this overrode `posts_update_own` and let **any authenticated user UPDATE any field on any post** — rewrite the content, flip `is_hidden`, mass-flag others, anything. Root cause: the `bump_post_like_count` trigger function (fires on `likes` INSERT/DELETE to maintain `posts.likes`) was NOT `SECURITY DEFINER`, so it ran as the inserting user and needed RLS permission to update `posts`. The previous engineer punted with `qual = true` instead of marking the trigger `SECURITY DEFINER`. Compare: `bump_post_comment_count` was already `SECURITY DEFINER` and worked correctly. Pre-pilot we are pre-traffic so the exploitation likelihood today is low, but at pilot scale this would be a fire.

**Report feature**: app had `is_flagged` / `flag_reason` / `flagged_at` columns on posts/comments AND an `AdminModeration` page that consumed them — but no end-user "Report" button. The admin queue was wired to content nobody could actually flag.

7. **`pilot_audit_report_feature_and_lock_down_posts_update`** — one migration bundling four changes:
   - `alter function public.bump_post_like_count() security definer` — trigger now bypasses RLS.
   - `drop policy "System can update post counts" on public.posts` — closes the bypass.
   - New `public.content_reports` table (audit trail). PK on `id`; unique `(reporter_id, target_type, target_id)` so re-reports are idempotent; `target_type` CHECK in `('post','comment')`; `reason` CHECK in `('spam','harassment','inappropriate','other')`. Indexes on `(target_type, target_id)` and `(created_at desc)`. RLS: commissioners SELECT all, reporters SELECT own, commissioners DELETE; **no INSERT policy** — writes can only come from the RPCs below (which run `SECURITY DEFINER` and bypass RLS).
   - Two SECURITY DEFINER RPCs `report_post(target_id, reason, details default null)` and `report_comment(...)`. Each: reject unauthenticated; reject invalid reason; reject self-reports; `insert ... on conflict (reporter_id, target_type, target_id) do nothing`; then `update posts/comments set is_flagged = true, flag_reason = :reason, flagged_at = coalesce(flagged_at, now())`. Preserve first-flag time (so admins can sort oldest-unresolved). EXECUTE revoked from public, granted to authenticated.

**Code changes (3 modified, 2 new):**
- **New** `src/lib/moderation.js` — `reportPost`/`reportComment` RPC wrappers (clip details to 500 chars), plus `REPORT_REASONS = [spam, harassment, inappropriate, other]` constant.
- **New** `src/components/PostActionMenu.js` — small `⋯` button + popover. Two actions: **Report** (opens a reason-picker modal with optional 500-char details textarea, submits the RPC, fires `onReported` callback) and **Block @user** (reuses `lib/blocks.blockUser` and fires `onBlocked`). **Hides itself entirely for own content** (no Report/Block on your own posts; you have delete elsewhere). Listens for outside-click + Escape to close. Hook order is intentionally `useEffect` before the early return — rules-of-hooks compliance.
- `src/pages/Feed.js` — `PostActionMenu` rendered next to each post header and on each comment row. Parent passes `onPostHidden` (filters posts by id) and `onUserBlocked` (filters posts by author_id) callbacks. Comments use local `setComments` filters.
- `src/components/TeamFeed.js` — same pattern.
- `src/pages/AdminModeration.js` — consolidated posts/comments query paths; **annotates each flagged item with a per-target report count from `content_reports`** so admins can sort by crowd weight. New small badge under the existing flag_reason badge: "N reports".

**Build:** clean (`Compiled with warnings` + only the expected harmless `Critical dependency`). Bundle +2.1 kB.

**Shipped as `4a020d07`** — migration live in prod, code on Vercel. Block-user shipped separately as `0468f8e3`.

**Smoke test**: sign in as user B (not the post author), tap `⋯` on someone's post, choose Report → pick reason → optional details → Send. The post should disappear from your feed locally; admin (Pete) then sees it in `/admin/moderation` with the flag_reason badge and "1 report" count.

### Early morning of May 16 — Demo tournament seeded + UI walk-through

**Tournament built**: `BLPA Cleveland Bash 2026` — `tournament_id = b2789d66-1d77-4a62-862d-00b550da6a98`. Pete (`fc0018c2-0a7d-4eda-9d91-4077f2f138a4`) is the director. 8 teams across 2 pools, 12 pool games + 1 championship (all `status='final'`, championship is `round='final'`), dates May 9–10 (last weekend). Format = BLPA Bash preset verbatim. Full fidelity per Pete's ask: 90 goals (with periods/times/scorer #/assists), 43 penalties (minor + major mix incl. fighting), 78 shot-on-goal rows (per period/per team), 260 lineup rows (10 players × 2 teams × 13 games, names like "Gus 'Cement Hands' Beck" carried in `game_lineups.invite_name` since the `players` table is unused). Final standings ended exactly as scripted: Beer Necessities 3-0 in Pool A, Net Profits 3-0 in Pool B, BN won the championship 4-3 (regulation, scripted goal log).

**Cleanup**: one line wipes the whole demo —
```sql
DELETE FROM public.tournaments WHERE id = 'b2789d66-1d77-4a62-862d-00b550da6a98';
```
Cascades through `tournament_teams` → `games` → `game_goals`/`penalties`/`shots`/`lineups`.

**Generator script**: `/tmp/gen_tournament.py` plus chunked SQL `/tmp/t1_header.sql` through `/tmp/t6b_lineups.sql` for re-running if Pete wants different team names / scores / dates. Will be lost on machine reboot (in /tmp). Re-generating produces fresh UUIDs.

**One DB schema constraint gotcha hit during apply**: `games.round` CHECK constraint allows only `('pool','semifinal','final','consolation')`. Initial attempt used `'championship'` and failed. Resolved by using `round='final'` for the championship game. Confusing naming overlap: the **literal string `'final'`** is a valid value in BOTH `games.round` (where it means "final round of the bracket") AND `games.status` (where it means "game completed / score is locked"). Same string, different columns, different meanings. When querying, always qualify which column you mean.

**UI walk-through (signed in as a throwaway demo viewer, since the tournament pages are auth-gated)**: walked Standings, Schedule, Bracket, Info tabs on the public view; clicked into the championship game scoresheet; walked the 5 director-manage tabs (Teams, Schedule, Bracket, Scorers, Settings); checked the ScorerView for the final. Produced a **21-item punch list in §11** with file:line refs and a priority order. Highlights: the most impactful single bug is **"Pool Pool A/B"** which is a 4-character fix in 3 files that affects standings, manage Bracket, manage Schedule, manage Teams, and the game header.

---

## 6. **Open config items** — Pete to verify in dashboards

These are the only known outstanding items from the audit. **None require code changes.**

### 🔴 Forgot-password flow is broken in production — config-only fix

**Confirmed via E2E test this session.** Decoded the Supabase reset email and found the `redirect_to` in the link was `https://www.rinkd.app` (Site URL fallback), NOT `https://rinkd.app/reset-password` that the app sends. The allowlist rejected our redirect because the apex domain isn't permitted.

This explains why **0 users have ever successfully completed a password reset** in production, including BLPA Nick (May 14 attempt — never consumed his recovery token).

**Fix — Supabase Dashboard → Authentication → URL Configuration:**
1. **Site URL:** change `https://www.rinkd.app` → `https://rinkd.app` (apex matches what Vercel serves as canonical; `www` is a 308 redirect).
2. **Redirect URLs:** add
   - `https://rinkd.app/reset-password`
   - `https://rinkd.app/*`
   - `http://localhost:3000/*`
   - any active Vercel preview origin patterns
3. Save.

**After Pete does this**, the test plan is in Section 8 below. If the listener race in `ResetPassword.js` also turns out to be real after this fix, ship the ~10-line defensive patch that handles `INITIAL_SESSION` with a recovered hash in addition to `PASSWORD_RECOVERY`.

### 🟠 Other config items (lower-impact)

- **`REACT_APP_BETA_BANNER` (Vercel env var)** — Feed shows a "🚧 Public beta" banner by default. Decide if that's the right message for BLPA opening day. Set `REACT_APP_BETA_BANNER=0` to hide it.
- **`REACT_APP_VAPID_PUBLIC_KEY` (Vercel env var)** — push subscriptions silently fail-no-key if this isn't set. Verify it's set in prod. If push hasn't been working reliably, this is likely why.
- **`REACT_APP_CREASE_PAYMENTS_LIVE` + `REACT_APP_CREASE_CHECKOUT_URL`** — when Stripe is wired. The paywall now refuses to claim "Subscribe" if the flag is on but the URL is missing (post-Surfaces 11-17 fix).
- **Supabase → Authentication → Policies → "Leaked password protection"** — flip ON. HaveIBeenPwned integration, blocks compromised passwords on signup/reset. Pure upside, one toggle.

---

## 7. What's next — the broader roadmap

Audit work is **done**. The post-audit landscape, in priority order:

### Immediate (pre-pilot)
1. **Pete:** Run the Supabase dashboard config fixes from Section 6 (forgot-password flow). Then run the E2E test in Section 8.
2. **Pete:** Live click-through of Scorer view + tournament create flow on the deployed app. Smoke-test the critical pilot path.
3. **Pete:** Send (or confirm sent) the build-questions email to Nick at BLPA + the Gamesheet sample-export ask.
4. **Pete:** Once Nick replies with Format 2 (DEX) and Format 3 specs, those presets can be built — Format 1 (BLPA Bash) is already shipped (`966a22a4`).

### Sprint 4F — recommend BEFORE pilot
- ~~**Block user**~~ **Done May 15 late evening** — see §5. Schema + `lib/blocks.js` + Profile/Settings UI + read-path filters all shipped. DMs/team-chat work below now has its dependency satisfied.

### Sprint 4F — POST-pilot
- **1:1 DMs** (~4-6 days). Schema: `conversations` + `conversation_participants` + `messages`. RLS via participants. Realtime via per-conversation channels. RPC `get_or_create_dm(other_user_id)` for 1:1 lookup. New `/messages` index + `/messages/:id` views.
- **Team group chat** (~1-2 days). Extends DM schema with `type='team'` + auto-sync trigger from `team_members`.
- **Admin god mode** (~2-3 days). `/admin/users` search, edit/delete-any-content Edge Function with service role, `profiles.is_suspended` flag, audit log. NO real impersonation (security risk).
- ~~**DB index audit** (~30 min).~~ **Done May 15 evening** — see §5. FK indexes added, RLS initplan refactor shipped, advisor cleaned up.
- **RLS multiple-permissive cleanup** (~30 min). 80 advisor WARNs remain — most are 2–3 differently-named policies doing the same thing (e.g. `comments_insert_own` + `"Authenticated users can comment"` + `"Users create their own comments"` are all the same INSERT-with-`author_id`-check). Consolidate to one policy per (table, cmd) pair. Behavior-affecting refactor, so do it deliberately and read each cluster before dropping — some pairs are subtly different.

### Tournament UI bugs (NEW — see §11)
- ~3 P1 items, ~6 P2 items, ~10 P3/P4 items found during the May 16 demo walkthrough. The Pool-Pool duplicate alone touches 4+ surfaces and is the single highest leverage fix. Full list with file:line refs in §11.

### Still gated on populating `players`
- The canonical `game_events` table backfill.
- Audit High #12's real leaderboard (`get_top_scorers` RPC is correct but returns nothing because `game_lineups` is empty and imported league goals belong to ghost-roster players with no accounts).
- Both unblock once **ChillerStats import + jersey-number → player_id resolver** runs (needs Pete's machine for internet egress).

### Monetization (gated on user volume)
- Crease premium ($4.99/mo) — UI shipped, Stripe wiring + env vars pending (see Section 6).
- BenchBoss/Captain Tier ($15/mo) — specced in `rinkd_v4/Rinkd_BenchBoss_Captain_Tier_Spec.md`, not built.

### Distribution backlog
- Reddit reposts, 25 podcaster DMs, 10 beer-league emails, Hockey Twitter launch (state-of-play tasks #82–85).
- Swap LiveBarn placeholder venue IDs for real ones (task #28).

---

## 8. Test plan — forgot-password E2E (after Section 6 dashboard fix)

After Pete updates Site URL + Redirect URLs in the Supabase dashboard:

1. **Sign out fully** (More drawer → Sign Out, or hard-reload in a private window).
2. Go to https://rinkd.app, click "Forgot password?", submit `pete@rinkd.app`.
3. **Before clicking the email link**, hover and read the URL. The `redirect_to=` value should now be `https://rinkd.app/reset-password` (NOT `www.rinkd.app`). That alone confirms the allowlist fix.
4. Click. Expect to land on a "Set a new password" form. Type a password twice, hit Update → auto-navigate to `/feed`.
5. Verify in the DB:
   ```sql
   select email, recovery_sent_at,
          (recovery_token is not null and recovery_token <> '') as still_unused,
          last_sign_in_at
   from auth.users where email = 'pete@rinkd.app';
   ```
   `still_unused` should be `false`, `last_sign_in_at` should be the time you completed step 4.

**If step 4 lands on `/reset-password` but immediately shows "Link expired"** — that's the listener race in `ResetPassword.js`. Subscribe to `onAuthStateChange` AFTER supabase-js has already processed and fired `PASSWORD_RECOVERY` during client init → we miss the event. Ship a defensive ~10-line patch: also accept `event === 'INITIAL_SESSION'` with a non-null session as recovery mode when the user is on `/reset-password`.

---

## 9. Working notes — odds & ends a new session should know

- **Auth context lives in `src/lib/authContext.js`** (extracted in Batch 3 to break a circular import). `App.js` still re-exports `AuthContext` + `useAuth` for back-compat.
- **`ensureProfileForUser(user)` in `src/lib/auth.js`** is idempotent and rebuilds a profile from `auth.users.user_metadata`. Used by `signUp` on the auto-confirm path AND by `App.js` `fetchProfileWithRetry` on first miss after an email-confirmation sign-in.
- **TournamentCreate.handleSubmit** is now non-transactional but with **cleanup-on-failure** — if anything fails after the tournament row is created, the partial tournament is cascade-deleted. Director sees an error and retries from a clean slate. Long-term: move this into an Edge Function with a real transaction.
- **ScorerView score is derived from goal log**, not stored separately. `saveGoal` / `deleteGoal` call `syncScoreFromGoals` to keep `games.home_score`/`away_score` in lockstep with the goal log. Manual +/− buttons still write the games table directly (override), and Finalize validates the mismatch with a confirm dialog.
- **`lib/analytics.js`** caches `user_id` at module level and refreshes via `onAuthStateChange`. Don't go back to `supabase.auth.getUser()` per event — meaningful perf nick.
- **RLS state, as of 02409e96 + May 15 evening perf pass:** `games` INSERT requires tournament director/scorer role; `league_games` UPDATE/INSERT/DELETE all require commissioner or scorekeeper; `volunteer_slots` UPDATE has a WITH CHECK protecting `assigned_user_id`; `analytics_events` INSERT requires `user_id IS NULL` or matches `auth.uid()`; `profiles.email` is UNIQUE. **All `auth.uid()` references in `public` RLS policies are now wrapped as `(select auth.uid())`** — when adding new RLS policies, write them this way too or you'll re-introduce the initplan perf issue. **`is_hidden = true` rows on `comments` and `posts` are no longer publicly visible**: only the author and commissioners can read them. **`user_blocks` is the source of truth for block state** — RLS lets either party see rows that involve them (needed for client-side filtering on the blocked side); only the blocker can write.
- **Block-user invariants (May 15 late evening):** `lib/blocks.js` keeps a module-scoped `Set<uuid>` of every user ID I need to filter — both `blocker_id = me AND blocked_id = X` *and* `blocked_id = me AND blocker_id = X` rows. Cache is invalidated by `blockUser`/`unblockUser` and by `onAuthStateChange`. **The auto-unfollow on block is one-directional only:** `blockUser` deletes my follow of them, but the *reverse* follow row (theirs of me) survives because the `follows` RLS only lets the follower delete their own row. That dangling follow is inert — once the block exists, my content is filtered from their feed — but it does mean blocked users still count in raw `getFollowCounts(me).followers`. Cosmetic; revisit if it shows up in a UI screenshot. The clean fix is a `SECURITY DEFINER` RPC `block_user(target)` that does both deletes server-side. Out of scope for v1.
- **Triggers that mutate another table must be `SECURITY DEFINER`** — May 15 late evening lesson, re-learned the hard way. `bump_post_like_count` originally wasn't, which forced the previous author to add a `qual = true` UPDATE policy on posts so the trigger could write. That accidentally opened up `posts` to arbitrary UPDATEs by any authenticated user. When adding any new trigger that updates a different table than it fires on (notification counts, denormalized aggregates, audit rows, etc.), make it `security definer` *and* `set search_path = public` so it doesn't depend on RLS exceptions. Check before you ship: `select prosecdef from pg_proc where proname = '<your_fn>'` must be `true`.
- **Report-feature invariants (May 15 late evening):** `content_reports` has **no INSERT policy** — that's intentional. The only legitimate write path is `public.report_post()` or `public.report_comment()`, both `SECURITY DEFINER` so they bypass RLS. The unique constraint `(reporter_id, target_type, target_id)` makes the RPC idempotent (`on conflict do nothing`), so a panicking user double-tapping Report doesn't create duplicate audit rows. `flagged_at` uses `coalesce(flagged_at, now())` so the first-flag time is preserved across subsequent reports; `flag_reason` is last-write-wins (most recent reporter's framing — fine for the admin queue). When the admin approves an item the `content_reports` rows are intentionally **not** deleted — they're audit history. A re-flag after approval will re-set `is_flagged = true` and the item returns to the queue; the new report's row joins the historical ones.
- **Two pre-existing stray files** in the working tree (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them out of audit commits unless Pete asks.
- **`rinkd_v4` folder** — strategy/spec docs only. Do NOT edit app code there; it doesn't deploy. To bring it into context: `/add-dir ~/Downloads/rinkd_v4` in Claude Code.
- **`rinkd_v4/RINKD_STATE_OF_PLAY.md`** is the broader orientation doc — read it for the BLPA partnership context, post-pilot specs, and pending tasks.

---

## 10. First thing to do in a new session

1. Read this doc top to bottom — **especially §11 (tournament UI punch list)** which is brand-new.
2. Run `cd ~/Downloads/rinkd_live && git log --oneline -6 && git status` to confirm state matches Section 4. HEAD should be `4a020d07`. The May 15 evening perf pass was DB-only (no commits). Block-user shipped as `0468f8e3`, Report feature shipped as `4a020d07` — both already on `main` and live on Vercel. Working tree should show only the two pre-existing strays (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) plus possibly this handoff doc itself.
   Confirm DB state via Supabase MCP: `select tablename from pg_tables where schemaname='public' and tablename in ('user_blocks','content_reports') order by tablename` should return both rows. **Also confirm the demo tournament still exists**: `select id, name, status from public.tournaments where id = 'b2789d66-1d77-4a62-862d-00b550da6a98'` should return one row (`BLPA Cleveland Bash 2026`, `complete`).
3. Ask Pete:
   - Did you complete the Supabase dashboard config (Section 6) and verify the password-reset E2E (Section 8)? **As of last save: not yet — `pete@rinkd.app` had no `recovery_sent_at` and `nick@blpa.com`'s May 14 recovery token was still unused.**
   - Did you smoke-test the now-deployed Block-user and Report features in prod?
   - Do you still want the demo tournament (`BLPA Cleveland Bash 2026`) in the DB, or wipe it (one-line DELETE in §5)?
   - What do you want to tackle next — the **tournament UI punch list** (§11; fastest pre-pilot wins per §11's own suggested order are #1, #17, #5, #11, #15), the RLS multiple-permissive cleanup (~30 min, §7), Sentry sanity check + VAPID env-var verification (~15 min, §6), PWA install banner for iOS (~1 hr), or post-pilot work?
4. Then proceed from there.

---

## 11. Tournament UI punch list (May 16 demo walkthrough)

Found by walking the seeded BLPA Cleveland Bash 2026 tournament end-to-end on the local dev server: public Standings/Schedule/Bracket/Info tabs, a game scoresheet, ScorerView, Tournaments index, and 5 director-manage tabs. 21 items below, ranked. **For each item: brief, where to fix, suggested approach.** Don't bundle these into one big commit — they're independent enough that each should land as its own small change (or grouped by surface).

### 🔴 P1 — Real bugs (fix first; small diffs, big visual impact)

**#1 — "Pool Pool A" / "Pool Pool B" duplicate prefix.** The DB stores `tournament_teams.pool = 'Pool A'` (full string), but several renderers prepend `'Pool '` again, producing `'Pool Pool A'`. Three known sites, all single-line changes:
- [src/pages/Tournament.js:201](src/pages/Tournament.js) — `<div>Pool {pool}</div>` → `<div>{pool}</div>`
- [src/pages/TournamentManage.js:385](src/pages/TournamentManage.js) — `Pool {g.home_team.pool}` → `{g.home_team.pool}`
- [src/pages/TournamentManage.js:527](src/pages/TournamentManage.js) — `Pool {q.pool}` → `{q.pool}`
- Also check the manage Schedule game cards (`POOL POOL A` red badge) and the public game page subtitle — search for any `(Pool|POOL) {.*pool.*}` markup. Long-term: the DB column should just be `'A'` and the UI should prepend `Pool ` consistently, but for now matching the existing data shape is the 1-line fix.

**#2 — Bottom nav bar covers content.** The fixed `<Nav>` at the bottom of every page (Chirps/Teams/Notifications/Profile/More) overlaps the last row of the page content. Look for the Layout component and add `padding-bottom: 68px` (or whatever the nav height is) to the inner container. Affects every authenticated page, not just tournament.

**#3 — Floating Help button (red `?` circle) overlaps content.** Renders `position: fixed` with no z-index isolation from the page content. Lands over post bodies, scoresheet rows, and the footer "© 2026 Rinkd, LLC" text on Landing. Fix in [src/components/HelpButton.js](src/components/HelpButton.js) — either add a content-aware offset or have the button shrink to an edge tab when the page is short.

### 🟠 P2 — Tournament-specific gaps (most visible to pilot users)

**#4 — Public Standings missing GP, GA, Goal Diff columns.** Shows W/L/T/GF/PTS only. BLPA Bash tiebreakers explicitly reference GA + goal_diff + goal_quotient. Without these columns a viewer can't see *why* one team got the tiebreaker. Edit [src/pages/Tournament.js](src/pages/Tournament.js) standings table — the data is already computed (see §5 verification SQL for the join pattern); just render more columns.

**#5 — Public Schedule cards have NO date or start time.** They show "FINAL · Team A vs Team B · Rink 1 · Lakewood Ice Complex" but not when the game was played. Director-manage Schedule renders the same data with times correctly, so the public renderer just drops the field. Likely [src/pages/Tournament.js](src/pages/Tournament.js) in the Schedule-tab JSX — add `formatLocalDate(g.start_time)` next to the rink string.

**#6 — Public Schedule has no day grouping or pool indicator.** Flat list of 13 games. Should group by day (`Saturday May 9 — Pool Play`, `Sunday May 10 — Championship`) and show a pool/round badge per game. Edit in the same Schedule-tab JSX.

**#7 — Championship game not visually distinct.** On public Schedule and Bracket, the final-round card looks identical to a pool game. Add a `🏆` icon + "Championship" pill + winner-bold styling when `round === 'final'`. The game-page itself has a "CHAMPIONSHIP · ADULT BEER LEAGUE" pill that's nice — replicate it on the schedule card.

**#8 — Bracket tab nearly empty for top-1-per-pool advancement.** When `settings.advancement_per_pool = 1` and there are 2 pools, the bracket is just one game. Currently renders one card and a wasteland of empty space. Add a champion callout (banner, podium, or "🏆 BEER NECESSITIES · 2026 CHAMPIONS" hero). Edit [src/pages/Tournament.js](src/pages/Tournament.js) Bracket tab.

**#9 — Goal/penalty log shows jersey #s only, never names.** The game scoresheet shows `#11 — assist: #19` with no idea who #11 is. `game_lineups` has `invite_name` + `jersey_number` for every player in every game. Add a small `useEffect` that loads lineups for this game and replaces `#11` with `Gus "Cement Hands" Beck (#11)` (or trimmed for space). File: [src/pages/GameDetail.js](src/pages/GameDetail.js) (or wherever `/game/:id` renders).

### 🟡 P3 — Manage-side polish (less visible to pilot users; director comfort)

**#10 — Manage tab strip cut off on the right.** "Settings" is partially clipped on mobile (containers are 343px viewable, 403px content). Tabs scroll horizontally but no visual hint. Add a right-edge gradient fade or chevron in [src/pages/TournamentManage.js](src/pages/TournamentManage.js) tab nav.

**#11 — "⚡ Generate Pool Schedule" button shown even when 12 pool games exist.** Should be disabled, hidden, or relabeled "Regenerate (will delete current N games)" when games already exist. Edit the manage Schedule tab in [src/pages/TournamentManage.js](src/pages/TournamentManage.js) — add a count check before rendering, or change the button's onClick to confirm + wipe + regenerate.

**#12 — Manage Bracket "Add Bracket Game" defaults round to Quarterfinal.** BLPA Bash is 1-per-pool advancement, so the next round IS Final, not QF. The default should derive from `settings.advancement_per_pool` (2 pools, 1 advances each = 2 teams = Final; 4 pools, 2 each = 8 teams = Quarterfinal). Edit [src/pages/TournamentManage.js](src/pages/TournamentManage.js) add-bracket-game form.

**#13 — Manage Bracket games list missing scores.** Shows "FINAL · BN vs NP · Sun May 10 1:00 PM" but no `4-3`. The public render DOES show scores. Add to manage Bracket render in [src/pages/TournamentManage.js](src/pages/TournamentManage.js).

**#14 — Manage Teams missing W/L/T summary.** Director can't see records on the Teams tab. Useful at a live event when answering "where do we stand?" questions. Compute records inline from the games join.

**#15 — ScorerView PERIOD selector shows OT button when format preset doesn't allow OT.** BLPA Bash settings are `num_periods: 3` and `shootout_bracket: true` (straight to SO from regulation, no OT). The PERIOD selector at [src/pages/ScorerView.js:469](src/pages/ScorerView.js:469) hardcodes `[['1','1st'],['2','2nd'],['3','3rd'],['4','OT'],['5','SO'],['final','Final']]`. Same hardcode at [src/pages/ScorerView.js:593](src/pages/ScorerView.js:593), [src/pages/ScorerView.js:631](src/pages/ScorerView.js:631), [src/pages/ScorerView.js:648](src/pages/ScorerView.js:648). Read the game's tournament settings; if `shootout_bracket && !overtime_allowed`, hide OT. (Add an `overtime_allowed` setting if missing, or infer from absence of any OT-specific setting.)

### 🟢 P4 — Polish / data hygiene

**#16 — Public Info tab missing key facts from `tournaments.settings` JSON.** Mercy rule (6-goal max), shootout policies (pool: off, bracket: on), tiebreaker order, venue, director name, team count. All in the JSON already (see §5 settings spec). Add to the Info-tab render in [src/pages/Tournament.js](src/pages/Tournament.js).

**#17 — Tournaments index shows "● Live" on past-dated tournaments.** [src/pages/Tournaments.js:76](src/pages/Tournaments.js:76) renders `● Live` when `status === 'active'`, regardless of `end_date`. TEST CUP (May 10–12) and LAKEWOOD CLASSIC (May 9–10) both show Live. Compute display label as `status === 'active' && new Date(t.end_date) >= today ? 'Live' : 'Final'`. Or auto-update `status` to `'complete'` via a scheduled job once `end_date` passes.

**#18 — Tournaments index lacks recency sort.** BLPA Bash (just-completed) is the LAST card. Newly active or just-completed events should sort first. [src/pages/Tournaments.js](src/pages/Tournaments.js) — change `.order('start_date', { ascending: true })` to descending, or sort by `coalesce(end_date, start_date) desc`.

**#19 — Game page header double-prints tournament name.** Left: "← BLPA Cleveland Bash 2026" (back-link). Right: "BLPA Cleveland Bash 2026 · Rink 1 · Lakewood Ice Complex" (venue label). Drop the tournament name from the right label since it's already on the left. Edit [src/pages/GameDetail.js](src/pages/GameDetail.js) (or the game page component).

**#20 — Two rinks both named "Lakewood Ice Complex" with NULL `sub_rink`.** UI renders "Rink 1" / "Rink 2" by `created_at` order — fragile. Either:
- (a) update the two prod rink rows to set `sub_rink = 'Sheet A'` and `'Sheet B'`, OR
- (b) merge into one row and use sub_rink properly going forward.
Quick SQL fix for (a):
```sql
update public.rinks set sub_rink = 'Sheet A' where id = 'a0000001-0000-0000-0000-000000000001';
update public.rinks set sub_rink = 'Sheet B' where id = 'a0000001-0000-0000-0000-000000000002';
```

**#21 — Auto-generated team initials: "Off the Posts" → "Ot".** Algorithm grabs `name[0] + name[1]` instead of first letters of meaningful words. Find the initials helper (probably in [src/components/Logos.js](src/components/Logos.js) or similar) and fix to split on whitespace, drop stopwords (`the`, `of`, `a`), then take first letter of each remaining word. Minor.

### 🔵 P5 — Out of scope for pre-pilot

- Onboarding modal fires on tournament URLs for new accounts — arguably expected; if it bothers Pete at pilot, gate it on whether the user is *new* (no profile activity) rather than on auth state.
- Director name + contact email not surfaced on the public Tournament page — could be useful for "how do I reach the host?" Minor.

### Suggested fix order if you tackle this end-to-end

1. **#1 Pool-Pool** (5 min, touches 4 surfaces)
2. **#17 Live-vs-Final badge** (10 min, prevents wrong info on the day after BLPA pilot)
3. **#5 Public-schedule game times** (15 min, makes the schedule actually useful)
4. **#11 Generate-pool-schedule guard** (10 min, prevents director footgun)
5. **#15 OT button in ScorerView** (20 min, requires reading tournament settings)
6. **#7 + #8 Championship visual treatment** (~1 hr total — biggest UX win)
7. **#9 Goal log with player names** (~45 min)
8. **#4 GA + GP + Diff columns** (~30 min)
9. **#2 + #3 Layout overlap fixes** (~30 min)
10. Everything else as polish.

Total: roughly a half-day to land P1+P2+top-of-P3, which would meaningfully change the demo quality before pilot.
