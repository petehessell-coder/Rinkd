# Rinkd — Claude Code Handoff

**Created:** May 15, 2026 — supersedes the previous handoff. Self-contained: a fresh Claude Code session should be able to pick up from here without reading the prior doc.
**Last updated:** May 19, 2026 (afternoon + evening) — **Five UX commits across the team surface + CSHL personal-tracker league scaffolded.** (1) Standings table refactored from CSS grid to an HTML table with frozen TEAM + PTS columns; middle stat columns scroll horizontally on mobile while team names and points stay pinned (`fc7d2904`). (2) Team logo uploads now match the profile-avatar pattern — `teams.logo_url` + `league_teams.logo_url` columns added (migration `teams_and_league_teams_add_logo_url`), TeamManage Create + Settings forms gain a 📷 Upload button with 5MB cap + NSFW pre-check + Replace/Remove affordances; renders fall back to colored initials when null (`460a8990`). (3) `CSHL 10U Squirts (2026-27)` league + `Shaker Heights Red Raiders` team scaffolded as Pete's "from the stands" personal tracker for his son Henry Hessell #17. Pete is commissioner of the league + manager of the team; Henry is on the roster via `invite_name` (no user account — COPPA). Source organization noted in `leagues.settings.source_org` + `source_url`. League: `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6`. Team: `d18e023c-354f-4d3b-b5a0-82574f05377d`. (4) Volunteer Coordinator promoted out of the More drawer's Manager section and onto the individual team page as a 5th tab between Feed and Info — "everything a team needs in one place." New `src/components/TeamVolunteer.js` renders open/filled/past stat pills, slot list with Claim/Cancel/Open-up/Delete by permission, past slots collapsed behind a toggle, and a manager-only `+ Add Volunteer Slot` composer with role presets + optional pin-to-game (`2e6207d5`, which corrected the wrong-direction `469406fc` that mistakenly put Volunteer on `/teams` instead of `/team/:id`). The standalone `/volunteer-coordinator` route still works as a multi-team aggregate dashboard but is no longer linked from any nav. Team page season stat line also gains **Ties** between Losses and the rest (`2e6207d5`). (5) **Multi-manager support for teams** — mirrors the multi-director tournament feature shipped earlier. New `is_team_manager(p_team_id, p_user_id)` SECURITY DEFINER helper + 6 RLS policies rewritten (teams_manager_update, team_members_manager_update + new founder-protected team_members_manager_delete, team_join_requests read+update, volunteer_slots insert+update+delete). Founding manager (`teams.manager_id`) is immutable — RLS forbids deletion of their `team_members` row with role='manager'. New ManagersSection at top of the Roster tab on TeamManage: add by handle/email (account required), Demote drops to player but keeps roster row, Remove deletes the row entirely. Founder shows amber "Founder" badge + "Can't remove" affordance. Migration `multi_team_manager_support_helper_and_rls` (`adc836b6`). Live build: `adc836b6c341`. **Last updated:** May 19, 2026 — **BLPA Cleveland moved to BAM (Strongsville, OH); pool play compressed to Saturday only.** Venue is now **Brunswick Auto Mart Arena (BAM)** at 15381 Royalton Rd, Strongsville, OH 44136. Tournament is now 2-day: Sat 6/13 (all 12 pool games) + Sun 6/14 (championship). Migration `blpa_cleveland_move_to_bam_strongsville_sat_sun_only` updated `tournaments.settings.venue_name` + `venue_address`, refreshed the 2 rinks rows (preserving UUIDs so game FKs stay intact), and moved the 6 Friday games onto Saturday afternoon slots. Follow-up migration `blpa_cleveland_minimize_back_to_back_games` resequenced the 12 pool games to minimize per-team back-to-backs: now 4 of 8 teams have one BB each (A3/A4/B3/B4), down from 6 of 8. **Mathematical floor:** a 4-team round-robin in 6 single-sheet slots cannot fully eliminate BBs — proven by the disjoint patterns {1,3,5} and {2,4,6}, which means at least two teams must hit a consecutive-slot pairing. Sheet assignment normalized: Pool A always on Sheet 1, Pool B always on Sheet 2. New Saturday schedule: 08:00 / 09:15 / 10:30 / 11:45 / 13:00 / 14:15 EDT, last puck Saturday ~15:30. Sunday championship times still TBD until Sat afternoon when Pete generates the bracket and picks first puck. **Last updated:** May 18, 2026 (late afternoon) — **Multi-director + Turnstile + security advisor pass.** Three more shipped commits (`4f145312` multi-director, `45f71a6d` Turnstile), three more DB migrations (`multi_director_support_helper_and_rls`, `multi_director_rls_extend_to_games_and_tournaments`, `close_security_definer_views_and_media_listing`), and a Cloudflare Turnstile widget standing up bot protection on signup. (1) **Multi-director:** tournament directors can now add other directors via the Scorers tab → new Directors section. New SECURITY DEFINER function `is_tournament_director(p_tournament_id, p_user_id)` + email-based lookup so Pete's UUID isn't hardcoded. The founding director (tournaments.director_id) gets a "Founder" badge + "Can't remove" affordance — RLS forbids deletion of their role row. Permission checks updated in 5 sites (TournamentManage page gate, Tournament canScore + Manage button + Follow-button-hiding, GameDetail isOrganizer, ScorerView director flag). TournamentManage shows a "Loading…" gate while the async role check is pending so a freshly-added director doesn't see the 🔒 lock screen flash. (2) **Turnstile on signup:** Cloudflare Turnstile in Managed mode. Widget renders on step 3 of signup; token forwarded to `supabase.auth.signUp({ options: { captchaToken } })`. Supabase Dashboard → Auth → Bot Protection enabled with secret key. Vercel env `REACT_APP_TURNSTILE_SITE_KEY` set. Verified: direct API signup without token returns `400 captcha_failed`. Auth via web UI requires solving the challenge first. Bug report + survey form Turnstile gating is filed as a post-pilot follow-up (the `qual = true` RLS on those tables means write-spam is theoretically possible; not pilot-blocking — only 25 days till live and abuse is unlikely at our scale). (3) **Architectural review fixes:** the 4 SECURITY DEFINER views (`analytics_daily`, `analytics_dau`, `league_standings`, `tournament_standings`) flipped to `security_invoker = on`. The `media` storage bucket's broad SELECT policy dropped (bucket is `public = true` so `/object/public/media/…` URLs still resolve, but anon can no longer enumerate via the listing API). 85 multiple_permissive_policies advisor warnings remain — backlog cleanup for post-pilot. **Last updated:** May 18, 2026 (afternoon) — **Tournament feed shipped + auto-follow Pete trigger.** Triggered by Pete noticing the auto-recap landed in the global Feed where unaffiliated users had no context. Three shipped commits + two DB migrations + a 19-user backfill. (1) `posts.tournament_id` column (nullable, FK to tournaments, ON DELETE SET NULL) with partial index on `(tournament_id, created_at desc)`. Migration `posts_add_tournament_id_for_tournament_scoped_feed`. (2) `getPosts` and `getFollowingPosts` filter `tournament_id IS NULL` — global/following feeds stay clean. New `getTournamentPosts(tournamentId, limit)` mirrors `getTeamPosts`. `createGameRecapPost` accepts `tournamentId`; insert + re-finalize update paths both stamp it. ScorerView passes `game.tournament_id` on finalize. (3) New **Feed tab** on Tournament.js between Bracket and Info — lazy-loaded, renders recap headline + body + author + "View game →"; non-recap posts get the existing `PostActionMenu` for report + block. (4) Tournament feed composer — anyone signed in can post chirps (text + optional photo via existing `uploadMedia`); 500-char cap; optimistic prepend. User posts do NOT trigger pushes (recap-only); avoids notification spam during a busy game. (5) Earlier same day: `lib/push.js` `subscribeToPush` now calls `getSubscription().unsubscribe()` before requesting fresh permission — fixes the `InvalidStateError` that surfaces when a browser holds an existing subscription registered against a rotated VAPID public key (commit `30b40986`). (6) **Auto-follow Pete on new account** — DB trigger `tr_auto_follow_pete` on `public.profiles AFTER INSERT`. SECURITY DEFINER, email-based Pete lookup (not hardcoded UUID), idempotent via `on conflict do nothing`. 19 existing users backfilled in a single transaction. Migration `auto_follow_pete_on_new_profile`. Live commits on `origin/main`: `30b40986` (push.js fix), `4ec187c4` (tournament feed), `ae4d7985` (composer). Live build: `ae4d79852ca5`. **Last updated:** May 18, 2026 (morning) — **Both P0 pre-pilot blockers cleared.** (1) Forgot Password flow fixed via Supabase URL Configuration (Site URL `www.rinkd.app` → apex; Redirect URLs allowlist now includes `https://rinkd.app/reset-password`, `https://rinkd.app/*`, `https://www.rinkd.app/*`, `http://localhost:3000/*`); E2E verified end-to-end as `pete@rinkd.app` (the first successful prod password reset in Rinkd history — Nick's May 14 attempt had silently failed against the old config). (2) Push pipeline activated via Path B: fresh VAPID pair generated, 3 Supabase secrets set, `send-recap-push` Edge Function deployed (v1, ACTIVE, JWT-verified), Vercel `REACT_APP_VAPID_PUBLIC_KEY` updated + redeployed; 2 stale May-09/May-12 test subscriptions purged. Private key stored in Pete's 1Password under "Rinkd VAPID keys (May 2026)" — **never rotate** post-pilot. Pete also completed the long-pending `claude/elegant-sanderson-80d1d0` merge (commit `ee0ca9ef`) — public landing + push pipeline code are now in production. **Pre-pilot P0 backlog is empty.** **Last updated:** May 17, 2026 (late evening) — New §13 "Operational artifacts" added (rinkd_v4 docs, roadmap xlsx, live state, new-session reading order). §7 Revenue + monetization subsection: 9 new items spanning Stripe Connect, registration fees, hotel affiliate, sponsorships, marketplaces, insurance partnership. **BenchBoss reframed from 3-tier pricing to 4 billing arrangements**: Community ($0) / Organizer-pays ($25/team) / **Pass-through ($15/team Technology fee billed to participating teams, BLPA-founding-partner model)** / Pro (custom annual). BIZ-BLPA-1 = post-pilot proof-point worth **~$1,840 / event** while BLPA pays nothing. **BLPA Cleveland pilot now 3 days (Fri 6/12 + Sat 6/13 + Sun 6/14)**, was 2 days. 12 pool games rescheduled in place: 6 Friday evening + 6 Saturday morning. Migration `cleveland_pilot_3day_reschedule_fri_sat_sun` live in prod. §7 roadmap expanded with **GameSheet + LeagueApps parity items** (15 new gaps total) — see `rinkd_v4/GAMESHEET_PARITY_GAPS.md` and `rinkd_v4/LEAGUEAPPS_PARITY_GAPS.md`.
**Source:** continuation of the audit-fix work, plus a full BLPA-spec implementation pass based on `rinkd_v4/CLEVELAND_BUILD_PLAN.md`.

---

## 1. What you're working on

Rinkd (rinkd.app) is a mobile-first social platform for the hockey community — players, parents, coaches, fans. **React 18 + React Router 6 (Create React App) + Supabase + Vercel**, shipped as a PWA. Core surfaces: feed ("chirps"), teams, leagues, tournaments, and live game scoring. Solo founder (Pete), pre-seed, moving fast toward a **Jun 13-14 BLPA tournament pilot at Brunswick Auto Mart Arena (BAM), Strongsville, OH** (2 days: Sat pool play + Sun championship).

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

## 4. Current state — verified May 19, 2026 evening

`origin/main` HEAD is **`adc836b6`** (`feat: multi-manager support for teams`). Vercel deployed at build ID `adc836b6c341`. Everything across the May 18-19 sessions is live in production:
- May 18 morning: Forgot Password config, VAPID rotation + Edge Function deploy, push.js fix
- May 18 afternoon: Tournament-scoped feed (recaps + composer), auto-follow-Pete trigger + backfill
- May 18 late afternoon: Multi-director support, SECURITY DEFINER view fixes, media bucket listing closed, Turnstile bot protection on signup, analytics RLS fix for Rinkd admins
- May 19 morning: BLPA Cleveland venue change (RMU → BAM Strongsville OH), 2-day pool play compress, minimum-BB schedule resequence
- May 19 afternoon: Standings table frozen TEAM + PTS columns (mobile horizontal scroll), team logo uploads, CSHL 10U Squirts league + Shaker Heights Red Raiders team scaffolded (Pete's personal tracker for son Henry #17)
- May 19 evening: Volunteer Coordinator moved out of the More drawer and onto the team page as a 5th tab, Ties stat added, multi-manager support for teams

Recent history on `origin/main`:

```
adc836b6  feat: multi-manager support for teams — managers can add other managers ← HEAD, deployed
2e6207d5  fix: move Volunteer to the team page tab (not /teams) + add Ties stat
469406fc  feat: promote Volunteer to a top tab on /teams (SUPERSEDED by 2e6207d5)
460a8990  feat: team logo uploads — mirror profile avatar pattern
fc7d2904  feat: standings table — freeze TEAM + PTS columns, scroll middle on mobile
04a37c5f  docs: May 19 — BLPA Cleveland venue change to BAM + 2-day pool play
14132f54  docs: §9 — note the analytics RLS lockout follow-up after SECURITY DEFINER fix
eb45b1be  docs: May 18 late afternoon — multi-director + Turnstile + security advisor pass
45f71a6d  feat: Cloudflare Turnstile on signup form — bot protection
4f145312  feat: multi-director support — tournament directors can add other directors
a6b65131  docs: May 18 afternoon — tournament feed + composer + auto-follow Pete
ae4d7985  feat: tournament feed composer — text + photo, with report/block
4ec187c4  feat: tournament-scoped feed — recaps no longer clutter the global feed
30b40986  fix: push.js — unsubscribe before resubscribe to survive VAPID rotation
f450d96a  docs: May 18 morning — P0 backlog cleared (Forgot Password + Push pipeline)
b55afb18  docs: §4 — distinguish origin/main vs local main, split pending ops
ee0ca9ef  merge: public tournament landing + push notification pipeline
2b793247  feat: push notifications — tournament follow + recap pipeline (pilot)
80f71e54  feat: public landing for tournament discovery (BLPA pilot)
d46f3d22  docs: new §13 Operational artifacts — fresh-session onboarding guide
28b97793  docs: monetization model — 4 billing arrangements + BLPA Pass-through proof-point
45a16c0c  docs: BLPA Cleveland now 3-day pilot (Fri 6/12 + Sat 6/13 + Sun 6/14)
ee529e2d  docs: handoff §7 — add Team engine (coaching tools) roadmap subsection
c37c3cb0  docs: handoff §7 — add GameSheet + LeagueApps parity roadmap items
da2b2915  docs: handoff — correct §4 merge state (first 4 commits already merged)
0979969a  docs: handoff update — public landing + push pipeline + status flip
c3947bbc  docs: handoff update — May 16 evening BLPA pilot batch + §12 pilot-readiness audit
799343b0  merge: tournament UI punch-list + BLPA pilot batch (scorer lockout, auto-recap, championship bracket gen, format-aware standings, logo upload, status enum fix)
9c773ff6  fix: layout polish — bottom nav padding + HelpButton overlap
5c3e42e5  feat: scorer lockout + auto-recap + shootout winner + bracket advancement
21785087  feat: tournament manage — punch list + logo upload + championship bracket gen
5ae955bc  feat: tournament public pages — punch list + BLPA standings/SO/champion
80294cb7  docs: add Claude Code handoff doc
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

**Working tree state:** clean on `main`. The worktree branch `claude/flamboyant-chaum-f3d5d3` is fully in sync with `origin/main`. Any further work in this worktree gets new commits on top.

Two pre-existing strays remain uncommitted (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them alone unless Pete asks otherwise.

**Operational state (verified May 19, 2026 evening):**
- BLPA Cleveland tournament `b2789d66-1d77-4a62-862d-00b550da6a98` is `active`, dates **Jun 13-14 (Sat-Sun)**, venue **Brunswick Auto Mart Arena (BAM), 15381 Royalton Rd, Strongsville, OH 44136**, 8 placeholder teams, 12 pool games seeded — all Saturday with the minimum-BB layout (A3/A4/B3/B4 have one BB each; A1/A2/B1/B2 are BB-free). Pristine state — any test data from earlier smoke tests has been rolled back.
- CSHL personal tracker — Pete's "from the stands" tracker for his son Henry #17 is scaffolded: league `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6` (CSHL 10U Squirts 2026-27) + team `d18e023c-354f-4d3b-b5a0-82574f05377d` (Shaker Heights Red Raiders). Pete is commissioner + manager. Subdivision (AA / A1 / A2 / A3 / B1 / B2) unknown until tryouts. Schedule import pending CSHL's mid-summer publication.
- Forgot Password flow: ✅ working (§6 + §8 verified end-to-end).
- Push pipeline: ✅ live — `send-recap-push` Edge Function deployed (v1, ACTIVE, JWT verification on); 3 VAPID secrets set; Vercel client bundle has the matching public key (`BMiwvt78h-…Eitc`); smoke-tested end-to-end with `mvntrec@gmail.com` on Android.
- Tournament feed: ✅ live — new Feed tab on Tournament.js (between Bracket and Info). Auto-recaps from finalize land here, NOT in global feed. User composer (text + photo) for anyone signed in. Report + block per-card via existing PostActionMenu.
- Auto-follow Pete on new account: ✅ live — DB trigger `tr_auto_follow_pete` on `public.profiles AFTER INSERT`. 19 existing users backfilled.
- Multi-director (tournaments): ✅ live — Scorers tab → Directors section. Founder badge protects the original director. RLS uses `is_tournament_director()` helper.
- Multi-manager (teams): ✅ live — Roster tab → Managers section at the top. Founder badge protects the original manager. RLS uses `is_team_manager()` helper. Add by handle/email, Demote (keeps roster row) or Remove (deletes row).
- Team logo uploads: ✅ live — `teams.logo_url` + `league_teams.logo_url` columns; TeamManage Create + Settings have a 📷 Upload button.
- Standings table responsive: ✅ live — TEAM (rank + name) frozen left, PTS frozen right, stat columns scroll horizontally on mobile.
- Team page Volunteer tab: ✅ live — new tab between Feed and Info; players Claim/Cancel slots, managers Add/Delete; past slots collapsed behind a toggle. Replaces the More-drawer Volunteer Coordinator entry.
- Team page season stat line: ✅ now shows **Players · Games · Wins · Losses · Ties**.
- Turnstile bot protection: ✅ live on signup, login, password reset.
- Security advisor pass: 4 SECURITY DEFINER views fixed, media bucket listing closed.
- 8 Edge Functions deployed (`send-invite`, `submit-scoresheet`, `send-push`, `schedule-ics`, `send-game-reminders`, `send-onboarding-emails`, `delete-account`, `send-recap-push`).

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

### Evening of May 16 — Full BLPA Cleveland pilot batch (worktree branch, 4 commits pending merge)

Triggered by Pete's `rinkd_v4/CLEVELAND_BUILD_PLAN.md` review. Shipped on
worktree branch `claude/elegant-sanderson-80d1d0`. Merge command in §4.

**21-item punch list (§11) — all done.** See §11 for the original list +
file:line refs. Highlights: Pool-Pool prefix fix; GP/GA/Diff columns +
GQ/PIM/Period Pts on standings (BLPA-spec); public schedule day-grouping +
times + championship gold treatment; bracket champion banner; goal log
resolves jersey # → player name via `game_lineups`; ScorerView OT/SO
buttons gate on tournament settings; manage tab strip clipping fix;
generate-pool-schedule guard; bracket default round derived from
pool_count × advancement; manage bracket shows scores; Teams tab shows
W/L/T; Tournaments index ● Live badge requires `end_date >= today`;
recency sort; game header de-dup; team-initials helper strips stopwords
(`src/lib/teamInitials.js`); layout bottom-nav padding; HelpButton sized
down + z-indexed below nav.

**Scorer lockout on finalize (`5c3e42e5`).** Once `status='final'`, every
write path (`changeScore`, `changePeriod`, `changeShots`,
`saveGoal/Penalty/Goalie`, `deleteGoal/Penalty`) early-returns. UI hides
+/−, period selector, log/add/delete controls. Banner explains the lock;
director sees "🔓 Reopen Game" button, scorers see "Only the director can
reopen." Reopen flips status back to `live` preserving goals/penalties/shots.
**Defense-in-depth:** even an old client or DevTools can't sneak writes
through — every handler checks `isLocked` itself.

**Auto-recap on finalize (`5c3e42e5`).** On successful tournament-game
finalize, upserts a Feed post tagged "Game Recap" with headline
("🏒 FINAL · Beer Necessities 4, Net Profits 3 / 🏆 Championship · BLPA
Cleveland"). New `posts.recap_for_game_id` column (partial unique index)
makes it idempotent — Reopen + re-finalize updates the same row,
preserves original author + `created_at`. Feed PostCard renders a
"🏒 View game →" affordance when this column is set, navigating to
`/game/:id`. League games skipped for pilot.

**Logo upload for tournaments (`21785087`).** TournamentManage → Settings
→ Branding now has an upload button alongside the URL input. Uses
shared `media` bucket via `uploadMedia(file, currentUser.id)`, 5 MB cap,
NSFW moderation matches profile avatars. URL fills the existing text
field on success; director clicks Save Settings to persist.

**Status enum mismatch fixed (`21785087`).** SettingsTab dropdown
previously offered ('upcoming','active','complete','cancelled') but the
DB `tournaments_status_check` only allows ('draft','active','complete').
Selecting Upcoming or Cancelled silently failed on save. Dropdown is now
aligned to the DB exactly: Draft (hidden from public), Active (live,
public), Complete. Default for new state is `draft`.

**ChampionshipBracketGenerator (`21785087`).** New component on the
Bracket tab. For each 4-team pool, generates 4 games: 2 semis (seed 2v3
+ seed 1v4), bronze game (TBD home/away), final game (TBD home/away).
Lives in `src/lib/tournamentManage.js`:
- `generateChampionshipBracket(tournamentId, {startTime, rinkId, gameMinutes})`
   — refuses to re-run if any bracket games exist (delete first to regenerate).
   Pools without exactly 4 teams are skipped; UI shows which pools matched.
- `resolveBracketSlotsFromSemis(tournamentId, pool)` — called from
   ScorerView's finalize path after a semi finalizes. Idempotent. Reads
   `shootout_winner` for tied semis. Fills final.home with semi1 winner,
   final.away with semi2 winner, bronze.home with semi1 loser, bronze.away
   with semi2 loser.
- `bracketWinnerSide(game)` — resolves winner side accounting for
   shootout_winner. Returns 'home' | 'away' | null.

**Shootout winner column + UI (`5c3e42e5`).** New `games.shootout_winner`
column ('home'|'away'|null). When a bracket-round game ends tied with
`shootout_bracket` on, ScorerView shows a Shootout Winner picker above
Finalize; Finalize button is disabled until a side is picked. Reopen +
re-finalize without a tie clears the field cleanly. Public schedule cards
+ manage bracket list show "FINAL / SO" and bold the SO winner. Champion
banner reads `shootout_winner` so an SO-decided championship resolves
correctly.

**Format-aware standings UI (`5ae955bc`).** Tournament.js standings now
read `settings.tiebreakers` and re-sort client-side. Columns swap based
on format: BLPA Bash shows GQ + Period Pts; DEX shows PIM (ASC); default
fallback shows DIFF. New `sortByTiebreakers` helper handles `lowest_pim`,
`goal_quotient`, `period_points`, `head_to_head`, `coin_toss`.

### DB migrations applied this batch (8 total via Supabase MCP)

8. **`punch_20_rename_lakewood_rink_sub_rinks_to_sheet_a_b`** — renamed
   the demo's Lakewood "Rink 1/Rink 2" sub_rinks to "Sheet A/Sheet B".
9. **`game_recap_auto_post_link_column`** — `posts.recap_for_game_id` +
   partial unique index. One recap per game; unlimited normal posts.
10. **`blpa_standings_view_with_gq_period_pts_pim`** (+ `_fix_period_pts_dedup`)
    — extended `tournament_standings` view with `goal_quotient` (GF÷GA,
    GA=0 → GF/0.001), `period_pts` (derived from `game_goals` grouped by
    period; non-shootout goals only), `pim` (derived from
    `game_penalties.duration_minutes`). Default sort: `pts desc,
    goal_quotient desc, period_pts desc, goal_diff desc, gf desc` —
    matches BLPA Bash exactly. DEX re-sorts client-side on `pim ASC`.
    The `_fix_period_pts_dedup` follow-up wraps the period_pts CTE in an
    outer GROUP BY because the original split-by-home/away UNION ALL
    produced two rows per team and the LEFT JOIN duplicated rows.
11. **`games_add_shootout_winner_column`** — text check ('home'|'away').
12. **`games_add_pool_column_for_bracket_scoping`** — text column on
    `games` with index on `(tournament_id, pool, round)`. Backfilled
    existing rows from `tournament_teams.pool`. Needed so bracket-pairing
    logic (semi → final/bronze) can scope by division when both
    final/bronze start with NULL teams.
13. **`cleveland_pilot_repurpose_demo_tournament_v2`** — wipes the
    Lakewood demo data (games + tournament_teams; cascades through
    game_goals/penalties/shots/lineups), renames tournament to "BLPA
    Cleveland", moves dates to Jun 12-14 (later expanded to 3 days
    via cleveland_pilot_3day_reschedule_fri_sat_sun), sets venue to RMU Island
    Sports Center, sets `advancement_per_pool=4` + `overtime_allowed=false`
    in settings, accent color gold. Adds 2 RMU rinks (Sheet 1/Sheet 2,
    UUIDs `a000…0010/0011`). Seeds 8 placeholder teams (A1-A4 in Pool
    A, B1-B4 in Pool B). Seeds 12 round-robin pool games spread
    across both sheets at 75-min slots — **originally Saturday-only,
    later rescheduled May 17 to Fri 6/12 evening (6 games, 17:00 / 18:15 /
    19:30) + Sat 6/13 morning (6 games, 08:00 / 09:15 / 10:30) so every
    team plays 1-2 games per day balanced**. Tournament status is `draft`
    initially, flipped to `active` May 16 evening.

**Cleveland day-of flow:**
1. **Now → Jun 13:** Pete renames placeholder teams as Nick sends rosters,
   uploads logos via the new logo upload field, flips status to `active`.
2. **Sat Jun 13 (8:00 AM - ~3:30 PM EDT at BAM, Strongsville OH):** Scorers run all 12 pool games (6 time slots × 2 sheets). Standings populate live with BLPA tiebreaker order (Points → GQ → Period Pts).
3. **Sat afternoon (post-pool play ~3:30 PM):** Pete opens TournamentManage → Bracket → "🏆 Generate Bracket". 8 games auto-create across 2 pools (semis with teams; gold + bronze with TBD). Pete picks Sunday first-puck time + per-game minutes at generation.
4. **Sun Jun 14:** Each semi finalizes → ScorerView prompts for SO winner if tied → gold/bronze slots auto-fill with the right teams. Pete (or his scorers) runs the gold + bronze games. Auto-recap posts hit the tournament Feed tab + push subscribers as each finalizes.
5. **Sun end:** Champion banner appears on the Bracket tab. Pete flips tournament status to `complete`.

### Late evening of May 16 — Push notification pipeline (`2b793247`)

Triggered by Pete wanting push live for the pilot. End-to-end "follow this
tournament → get pushed when any of its games finalize." Net: ~half-day
of work, ~262 LOC, scoped intentionally tight so post-pilot extensions
(DMs, team follow, league recaps) become 3-line additions on top.

**Schema:** new `tournament_subscriptions(user_id, tournament_id)` PK
table with cascade FKs to both sides + RLS that lets each user manage
only their own rows. Migration `push_pilot_tournament_subscriptions_table`
live in prod.

**Edge Function** `supabase/functions/send-recap-push/index.ts`:
- Accepts `{post_id}`. Looks up the recap post → game → tournament →
  subscribers → push_subscriptions, all with service-role credentials,
  so a malicious authed user can't influence targeting or payload.
- Sends in parallel via `npm:web-push@3.6.7`. Prunes 410/404 stale
  subscription rows so dead endpoints don't get hammered forever.
- Notification tag is `recap:<post_id>` — collapse-key so a Reopen +
  re-finalize replaces rather than stacks the notification.
- **Required secrets (Supabase Edge Function env):** `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:…). Plus `SUPABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY` which are auto-injected by Supabase.

**Client:**
- `src/lib/tournamentSubscriptions.js` — `followTournament`,
  `unfollowTournament`, `isFollowingTournament`. Upsert on follow keeps
  double-tap idempotent.
- `src/lib/push.js` — new `triggerTournamentRecapPush(postId)` thin
  wrapper around `supabase.functions.invoke('send-recap-push', …)`.
  Errors are swallowed; a failed push must never block finalize.
- `src/pages/Tournament.js` — "🔔 Follow" / "🔕 Following" toggle in
  the header. Visible to authed non-directors only (the director gets
  the Manage button instead; they already see everything from their own
  writes). First-time tap prompts for browser push permission via the
  existing `subscribeToPush`; if denied, the DB follow row is still
  created with a friendly heads-up so a later opt-in from Profile
  starts delivering immediately.
- `src/pages/ScorerView.js` — after `createGameRecapPost` succeeds in
  the finalize path, calls `triggerTournamentRecapPush(recapPost.id)`.

**Pilot scope:** 1 push per game finalize per subscriber. For BLPA
Cleveland that's a 20-push ceiling (12 pool + 8 bracket). If even that
proves noisy, gate the trigger behind a feature flag in a follow-up.
League games still skip the recap+push path entirely.

**iOS push caveat:** iOS Safari delivers web push only when the user
has installed the PWA to home screen (iOS 16.4+). A spectator who opens
the link in mobile Safari without "Add to Home Screen" will never
receive pushes. Android delivers in any browser with permission. So on
iOS, push reach ≈ PWA-install rate. We don't have a strong install
banner yet (post-pilot backlog).

**Status:** code shipped. **Not yet operational** — Pete needs to set
VAPID secrets in Supabase and deploy the Edge Function. Full setup
checklist in §12.

### Late evening of May 16 — Public tournament landing (`80f71e54`)

Spectators can now share + open BLPA Cleveland URLs without a Rinkd
account. Pattern: **public landing, gated data** — non-participants see
tournament name, dates, venue, teams; standings / live scores /
schedule / bracket / scoresheet all stay login-gated to drive sign-up.

**Routes unwrapped from `ProtectedRoute` in App.js:** `/tournament/:id`
and `/tournaments`. RLS already lets anonymous users SELECT from
`games`, `rinks`, `tournament_teams`, and from `tournaments` when
status is `'active'`/`'complete'` (draft tournaments stay invisible to
anonymous users — useful for pre-event privacy).

**Tournament.js branch on currentUser:**
- `currentUser == null` + tournament loads → renders
  `PublicTournamentLanding` component (hero with tournament metadata +
  logo + accent color; "X teams · Y games" stats; teams list grouped
  by pool; two prominent "Sign up to view live" CTAs).
- `currentUser == null` + tournament doesn't load (draft / not found)
  → friendly "🔒 This tournament is private — sign in to view" state
  instead of the director-facing retry/back UI.
- `currentUser` present → full UI (unchanged).

**Tournaments.js:**
- Works for anonymous users (RLS already filters appropriately).
- "+ Create" button swaps to "Sign in" when anonymous.
- A guest banner above the cards prompts sign-up.
- Click-through to any card lands on the public landing.

**Auth + returnTo (`Auth.js` + `App.js`):**
- Sign-up CTAs link to `/login?returnTo=/tournament/X`.
- `Auth.js` reads `?returnTo` via `useSearchParams` and uses it after
  successful sign-in / sign-up (default `/feed` when missing).
- Open-redirect protected: only relative paths starting with single `/`
  are honored (rejects `//evil.com`, `http://...`, protocol-relative).
- Falls back to `/feed` when missing or unsafe.
- App.js: `/login` route honors `?returnTo` for already-logged-in
  users too (new `LoginRedirect` helper applies the same safety
  check).

### BLPA Cleveland status flipped (May 16 late evening)

Tournament `b2789d66-1d77-4a62-862d-00b550da6a98` status flipped from
`draft` to `active` via MCP. **Now publicly discoverable** from the
Tournaments index (`/tournaments` query filter is
`.in('status', ['active', 'complete'])`). Public landing renders
immediately. Switch back to `draft` from TournamentManage → Settings if
Pete needs to hide it again pre-event (e.g., wait for Nick's real team
names before going public).

### Early morning of May 16 — Demo tournament seeded + UI walk-through

> **Status (May 16 evening):** the tournament row at
> `b2789d66-1d77-4a62-862d-00b550da6a98` was repurposed in place (see the
> May 16 evening entry above). Its data — teams, games, goals, penalties,
> shots, lineups — was wiped and replaced with the real BLPA Cleveland
> pilot seed (Jun 12-14 at RMU, 8 placeholder teams, 12 Fri+Sat
> round-robin games). The narrative below describes the original *demo*
> dataset for historical context only. Do NOT expect those scripted
> goals/penalties/lineups to exist in the DB anymore.

**Tournament built**: `BLPA Cleveland Bash 2026` — `tournament_id = b2789d66-1d77-4a62-862d-00b550da6a98`. Pete (`fc0018c2-0a7d-4eda-9d91-4077f2f138a4`) is the director. 8 teams across 2 pools, 12 pool games + 1 championship (all `status='final'`, championship is `round='final'`), dates May 9–10 (last weekend). Format = BLPA Bash preset verbatim. Full fidelity per Pete's ask: 90 goals (with periods/times/scorer #/assists), 43 penalties (minor + major mix incl. fighting), 78 shot-on-goal rows (per period/per team), 260 lineup rows (10 players × 2 teams × 13 games, names like "Gus 'Cement Hands' Beck" carried in `game_lineups.invite_name` since the `players` table is unused). Final standings ended exactly as scripted: Beer Necessities 3-0 in Pool A, Net Profits 3-0 in Pool B, BN won the championship 4-3 (regulation, scripted goal log).

**Cleanup**: one line wipes the whole demo —
```sql
DELETE FROM public.tournaments WHERE id = 'b2789d66-1d77-4a62-862d-00b550da6a98';
```
Cascades through `tournament_teams` → `games` → `game_goals`/`penalties`/`shots`/`lineups`.

**Generator script**: `/tmp/gen_tournament.py` plus chunked SQL `/tmp/t1_header.sql` through `/tmp/t6b_lineups.sql` for re-running if Pete wants different team names / scores / dates. Will be lost on machine reboot (in /tmp). Re-generating produces fresh UUIDs.

**One DB schema constraint gotcha hit during apply**: `games.round` CHECK constraint allows only `('pool','semifinal','final','consolation')`. Initial attempt used `'championship'` and failed. Resolved by using `round='final'` for the championship game. Confusing naming overlap: the **literal string `'final'`** is a valid value in BOTH `games.round` (where it means "final round of the bracket") AND `games.status` (where it means "game completed / score is locked"). Same string, different columns, different meanings. When querying, always qualify which column you mean.

**UI walk-through (signed in as a throwaway demo viewer, since the tournament pages are auth-gated)**: walked Standings, Schedule, Bracket, Info tabs on the public view; clicked into the championship game scoresheet; walked the 5 director-manage tabs (Teams, Schedule, Bracket, Scorers, Settings); checked the ScorerView for the final. Produced a **21-item punch list in §11** with file:line refs and a priority order. Highlights: the most impactful single bug is **"Pool Pool A/B"** which is a 4-character fix in 3 files that affects standings, manage Bracket, manage Schedule, manage Teams, and the game header.

### May 18 morning — Both P0 pre-pilot blockers cleared

Two P0 items had been carried since May 15 as "Pete needs to do dashboard config." Both cleared in a single morning session.

**Forgot Password flow fixed.** Root cause: Supabase Auth's Site URL was `https://www.rinkd.app` and the redirect URLs allowlist didn't include the apex `rinkd.app/reset-password` that the React app sends in `resetPasswordForEmail`. Every reset email's link 302'd to a denied redirect → silent black hole. 0 users had ever successfully completed a prod password reset (verified via `auth.users.recovery_token IS NOT NULL` queries). Nick at BLPA had tried May 14, his recovery token was still unconsumed in the DB. Fix in Supabase Dashboard → Authentication → URL Configuration: Site URL → `https://rinkd.app`; Redirect URLs added `https://rinkd.app/reset-password`, `https://rinkd.app/*`, `https://www.rinkd.app/*`, `http://localhost:3000/*`. E2E verified end-to-end as `pete@rinkd.app` (the first successful prod password reset in Rinkd history). The `ResetPassword.js` listener-race defensive patch from §8 was NOT needed — Supabase fires `PASSWORD_RECOVERY` reliably with the corrected redirect.

**Push pipeline activated (Path B — fresh VAPID pair).** The old VAPID private key wasn't recoverable from any keystore (lost to time). Generated a fresh pair via `npx web-push generate-vapid-keys --json` to `/tmp/vapid_keys.json`. Set 3 Supabase Edge Function secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:hello@rinkd.app`) via `supabase secrets set --project-ref tbpoopsyhfuqcbugrjbh`. Deployed `send-recap-push` Edge Function (v1, ACTIVE, JWT-verified) via the Supabase MCP `deploy_edge_function` tool with the source from commit `2b793247`. Updated Vercel env `REACT_APP_VAPID_PUBLIC_KEY` to the new public key (`BMiwvt78h-jzUl6lL6KgWs-PA0Y8PwX41rihhzDzt9mHWEitIe3fNHz1r3UOqIRGxL14FH-iwX9GSkaCjEeBEmc`) — Pete pasted into Vercel dashboard. Pushed `claude/elegant-sanderson-80d1d0` into `main` (commit `ee0ca9ef`) — public landing + push pipeline code now in production, Vercel auto-deployed. Deleted 2 stale push_subscriptions (May 9 + May 12 test subs tied to the OLD VAPID key — would have been silent-failure rows). Saved new private key to Pete's 1Password as "Rinkd VAPID keys (May 2026)" + wiped tempfile. **DO NOT regenerate** — rotation invalidates every real-user subscription.

**End-to-end smoke test on Android.** Created a second account `mvntrec@gmail.com` (since the Follow button on Tournament.js hides for the tournament director — Pete is the director of BLPA Cleveland, so he can't subscribe to push for his own tournament; intentional behavior). Hit the `InvalidStateError` from a stale pre-rotation pushManager subscription cached in the browser; Chrome's "Reset notifications" site setting cleared it. Resubscribe succeeded → `push_subscriptions` row inserted (FCM endpoint, new VAPID key). Finalized test game `dd055e47…` from director account → recap post created → Edge Function invoked → push arrived on phone within ~2s with OS-native card. Tap → opened `/game/dd055e47…`. Full chain validated. Test game rolled back to `scheduled` + recap post deleted post-test.

### May 18 afternoon — Tournament feed + composer + push.js rotation fix + auto-follow Pete

Three follow-on code commits (live in prod) + the `tr_auto_follow_pete` DB trigger.

**`30b40986` — push.js: unsubscribe before resubscribe to survive VAPID rotation.** Surfaced during the morning smoke test (mvntrec@gmail.com's Android Chrome held an old subscription tied to the rotated key). At the top of `subscribeToPush` in `src/lib/push.js`, before `Notification.requestPermission()`: call `reg.pushManager.getSubscription()` and `unsubscribe()` any existing sub. Errors swallowed; subscribe() below surfaces real failures with full context. 9 lines added. No DB or Edge Function changes — pure client-side.

**`4ec187c4` — tournament-scoped feed.** Triggered by Pete: "The recap went to the general feed where some users will have no context or need to see it." Design: filter, don't relocate. Migration `posts_add_tournament_id_for_tournament_scoped_feed` adds nullable `posts.tournament_id` (FK to tournaments, `ON DELETE SET NULL`) + partial index `(tournament_id, created_at desc) WHERE tournament_id IS NOT NULL`. `getPosts` + `getFollowingPosts` filter `tournament_id IS NULL` so global/following feeds stay clean. New `getTournamentPosts(tournamentId, limit)` mirrors `getTeamPosts` (blocked-user filter applied). `createGameRecapPost` accepts `tournamentId` — both insert + re-finalize update paths stamp the column (re-finalize self-heals older recaps). `ScorerView.js` passes `game.tournament_id` on finalize. New `Feed` tab on Tournament.js between Bracket and Info — lazy-loaded the first time the tab opens. Empty state copy: "📰 No updates yet. Recaps appear here when games finalize. You can post too." No backfill needed — the only recap in prod was the smoke-test row we deleted post-test.

**`ae4d7985` — tournament feed composer.** Decision: anyone signed in can post to the tournament feed (maximum community engagement, existing report+block flow handles abuse). User posts do NOT trigger pushes (recap-only); avoids notification spam during a busy game. `createPost` now accepts `tournamentId`. FeedTab gains a composer at the top: textarea (500-char cap), optional photo/video upload via existing `uploadMedia`, optimistic prepend on success. Non-recap cards get the existing `PostActionMenu` (Report + Block @author); recap cards don't (auto-generated, nobody to report). Media inlined below text.

**Auto-follow Pete on new account (DB trigger).** Migration `auto_follow_pete_on_new_profile` creates `auto_follow_pete_on_profile_insert()` function (SECURITY DEFINER, `search_path = public, auth`) and `tr_auto_follow_pete AFTER INSERT` trigger on `public.profiles`. Looks up Pete by email (not hardcoded UUID — survives any future account migration). Skips self-follow. Uses `on conflict do nothing` for idempotence. Backfill: 19 existing eligible users inserted in one transaction (all 20 - 1 Pete). Users who manually unfollow stay unfollowed — trigger only fires on INSERT.

**Code commits live on `origin/main` (live build `ae4d79852ca5`):** `30b40986` (push.js), `4ec187c4` (tournament feed), `ae4d7985` (composer). Two DB migrations live in prod DB: `posts_add_tournament_id_for_tournament_scoped_feed`, `auto_follow_pete_on_new_profile`.

### May 18 late afternoon — Multi-director + Turnstile + architectural review fixes

Three more shipped commits (`4f145312`, `45f71a6d`) + three DB migrations + a Cloudflare Turnstile widget standup. Triggered by Pete asking (a) "let multiple directors run a tournament," then (b) "how do I block scraping," then (c) the six-question architectural review (RLS, realtime, edge functions, auth, queries, cold starts).

**`4f145312` — Multi-director support.** A tournament's original director (`tournaments.director_id`) can now grant full management access to additional users via the Scorers tab → new Directors section. Added directors get the same powers: edit teams/schedule/bracket/settings/scorer roster + reopen finalized games. Founder is immutable.

Migrations:
- `multi_director_support_helper_and_rls` — new `is_tournament_director(p_tournament_id, p_user_id)` function (SECURITY DEFINER, STABLE, `search_path = public, auth`) that returns true if the user is either the original director OR has `role='director'` in `tournament_roles`. `tournament_roles` RLS rewritten to use it: `roles_insert` allows any director to insert; new `roles_delete` allows any director to delete except the founder's own role row (`not exists (select 1 from tournaments t where t.director_id = tournament_roles.user_id and tournament_roles.role = 'director')`); `roles_director_read` lets any director see the full role list.
- `multi_director_rls_extend_to_games_and_tournaments` — extends `games`, `tournament_teams`, and `tournaments` policies to honor extra directors via the helper. `tournaments` DELETE policy intentionally NOT updated — destroying the event remains the founder's sole prerogative.

Code:
- New `src/lib/tournamentDirectors.js` — `addDirectorByInput`, `listDirectors`, `removeDirector`, `isExtraDirector`. Mirrors `tournamentScorers.js` patterns BUT directors must already have a Rinkd account (no email-invite path — too privileged to grant by address-typo).
- `TournamentManage.js` — new `DirectorsSection` component rendered above the existing scorer UI on the Scorers tab. Founder gets an amber "Founder" badge + "Can't remove" affordance. New `isExtraDirector` state + `extraDirectorChecked` flag so a freshly-added director doesn't see the 🔒 lock-screen flash on first navigate to /manage.
- Permission checks updated in 5 sites: `TournamentManage` page gate, `Tournament` canScore + Manage button + hide-Follow, `GameDetail` isOrganizer, `ScorerView` director flag for Reopen/OT/SO gating.

**Security advisor pass (migration `close_security_definer_views_and_media_listing`).** Triggered by the architectural review; advisor flagged 4 ERROR-level `SECURITY DEFINER` views + 1 WARN-level public storage bucket listing.
- `alter view ... set (security_invoker = on)` on `analytics_daily`, `analytics_dau`, `league_standings`, `tournament_standings`. Anon access to standings preserved (underlying tables are `qual = true` public-read). Anon access to analytics views correctly blocked (`analytics_events` is commissioner-only). Verified with curl as anon: standings returns rows, analytics views return `[]`.
- Dropped `"Public can read media"` policy on `storage.objects`. Bucket has `public = true` so direct URL fetches via `/object/public/media/…` still work; anon enumeration via the `/storage/v1/object/list/media` API now returns `[]`. Verified.

**`45f71a6d` — Cloudflare Turnstile on signup.** Bot challenge in Managed mode (smart, usually invisible).
- New `src/components/TurnstileWidget.js` — small wrapper around the global `window.turnstile.render`. Exposes `onToken` callback, `theme` prop, and `isTurnstileEnabled` flag (true when `REACT_APP_TURNSTILE_SITE_KEY` is set). Polls for `window.turnstile` while the script loads; handles widget cleanup on unmount.
- `public/index.html` — included Turnstile script with `async defer`.
- `src/lib/auth.js` `signUp` — accepts `captchaToken`, forwards to `supabase.auth.signUp({ options: { captchaToken } })`.
- `src/pages/Auth.js` — renders `<TurnstileWidget>` below the Level dropdown on step 3 of signup. Gates `handleSignup` on a verified token; shows clear error if user tries to submit before completing the challenge.

Config (Pete-side, all done May 18):
- Cloudflare Turnstile widget created for hostnames `rinkd.app`, `www.rinkd.app`, `localhost`. Site key + secret key generated.
- Supabase Dashboard → Auth → Bot Protection: enabled with Turnstile provider + secret key pasted.
- Vercel env `REACT_APP_TURNSTILE_SITE_KEY` set.

Verified end-to-end: direct API signup attempt without a token returns `HTTP 400 {"error_code":"captcha_failed"}`. Live build `45f71a6dd568` includes the Turnstile script. Bug report + survey form Turnstile gating is filed as a post-pilot follow-up spawn-task — the `qual = true` RLS on those tables means write-spam is theoretically possible, but at 25 days to pilot the abuse vector is low-probability.

**Spreadsheet drift:** `~/Downloads/rinkd-sprints.xlsx` is now further out of sync with §7. Handoff doc remains source of truth.

### May 19, 2026 — BLPA Cleveland venue change + 2-day compress + minimum-BB resequence

Pete swapped the venue (RMU Island Sports Center, Pittsburgh → Brunswick Auto Mart Arena, Strongsville, OH) and dropped Friday games. All 12 pool games now run Saturday 6/13. Sunday 6/14 stays championship.

**Migration `blpa_cleveland_move_to_bam_strongsville_sat_sun_only`:**
- `tournaments.settings.venue_name` → `"Brunswick Auto Mart Arena (BAM)"`
- `tournaments.settings.venue_address` → `"15381 Royalton Rd, Strongsville, OH 44136"`
- Dropped the stale `settings.venue` key (Lakewood, predates venue_name/venue_address)
- Updated 2 `rinks` rows in place (preserve UUIDs to keep game FKs intact)
- Moved 6 Friday games onto Saturday afternoon slots (11:45 / 13:00 / 14:15 EDT)
- Tournament start_date was already `2026-06-13` (corrected pre-session)
- Assumption: BAM has 2 sheets (matches the existing 2-sheet schedule shape; Pete confirmed by request)

**Migration `blpa_cleveland_minimize_back_to_back_games`:**
- Re-sequenced the 12 pool games to minimize per-team back-to-backs.
- Per-team gaps:
  - A1/B1: 08:00, 10:30, 13:00 (2.5h, 2.5h) ✓ no BB
  - A2/B2: 08:00, 11:45, 14:15 (3.75h, 2.5h) ✓ no BB
  - A3/B3: 09:15, 10:30, 14:15 (1.25h, 3.75h) ❌ 1 BB
  - A4/B4: 09:15, 11:45, 13:00 (2.5h, 1.25h) ❌ 1 BB
- 4 of 8 teams have one BB each. Down from 6 of 8 after the first venue migration.
- **Mathematical floor:** 4-team round-robin in 6 single-sheet slots cannot fully eliminate BBs. Only 4 valid no-BB patterns exist for 3 of 6 slots — {1,3,5}, {1,3,6}, {1,4,6}, {2,4,6} — and {1,3,5} ∩ {2,4,6} is empty, so any 2 teams assigned those patterns can never play each other. Best achievable is 2 BB-free + 2 BB-prone per pool.
- Sheet assignment normalized: Pool A on Sheet 1, Pool B on Sheet 2.

**Final Saturday schedule (all EDT, BAM):**

| Slot | Sheet 1 | Sheet 2 |
|---|---|---|
| 08:00 | A1 v A2 | B1 v B2 |
| 09:15 | A3 v A4 | B3 v B4 |
| 10:30 | A1 v A3 | B1 v B3 |
| 11:45 | A2 v A4 | B2 v B4 |
| 13:00 | A1 v A4 | B1 v B4 |
| 14:15 | A2 v A3 | B2 v B3 |

Last puck Saturday ~15:30. Sunday championship times still TBD until Pete generates the bracket Saturday afternoon.

### May 19, 2026 afternoon — Standings sticky columns, team logo uploads, CSHL personal tracker

**`fc7d2904` — Standings table sticky columns.** On mobile, full team names + the PTS column would push the W/L/T/GF/GA columns off-screen. Refactored from a single CSS grid (gridTemplateColumns) into an HTML table inside an overflow-x:auto wrapper. The TEAM column (rank chip + team name, width up to 160px) uses `position: sticky; left: 0`. The PTS column uses `position: sticky; right: 0`. Both sticky cells have a subtle box-shadow at their scroll-edge to hint at the affordance. `tableLayout: auto` with `minWidth: max-content` on the table forces the overflow when content exceeds the container — desktop still sees the full table (no scroll), mobile scrolls when needed. ADVANCES TO BRACKET divider moved into a colSpan'd row. No data shape changes.

**`460a8990` — Team logo uploads.** Mirror profile-avatar pattern. Migration `teams_and_league_teams_add_logo_url` adds nullable `logo_url text` columns to `teams` and `league_teams` (tournament_teams already had it from `21785087`). `createTeam` accepts `logo_url`. TeamManage Create + Settings forms gain a 📷 Upload button next to the existing color picker; uses `uploadMedia(file, currentUser.id)` from `lib/posts.js`; 5MB cap, NSFW pre-check via `classifyImage`. When `logo_url` is set, the colored-initials fallback is hidden visually but `logo_color` remains in the DB so Remove reverts cleanly. Rendering in Team.js + Teams.js uses `background:`url(...) center/cover, <color>`` so partially-transparent logos still get the team color underneath.

**CSHL 10U Squirts personal tracker scaffolded.** Pete plans to use Rinkd as a personal tracker for his son Henry Hessell #17's CSHL season — "from the stands, nothing official." CSHL is hosted on Crossbar; their public site exposes `/standings/show/<id>` + `/stats/division_instance/<id>` URLs but pages are client-side rendered so WebFetch doesn't see the data without a headless browser. The 2026-27 season schedule hasn't been published yet (mid-summer expected). Scaffolded the league + team shell now:
- League: `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6` — `CSHL 10U Squirts (2026-27)`, season `2026-2027`, Pete as commissioner. `settings.source_org = 'Cleveland Suburban Hockey League'`, `settings.source_url = 'https://www.cshlhockey.org/'`.
- Team: `d18e023c-354f-4d3b-b5a0-82574f05377d` — `Shaker Heights Red Raiders`, division `10U Squirts`, Pete as manager, source `rinkd_native`.
- League-team link populated.
- Roster: Pete (manager) + Henry Hessell #17 (no user account — COPPA; tracked via `team_members.invite_name`).
- Subdivision (AA / A1 / A2 / A3 / B1 / B2) is NULL until tryouts confirm placement.
- Opponent teams will be added as nameplate-only `league_teams` rows (no underlying `teams` row, no roster) when CSHL publishes the schedule.
- Pete will enter scores + Henry's goals/assists after each game; standings auto-update; season stat scrapbook accumulates.

### May 19, 2026 evening — Volunteer relocation + Ties stat + multi-manager support

**`469406fc` (wrong direction) + `2e6207d5` (correction) — Volunteer placement.** Pete wanted Volunteer moved out of the More drawer's Manager section. First attempt put a tab strip above `/teams` (incorrect — Pete meant the individual team page). Correction commit deleted the `TeamsHeaderTabs.js` component, removed it from `Teams.js` + `VolunteerCoordinator.js`, and added a new `src/components/TeamVolunteer.js` self-contained for a single team. TABS array on `Team.js` is now `['Roster', 'Schedule', 'Feed', 'Volunteer', 'Info']`. The Volunteer surface:
- Stat pills: Open / Filled / Past counts
- Slot list per row: role, time, notes, who's signed up (if any), action button
  - Open + signed-in → Claim (red); calls `claimSlot(id)` from `lib/volunteers.js`
  - You signed up → green "You're signed up" + Cancel
  - Someone else signed up → their name + (manager) Open up
  - Manager-only 🗑 Delete
- Past slots auto-collapse behind a "▼ Show N past" toggle
- Manager-only `+ Add Volunteer Slot` composer: role preset dropdown (Scorekeeper / Snack Parent / Locker Room Monitor / Gear Hauler / Statkeeper / Off-ice Official / Tournament Volunteer / Custom) + optional pin-to-game (loads team's scheduled games + auto-sets time) + manual time picker + notes
- Standalone `/volunteer-coordinator` route still works as a multi-team aggregate dashboard (untouched) but is no longer linked from any nav.

**`2e6207d5` — Ties added to team page season stat line.** Was `Players · Games · Wins · Losses`. Now also computes ties from `games.status='final'` with `home_score === away_score && home_score != null`. Renders as 5th stat between Losses and the rest. Wins + Losses + Ties = total finalized games at a glance.

**`adc836b6` — Multi-manager support for teams.** Mirrors the multi-director tournament pattern. Migration `multi_team_manager_support_helper_and_rls`:
- New `is_team_manager(p_team_id, p_user_id)` SECURITY DEFINER STABLE function (`search_path = public, auth`). Returns true if user is either the founding `teams.manager_id` OR has `team_members.role = 'manager'` for this team. `createTeam` already inserts a manager team_members row for the founder, so this path was structurally in place — just no RLS gates honored it.
- 6 RLS policies rewritten to use the helper: `teams_manager_update`, `team_members_manager_update`, new `team_members_manager_delete` with founder-protection clause, `team_join_requests` read + update, `volunteer_slots` insert + update + delete. The volunteer_slots update policy preserves the "self-claim" path (any authed user can claim/release their own slot).
- Founder protection: the `team_members` row where `user_id = teams.manager_id AND role = 'manager'` is undeletable via RLS. `removeTeamManager` silently no-ops on it.

Code:
- New `src/lib/teamManagers.js` — `listTeamManagers`, `addTeamManagerByInput` (account-required like Directors; PROMOTES if target is already on the team with a different role), `demoteTeamManager` (drops to player but keeps roster row), `removeTeamManager` (deletes the row entirely).
- `TeamManage.js`: new `ManagersSection` rendered at the top of the Roster tab. Founder shows amber "Founder" badge + "Can't remove" affordance; others get Demote + Remove buttons.
- `Team.js` `isManager` strengthened: now `userRole?.role === 'manager' || team.manager_id === currentUser.id`. Matches the server-side `is_team_manager()` truth and survives any legacy team where the founder's team_members row is missing.

These are the only known outstanding items from the audit. **None require code changes.**

### ~~🔴 Forgot-password flow~~ — ✅ FIXED May 18, 2026 morning

**Root cause (now resolved):** The Supabase reset email's `redirect_to` was `https://www.rinkd.app` (Site URL fallback), NOT `https://rinkd.app/reset-password` that the app sends. The allowlist rejected the apex redirect because the apex domain wasn't permitted. **0 users had ever successfully completed a password reset** in production prior to this fix (including BLPA Nick on May 14 — his recovery token was never consumed).

**Fix applied (Supabase Dashboard → Authentication → URL Configuration):**
- Site URL changed `https://www.rinkd.app` → `https://rinkd.app`
- Redirect URLs added: `https://rinkd.app/reset-password`, `https://rinkd.app/*`, `https://www.rinkd.app/*`, `http://localhost:3000/*`

**E2E verified May 18, 13:39 UTC:** Pete completed full Forgot Password → email → click → set new password → land on `/feed` flow. DB confirmed: `last_sign_in_at` = 2026-05-18 13:39:51, `still_unused` = false, `updated_at` = 2026-05-18 13:40:06. `ResetPassword.js` listener race did NOT manifest — no defensive patch needed.

**BLPA captains can now reset their passwords** if they hit the flow during pilot onboarding.

### 🟠 Other config items (lower-impact)

- **`REACT_APP_BETA_BANNER` (Vercel env var)** — Feed shows a "🚧 Public beta" banner by default. Decide if that's the right message for BLPA opening day. Set `REACT_APP_BETA_BANNER=0` to hide it.
- **~~VAPID setup for push pipeline~~** ✅ **DONE** May 18, 2026 morning (Path B — fresh pair generated because old private key wasn't recoverable). New public key in Vercel env (`REACT_APP_VAPID_PUBLIC_KEY`) + as Supabase secret; new private key as Supabase secret + saved to Pete's 1Password entry "Rinkd VAPID keys (May 2026)". `send-recap-push` Edge Function deployed (v1, ACTIVE, `verify_jwt=true`). 2 stale test subscriptions purged. **DO NOT regenerate this pair** — rotation invalidates every real-user subscription. Procedure preserved in `~/.bash_history` and the May 18 Claude Code transcript for reference if ever needed again.
- **~~Turnstile bot protection on signup~~** ✅ **DONE** May 18, 2026 late afternoon. Cloudflare Turnstile widget created (Managed mode, hostnames: rinkd.app + www.rinkd.app + localhost). Supabase Auth → Bot Protection enabled with secret key. Vercel env `REACT_APP_TURNSTILE_SITE_KEY` set. Signup, login, password reset all gated by the challenge. Bug report + survey form gating filed as a post-pilot follow-up spawn-task.
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

### Tournament UI bugs (§11) — **DONE May 16 evening**
- All 21 punch-list items shipped on worktree branch (4 commits, pending merge — see §4). §11 retained as a historical reference; do not re-implement.

### May 17 evening — BLPA Cleveland rescheduled to 3 days (SUPERSEDED May 19)

> **SUPERSEDED:** This 3-day plan was reverted on May 19 to 2-day (Sat-Sun only, BAM in Strongsville). See the May 19 §5 entry. Retained for historical context only.

Pete confirmed the tournament starts Friday Jun 12, not Saturday Jun 13. New shape: **Fri 6/12 + Sat 6/13 + Sun 6/14**. Pool play splits across Fri evening + Sat morning so every team plays 1-2 games per day instead of 3-on-1-day-0-on-the-other. Championship stays Sunday.

Migration **`cleveland_pilot_3day_reschedule_fri_sat_sun`** (live in prod):
1. `tournaments.start_date` → `2026-06-12` (end_date stays `2026-06-14`)
2. DELETE all 12 pool games (no nested data lost — cascade-clean since no scoring has happened yet)
3. Re-INSERT 12 pool games with rebalanced schedule below

**Friday Jun 12 evening (6 games, 17:00 / 18:15 / 19:30 EDT):**
| Time | Sheet 1 | Sheet 2 |
|---|---|---|
| 17:00 | A1 v A2 | A3 v A4 |
| 18:15 | B1 v B2 | B3 v B4 |
| 19:30 | A1 v A3 | B1 v B3 |

**Saturday Jun 13 morning (6 games, 08:00 / 09:15 / 10:30 EDT):**
| Time | Sheet 1 | Sheet 2 |
|---|---|---|
| 08:00 | A2 v A4 | B2 v B4 |
| 09:15 | A1 v A4 | B1 v B4 |
| 10:30 | A2 v A3 | B2 v B3 |

**Per-team daily counts (verified via SQL):** A1=2+1, A2=1+2, A3=2+1, A4=1+2, B1=2+1, B2=1+2, B3=2+1, B4=1+2 — every team 1-2 per day, 3 total. ✓

Sunday Jun 14: championship games (semis + bronze + gold per pool, 8 total) auto-generate Sat afternoon via the existing Bracket tab button — director picks first-puck time + per-game minutes at generation. No schedule change needed.

### Tournament engine — GameSheet parity (post-pilot)

Spec'd in **`rinkd_v4/GAMESHEET_PARITY_GAPS.md`** (May 17). 7 gaps between Rinkd's current tournament feature set and GameSheet's. Suggested sprint order per the spec doc: iOS PWA banner → suspensions → game clock → offline mode → (refs + embed in parallel) → roster validation. All items below have full file:line/migration specs in the parity doc — pull from there, don't re-spec.

| # | Gap | Priority | Effort | Notes |
|---|---|---|---|---|
| GS-1 | **Offline mode** — SW background-sync queue + IndexedDB so a flaky WiFi rink doesn't drop goals/penalties mid-game | **P0 pre-scale** | 8-12 days | Spec includes 5 phases (prefetch, queue, SW drain, banner, conflict resolution). Currently §12 P2 K hand-waves with "paper backup" — fine for one venue, **required before 2nd tournament partner**. New Edge Function `sync-scorekeeper-queue` (service role). No schema changes. |
| GS-2 | **Suspension management** — game-misconduct/match-penalty flow auto-prompts a `game_suspensions` row; director sees pending suspensions tab; suspended players badged on standings | **P1** | 2-3 days | New `game_suspensions` table. New `SuspensionPrompt` modal in ScorerView. New Suspensions tab in TournamentManage. New `send-suspension-alert` Edge Function (mirrors `send-recap-push` pattern — should be 30 LOC). |
| GS-3 | **In-app game clock** — counts down period length, auto-pre-fills `time_in_period` on goal/penalty save | **P2** (parity spec) — argue **P1**, fastest QoL win for scorers | 1 day | New `GameClock` component. Pure client-side state; no DB writes. Uses existing `useWakeLock`. Eliminates the #1 data-entry error (manual time entry). |
| GS-4 | **Referee tracking** — assign refs per game, post-tournament ref analytics (penalties called, misconducts) | **P2** | 2-3 days | New `referees` + `game_referees` tables; optional `game_penalties.referee_id` FK. Pre-game ref assignment UI. Per-ref stats from existing penalty joins. |
| GS-5 | **Roster / lineup validation** — jersey# → player_id resolver + pre-game eligibility check against active suspensions | **P3** | 3-4 days after ChillerStats import | **Gated on the same `players` table backfill the leaderboard depends on** (see "Still gated on populating `players`" below). Once unblocked, gives "✓ Rosters verified" badge on game pages. |
| GS-6 | **Embed widgets** — `/embed/tournament/:id/standings` + `/schedule` iframes for league/club websites | **P3** | 1-2 days | Two new no-auth routes outside ProtectedRoute. 30s polling (not realtime — iframes drop WebSockets). LeagueApps gap LA-8 below shares this architecture; build both at once. |
| GS-7 | **iOS PWA install banner** — push doesn't reach iOS users unless they install the PWA to home screen (16.4+). Banner triggers on 3rd visit or on Follow-tournament tap | **P1** | 4-6 hours | Already noted in passing in the post-pilot backlog; parity doc gives the full spec. **Pull forward** — small build, unblocks push on iOS. Trigger: 3rd visit (visit counter in localStorage) OR Follow-tap moment (highest intent). |

### League engine — LeagueApps parity (post-pilot)

Spec'd in **`rinkd_v4/LEAGUEAPPS_PARITY_GAPS.md`** (May 17). 8 gaps for the league-management surface (vs the tournament surface above). Per the spec doc: BLPA Cleveland is tournaments, **none of these are pilot-blocking**. First milestone after Cleveland per the doc: LA-1 (Stripe registration) + LA-2 (Waivers). Everything else is table stakes after that.

| # | Gap | Priority | Effort | Notes |
|---|---|---|---|---|
| LA-1 | **Stripe registration + payments** — teams register + pay season fees self-service; commissioner sees real-time registration + collection | **P0** post-pilot | 5-8 days | New `league_registrations` table; columns on `leagues` for fee + deadline + capacity. New `LeagueRegister` public page. New `stripe-webhook` Edge Function. New Vercel env `REACT_APP_STRIPE_PUBLISHABLE_KEY`; Supabase secrets `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Unlocks revenue. **Shares core build with TOURN-REG-1** (tournament registration) — same Stripe Connect + webhook + Edge Function pattern; consider folding both into one polymorphic `registrations` table keyed by `(parent_type, parent_id)` to avoid duplication. |
| LA-2 | **Digital waivers** — commissioner attaches a waiver to a league; players sign before joining; signatures exportable | **P1** | 3-4 days | New `league_waivers` + `league_waiver_signatures` tables. New `WaiverModal` + standalone sign route `/league/:id/waiver/:waiverId`. Legal protection — pair with LA-1 before opening leagues to public sign-up. |
| LA-3 | **USA Hockey membership validation** — players enter USAH member # at registration; sanctioned leagues require valid active membership | **P1** for sanctioned leagues, **N/A** for BLPA-style rec leagues | 3-5 days | USAH has no public API — sanctioned path requires their bulk-export integration; non-sanctioned path is self-attestation. **Skip unless Rinkd pursues youth/sanctioned leagues.** |
| LA-4 | **Financial reporting** — commissioner dashboard with total collected, outstanding, refunds, Stripe net | **P1** (depends on LA-1) | 2-3 days | No new tables — derives from `league_registrations` + Stripe balance API. New `LeagueManage` → Financials tab. CSV export. |
| LA-5 | **Division eligibility enforcement** — divisions with age/skill rules; ineligible players blocked from rostering; commissioner can grant overrides with audit log | **P2** | 3-4 days | New `league_divisions` + `league_eligibility_overrides` tables; `league_teams.division_id` FK. New `EligibilityGate` wrapper for join flows. |
| LA-6 | **Multi-season management** — one league spans Fall 2025 / Spring 2026 / etc.; archive seasons; historical seasons remain browsable | **P2** | 2-3 days | New `league_seasons` table; `season_id` FK on `league_teams` + `league_games`. Partial unique index enforces one active season per league. Standings filter by season. Legacy rows treat NULL season_id as "pre-season-tracking." |
| LA-7 | **Commissioner analytics** — scoring/penalty leaderboards per league; RSVP fill rate; volunteer fill rate over the season | **P3** | 2-3 days | No schema changes — pure query work. New `getLeagueAnalytics()` helper. New `LeaderboardTable` reusable component. New Analytics tab in `LeagueManage`. |
| LA-8 | **League embed widgets** — `/embed/league/:id/{standings,schedule,leaders}` iframe routes for club websites | **P3** | 2-3 days | Shares architecture with GS-6 above — **build together**. Optional `?theme=&accent=` query params for white-label. |

### Team engine — coaching tools (post-pilot)

Pete's ask (May 17): "line combos and shift tracking, manager/coach runs from the team page." Phased so each piece is shippable on its own; later phases stack onto earlier ones without rework. All work lives on `/team/:id` (existing `Team.js` + `TeamManage.js`) and is coach/manager-gated via the existing `teams.manager_id` check. None of these are pilot-blocking — independent track of work that helps Rinkd compete with TeamSnap / Hockey Coach Vision / SportlyzerCoach for serious/youth/junior teams (BLPA-style rec teams probably won't engage with shift tracking as deeply).

| # | Item | Priority | Effort | Notes |
|---|---|---|---|---|
| TEAM-1 | **Line combinations builder** — coach defines forward lines (LW-C-RW × 4), defense pairs (LD-RD × 3), goalie rotation. Drag-and-drop from the roster. Multiple saved lineup cards per team (e.g. "Powerplay", "Penalty Kill", "Even Strength"). Visible read-only to roster; editable by manager only. | P2 | 2-3 days | New `team_lineups` table (one row per saved lineup card) + `team_lineup_slots` (player_id × position × line_number). New "Lines" tab on `Team.js`. Drag-and-drop UI using HTML5 drag events (no library). Selectable in the existing pre-game lineup flow (extends `game_lineups`). |
| TEAM-2 | **Live shift tracking** — bench-side UI for toggling lines on/off ice during a game. Real-time TOI calculation. Coach taps "Line 1 ON" → starts a shift timer; taps "Line 2 ON" → ends Line 1's shift, starts Line 2's. Per-player TOI accumulates from line shifts (no per-player toggle — would be too fiddly on the bench). | P2 | 3-5 days | New `game_shifts` table: `(game_id, lineup_id, line_number, started_at, ended_at, period)`. New `/bench/:gameId` route (separate from ScorerView — different mental model, different UX). Realtime sync so two coaches on the same bench stay coherent. Wake lock + tap-targets ≥44px (same iPad treatment as ScorerView). |
| TEAM-3 | **Shift-based stats** — per-player TOI per game and over a season; shifts per period; average shift length; longest/shortest shift. Per-line aggregate: avg TOI per shift, total shifts logged. | P3 | 2-3 days | No new tables — pure aggregation from `game_shifts`. New "Stats" subsection on player profile (per-game TOI heatmap) and on team page (lineup card view with cumulative TOI/shifts per line). |
| TEAM-4 | **Shift ↔ game-event linking (advanced stats)** — `+/-` per player (who was on-ice for goals for vs against), goal/assist attribution by line, special-teams analytics (PP/PK time + conversion). Joins `game_shifts.started_at/ended_at` ranges against `game_goals.created_at` + `game_penalties.created_at`. | P3 | 3-4 days | No new tables. Materialized view `player_game_advanced_stats` updated on game finalize. Adds a "Game Notes" section to the post-game recap with line-level analytics. Requires TEAM-2 to be in place (no shifts = nothing to join against). |

**Suggested order:** TEAM-1 alone is useful for any team with set lines (delivers value at Sprint 1). TEAM-2 unlocks every later phase but is the heaviest UI/UX lift. TEAM-3 + TEAM-4 are stat-nerd features for the most engaged coaches — defer until at least one team is actively using TEAM-2 in live games so the dataset has something to aggregate.

### Revenue + monetization (post-pilot — Phase 1 + Phase 2)

Spec'd by Pete May 17 evening + refined later same evening based on screenshots of the monetization roadmap + BenchBoss pricing tiers + the "BLPA is the founding-partner pass-through customer" model. Two phases: Phase 1 (0-6 months — Ship Now) and Phase 2 (6-18 months — Build After Cleveland). All revenue items share a foundational dependency on BIZ-INFRA-1 (Stripe Connect platform-fee setup). **Pricing tiers (BIZ-TIER-1) are intentionally post-pilot — don't introduce pricing during Cleveland, ship as Sprint 1 work after.**

**Key pricing decisions captured May 17 (don't re-litigate without explicit Pete review):**
- **Stripe fee absorption:** organizer eats the 2.9% + 30¢ processing fees on every checkout. Standard marketplace practice. Means BLPA gets ~$2,427 of a $2,500 entry fee per team (with $15 BenchBoss + $58 platform fee + Stripe deducted from the $2,515 gross).
- **BenchBoss fee label:** "Technology fee" (not "BenchBoss fee", not "Convenience fee") — softer than naming Rinkd directly, more transparent than vague convenience-fee framing. Standard label teams have seen elsewhere (Ticketmaster-style).
- **Refund policy:** sliding scale — 100% refund >14 days before event, 50% refund 7-14 days out, 0% refund inside 7 days. Technology fee non-refundable once event runs. Industry standard for amateur sports; protects bracket integrity against late dropouts.
- **Crease premium positioning:** kept as a **separate consumer track** (does NOT fold into B2B BenchBoss). Different audience (players + fans), scales independently. MONEY-1 Crease premium remains its own revenue stream alongside BenchBoss/marketplaces; not bundled.

**Phase 1 — Ship Now (0-6 months)**

| # | Item | Priority | Effort | Notes |
|---|---|---|---|---|
| BIZ-INFRA-1 | **Stripe Connect platform-fee setup** — onboard Rinkd as a Stripe platform, configure Connect accounts for tournament organizers + photographers + refs (later), enable platform-fee on every charge | **P0 (revenue track)** | 3-5 days | Foundation under every paid item below. Without this, Rinkd can take checkouts but can't take a cut. New Edge Function for Connect-account onboarding; webhook to mirror payouts to a `stripe_payouts` table for visibility. Organizer eats Stripe processing fees (standard). |
| TOURN-REG-1 | **Tournament registration + 1.5-2% platform fee** — teams register + pay entry fee via the tournament public landing; organizer keeps ~98%, Rinkd takes 1.5-2% as platform fee | **P0** | shares core build with LA-1 (extends to tournaments) | Reuses `league_registrations` schema pattern → `tournament_registrations` table (or fold into one polymorphic `registrations` table). Webhook updates `paid_at`; auto-approves team into `tournament_teams` on payment. **HARD DEPENDENCY for Pass-through billing arrangement (see BIZ-TIER-1)** — without TOURN-REG-1 live, there's no way to collect the $15/team Technology fee from participating teams. Reference revenue: $2,000 per Mad Man event at 2% take. |
| BIZ-1 | **Hotel affiliate (Lucid Travel / HotelPlanner)** — generate a hotel block URL per tournament; tracking pixel; 3-5% commission per room booked | **P1 (high ROI / zero engineering)** | 1-2 days | No payment infrastructure needed. New `tournament.hotel_affiliate_url` field; tournament public landing surfaces "Book your hotel" button; UTM-tracked affiliate link. Reference revenue: $300-800 per tournament passive, scales with attendance. **Ship before Stripe Connect even goes live** — doesn't depend on it. |
| BIZ-2 | **Tournament sponsorships** — "presented by" placement on tournament pages, brackets, and recap push notifications | **P1** | 5-7 days | New `tournament_sponsors` table (name, logo, tier, placement, contract dates). UI: sponsor logos on Tournament public page header + Bracket tab + game cards (subtle). Push integration: extend `send-recap-push` payload to include sponsor mention. Sponsorship management UI for organizers. Reference revenue: $200-1,500 per tournament. Revshare split TBD when shipping — historical default: organizer-sold = Rinkd 20-30%; Rinkd-sold-direct = Rinkd 70-80% with 20-30% kickback to organizer. |
| BIZ-TIER-1 | **BenchBoss billing arrangements (4 modes, not 3 tiers)** — Community ($0, ≤16 teams), Organizer-pays ($25/team to organizer), **Pass-through ($15/team Technology fee charged directly to participating teams)**, Pro (custom annual flat, white-label, multi-tournament dashboard, dedicated onboarding) | **P0 post-pilot** (Sprint 1 work after BLPA Cleveland — NOT during pilot) | 5-10 days | **Replaces obsolete MONEY-2** (BenchBoss $15/mo captain consumer framing — superseded). New `tournaments.billing_model` enum (`community | organizer_pays | pass_through | pro`) + `bench_fee_cents` (defaults: 0 / 2500 / 1500 / per-contract). Feature-gating layer keys off billing_model. Plan-selection UI in TournamentCreate. Pro tier carries over MONEY-2's higher-spec items (white-label, multi-tournament dashboard, custom formats/rules config, priority support, dedicated onboarding). **Pass-through is the BLPA-style founding-partner arrangement**: organizer gets BenchBoss free; participating teams see "Technology fee $15.00" line item at registration checkout (per TOURN-REG-1). Target customers: Community = booster clubs / house leagues; Organizer-pays = Mad Man Hockey / Hockey Time Productions / regional operators; Pass-through = BLPA Cleveland (founding partner) + similar partnership deals; Pro = BLPA long-term / Breakaway / 3rd Line (10+ tournaments/year). |
| BIZ-BLPA-1 | **BLPA Cleveland post-pilot conversion to Pass-through billing** — flip `tournaments.billing_model='pass_through'`, `bench_fee_cents=1500`; enable TOURN-REG-1 registration flow for the next BLPA event after Cleveland | **P1 post-pilot** | ~1 day config + content updates (once TOURN-REG-1 live) | The **proof point** that Pass-through billing generates revenue. First event @ ~16 teams = $240 BenchBoss + $1,600 platform fee on $80K of entry fees = **$1,840 / event** for Rinkd. Track first-month revenue carefully — becomes the sales pitch artifact for Mad Man / Hockey Time conversations: *"BLPA is making us $1,840/event passively while paying nothing themselves. Want the same?"* |

**Phase 2 — Build After Cleveland (6-18 months)**

| # | Item | Priority | Effort | Notes |
|---|---|---|---|---|
| BIZ-3 | **Referee marketplace** — organizers post games needing officials, certified refs claim slots, Rinkd takes 8-12% booking fee | **P2** | 7-10 days (incl. GS-4 dependencies) | Builds on GS-4 (Referee tracking — currently P2 post-Cleveland). GS-4 gives us the `referees` table + per-game assignment; BIZ-3 adds the booking marketplace layer on top (open-slot listings, claim-with-deposit, payout via Stripe Connect, dispute flow). Reference revenue: $15-40 per game slot, 40-team tournament ≈ 30+ games = $450-1,200 per event. Marketplace fee transparency: show % to both sides openly (standard pattern). |
| BIZ-4 | **Photography marketplace** — organizers connect with local sports photographers, 15% booking fee, photos auto-drop into the Feed | **P2** | 5-7 days | Best **social-flywheel** item: photos auto-drop into auto-recap posts = engagement spike per game + photographer earns + organizer pays + spectator gets richer content. All three sides win. New `photographers` + `photography_bookings` tables; Storage bucket for photo uploads with proper RLS; integration into the existing `recap_for_game_id` post flow so the recap post gets a photo gallery attached. Reference revenue: $300-800 per tournament. |
| BIZ-5 | **Tournament insurance partnership** — K&K Insurance or Markel (standard in amateur sports), referral fee per policy issued through Rinkd | **P3** | 1 day build + weeks of partnership outreach | Mostly outreach. Lightweight referral form on the organizer Settings page; UTM-tagged redirect to the insurance partner; insurance partner pays per-issued-policy. Reference revenue: $50-150 referral per tournament, hands-off recurring once signed. |

**Total post-pilot revenue work:** ~30-40 days of build, sequenced across roughly 6 months if shipped serially. **Sprint 1 post-pilot cluster** (highest priority): BIZ-INFRA-1 + TOURN-REG-1 + BIZ-TIER-1 + BIZ-BLPA-1 + BIZ-1. That cluster alone unlocks ~$1,840/event from BLPA + $300-800/event from hotel affiliate + foundation for everything else.

**TBD-when-shipping (deferred decisions captured but not blocking):**
- Volume pricing on Organizer-pays tier (flat $25/team vs sliding scale vs per-event cap) — defer to first Operator sales conversation
- Free trial for new Operators (first event free vs 30-day money-back vs none) — defer; experiment when funnel exists
- Pro tier pricing benchmark (target: $5K-15K/year flat) — defer to first Pro sales conversation
- Marketplace fee transparency for BIZ-3 / BIZ-4 (show % to both sides openly = recommended) — decide when building
- Sales tax + 1099-K reporting via Stripe Tax + Stripe Connect — required when crossing $X/year per state; not blocking pilot
- International / multi-currency — defer until non-US tournament interest

### Still gated on populating `players`
- The canonical `game_events` table backfill.
- Audit High #12's real leaderboard (`get_top_scorers` RPC is correct but returns nothing because `game_lineups` is empty and imported league goals belong to ghost-roster players with no accounts).
- Both unblock once **ChillerStats import + jersey-number → player_id resolver** runs (needs Pete's machine for internet egress).

### Monetization (gated on user volume)
- Crease premium ($4.99/mo) — UI shipped, Stripe wiring + env vars pending (see Section 6). **Confirmed May 17:** stays as a separate consumer revenue track alongside the B2B BenchBoss/marketplaces. Not bundled.
- ~~BenchBoss/Captain Tier ($15/mo)~~ — **superseded May 17 evening.** The captain-subscription consumer framing in `rinkd_v4/Rinkd_BenchBoss_Captain_Tier_Spec.md` was replaced by the **B2B 4-arrangement BenchBoss billing model** (Community free / Organizer-pays $25/team / Pass-through $15/team Technology fee to participants / Pro custom annual) tracked as **BIZ-TIER-1** in the Revenue + monetization section above. Old spec doc retained as historical reference.

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
- **ScorerView is fully gated on `isLocked = status === 'final'` (May 16 evening).** Every write path (`changeScore`, `changePeriod`, `changeShots`, `saveGoal/Penalty/Goalie`, `deleteGoal/Penalty`) early-returns when locked, and the UI controls hide. Only the director (tournament) or commissioner (league) sees the Reopen button. When adding any new mutator to ScorerView, **start with `if (isLocked) return;`** — that's the defense-in-depth contract.
- **Tournament settings JSONB is the single source of format truth.** The `tournament_formats` table from `rinkd_v4/CLEVELAND_BUILD_PLAN.md` was intentionally NOT built — the JSONB approach is simpler and the BLPA Bash preset (in `TournamentCreate.js` → `FORMAT_PRESETS`) already populates the right shape. Keys used downstream: `points_win`/`points_tie`/`points_loss` (standings view), `tiebreakers` (Tournament.js client-side re-sort + standings column swap), `shootout_pool`/`shootout_bracket` (ScorerView SO gating + bracket shootout-winner picker), `overtime_allowed` (ScorerView OT gating), `num_periods` (ScorerView period selector), `advancement_per_pool` (Bracket tab generator + standings "↑ ADVANCES" divider), `max_goal_differential` (Info tab mercy rule display; not enforced at game-time), `venue_name`/`venue_address` (Info tab).
- **Tiebreaker tokens (May 16 evening).** `settings.tiebreakers` is an array of strings the standings UI re-sorts on. Supported tokens (handled in `sortByTiebreakers`): `points`, `goal_quotient`, `period_points`, `lowest_pim` / `penalty_minutes` (ASC), `goal_diff`, `goals_for`, `goals_against` (ASC), `head_to_head` (no-op stub), `coin_toss` (no-op stub). The DB view's default order matches BLPA Bash exactly so most tournaments don't need client-side re-sort; DEX-format tournaments do.
- **Goal Quotient definition.** `GF ÷ GA`, with `GA = 0` treated as `GF / 0.001` to avoid divide-by-zero. Rounded to 3 decimals in the view. Per BLPA Nick's May 14 email — not GF − GA (goal_diff), which is the easier "intuitive" tiebreaker every other sport uses. When teams ask why their ranking changed, GQ is the answer.
- **Period Points definition.** For each pool game, for each period (1–3 for most formats), the team that outscored its opponent in that period gets +1 period point. Ties in a period = 0 to either team. Shootout goals (`is_shootout = true`) are explicitly excluded — they decide the game, not a period. Derived from `game_goals` at view-time so we don't need a separate `game_periods` table.
- **PIM definition.** Sum of `game_penalties.duration_minutes` per team across pool play. Each penalty row already carries `team_id` so no normalization needed. Used as the DEX-format secondary tiebreaker (lower PIM ranks higher).
- **`games.shootout_winner` is the source of truth for SO-decided bracket games.** `home_score`/`away_score` reflect regulation only (a 4-3 OT win and a 4-3 SO win store the same scores). When resolving a bracket winner — for the champion banner, the bracket auto-fill, or anything else — use `bracketWinnerSide(game)` from `lib/tournamentManage.js` which checks shootout_winner first, then falls back to score comparison.
- **`games.pool` is required for bracket pairing.** Pool games derive it from either side's `tournament_teams.pool` (and the migration backfilled existing rows). Semi/final/bronze games carry it explicitly so the bracket can be pool-scoped — needed because the final + bronze games START with NULL home/away, leaving the pool column as the only way to know which division they belong to.
- **Championship bracket pattern (May 16 evening).** For 4-team-per-pool formats (BLPA Cleveland), `generateChampionshipBracket` creates 4 games per pool ordered by `start_time`: semi1 (seed 2v3) at slot 0, semi2 (seed 1v4) at slot 1, bronze at slot 2, final at slot 3. `resolveBracketSlotsFromSemis` pairs them by start_time order — so DO NOT reorder semi start_times after generation, or the auto-fill will pair the wrong winners with the wrong slots. Idempotent: re-running the generator refuses if any bracket games exist (delete first to regenerate). Director can also manually edit any auto-generated game via the existing manage Bracket UI.
- **Auto-recap invariants (May 16 evening).** `posts.recap_for_game_id` has a partial unique index — at most one recap per game, unlimited regular posts (they all share NULL). `createGameRecapPost` in `lib/posts.js` upserts: if a row exists, updates content + tag (keeps original author + created_at); else inserts with the finalizing user as author. Only fires for tournament games (`!isLeague && game.tournament_id`); league games + team games are skipped. Failure to post the recap never blocks the finalize itself.
- **Status enum mismatch (May 16 evening, FIXED).** `tournaments_status_check` allows only `('draft','active','complete')`. Previous SettingsTab dropdown offered Upcoming + Cancelled which silently failed. New code only offers the 3 valid options. If you ever need to add a status, update BOTH the DB constraint AND the dropdown — they're now in sync.
- **Public tournament landing pattern (May 16 evening).** `/tournament/:id` and `/tournaments` are intentionally *not* wrapped in `ProtectedRoute`. The gate happens INSIDE `Tournament.js`: if `!currentUser`, render `PublicTournamentLanding` (metadata only — name, dates, venue, team list, sign-up CTAs). Live data (standings, scores, schedule, bracket details) stays login-gated. Anonymous-friendly error states use 🔒 framing + "Sign in / Browse tournaments" buttons instead of the director-facing retry. When adding new tournament-detail features, default to gating them inside the `currentUser` branch unless they're explicitly safe to expose anonymously.
- **`?returnTo=…` redirect (May 16 evening).** `Auth.js` and the `/login` route both honor `?returnTo` from the URL. **Safety check applied at both sites:** must start with single `/`, can't start with `//` (rejects `//evil.com`, `http://…`, protocol-relative). Falls back to `/feed` when missing or unsafe. When adding new "sign in to do X" CTAs anywhere, link to `/login?returnTo=<encoded-path>` — the redirect-back is free.
- **Push pipeline (May 16 late evening).** Architecture: client never touches push targeting. `triggerTournamentRecapPush(post_id)` from `lib/push.js` invokes the `send-recap-push` Edge Function which does ALL lookups with service role (post → game → tournament → subscribers → push_subscriptions). This means future pushes for new event types (DMs, follows, etc.) follow the same pattern: build a tiny Edge Function (`send-X-push`), pass the originating row id, function handles the rest. Don't push from the client. Don't accept user_ids from the client. Don't accept payload content from the client — assemble it server-side from canonical rows so abuse is bounded to "re-fire an existing legitimate notification." For the recap path that's a `tag: recap:<post_id>` collapse-key so re-fires replace rather than stack.
- **VAPID keys are forever-ish.** Once subscribers register with a public key, rotating it invalidates every push subscription — the browser pushManager won't match the new key and `pushManager.subscribe()` has to be re-called. For pilot we have 2 existing test subs (May 12 timestamps), so rotation cost is near zero. **Post-pilot if user base grows, never rotate** without an in-app banner asking users to re-enable notifications. Store both keys in a password manager (1Password) the moment they're generated. NEVER re-run `npx web-push generate-vapid-keys` after pilot users have subscribed.
- **`tournament_subscriptions` invariants (May 16 late evening).** RLS lets each user manage only their own rows (SELECT/INSERT/DELETE all check `(select auth.uid()) = user_id`). The Edge Function bypasses RLS via service role to find subscribers for a tournament. Following a tournament does NOT auto-subscribe to push — the user must also have a `push_subscriptions` row, which requires browser permission + the existing `subscribeToPush(userId)` flow. The Follow button on Tournament.js handles both: if the user hasn't subscribed to push yet, it prompts; if they deny, the DB follow is created anyway so a later Profile-page opt-in immediately starts delivering. Disconnects between the two tables (followed but no push_sub, or push_sub but unfollowed) are both no-op states — they don't break anything, they just don't deliver pushes.
- **Two pre-existing stray files** in the working tree (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them out of audit commits unless Pete asks.
- **`rinkd_v4` folder** — strategy/spec docs only. Do NOT edit app code there; it doesn't deploy. To bring it into context: `/add-dir ~/Downloads/rinkd_v4` in Claude Code.
- **`rinkd_v4/RINKD_STATE_OF_PLAY.md`** is the broader orientation doc — read it for the BLPA partnership context, post-pilot specs, and pending tasks.
- **Tournament-scoped feed invariants (May 18 afternoon).** `posts.tournament_id` is nullable: `NULL` = global feed post, `NOT NULL` = scoped to the referenced tournament's Feed tab and filtered OUT of global/following feeds. When adding any new feed-style query, decide upfront which surface it serves and apply the matching `tournament_id` filter — `.is('tournament_id', null)` for global, `.eq('tournament_id', X)` for tournament-scoped. The partial index `posts_tournament_id_created_at_idx` only covers rows where `tournament_id IS NOT NULL`, so global-feed queries hit the regular `created_at` index path. `createGameRecapPost` accepts a `tournamentId` param and stamps it on both insert + re-finalize update; the re-finalize stamp self-heals older recap rows that pre-date the column. **The Follow button on Tournament.js hides for the tournament director** (intentional — they're already seeing events from their own writes) which means a director can't subscribe to push for their own tournament. To smoke-test push as a non-director, use a second account.
- **push.js unsubscribe-before-resubscribe (May 18 afternoon, commit `30b40986`).** `subscribeToPush` in `src/lib/push.js` now calls `reg.pushManager.getSubscription()` + `unsubscribe()` before `Notification.requestPermission()`. This is the defensive fix for the `InvalidStateError` that surfaces when a browser holds an existing subscription registered against a rotated VAPID public key. **Practical implication:** any future VAPID rotation no longer requires affected users to manually clear Chrome's site-notification permission to recover — they just re-enable from Profile and it works. **DO NOT undo this** unless you're also adding a separate "compare existing applicationServerKey and skip if matching" optimization, otherwise you'll regress the rotation-recovery path.
- **Auto-follow Pete trigger (May 18 afternoon, migration `auto_follow_pete_on_new_profile`).** Trigger `tr_auto_follow_pete` on `public.profiles AFTER INSERT` calls `auto_follow_pete_on_profile_insert()` (SECURITY DEFINER, `search_path = public, auth`). The function looks up Pete by `auth.users.email = 'pete@rinkd.app'` (not hardcoded UUID), skips self-follow, and uses `on conflict do nothing` for idempotence. **Implications:** (a) every new account is following `pete@rinkd.app` from day 1, so Pete's posts populate their Following feed immediately; (b) the trigger only fires on INSERT — users who manually unfollow stay unfollowed; (c) backfill applied May 18 — all 19 pre-existing eligible users now also follow Pete. If post-pilot we add more "default follow" accounts, refactor to a `default_follows` lookup table rather than chaining more triggers.
- **Multi-director permission model (May 18 late afternoon, commit `4f145312`).** `tournaments.director_id` is the founding director — IMMUTABLE. Additional directors live in `tournament_roles` with `role='director'`. The DB-level source of truth is `is_tournament_director(p_tournament_id, p_user_id)` (SECURITY DEFINER, STABLE). All RLS policies that gate by "is director" use this helper. Client-side, sites that previously checked `tournament.director_id === currentUser.id` now ALSO load an async `isExtraDirector` flag via `src/lib/tournamentDirectors.js:isExtraDirector(userId, tournamentId)`. **When adding any new director-gated UI element:** load `isExtraDirector` in parallel with the existing patterns (see `Tournament.js`, `TournamentManage.js`, `GameDetail.js`, `ScorerView.js` for the established useEffect pattern). RLS protects the founder's role row from deletion via a clause `not exists (select 1 from tournaments t where t.director_id = tournament_roles.user_id and tournament_roles.role = 'director')` — don't fight this; tournament transfer/destruction should go through different surfaces. `tournaments` DELETE is NOT extended to additional directors (founder-only).
- **SECURITY DEFINER views were a leak (May 18 late afternoon, migration `close_security_definer_views_and_media_listing`).** `analytics_daily`, `analytics_dau`, `league_standings`, `tournament_standings` were defined with `SECURITY DEFINER` — meaning queries ran as the view creator, bypassing the caller's RLS. Anon could in theory query analytics. All four flipped to `security_invoker = on`. When adding new views going forward, default to `security_invoker = on` unless you have a specific reason to bypass caller RLS (and document it). The Supabase advisor flags this with severity ERROR; check `get_advisors` after creating views. **Follow-up gotcha (later same evening, migration `analytics_events_rls_allow_rinkd_admins`):** flipping views to invoker surfaced a latent bug — the `analytics_events` RLS only allowed `is_commissioner` (a league-commissioner role), not site-wide Rinkd admins. Pete had been depending on the SECURITY DEFINER bypass to see his own admin analytics. Fix: broadened the policy to `is_commissioner((select auth.uid())) OR exists(... profiles where p.is_admin = true)`. **Lesson:** when flipping a view from definer to invoker, verify the underlying table's RLS actually grants read to the intended consumers. The view's old leak may have been masking under-permissive table RLS.
- **Storage bucket listing vs object URLs (May 18 late afternoon).** The `media` bucket is `public = true` so `/object/public/media/{path}` URLs resolve without auth — that's how image fetches work in posts. We removed the broad `(bucket_id = 'media'::text)` SELECT policy on `storage.objects`, which previously also let anon ENUMERATE every file via `/storage/v1/object/list/media`. Listing now returns `[]` to anon; direct URL fetches still work. **For any new public bucket:** rely on `public = true` for URL access, don't add a broad SELECT policy.
- **Turnstile is on for ALL auth endpoints (May 18 late afternoon, commit `45f71a6d`).** Supabase's "CAPTCHA Protection" toggle applies globally to `/auth/v1/signup`, `/signin`, `/recover`. The client side renders the widget only on step 3 of signup (per Auth.js), but `src/lib/auth.js` `signUp` accepts and forwards `captchaToken`. **If you add Turnstile to login/forgot in the UI later**, accept and forward a `captchaToken` to `signIn` and `resetPasswordForEmail` the same way. **DO NOT use `signIn`/`recover` from anything that doesn't pass through a Turnstile-verified flow** — those endpoints will now reject any request without a token. Non-auth surfaces (bug_reports, survey_responses) are NOT yet gated; see the post-pilot spawn-task.
- **Multi-manager permission model for teams (May 19 evening, commit `adc836b6`).** Direct mirror of the multi-director tournament pattern. `teams.manager_id` is the founding manager — IMMUTABLE. Additional managers live in `team_members` with `role='manager'`. DB-level source of truth: `is_team_manager(p_team_id, p_user_id)` (SECURITY DEFINER, STABLE). All team-related RLS policies that gate by "is manager" use this helper — `teams`, `team_members`, `team_join_requests`, `volunteer_slots`. **`createTeam` already inserts a `team_members` row for the founder** with role='manager', so `getUserRoleOnTeam(teamId)` returns 'manager' for them via the same path as additional managers — no need to special-case the founder client-side. The Team.js `isManager` check ORs `userRole?.role === 'manager'` with `team.manager_id === currentUser.id` purely as belt-and-suspenders for any legacy team missing the founder's team_members row. RLS protects the founder's row from deletion via `not exists (... where t.manager_id = team_members.user_id and team_members.role = 'manager')`. **When adding any new team-gated UI, check `isManager` not `team.manager_id`.** The `volunteer_slots_update` policy preserves the self-claim path (`assigned_user_id = auth.uid()` OR `is_team_manager`) — don't tighten it without preserving Claim/Release for non-managers.
- **Volunteer Coordinator's two surfaces (May 19 evening).** Volunteer lives on the individual team page (`/team/:id` → Volunteer tab, `src/components/TeamVolunteer.js`) for the per-team experience. The standalone `/volunteer-coordinator` route still exists as a multi-team aggregate dashboard but is no longer linked from any nav (was removed from the More drawer's Manager section earlier). The per-team component handles Claim/Cancel/Open-up/Delete + a manager-only +Add composer with role presets + optional pin-to-game. Past slots collapse behind a toggle to keep the upcoming list focused. **When adding new volunteer behaviors**, prefer the team-page surface — it's the discovered path now.
- **Standings table is a horizontally-scrollable HTML table with sticky columns (May 19 afternoon, commit `fc7d2904`).** TEAM (rank chip + team name, up to 160px) is `position: sticky; left: 0`; PTS is `position: sticky; right: 0`. Middle stat columns (GP/W/L/T/GF/GA + format-specific GQ/P.PT/PIM/DIFF) scroll horizontally on mobile via the wrapper's `overflowX: auto`. `tableLayout: auto` with `minWidth: max-content` on the `<table>` forces the overflow when content exceeds the container — desktop sees no scroll because the full table fits. Each sticky cell sets its own `background` color to match the surrounding row/header (otherwise scrolled content shows through), plus a subtle `box-shadow` at the scroll edge as an affordance hint. **When adding new tiebreaker columns to standings**, append to the `midCols` array in Tournament.js — they slot into the scrollable middle automatically; don't widen the sticky cells.
- **Team logo uploads share the profile-avatar pattern (May 19 afternoon, commit `460a8990`, migration `teams_and_league_teams_add_logo_url`).** Both `teams.logo_url` and `league_teams.logo_url` are nullable text. Upload flow: 5MB cap → `classifyImage(file)` NSFW pre-check → `uploadMedia(file, currentUser.id)` from `lib/posts.js` → returns a public URL into form state → saved with the rest of the team settings. Rendering pattern: `background:`url(${logo_url}) center/cover, ${logo_color || fallback}`` so partially-transparent logos get the team color underneath; conditional hides the colored-initials text when `logo_url` is set. `tournament_teams.logo_url` already shipped earlier (commit `21785087`). **When adding new team-display surfaces (game cards, schedule rows, etc.)** follow the same fallback chain: `logo_url` → `logo_color + logo_initials` → derived from `name`.
- **CSHL personal tracker is a "from the stands" use of the league surface (May 19 afternoon).** League `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6` (CSHL 10U Squirts 2026-27), team `d18e023c-354f-4d3b-b5a0-82574f05377d` (Shaker Heights Red Raiders), Pete as commissioner + manager. Henry Hessell #17 lives as a `team_members` roster row with `invite_name = 'Henry Hessell'` and `user_id = NULL` (COPPA — minors can't have Rinkd accounts; 13+ floor). CSHL is hosted on **Crossbar**; their public site exposes division standings at `/standings/show/<id>` and team stats at `/stats/division_instance/<id>` but renders client-side so WebFetch can't read it — Chrome MCP or manual paste is the import path when the 2026-27 schedule lands (expected mid-summer). The `leagues.settings` JSONB carries `source_org` + `source_url` + a `notes` string explaining the personal-tracker framing.

---

## 10. First thing to do in a new session

1. Read this doc top to bottom — **especially §13 (operational artifacts) which tells you what files/tools exist outside this doc**, then §5 (recent shipped work — most recent entries first), §7 (forward roadmap), §12 (pilot-readiness audit), and §9 (working notes — invariants you'll regret missing).
2. Run `cd ~/Downloads/rinkd_live && git log --oneline -10 && git status` to confirm state matches §4.
   - Expected `origin/main` HEAD: **`adc836b6`** (`feat: multi-manager support for teams`). If later, read the new commits.
   - Confirm BLPA Cleveland is seeded + active: `select name, start_date, end_date, status, settings->>'venue_name' from public.tournaments where id = 'b2789d66-1d77-4a62-862d-00b550da6a98'` should return `BLPA Cleveland · 2026-06-13 · 2026-06-14 · active · Brunswick Auto Mart Arena (BAM)`. Team count = 8, game count = 12 pool games (all Saturday).
   - Confirm CSHL personal tracker is scaffolded: `select name from public.leagues where id = '2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6'` should return `CSHL 10U Squirts (2026-27)`.
   - Confirm the May 18-19 schema additions: `posts.tournament_id` column exists; `tr_auto_follow_pete` trigger exists; `is_tournament_director` + `is_team_manager` functions exist (`select proname from pg_proc where proname in ('is_tournament_director', 'is_team_manager')`); `teams.logo_url` + `league_teams.logo_url` columns exist.
   - Confirm Edge Function deployed: use Supabase MCP `list_edge_functions` and look for `send-recap-push` (slug). Should be `status: ACTIVE`, `verify_jwt: true`.
   - Confirm Turnstile is gating signup: anonymous POST to `/auth/v1/signup` without a `captcha_token` should return `400 captcha_failed`.
3. Ask Pete:
   - Did Nick send real team names + logos for BLPA Cleveland? Director swaps via TournamentManage → Teams → Edit, uploads logos via Settings → Branding.
   - Anything new break since the May 18 push of `ae4d7985`?
   - What next — items from §7 GameSheet/LeagueApps parity, iOS PWA install banner (§7 GS-7, ~4-6 hrs), or fresh requests?
4. **Pull up the operational spreadsheet** at `~/Downloads/rinkd-sprints.xlsx` (or Pete's Google Sheet version if uploaded). The **Sprint plan** tab shows the next ~12 weeks of work in sequence (S0 pre-pilot + S1 post-pilot revenue cluster); the **Per-day checklist** tab tracks Pete's pre-pilot operations status; the **Cleveland day-of** tab is the live run sheet for Jun 12-14. See §13.2 for tab-by-tab notes. **Note (May 18):** the spreadsheet was last regenerated May 17 evening — items marked complete since then in this handoff are not reflected in the xlsx until someone re-runs the build scripts (`/tmp/build_rinkd_sprints.py` etc., which may have been cleared on reboot).
5. Then proceed from there.

---

## 11. Tournament UI punch list (May 16 demo walkthrough) — ✅ ALL DONE

**Status (May 16 evening):** every item below shipped on worktree branch
`claude/elegant-sanderson-80d1d0` across commits `5ae955bc` (public pages),
`21785087` (manage), `5c3e42e5` (scorer), and `9c773ff6` (layout). Pending
Pete's merge to `main` — see §4. Retained below as a historical reference.

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

---

## 12. Pilot-readiness audit (May 16 late evening — what's left for BLPA Cleveland Jun 13-14)

The BLPA pilot batch shipped a huge amount (see §5 May 16 evening entries). This is the swept-up list of what could still trip up the live event, ranked by blast radius. **Updated May 16 late evening: ~~strikethrough~~ = done.**

### 🔴 P0 — Will affect the pilot if not handled

**~~A. Public tournament page is auth-gated.~~** ✅ **DONE** in commit `80f71e54`. Public landing for anonymous spectators ships tournament metadata + teams + sign-up CTAs; live data stays login-gated. See §5 "Public tournament landing" entry.

**~~B. Forgot-password flow.~~** ✅ **DONE** May 18, 2026 morning. Supabase dashboard URL Configuration updated (Site URL → apex, 4 redirect URLs added); E2E verified end-to-end with `pete@rinkd.app`. See §6 "Forgot-password flow" entry above.

**~~C. Tournament status flip on day-of.~~** ✅ **DONE** May 16 late evening via MCP. BLPA Cleveland is now `active`. Pete can flip back to `draft` from TournamentManage → Settings if he wants to hide pre-event.

**~~D. Push pipeline not yet operational.~~** ✅ **DONE** May 18, 2026 morning. Fresh VAPID pair generated (Path B per §6); 3 Supabase secrets set (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); Edge Function `send-recap-push` deployed (v1, ACTIVE, `verify_jwt=true`); Vercel env var `REACT_APP_VAPID_PUBLIC_KEY` updated to the new public key; Vercel redeployed (commit `ee0ca9ef` — the `claude/elegant-sanderson-80d1d0` merge that also brought the public-landing + push-pipeline code itself live). Function reachability verified (`POST /functions/v1/send-recap-push` without JWT → `401 UNAUTHORIZED_NO_AUTH_HEADER`, as expected). Two stale May-09/May-12 test push_subscriptions deleted; table now empty.

**New private key location:** Pete saved to 1Password ("Rinkd VAPID keys (May 2026)"); tempfile `/tmp/vapid_keys.json` wiped. **Do NOT regenerate** — any future rotation invalidates all real-user subscriptions.

**Still required:** real-device smoke test (Pete subscribes on iPhone+PWA-installed or Android → another account finalizes any pool game → first device receives a push within ~2s). Defer until pilot prep gets there.

After secrets + deploy, smoke-test:
- On a real iOS device (16.4+, **PWA installed to home screen**) or Android: sign in, navigate to `/tournament/b2789d66-1d77-4a62-862d-00b550da6a98`, tap "🔔 Follow", accept the OS prompt.
- In a second device/browser, sign in as a director/scorekeeper, finalize any pool game in ScorerView.
- First device should receive a push within ~2 sec with the recap headline. Tap → opens `/game/<id>`.
- If nothing arrives: `supabase functions logs send-recap-push --project-ref tbpoopsyhfuqcbugrjbh`. Most likely cause: VAPID public/private mismatch.

### 🟠 P1 — Quality-of-event, not pilot-blocking

**E. Real team names + logos.** Director (Pete) swaps placeholders via TournamentManage → Teams → Edit; uploads logos via the new Settings → Branding upload. Needs Nick's roster file. Standings + bracket + auto-recap all keyed on UUIDs so renames are safe at any time.

**F. Sunday championship game times.** Saturday's 12 pool games are seeded with hard times (Sat 6/13 08:00/09:15/10:30/11:45/13:00/14:15 EDT at BAM). Sunday's 8 championship games are generated on-demand via the Bracket tab button Sat afternoon (after the last pool game ~15:30 EDT); Pete picks the first start time + per-game minutes when generating. Plan Sat afternoon: "Sunday games start at X" — pick a buffer that fits all 8 games across 2 sheets (each pool plays semis then a final or bronze, so the bronze + final per pool need to be sequential on a single sheet OR split across sheets).

**G. iPad usability of ScorerView.** Spec calls for it. Wake lock works on Safari 16.4+, warning banner shown otherwise. 44px touch targets per spec. **Smoke-test on the actual iPad before pilot.** Open ScorerView for one game, walk through Log Goal / Add Penalty / Period change / Finalize / Reopen. Anything weird → bring it up.

**~~H. VAPID env var for push notifications.~~** ✅ Subsumed by P0 #D above — push pipeline now actually has consuming code, so this is no longer "set this env var if you ever want push" — it's "complete the secrets + deploy to activate the live recap pushes shipped this batch."

### 🟡 P2 — Worth knowing, don't need to fix

**H. Mercy rule is informational only.** Settings stores `max_goal_differential: 6`; the Info tab displays it; nothing in-app enforces it (no game clock = no "clock runs out"). Director/scorer manually ends the game when the mercy threshold hits. Communicate this to scorers at the captains' meeting.

**I. Period clock not in-app.** Scorer enters period number + time manually. The rink scoreboard is the source of truth for the actual clock; scorer just records events with the displayed timestamp. Fine for a tournament with on-site scoreboards. Would matter for unmonitored beer-league use later.

**J. Two simultaneous scorers on the same game.** Realtime sync via `game_goals` / `game_penalties` channels is in place (per `5c3e42e5`'s ScorerView). One scorer adds a goal, the other's screen reloads the goal log within ~1s. Score state itself converges via the DB write — last-write-wins on `home_score`/`away_score`/`period`/`status`. Worth a quick test before pilot: open ScorerView on two devices, add a goal on one, watch the other update.

**K. Mid-game wifi drop.** Optimistic UI rollback on failure already exists (`5c3e42e5`'s changeScore + the goal/penalty error paths). If a scorer fully loses connection, they can't save. Have a backup paper scoresheet at each sheet. The pilot is one weekend at one venue; this is mitigable with prep, not a code fix.

**L. LiveBarn at BAM.** Unknown if Brunswick Auto Mart Arena has LiveBarn cameras. If not, leave `rinks.live_barn_venue_id` null on both Sheet 1 + Sheet 2 — the LiveBarn pill auto-hides when the venue ID is missing or placeholder. If yes, set the real venue IDs (one per sheet) once Pete confirms.

**M. Onboarding modal on tournament URLs.** Pre-existing behavior — flagged in original §11 P5 entry. New users following a BLPA Cleveland link land on the auth screen, sign up, then immediately see the onboarding modal before the tournament. Mildly annoying but not pilot-blocking.

### 🟢 Pre-pilot checklist (in order)

1. **~~Merge worktree branch + push to main.~~** ✅ Done May 18 morning — `ee0ca9ef` is the merge commit; Vercel auto-deployed.
2. **~~Fix Forgot Password.~~** ✅ Done May 18 morning — §6 dashboard config + E2E verified end-to-end as `pete@rinkd.app`.
3. **~~VAPID secrets + Edge Function deploy.~~** ✅ Done May 18 morning — Path B fresh pair, 3 secrets set, `send-recap-push` v1 ACTIVE, Vercel public key updated + redeployed.
4. **Pete** — Get team names + logos from Nick. Swap placeholders in TournamentManage → Teams + Settings → Branding logo upload.
5. **Pete** — Smoke-test push end-to-end on a real device (§12 D smoke-test steps). Sign in, Follow tournament, accept push prompt, then have a director finalize any game in ScorerView from a 2nd device → first device should receive push within ~2s.
6. **Pete** — Smoke-test ScorerView on iPad (P1 G above).
7. **Pete** — Send pilot URL `https://rinkd.app/tournament/b2789d66-1d77-4a62-862d-00b550da6a98` to BLPA captains. They'll see the public landing without signing up; sign-up CTA brings them into Rinkd, then they can Follow + receive recap pushes.
8. **Sat Jun 13 morning (pre-08:00 EDT at BAM)** — verify status is still `active` (it is now, but Pete may have flipped to draft for pre-event privacy).
9. **Sat Jun 13 (08:00 AM - ~3:30 PM EDT at BAM)** — Run all 12 pool games across 6 slots × 2 sheets (08:00 / 09:15 / 10:30 / 11:45 / 13:00 / 14:15). Standings populate live; auto-recap posts hit the tournament Feed tab + push subscribers as each game finalizes.
10. **Sat ~3:30 PM** — Pete clicks "🏆 Generate Bracket"; picks Sunday start time + rink. 8 championship games created (semis with teams; gold + bronze with TBD).
11. **Sun Jun 14** — Run championship games. SO winner prompt fires on tied bracket games; bracket auto-fills as each semi ends.
12. **Sun end** — Champion banner appears. Pete flips status to `complete`.

**P0 backlog is empty.** Remaining items are operations + content (team names from Nick) + smoke testing — no Pete-config or Claude-code work blocks the pilot.

---

## 13. Operational artifacts — what a new session needs to know exists

Three categories of artifacts live OUTSIDE this handoff doc that a new Claude Code session should be aware of. None of them are in the `rinkd_live` repo; they're either in `~/Downloads/rinkd_v4/` (strategy docs) or `~/Downloads/` (live operational tools).

### 13.1 Strategy / spec docs (`~/Downloads/rinkd_v4/`)

The `rinkd_v4` folder is **strategy only** — its app code does not deploy, so do not edit code there. The docs are the source of truth for product direction. To bring into context: `/add-dir ~/Downloads/rinkd_v4` in Claude Code.

| File | Why it matters | When to read |
|---|---|---|
| `CLEVELAND_BUILD_PLAN.md` | Original BLPA Cleveland tournament build spec — May 2026. Section 5 has the championship bracket structure (4-team-per-division: semi 2v3 + semi 1v4 → gold + bronze). | Reference when working on tournament features or BLPA-specific code. |
| `GAMESHEET_PARITY_GAPS.md` | 7 gaps between Rinkd tournament feature set and GameSheet's. Full spec for each (offline mode, suspensions, game clock, refs, roster validation, embed widgets, iOS PWA banner). | When working on any GS-* item from §7 of this handoff. |
| `LEAGUEAPPS_PARITY_GAPS.md` | 8 gaps for league management surface (Stripe registration, waivers, USAH, financials, divisions, multi-season, analytics, embeds). | When working on any LA-* item from §7. |
| `RINKD_STATE_OF_PLAY.md` | Broader orientation doc — BLPA partnership context, post-pilot specs, pending tasks. Older than this handoff. | First-time new sessions; for partnership/business context. |
| `Rinkd_BenchBoss_Captain_Tier_Spec.md` | **SUPERSEDED** by BIZ-TIER-1 (the 4-arrangement B2B BenchBoss billing model — see §7 Revenue). Retained as historical reference only. | Don't act on it. |
| `Rinkd_Brand_Voice_Guidelines.md`, `Rinkd_Marketing_Kit.md`, etc. | Brand + marketing source material. | When writing user-facing copy, sales pitches, etc. |

### 13.2 Roadmap spreadsheet (`~/Downloads/rinkd-sprints.xlsx`)

A four-tab xlsx that's the operational view of the roadmap. Pete uploads to Google Drive → Google Sheets for live editing. Built by Claude via the anthropic-skills:xlsx skill; if a new session needs to regenerate it, the build scripts live at `/tmp/build_rinkd_sprints.py` + `/tmp/add_pilot_sheets.py` + `/tmp/add_sprint_column.py` (will be lost on machine reboot — re-derive from this doc's §7 if needed).

| Tab | Rows | What it shows |
|---|---|---|
| **Rinkd Roadmap — May 17 2026** | 72 | All 71 roadmap items from §7 in a single grid. Columns: ID · Category · Item · Priority · Effort · Status · **Sprint** · Brief explanation · Dependency · Spec ref. **Sprint column** is colored: 🟥 S0 (pre-pilot Pete tasks), 🟦 S1.1-S1.5 (Sprint 1 revenue cluster in build order), 🟧 S2, 🟩 S3, ⬜ S4, S5+ / ongoing / consumer / superseded / gated. Bottom has live COUNTIF summary by Status. |
| **Sprint plan** | 17 | Sequenced execution view of S0 (pre-pilot) + S1 (post-pilot revenue cluster). Each row has Target week + Depends on + What it unlocks. Includes a 3-line summary footer (S1 effort total, first-dollar moment, expected first-month revenue from BLPA Pass-through). |
| **Per-day checklist** | 26 | Milestone-based pre-pilot checklist (T-26 → T+4). Pete checks off as you go; footer COUNTIFs show "X of Y complete". **STALE since May 19:** the Friday-start label is wrong (pilot is now Sat 6/13 start at BAM). The xlsx needs regenerating from the current §7 to reflect the 2-day + BAM venue. |
| **Cleveland day-of** | 38 | Hour-by-hour run sheet. **STALE since May 19:** built for the 3-day RMU plan that was superseded. The current Saturday schedule (12 pool games, 08:00-14:15 EDT at BAM) and 1-day Sunday championship are NOT reflected. Re-derive from §5 May 19 entry when xlsx is regenerated. |

**When to update the spreadsheet:** any time §7 changes (new roadmap item, item completion, sprint re-ordering). Re-run the build scripts in `/tmp/` or re-derive. **Critical:** the spreadsheet is downstream of this handoff doc — handoff doc is source of truth, spreadsheet is its operational projection.

### 13.3 Live operational state (databases + dashboards)

| Resource | URL / location | Notes |
|---|---|---|
| Supabase project | `tbpoopsyhfuqcbugrjbh` (use MCP) | Auth, DB, Edge Functions, Storage. RLS state documented in §9. |
| Vercel project | `prj_fIYsPTQJ0vaYvj1w3kZkodpdqZUH` (team `team_kIYhrLu5tSRKt67rW3BTdYHB`) | Production deploys, env vars (incl. `REACT_APP_VAPID_PUBLIC_KEY` per §6). |
| Production app | https://rinkd.app | Apex; `www.rinkd.app` 308-redirects to apex. |
| GitHub repo | `petehessell-coder/Rinkd` | `main` branch auto-deploys to Vercel. |
| BLPA Cleveland tournament URL | https://rinkd.app/tournament/b2789d66-1d77-4a62-862d-00b550da6a98 | Public landing (no auth needed). `tournament_id = b2789d66-1d77-4a62-862d-00b550da6a98`, status=`active`, Jun 12-14 at RMU. |

### 13.4 New-session reading order (recommended)

If you're a fresh Claude Code session and need to get oriented in 15 minutes:

1. **This file (CLAUDE_CODE_HANDOFF.md)** — top to bottom. §1-§4 = orientation; §5 = what's recently shipped; §7 = forward roadmap; §10 = first thing to do; §12 = pilot-readiness audit.
2. **`git log --oneline -10`** — verify state matches §4. If `main` HEAD doesn't match, either Pete merged + pushed since this doc was updated (likely fine) or something's drifted.
3. **`select name, status, start_date, end_date from public.tournaments where id = 'b2789d66-1d77-4a62-862d-00b550da6a98'`** via Supabase MCP — verify BLPA Cleveland is still `active` + dates `2026-06-12 / 2026-06-14`.
4. **`open ~/Downloads/rinkd-sprints.xlsx`** (or the corresponding Google Sheet if Pete's uploaded it) — confirm the Sprint plan + Per-day checklist tabs reflect current state.
5. **Skim `rinkd_v4/RINKD_STATE_OF_PLAY.md`** — broader business context if you need it.

Steps 1-4 are required orientation. Step 5 only if the task involves business strategy / partnerships / unfamiliar product areas.
