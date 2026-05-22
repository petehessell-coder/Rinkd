# Rinkd — Claude Code Handoff

**Created:** May 15, 2026 — supersedes the previous handoff. Self-contained: a fresh Claude Code session should be able to pick up from here without reading the prior doc.
**Last updated:** May 20, 2026 (evening) — **League engine + activation gate MERGED to main + a full day of league-customer features.** The `claude/laughing-nightingale-10d576` worktree (Phase 1+2+3 league parity + activation gate) was merged May 19 evening (`5eedabd0` / `83ebfab3`) and everything since has shipped straight to main (Pete delegated commit+push authority — see memory `commit-authority`). Main HEAD is now **`01894320`**. The day's work (newest first): closed the team-roster loop (requester gets approve/deny notification + manager-add-by-email fires the invite email — `01894320`); join-request flow fixes so league commissioners can action requests on any team in their league + notification fanout to all managers/commissioners (`434ad328`); email-invite path for team-manager grants via `team_manager_invites` + magic-link `/accept-team-invite` (`90f6666d`); commissioner-grants-management UI in LeagueManage Teams tab via `assign_league_team_manager` RPC (`a5936dce`); league-added teams now create real `public.teams` rows via `create_league_team` RPC + KOHA 8-team backfill (`3db0aa7f`); DatePicker timezone off-by-one fix (`5eca7c4e`); league logo upload in Settings (`f2f5252c`); per-game stream URL for YouTube/Twitch/Facebook/Vimeo since KOHA streams on YouTube not LiveBarn (`a69702f1`); landing→signup funnel instrumentation (`06e2ed8a`); hosting-CTA banners hidden on activated events (`42344635`); pricing model locked to per-size ladders superseding BIZ-TIER-1 (`932cf198`, `docs/Rinkd_Pricing_Guide.docx`); AdminActivations admin-RPC + column fixes (`73bf3c52`, `dbf64d33`); Turnstile widget shipped to login + forgot forms — was signup-only which silently broke EVERY login (`af13dfab` + `ebd4f7ca`). **KOHA (Kanata Oldtimers) is the first real external league on the platform.** See §5 "May 20" entry for full detail. **Last updated:** May 19, 2026 (afternoon + evening) — **Five UX commits across the team surface + CSHL personal-tracker league scaffolded.** (1) Standings table refactored from CSS grid to an HTML table with frozen TEAM + PTS columns; middle stat columns scroll horizontally on mobile while team names and points stay pinned (`fc7d2904`). (2) Team logo uploads now match the profile-avatar pattern — `teams.logo_url` + `league_teams.logo_url` columns added (migration `teams_and_league_teams_add_logo_url`), TeamManage Create + Settings forms gain a 📷 Upload button with 5MB cap + NSFW pre-check + Replace/Remove affordances; renders fall back to colored initials when null (`460a8990`). (3) `CSHL 10U Squirts (2026-27)` league + `Shaker Heights Red Raiders` team scaffolded as Pete's "from the stands" personal tracker for his son Henry Hessell #17. Pete is commissioner of the league + manager of the team; Henry is on the roster via `invite_name` (no user account — COPPA). Source organization noted in `leagues.settings.source_org` + `source_url`. League: `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6`. Team: `d18e023c-354f-4d3b-b5a0-82574f05377d`. (4) Volunteer Coordinator promoted out of the More drawer's Manager section and onto the individual team page as a 5th tab between Feed and Info — "everything a team needs in one place." New `src/components/TeamVolunteer.js` renders open/filled/past stat pills, slot list with Claim/Cancel/Open-up/Delete by permission, past slots collapsed behind a toggle, and a manager-only `+ Add Volunteer Slot` composer with role presets + optional pin-to-game (`2e6207d5`, which corrected the wrong-direction `469406fc` that mistakenly put Volunteer on `/teams` instead of `/team/:id`). The standalone `/volunteer-coordinator` route still works as a multi-team aggregate dashboard but is no longer linked from any nav. Team page season stat line also gains **Ties** between Losses and the rest (`2e6207d5`). (5) **Multi-manager support for teams** — mirrors the multi-director tournament feature shipped earlier. New `is_team_manager(p_team_id, p_user_id)` SECURITY DEFINER helper + 6 RLS policies rewritten (teams_manager_update, team_members_manager_update + new founder-protected team_members_manager_delete, team_join_requests read+update, volunteer_slots insert+update+delete). Founding manager (`teams.manager_id`) is immutable — RLS forbids deletion of their `team_members` row with role='manager'. New ManagersSection at top of the Roster tab on TeamManage: add by handle/email (account required), Demote drops to player but keeps roster row, Remove deletes the row entirely. Founder shows amber "Founder" badge + "Can't remove" affordance. Migration `multi_team_manager_support_helper_and_rls` (`adc836b6`). Live build: `adc836b6c341`. **Last updated:** May 19, 2026 — **BLPA Cleveland moved to BAM (Strongsville, OH); pool play compressed to Saturday only.** Venue is now **Brunswick Auto Mart Arena (BAM)** at 15381 Royalton Rd, Strongsville, OH 44136. Tournament is now 2-day: Sat 6/13 (all 12 pool games) + Sun 6/14 (championship). Migration `blpa_cleveland_move_to_bam_strongsville_sat_sun_only` updated `tournaments.settings.venue_name` + `venue_address`, refreshed the 2 rinks rows (preserving UUIDs so game FKs stay intact), and moved the 6 Friday games onto Saturday afternoon slots. Follow-up migration `blpa_cleveland_minimize_back_to_back_games` resequenced the 12 pool games to minimize per-team back-to-backs: now 4 of 8 teams have one BB each (A3/A4/B3/B4), down from 6 of 8. **Mathematical floor:** a 4-team round-robin in 6 single-sheet slots cannot fully eliminate BBs — proven by the disjoint patterns {1,3,5} and {2,4,6}, which means at least two teams must hit a consecutive-slot pairing. Sheet assignment normalized: Pool A always on Sheet 1, Pool B always on Sheet 2. New Saturday schedule: 08:00 / 09:15 / 10:30 / 11:45 / 13:00 / 14:15 EDT, last puck Saturday ~15:30. Sunday championship times still TBD until Sat afternoon when Pete generates the bracket and picks first puck. **Last updated:** May 18, 2026 (late afternoon) — **Multi-director + Turnstile + security advisor pass.** Three more shipped commits (`4f145312` multi-director, `45f71a6d` Turnstile), three more DB migrations (`multi_director_support_helper_and_rls`, `multi_director_rls_extend_to_games_and_tournaments`, `close_security_definer_views_and_media_listing`), and a Cloudflare Turnstile widget standing up bot protection on signup. (1) **Multi-director:** tournament directors can now add other directors via the Scorers tab → new Directors section. New SECURITY DEFINER function `is_tournament_director(p_tournament_id, p_user_id)` + email-based lookup so Pete's UUID isn't hardcoded. The founding director (tournaments.director_id) gets a "Founder" badge + "Can't remove" affordance — RLS forbids deletion of their role row. Permission checks updated in 5 sites (TournamentManage page gate, Tournament canScore + Manage button + Follow-button-hiding, GameDetail isOrganizer, ScorerView director flag). TournamentManage shows a "Loading…" gate while the async role check is pending so a freshly-added director doesn't see the 🔒 lock screen flash. (2) **Turnstile on signup:** Cloudflare Turnstile in Managed mode. Widget renders on step 3 of signup; token forwarded to `supabase.auth.signUp({ options: { captchaToken } })`. Supabase Dashboard → Auth → Bot Protection enabled with secret key. Vercel env `REACT_APP_TURNSTILE_SITE_KEY` set. Verified: direct API signup without token returns `400 captcha_failed`. Auth via web UI requires solving the challenge first. Bug report + survey form Turnstile gating is filed as a post-pilot follow-up (the `qual = true` RLS on those tables means write-spam is theoretically possible; not pilot-blocking — only 25 days till live and abuse is unlikely at our scale). (3) **Architectural review fixes:** the 4 SECURITY DEFINER views (`analytics_daily`, `analytics_dau`, `league_standings`, `tournament_standings`) flipped to `security_invoker = on`. The `media` storage bucket's broad SELECT policy dropped (bucket is `public = true` so `/object/public/media/…` URLs still resolve, but anon can no longer enumerate via the listing API). 85 multiple_permissive_policies advisor warnings remain — backlog cleanup for post-pilot. **Last updated:** May 18, 2026 (afternoon) — **Tournament feed shipped + auto-follow Pete trigger.** Triggered by Pete noticing the auto-recap landed in the global Feed where unaffiliated users had no context. Three shipped commits + two DB migrations + a 19-user backfill. (1) `posts.tournament_id` column (nullable, FK to tournaments, ON DELETE SET NULL) with partial index on `(tournament_id, created_at desc)`. Migration `posts_add_tournament_id_for_tournament_scoped_feed`. (2) `getPosts` and `getFollowingPosts` filter `tournament_id IS NULL` — global/following feeds stay clean. New `getTournamentPosts(tournamentId, limit)` mirrors `getTeamPosts`. `createGameRecapPost` accepts `tournamentId`; insert + re-finalize update paths both stamp it. ScorerView passes `game.tournament_id` on finalize. (3) New **Feed tab** on Tournament.js between Bracket and Info — lazy-loaded, renders recap headline + body + author + "View game →"; non-recap posts get the existing `PostActionMenu` for report + block. (4) Tournament feed composer — anyone signed in can post chirps (text + optional photo via existing `uploadMedia`); 500-char cap; optimistic prepend. User posts do NOT trigger pushes (recap-only); avoids notification spam during a busy game. (5) Earlier same day: `lib/push.js` `subscribeToPush` now calls `getSubscription().unsubscribe()` before requesting fresh permission — fixes the `InvalidStateError` that surfaces when a browser holds an existing subscription registered against a rotated VAPID public key (commit `30b40986`). (6) **Auto-follow Pete on new account** — DB trigger `tr_auto_follow_pete` on `public.profiles AFTER INSERT`. SECURITY DEFINER, email-based Pete lookup (not hardcoded UUID), idempotent via `on conflict do nothing`. 19 existing users backfilled in a single transaction. Migration `auto_follow_pete_on_new_profile`. Live commits on `origin/main`: `30b40986` (push.js fix), `4ec187c4` (tournament feed), `ae4d7985` (composer). Live build: `ae4d79852ca5`. **Last updated:** May 18, 2026 (morning) — **Both P0 pre-pilot blockers cleared.** (1) Forgot Password flow fixed via Supabase URL Configuration (Site URL `www.rinkd.app` → apex; Redirect URLs allowlist now includes `https://rinkd.app/reset-password`, `https://rinkd.app/*`, `https://www.rinkd.app/*`, `http://localhost:3000/*`); E2E verified end-to-end as `pete@rinkd.app` (the first successful prod password reset in Rinkd history — Nick's May 14 attempt had silently failed against the old config). (2) Push pipeline activated via Path B: fresh VAPID pair generated, 3 Supabase secrets set, `send-recap-push` Edge Function deployed (v1, ACTIVE, JWT-verified), Vercel `REACT_APP_VAPID_PUBLIC_KEY` updated + redeployed; 2 stale May-09/May-12 test subscriptions purged. Private key stored in Pete's 1Password under "Rinkd VAPID keys (May 2026)" — **never rotate** post-pilot. Pete also completed the long-pending `claude/elegant-sanderson-80d1d0` merge (commit `ee0ca9ef`) — public landing + push pipeline code are now in production. **Pre-pilot P0 backlog is empty.** **Last updated:** May 17, 2026 (late evening) — New §13 "Operational artifacts" added (rinkd_v4 docs, roadmap xlsx, live state, new-session reading order). §7 Revenue + monetization subsection: 9 new items spanning Stripe Connect, registration fees, hotel affiliate, sponsorships, marketplaces, insurance partnership. **BenchBoss reframed from 3-tier pricing to 4 billing arrangements**: Community ($0) / Organizer-pays ($25/team) / **Pass-through ($15/team Technology fee billed to participating teams, BLPA-founding-partner model)** / Pro (custom annual). BIZ-BLPA-1 = post-pilot proof-point worth **~$1,840 / event** while BLPA pays nothing. **BLPA Cleveland pilot now 3 days (Fri 6/12 + Sat 6/13 + Sun 6/14)**, was 2 days. 12 pool games rescheduled in place: 6 Friday evening + 6 Saturday morning. Migration `cleveland_pilot_3day_reschedule_fri_sat_sun` live in prod. §7 roadmap expanded with **GameSheet + LeagueApps parity items** (15 new gaps total) — see `rinkd_v4/GAMESHEET_PARITY_GAPS.md` and `rinkd_v4/LEAGUEAPPS_PARITY_GAPS.md`.
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

## 4. Current state — verified May 20, 2026 evening

`origin/main` HEAD is **`8f70aa31`** (`docs: AvantLink denied Pure Hockey` — May 22; + a few small store/icon commits since) — May 21). Vercel auto-deploys `main` to production. **The entire league engine (Phase 1+2+3 + Phase 3b), the activation gate, and ~13 May-20 fixes/features are all MERGED + live.** The league-parity worktree (`claude/laughing-nightingale-10d576`) was merged to main May 19 evening (`5eedabd0` + `83ebfab3`); everything since has gone straight to main.

What's live, newest first:
- **Store → native gear shop + Pure Hockey affiliate** (`607bd94e`+`587ec7e9`, May 21) — Store back in the More drawer; `/store` rebuilt on a new `products` table (rinkd_merch + pure_hockey sources), affiliate click-out + FTC disclosure, "Pro Shop dropping soon" state. Pure Hockey side **DENIED by AvantLink May 22** (App 1601413) — paths back: merchant-vouch or reapply once Rinkd has traction; feed-sync fn scaffolded (not deployed). See §5 + memory `store-pure-hockey-affiliate`.
- **Public `/pricing` page** (`73fea303`, May 21) — shareable/indexable pricing tables (league + tournament tiers, cross-sell, 1% reg fee) from the pricing-guide docx; wired into hosting + activation banners + More drawer (not a nav tab). ⚠️ CTAs still drop into the FREE create wizard — payment-gating is a change-later once Stripe ships (see §5 + §7). Needs a visual eyeball.
- **Tape-job font on headers + wordmark** (`f96c6d14`→`086cde2e`, May 21) — hand-taped A–Z art sliced into glyph PNGs (`public/tapejob/`) + `TapeText` component; applied to 7 static section headers (CHIRPS/TEAMS/NOTIFICATIONS/TOURNAMENTS/LEAGUES/DISCOVER/STORE) + the RINKD wordmark everywhere (lockup, Auth/Landing/ResetPassword, landing brand strip, survey). ⚠️ wants a real-screen eyeball. See §5 May 21.
- **Event-page view tracking fixed** (`5ec7067c`, May 21) — `tournament_public_view` / `league_public_view` now fire for ALL viewers (were anon-only → recorded zero) with an `{ anonymous }` flag. See §5 May 21 + §9 funnel-events note.
- **GS-7 iOS PWA install banner** (`1efb2124`, May 21) — iOS Safari users prompted to install (3rd open or Follow-tap) so web push actually reaches iPhones. Self-gated; needs a real-device eyeball. See §5 May 21 + §7 GameSheet table.
- **Pre-pilot scale/reliability/security batch** (`9b50a41f`→`ff792c5d`, May 20) — auth screen opens on signup for cold traffic; Profile load parallelized + bounded; Tournament/League live-standings reload debounced; **`submit-scoresheet` Edge Function secured (v8 — caller auth + server-side recipients; ⚠️ happy path untested, see §12 checklist)**; push/scoresheet failure logging; `search_path` locked on 20 functions. See the §5 "Pre-pilot scale/reliability/security audit" entry.
- **Team-roster loop closed** (`01894320`) — requester gets a notification on approve/deny; manager adding a player by email now fires the `team_invite` email (auto-links on signup via the existing `link_invited_player` trigger).
- **Join-request flow fixes** (`434ad328`) — league commissioners can now action join requests on any team in their league (`is_league_commissioner_of_team` helper), notification trigger fans out to ALL managers + commissioners, trigger search_path locked.
- **Email-invite path for team-manager grants** (`90f6666d`) — `team_manager_invites` table + magic-link `/accept-team-invite` flow.
- **Commissioner-grants-management UI** (`a5936dce`) — LeagueManage Teams tab "+ Manager" / "+ Co-manager" via `assign_league_team_manager` RPC.
- **League-added teams are now real teams** (`3db0aa7f`) — `create_league_team` RPC creates a `public.teams` row + link; KOHA's 8 teams backfilled.
- **DatePicker timezone fix** (`5eca7c4e`) — `YYYY-MM-DD` parsed as local midnight (was UTC → off-by-one).
- **League logo upload** (`f2f5252c`) — Settings tab upload + renders on banner/index/admin.
- **Per-game stream URL** (`a69702f1`) — YouTube/Twitch/Facebook/Vimeo link on league games (KOHA streams on YouTube, not LiveBarn).
- **Funnel instrumentation** (`06e2ed8a`) — auth_view, auth_first_input, signup_step_advanced, forgot_password_clicked, tournament_public_view, league_public_view.
- **Hosting banners gated** (`42344635`) — "Run your league/Host your tournament on Rinkd" CTAs hide on activated events.
- **Pricing model locked** (`932cf198`) — per-size ladders (see §5 May 20 + `docs/Rinkd_Pricing_Guide.docx`); BIZ-TIER-1 superseded.
- **AdminActivations fixes** (`73bf3c52`, `dbf64d33`) — admin RPC for non-founder toggles + tournaments-have-no-logo_color fix.
- **Turnstile login/forgot fix** (`af13dfab` + `ebd4f7ca`) — widget renders on login + forgot forms (was signup-only → every login failed); remount on failed attempt.
- May 19 evening: **full league engine + activation gate** (`5eedabd0`) — see the Phase 1/2/3a/3b + activation §5 entries below.

**Working tree state:** `main` has only the two long-standing pre-existing strays uncommitted (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them alone unless Pete asks. The worktree at `.claude/worktrees/laughing-nightingale-10d576` is now fully merged into main; further work can go straight to main (Pete delegated commit + push authority May 19 — see memory `commit-authority`; ad-hoc fixes ship straight to main, large feature branches still get a hold-for-review).

**78 DB migrations applied total** (via Supabase MCP). The May 20 additions: `posts_add_league_id...`, `league_subscriptions_table...`, `league_games_add_phase...`, `league_games_add_round...`, `tournaments_and_leagues_add_is_activated...`, `admin_set_activation_rpc`, `league_games_and_rinks_add_youtube_url`, `create_league_team_rpc_and_koha_backfill`, `assign_league_team_manager_rpc`, `team_manager_invites_email_path`, `join_request_flow_fixes`, `notify_requester_on_join_decision`. Plus the May 19 league migrations (`leagues_add_dates...`, `league_roles_table...`).

**Edge Functions (10 deployed):** `send-invite` (v10 — now handles team_manager_invite type), `submit-scoresheet`, `send-push`, `schedule-ics`, `send-game-reminders`, `send-onboarding-emails`, `delete-account`, `send-recap-push` (v2 — activation-gated), `send-league-recap-push` (v2 — activation-gated, NEW May 19).

**Operational state (verified May 20, 2026 evening):**
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
- Turnstile bot protection: ✅ live on signup, login, password reset. (Login + forgot widget shipped May 20 — was signup-only before, which silently broke every login.)
- Security advisor pass: 4 SECURITY DEFINER views fixed, media bucket listing closed. All May 20 migrations advisor-clean (0 ERROR-level).
- **League engine: ✅ FULLY LIVE.** Multi-commissioner (`is_league_commissioner`), 4-step LeagueCreate wizard, PublicLeagueLanding for anon, Feed tab + composer + auto-recap, league push pipeline (`league_subscriptions` + `send-league-recap-push`), `league_games.phase` (regular_season/playoffs) with standings filter, smart target-games-per-team scheduler, Playoffs bracket tab, 4 format presets, league logo upload, per-game stream URL. `/league/:id` + `/leagues` are anon-public.
- **Activation gate: ✅ LIVE.** `tournaments.is_activated` + `leagues.is_activated` (default false; existing rows backfilled true). RLS hard-blocks scoring writes until flipped. Admin toggle at `/admin/activations` (`profiles.is_admin` only; non-founder toggles via `admin_set_activation` RPC). UX pills + ScorerView wall + Edge-Function push refusal. **THIS IS THE MONETIZATION MOAT — don't relax without Pete review.**
- **KOHA (Kanata Oldtimers Hockey Association):** first real external league signed on. 8 teams (Black Tartans, Cemented, CSC, G&V Drywallers, GA-Integrated, Molsons, Oldtimers, Unifor) backfilled as real `public.teams` rows (unclaimed — manager_id NULL). They stream on YouTube (not LiveBarn). Commissioner is `b80af4b7-9c3d-466c-9dde-414c73fe7188`. One pending join request (Howitzer → Cemented) now actionable by the commissioner.
- **Pricing locked May 20** (`docs/Rinkd_Pricing_Guide.docx`): League per-season $299/$599/$999 + $99 division add-on; Tournament per-event $149/$299/$499/$799; 1% registration platform fee + Stripe pass-through. BLPA Cleveland is OUT (custom deal, TBD). Tier ENFORCEMENT (team caps, tier column) not built — Sprint-1 post-pilot.
- 10 Edge Functions deployed (see §4 list above).

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

### May 19, 2026 evening (continued) — League engine Phase 1: tournament parity build

Picked up the queued `~/Downloads/rinkd_v4/LEAGUE_PARITY_PHASE_1_BUILD.md` plan and shipped Phase 1 end-to-end. Branch is the `claude/laughing-nightingale-10d576` worktree; pending Pete's merge to `main`. **Phase 1 is schema + bare-minimum scaffolding only** — Phase 2 (Feed, public landing, push) and Phase 3 (`league_games.phase`, multi-day scheduler, target-games-per-team, playoff bracket) are still queued. None of this is pilot-blocking — BLPA Cleveland is tournaments, not leagues.

**Two migrations** (live in prod via MCP; no app-level dependency until Pete merges the worktree code):

1. **`leagues_add_dates_venue_accent_logo_url`** — adds 6 columns to `public.leagues`: `start_date`, `end_date`, `venue_name`, `venue_address`, `accent_color`, `logo_url`. Plus two partial indexes:
   - `leagues_active_by_start_idx` on `(start_date) WHERE status='active'` — keeps the Leagues page hot path lean.
   - `leagues_end_date_idx` on `(end_date) WHERE end_date IS NOT NULL` — for upcoming/recent split + Phase 3 playoff trigger gate.
   - Intentionally NOT indexed: `venue_name`, `venue_address`, `accent_color`, `logo_url`. Display-only.

2. **`league_roles_table_and_is_league_commissioner_helper`** — multi-commissioner support, direct mirror of the multi-director (tournament) and multi-manager (team) patterns:
   - New `public.league_roles (id, league_id, user_id, role, created_at)` with `role` CHECK in `('commissioner','scorer','viewer')` + `UNIQUE (league_id, user_id)` + FK CASCADE on both sides.
   - 2 supporting indexes: `(league_id, role)` for listCommissioners / listScorers; `(user_id, role)` for the `useUserRole` "what leagues am I a commissioner of" hot path. Both verified via `EXPLAIN ANALYZE` to use `Index Only Scan` / `Index Scan`.
   - New `is_league_commissioner(p_league_id, p_user_id) returns boolean` — `STABLE SECURITY DEFINER` with explicit `search_path = public, auth`. Identical shape to `is_tournament_director` + `is_team_manager`. Returns true if the user is either the founding commissioner OR has `role='commissioner'` in `league_roles`.
   - 4 RLS policies on `league_roles`: `read_own` (own rows), `commissioner_read` (all rows for leagues you commish), `insert` (commissioners only), `delete` (commissioners only + **founder-protection NOT EXISTS clause** so the founder's commissioner row is undeletable).
   - `leagues_update` rewritten to use the helper (was founder-only) — additional commissioners can now edit league settings.
   - `league_games_insert` / `league_games_update` / `league_games_delete` rewritten to use the helper. `update` ORs in `scorekeeper_id` AND `EXISTS league_roles WHERE role='scorer'` — both the assigned scorekeeper and any league-role scorer can score a game.

**Advisor pass after each migration** — 0 ERROR-level findings on either security or performance. The new WARNs are symmetric with the existing tournament-side pattern (anon/authenticated executable on the SECURITY DEFINER helper — identical to `is_tournament_director`; multi-permissive SELECT on `league_roles` — same shape as `tournament_roles`). Doc explicitly accepts these.

**DB-level RLS smoke tests** (seeded a `SMOKE TEST — Phase 1 Parity` league with founder=Pete (test account) + extra commissioner Jake + scorer mvntrec, ran via `SET LOCAL ROLE authenticated` + `request.jwt.claims`, then cleaned up):
- ✅ Extra commissioner CANNOT delete founder's row (0 rows affected — founder-protection clause holds).
- ✅ Extra commissioner CAN delete a non-founder role row (1 row).
- ✅ Scorer-only user CANNOT delete any commissioner row (0 rows).
- ✅ Anon CAN SELECT a public league (`is_public = true`).
- ✅ Scorer-only user CANNOT UPDATE the league (0 rows).
- ✅ Extra commissioner CAN UPDATE the league (1 row).

**Code (4 files new, 3 files modified):**
- **New** `src/lib/leagueCommissioners.js` — direct port of `tournamentDirectors.js`. Exports `isExtraCommissioner`, `listCommissioners`, `addCommissionerByInput` (account-required, no email-invite path), `removeCommissioner`.
- **New** `src/lib/leagueScorers.js` — direct port of `tournamentScorers.js`. Exports `resolveProfile`, `addScorerByInput` (with email-invite fallback to a new `league_scorer_invite` type for `send-invite` Edge Function), `listScorers`, `removeScorer`.
- **New** `src/pages/LeagueCreate.js` — full 4-step wizard mirroring `TournamentCreate.js`:
  - **Step 1 (Basics):** name, division/level/location/season (existing fields), start_date + end_date + venue_name + venue_address (new), accent_color (new), logo color + initials + image upload via `uploadMedia` + `classifyImage` 5MB cap + NSFW pre-check (mirrors team/tournament).
  - **Step 2 (Format & Rules):** ONE preset for Phase 1 — `classic_league` (single round-robin, 3×12 stop, 6-goal mercy, ties allowed). More presets land in Phase 3. Full editable Game Format / Point System / Tiebreaker reorder / Options (allow_ties, shootout_regular_season, shootout_playoffs).
  - **Step 3 (Divisions & Teams):** free-text divisions (default: none → one league-wide group). Team picker is search-or-create (`teams` table debounced 300ms, falls back to UNLINKED row tagged amber). Each team can be assigned to a division at add time.
  - **Step 4 (Commissioners & Scorers):** both lists optional, founder auto-set via the createLeague insert.
  - **Cleanup-on-failure** identical to the tournament wizard — on any post-insert failure, `delete from leagues where id = leagueRow.id` cascade-clears league_teams + league_roles + league_games. Surface a "may still exist" note only if the cleanup itself fails.
  - **Batch team insert** — single `.insert([...])` for teams to avoid the N+1 anti-pattern the Phase 1 doc flagged. Commissioner + scorer additions stay sequential because each goes through `add*ByInput` which does an account-resolution step that's intentionally serial (avoids hammering the auth lookup).
- `src/lib/leagues.js` — `createLeague` extended to accept all 6 new columns; empty strings nulled out for the date fields so Postgres doesn't reject them. `getUserLeagueRole` now returns `'commissioner' | 'scorer' | 'viewer' | null` by ALSO consulting `league_roles` (was founder-only).
- `src/pages/LeagueManage.js` — inline `CreateLeague` component (lines 60-124) deleted; `createLeague` import removed. The `if (id === 'create') return <CreateLeague…/>` fallthrough is now a defensive `navigate('/league/create', { replace: true })` in case a stale link hits this surface.
- `src/App.js` — registered `import LeagueCreate from './pages/LeagueCreate'`; the `/league/create` route now points to `LeagueCreate` directly (was double-routed through `LeagueManage`).

**Build:** clean (`Compiled with warnings` with only the pre-existing harmless `Critical dependency` webpack warning). Bundle +5.5kB gz.

**Smoke-tests deferred to Pete (require browser + 2nd account):**
1. ✅ DB: helper correctness + RLS — verified above via direct SQL.
2. **Wizard happy path** — `/league/create` → fill 4 steps → land on `/league/<id>/manage` with all settings + teams populated.
3. **Failure recovery** — kill the network mid-Publish; expect cleanup-on-failure delete of the partial league.
4. ✅ DB: founder-protection RLS — verified above.
5. **Second commissioner UX** — add a commissioner via wizard, sign in as that account, confirm `/league/:id/manage` is accessible + Settings can be edited.
6. **Scorer access** — add a scorer, sign in as that account, score a league game via ScorerView.
7. **Anon view** — confirm `/league/<id>` still renders for signed-out users (is_public=true leagues).

**Scope guardrails honored** (per Phase 1 doc "What NOT to do"): no Feed tab, no PublicLeagueLanding, no `posts.league_id`, no schedule generator extension, no `league_games.phase`, no `league_subscriptions`/push, no tournament-side touches.

**✅ MERGED to main May 19 evening** (`5eedabd0`, then synced via `83ebfab3`). Live in prod. Original merge note retained below for reference:
```
rm -f .git/index.lock && \
  git checkout main && \
  git merge --no-ff claude/laughing-nightingale-10d576 -m "merge: league engine Phase 1 + Phase 2 — tournament parity build" && \
  git push origin main
```

### May 19, 2026 evening (continued, second pass) — League engine Phase 2: Feed + PublicLeagueLanding + push pipeline

Layered Phase 2 on top of Phase 1 in the same `claude/laughing-nightingale-10d576` worktree (one cohesive review). Closes the major Phase 2 deliverables from `~/Downloads/rinkd_v4/LEAGUE_PARITY_PHASE_1_BUILD.md`: league-scoped feed, public landing for anonymous users, follow + push notification pipeline. Phase 3 (`league_games.phase` column, multi-day scheduler, target-games-per-team auto-compute, playoff bracket UI) is still queued.

**Two migrations** (live in prod via MCP):

1. **`posts_add_league_id_for_league_scoped_feed`** — adds nullable `posts.league_id uuid REFERENCES public.leagues(id) ON DELETE SET NULL`. Mirror of the May 18 `posts.tournament_id` migration. Adds partial btree `posts_league_id_created_at_idx ON (league_id, created_at DESC) WHERE league_id IS NOT NULL` so the League Feed tab read is indexed.

2. **`league_subscriptions_table_for_push_targeting`** — `league_subscriptions(user_id uuid, league_id uuid, created_at timestamptz)` with composite PK `(user_id, league_id)` + index on `(league_id)` for reverse-direction lookup. FKs CASCADE on both sides. RLS: `select/insert/delete` all self-scoped via `(select auth.uid()) = user_id`. Direct mirror of `tournament_subscriptions`.

**Advisor pass** after both migrations: 62 WARN, **0 ERROR-level**, no new warnings introduced.

**DB-level RLS spot-checks (all 6 pass):**
- Anon SELECT on `league_subscriptions` → 0 rows (no policy grants anon). ✓
- Authed user SELECT shows only own rows. ✓
- Authed user INSERT impersonating another user → blocked with `new row violates row-level security policy`. ✓
- Authed user DELETE returns only own rows; the other user's row survives. ✓
- Anon SELECT on `posts.league_id`-tagged posts works (0 today, no error — when recaps land they'll show). ✓
- Wired-up bonus: confirmed anon SELECT on `league_games`, `league_teams`, `rinks` all return public-read `true` so PublicLeagueLanding renders for anon visitors. ✓

**Edge Function deployed: `send-league-recap-push`** (v1, ACTIVE, `verify_jwt=true`). Direct mirror of `send-recap-push` — same don't-trust-the-client architecture (client hands over a `post_id`, function walks `posts → league_games → leagues → league_subscriptions → push_subscriptions` under service role, fans out via `web-push`, prunes 410/404). Reuses the existing VAPID secrets set in May 18's `send-recap-push` deploy. Anonymous POST → `401 UNAUTHORIZED_NO_AUTH_HEADER` (JWT enforced).

**Code (1 new file, 5 modified):**

- **New** `src/lib/leagueSubscriptions.js` — `followLeague`, `unfollowLeague`, `isFollowingLeague`. Direct port of `tournamentSubscriptions.js` (upsert-on-follow for idempotent double-tap).
- `src/lib/posts.js`:
  - `getPosts` + `getFollowingPosts` now also `.is('league_id', null)` so league-scoped posts stay off the global feed (mirror of the tournament filter).
  - New `getLeaguePosts(leagueId, limit = 50)` mirror of `getTournamentPosts`. Hits the partial index above.
  - `createGameRecapPost` accepts `leagueId`; on existing-row update it also re-stamps `league_id` for self-healing of older recaps.
  - `createPost` accepts `leagueId` so the Feed-tab composer can scope user posts to a league.
- `src/lib/push.js` — new `triggerLeagueRecapPush(postId)` mirror of `triggerTournamentRecapPush`; invokes `send-league-recap-push` Edge Function.
- `src/pages/League.js` (heaviest rewrite):
  - Accepts `currentUser` prop.
  - New `TABS` array: `['Schedule', 'Standings', 'Teams', 'Feed', 'Info']` (Feed inserted between Teams and Info).
  - New state: `isFollowing`, `followBusy`, `isExtraCommissioner`, `feedPosts`, `feedLoading`.
  - New `useEffect`s: load `isFollowing`, load `isExtraCommissioner`, lazy-load `feedPosts` on first Feed-tab open, realtime subscription to `league_games` for live score updates (mirror of Tournament.js).
  - New `handleFollowToggle` — first-time follow triggers `subscribeToPush` if not already subscribed; falls through to the DB follow either way.
  - `isCommissioner` is now `userRole === 'commissioner' || isExtraCommissioner` so additional commissioners see the Manage button and scorer affordances.
  - Anon gate: if `!currentUser`, render `<PublicLeagueLanding>` (inline component at the bottom of the file).
  - "Private league" framing for the not-found error state when anon (matches the tournament pattern).
  - New `<LeagueFeedTab>` sub-component (mirror of Tournament FeedTab): textarea composer + photo upload, 500-char cap, optimistic prepend, blocked/reported post filtering via `PostActionMenu`, "View game →" deep-link to `/league-game/:id`.
  - New `<PublicLeagueLanding>` sub-component: league metadata (name, season, dates, venue, logo) + sign-up CTAs + 3-stat counter (Teams / Games / Played) + teams list with logo chips. Records hidden behind sign-up. SEO-friendly + Google-indexable.
- `src/pages/ScorerView.js`:
  - Imports `triggerLeagueRecapPush`.
  - `buildRecapContent` now accepts `leagueName` in addition to `tournamentName`; league finalize uses `Regular season · <league name>` as the context line (Phase 3 will plug in `league_games.phase` for playoffs).
  - New `else if` branch at the finalize call site: when `isLeague && newStatus === 'final' && game.league_id`, build recap content, `createGameRecapPost({ ..., leagueId })`, then `triggerLeagueRecapPush(postId)`. Failures non-fatal — game finalizes regardless. No bracket auto-fill (leagues don't have bracket games until Phase 3).
- `src/App.js`:
  - `/league/:id` and `/leagues` dropped out of `ProtectedRoute` so anonymous spectators can land on `<PublicLeagueLanding>`. `currentUser={user}` now passed to League.js. Mirror of the May 16 tournament public-landing pattern. Inline comment documents the parity.

**Build:** clean (`Compiled with warnings` with only the harmless `Critical dependency` webpack warning). Bundle +3.75 kB gz on top of Phase 1.

**Smoke-tests deferred to Pete (browser + 2nd account):**
1. ✅ DB-level RLS + advisor — verified above.
2. **Anon landing** — sign out, visit `/league/<id>` for a `is_public=true` league; expect `<PublicLeagueLanding>` with metadata + teams + sign-up CTAs.
3. **Follow + push** — sign in as a non-commissioner, tap 🔔 Follow on a league, accept the push permission prompt. Confirm `league_subscriptions` row created. Have a commissioner finalize a league game in ScorerView; first device should receive a push within ~2s with the recap headline.
4. **Feed tab** — confirm the auto-recap from #3 lands in the league's Feed tab (not the global Feed). Post a chirp from the Feed composer; expect optimistic prepend.
5. **2nd commissioner can score + finalize** — sign in as a `league_roles.role='commissioner'` user (not the founder), open `/league/:id/manage`, open ScorerView, finalize a game. Confirm the recap lands and pushes fire.
6. **Scorer access** — sign in as a `league_roles.role='scorer'` user; ScorerView allows finalize via the `EXISTS league_roles WHERE role='scorer'` branch of the `league_games_update` RLS.

**Scope guardrails honored** (per Phase 1 doc "What NOT to do" applied to Phase 2 scope): no `league_games.phase` column, no multi-day/games-per-day/target-games-per-team scheduler, no playoff bracket UI. All Phase 3 work.

**Phase 3 — still queued.** From §7: `league_games.phase` + composite index `(league_id, phase)` for `WHERE phase='regular_season'`; multi-day + games-per-day + days-of-week scheduler with target-games-per-team auto-compute (Option B per Pete May 19); playoff bracket UI; more format presets (currently only `classic_league`). Effort: **~5-6 days**.

**✅ MERGED to main May 19 evening** as part of `5eedabd0`.

### May 19, 2026 evening (continued, third pass) — League engine Phase 3a: phase column + smart schedule generator + more presets

Layered Phase 3a on top of Phase 2 in the same `claude/laughing-nightingale-10d576` worktree. Closes the foundational pieces of Phase 3 from the build doc: `league_games.phase` column + standings view filter, target-games-per-team schedule generator, additional format presets. **Phase 3b (playoff bracket UI) is queued for a follow-up session** — see §7. Bracket UI is a UI-heavy piece that benefits from real season data and from observing how commissioners use the new generator; standings-with-phase-filter is already in place, so playoff games can be inserted manually today and they'll be cleanly excluded from regular-season standings.

**One migration** (live in prod via MCP):

**`league_games_add_phase_for_playoffs`** — adds `league_games.phase text NOT NULL DEFAULT 'regular_season' CHECK (phase IN ('regular_season','playoffs'))`. All 42 pre-existing rows backfilled to `regular_season` via the column default. New composite index `league_games_league_phase_idx ON (league_id, phase)` for the standings view's hot read path. The `league_standings` view (already flipped to `security_invoker=on` per May 18 fix) was dropped + recreated with `WHERE league_games.phase = 'regular_season'` in both branches of the UNION ALL — playoff games are now structurally invisible to regular-season standings. `security_invoker=on` preserved.

**Advisor pass:** 62 WARN, **0 ERROR-level**, no new warnings introduced. View def re-pulled with `pg_get_viewdef` confirms the `phase = 'regular_season'` predicate is in place.

**Code (1 new lib, 3 modified):**

- **New** `src/lib/leagueScheduleGenerator.js` — pure-function schedule generator. Three exports:
  - `computeScheduleShape({ teamCount, targetGamesPerTeam })` → `{ meetingsPerPair, gamesPerTeam, totalGames }`. Rounds the user's target to the nearest clean round-robin count (so "30 games per team across 8 teams" = `round(30/7)=4` meetings = 28 games per team). Floors at 1 meeting so a low target always produces at least one full RR.
  - `buildSlotTimeline({ startDate, daysOfWeek, gamesPerDay, totalSlots, firstPuckHour, firstPuckMinute, gameBlockMinutes })` → array of ISO datetime strings. Walks the calendar forward from `startDate`, emits up to `gamesPerDay` slots on each allowed day-of-week, stagger by `gameBlockMinutes`. Hard-capped at 3 years of walk so a misconfigured form can't spin forever; returns `error: 'calendar_exhausted'` signal.
  - `generateLeagueSchedule({ teams, targetGamesPerTeam, startDate, daysOfWeek, gamesPerDay, rinkId, ... })` → `{ rows, shape, lastSlotDate, error? }`. Reuses `roundRobinPairs` from `tournamentManage.js` for the underlying RR. Flips home/away on alternating meetings so a team that hosts a given opponent in meeting 1 visits them in meeting 2 — fairness across multiple round-robins. Tags every row with `phase: 'regular_season'`. Caller does the DB insert.
- `src/lib/scheduleBuilder.js` — extended `bulkInsertLeagueGames` to write `phase: g.phase || 'regular_season'` so the new generator's rows land tagged correctly. Default matches the DB column default; the (future) bracket generator can pass `'playoffs'`.
- `src/pages/LeagueManage.js` — Schedule tab now leads with **⚡ Smart Generator — Target Games Per Team**. Inline `SmartScheduleGenerator` sub-component with:
  - Target games per team (number, 1-200)
  - Start date
  - Days-of-week multi-select chips (Sun-Sat)
  - Games per day (default 1)
  - Rink picker (optional — generator allows commissioner to assign per-game later)
  - First puck (24h hour + minute) + minutes between games (default 18:00 + 75-min spacing)
  - **Live preview card** that re-runs `generateLeagueSchedule` on every form change (no DB hit) — shows "X games across Y teams. Each team plays each opponent N× = M games per team. Last game: <date>." Surfaces `calendar_exhausted` error if days-of-week + start can't fit the schedule in 3 years.
  - Two-tap confirm — first tap shows "Confirm — insert N games", second tap actually inserts via `bulkInsertLeagueGames`. Prevents accidental double-generation.
  - The existing modal-based "Advanced — Single/Double Round-Robin Wizard" stays accessible just below as the secondary path for commissioners who want finer control. Both write through `bulkInsertLeagueGames`, so both produce `phase='regular_season'`-tagged rows.
- `src/pages/LeagueCreate.js` — `FORMAT_PRESETS` expanded from 1 to **4 presets**:
  - `classic_league` (unchanged) — single RR, 3×12 stop, 6-goal mercy, ties allowed
  - `beer_league_no_ties` — 3×17 run-time, SO in regular season, no mercy
  - `high_school_style` — 3×15 stop, 7-goal mercy, OT/SO playoffs only
  - `youth_short_game` — 2×20 run-time, 8-goal mercy, ties allowed, no SO

**Build:** clean. Bundle +2.37 kB gz on top of Phase 2.

**DB-level smoke tests (all pass):**
- ✅ `league_games.phase` column exists, NOT NULL with `CHECK (phase IN ('regular_season','playoffs'))`.
- ✅ Composite index `league_games_league_phase_idx` built.
- ✅ All 42 pre-existing rows backfilled to `regular_season`.
- ✅ View definition (re-pulled via `pg_get_viewdef`) contains `phase = 'regular_season'` in both branches.
- ✅ View options confirm `security_invoker=on` preserved (no SECURITY DEFINER regression).
- ✅ Advisor pass: 0 ERROR-level, no new findings.
- ✅ Generator math verified by inspection for typical commissioner inputs (8 teams × target 30 → 4 meetings → 28 actual; 8 teams × target 14 → 2 meetings → 14 actual; 8 teams × target 1 → 1 meeting → 7 actual; teamCount<2 → 0/0/0).

**Smoke-tests deferred to Pete (browser):**
1. Open `/league/<id>/manage` → Schedule tab; pick days-of-week, target=20, start=today, games/day=1; tweak the preview ("16 teams × 1 meeting × 15 opponents = 15 games per team, 120 games total"); fire Generate; expect 120 rows inserted with `phase='regular_season'`.
2. Insert a playoff game manually (set `phase='playoffs'` on a row); confirm it appears in the Schedule tab but is **invisible** in the Standings tab (the new view filter).
3. Generator edge: pick 1 day-of-week + target that requires more days than 3 years allow; expect the preview to surface "Calendar full — try more days-of-week or more games-per-day" and Generate to be disabled.
4. New presets: open `/league/create` Step 2, click each of the 4 preset chips, verify the settings populate sensibly.
5. Re-generate guard: tap Generate once, then tap again — the button label changes to "Confirm — insert N games" before the actual write.

**Phase 3b — queued (NOT in this batch):**
- Playoff bracket UI: pick top-N teams from standings, generate bracket games tagged `phase='playoffs'`. Inserts go through the same `bulkInsertLeagueGames` (no DB changes needed — the schema is ready).
- Per-rink balancing in the smart generator (Phase 3a is single-rink). Once multi-rink leagues land, run the generator per rink + interleave.
- Schedule edit flow for the smart-generated games (today, commissioner edits individually in the Schedule tab — fine for MVP).

**✅ MERGED to main May 19 evening** as part of `5eedabd0`.

### May 19, 2026 evening (continued, fourth pass) — League engine Phase 3b: playoff bracket UI

Closes the last queued piece of Phase 3 from the original build doc. Layered on the same `claude/laughing-nightingale-10d576` worktree — Phase 1 + 2 + 3a + 3b ship as one merge.

**One migration** (live in prod via MCP):

**`league_games_add_round_for_playoff_bracket`** — adds `league_games.round text NULL` (mirror of `games.round` on the tournament side; intentionally no CHECK so non-standard bracket patterns like play-ins or third-place games can land later without a schema change). Adds partial composite index `league_games_phase_round_idx ON (league_id, phase, round) WHERE phase='playoffs'` so "list this league's playoff bracket" stays cheap as regular-season rows pile up around it.

**Structural constraint discovered:** `league_games.home_team_id` + `away_team_id` are **NOT NULL** (vs tournament `games` which allows NULL). Means I can't pre-create TBD placeholder rounds the way the tournament bracket does. Phase 3b ships a **one-round-at-a-time** flow: commissioner generates round 1 from standings (real seeds), then comes back after that round finalizes to generate round 2 from winners. This is actually a cleaner UX than placeholder-fill — commissioners can adjust schedule between rounds based on real availability.

**Advisor pass:** 62 WARN, **0 ERROR-level**, no new findings. All 42 existing rows untouched (still tagged `regular_season`).

**Code (1 new lib, 1 modified):**

- **New** `src/lib/leaguePlayoffGenerator.js` — pure-function bracket generator.
  - `SUPPORTED_BRACKET_SIZES = [2, 4, 8]` — covers the vast majority of beer/youth/adult-rec leagues; 16+ is a Phase 4 ask if needed.
  - `seedPairs(bracketSize)` — standard 1v8 / 4v5 / 3v6 / 2v7 (8-team QFs); 1v4 / 2v3 (4-team semis); 1v2 (2-team final). Higher seed = home team.
  - `firstRoundLabel(bracketSize)` — `'quarterfinal' | 'semifinal' | 'final' | null`.
  - `generatePlayoffRoundOne({ standings, bracketSize, ...scheduling })` — seeds from current `league_standings` rows (sorted by `rank`). Reuses `buildSlotTimeline` from `leagueScheduleGenerator.js` for the calendar walk. Returns `{ rows, label, error? }` with `error ∈ { 'unsupported_bracket_size', 'not_enough_teams', 'calendar_exhausted' }`.
  - `generatePlayoffNextRound({ previousRound, bracketSize, includeBronze, ...scheduling })` — takes finalized round-N games + emits round-N+1 by pairing adjacent-slot winners (`[w0,w1]` → final, `[w0,w1,w2,w3]` → 2 semis). When previousRound is `'semifinal'` and `includeBronze=true`, also emits a bronze game pairing the two losers. Validates: previous round must all be `status='final'`, no ties (return `'incomplete_winners'`), no slot exhaustion.
  - All rows tagged `phase='playoffs'` + the correct round label so the standings view structurally excludes them (Phase 3a).
- `src/pages/LeagueManage.js`:
  - New 'Playoffs' tab in `MANAGE_TABS = ['Teams', 'Schedule', 'Playoffs', 'Settings']`.
  - `load()` extended to fetch `getLeagueStandings(id)` alongside teams/games/rinks. New `standings` state.
  - New `<PlayoffsTab>` inline sub-component (~270 lines) with three sections:
    - **🏆 Generate Playoff Bracket** form — bracket size selector (2/4/8, disabled options for sizes that exceed team count), days-of-week chips, start date, games-per-day, rink, first puck, spacing. Live preview shows actual matchups with team names + dates. Two buttons render conditionally:
      - **Round 1** ("Generate quarterfinal/semifinal/final (N games)") when no round-1 games exist yet — seeded from standings.
      - **Next round** ("Generate semifinal/final (N games)") when the latest existing round is fully final — pairs winners + optional bronze-game checkbox for semis-complete state.
    - **Top N from Standings (Seeding)** — read-only preview showing which teams currently hold the top seeds and their W-L-T-pts. Surfaces "Only X teams have a standings rank — need N for this bracket size" when standings is short.
    - **Current Bracket** — grouped by round (Quarterfinals → Semifinals → Final / Bronze) with home/away/time/score (when final). Renders only when at least one playoff game exists.
  - The `<SmartScheduleGenerator>` (Phase 3a) and existing modal-based Advanced wizard stay in the Schedule tab — Playoffs is a separate flow.

**Build:** clean. Bundle +3.5 kB gz on top of Phase 3a.

**DB smoke (all pass):**
- ✅ `round` column added (nullable text), partial index `league_games_phase_round_idx` built.
- ✅ View definition still contains `phase = 'regular_season'` filter.
- ✅ All 42 existing rows untouched; `round` defaults to NULL for them.
- ✅ Advisor pass: 0 ERROR-level.
- ✅ Generator math verified by inspection: seedPairs for 2/4/8 returns standard cross-bracket matchups; `pairWinnersInOrder([w0,w1,w2,w3])` → `[(w0,w1), (w2,w3)]`; tie detection blocks next-round generation cleanly.

**Smoke-tests deferred to Pete (browser):**
1. Open `/league/<id>/manage` → Playoffs tab; with at least 4 finalized regular-season games, expect 4-team bracket option active; pick start date + Sun chip; preview shows "1v4" + "2v3" matchups with correct seeds; tap Generate; expect 2 rows inserted with `phase='playoffs'` + `round='semifinal'`.
2. Finalize both semifinal games in ScorerView; come back to Playoffs tab; expect the "Next round preview" panel to show the championship matchup (winner of semi 1 vs winner of semi 2) + bronze checkbox; tap Generate; expect 2 rows (final + bronze) tagged correctly.
3. Verify regular-season Standings is unchanged after playoff games land — phase filter keeps them out.
4. Edge: try generating a bracket with `bracketSize > standings.length`; expect "Only X teams have a standings rank — need N" error in the seeding preview + Generate disabled.

**Phase 3 — ✅ COMPLETE.** All four pieces from the original Phase 3 spec shipped:
- ✅ `league_games.phase` column + standings view filter (Phase 3a)
- ✅ Smart target-games-per-team scheduler (Phase 3a)
- ✅ Playoff bracket UI (Phase 3b)
- ✅ More format presets — 4 total (Phase 3a)

**Deferred polish (post-merge backlog, not pilot-blocking):**
- Per-rink balancing in the smart generator (today: single-rink — commissioners run the generator per rink + interleave manually).
- Smart-schedule batch edit (today: per-game inline edit in the Schedule tab).
- Phase selector on the manual "Add Single Game" form (today: commissioner who wants to manually add a non-bracket playoff game would need to set `phase` via SQL — rare edge case).
- 6-team bracket with byes (Phase 3b ships 2/4/8 only — covers the common cases).
- Auto-fill of next-round games as soon as a prior-round game finalizes (today: commissioner re-runs the generator manually).

**✅ MERGED to main May 19 evening** as part of `5eedabd0`.

### May 19, 2026 evening (continued, fifth pass) — Activation gate (monetization switch)

Pete realized that everything functions for everyone — there's no paywall in the loop. Closes that with a **per-event activation switch** that gates the live-scoring + push value paths at the RLS layer. Organizers can still create + configure freely (teams, schedule, bracket, public landing); only the things that matter at game-time (finalize, goal/penalty inserts, push fanout) require a Rinkd admin to flip `is_activated` first. Layered on the same `claude/laughing-nightingale-10d576` worktree.

**One migration** (live in prod via MCP):

**`tournaments_and_leagues_add_is_activated_admin_gate`** — adds `is_activated boolean NOT NULL DEFAULT false` to both `public.tournaments` and `public.leagues`. **Backfilled all existing rows to `true`** (4 tournaments + 5 leagues) so BLPA Cleveland / CSHL personal tracker / demo data keep working. New rows default `false` — Pete decides per event going forward.

Three RLS rewrites enforce the gate:
- `games_director_update` + `games_scorer_update` (tournament side): both now require `EXISTS tournaments t WHERE t.id = games.tournament_id AND t.is_activated = true` ANDed onto the existing director/scorer path. The `tournament_id IS NULL` escape hatch (solo / non-tournament games) stays exempt.
- `league_games_update`: same gate ANDed onto the existing commissioner/scorekeeper/scorer path.
- New `game_goals_insert_requires_activated` + `game_penalties_insert_requires_activated`: defense-in-depth INSERT policies. A goal/penalty insert hits a game; that game's parent tournament OR league must be activated (or the game must be solo `tournament_id IS NULL`). Blocks the scoring-tool write path even if UPDATE somehow bypasses.

**DB smoke test** confirmed the gate works end-to-end: set BLPA Cleveland `is_activated=false`, attempted `UPDATE games SET home_score=99 WHERE tournament_id=...` as the founding director — **0 rows affected**. Flipped `is_activated=true` and retried — **12 rows updated** (one per pool game). Cleaned up.

**Advisor pass:** 62 WARN, **0 ERROR-level**, no new findings from this migration.

**Code (1 new page, 1 new route, edits across 5 files, 2 Edge Function redeploys):**

- **New** `src/pages/AdminActivations.js` (~220 lines) — admin console at `/admin/activations`. Gated by `useIsRinkdAdmin` (same `profiles.is_admin=true` gate the other admin pages use). Lists tournaments + leagues with:
  - Logo + name + division/season/date subtitle.
  - Status pill (● Activated green / ○ Pending amber).
  - Toggle switch.
  - Filter chips (Pending / Activated / All) + free-text search across name + division.
  - "Pending (N)" counter on the Pending chip.
  - Click name → deep-link to the public page.
  - Reload button + error surface for write failures.
- `src/App.js` — registered `/admin/activations` route + `AdminActivations` import.
- `src/components/MoreDrawer.js` — added Activations link to the Rinkd Admin section between Analytics and Bug reports.
- `src/pages/Tournament.js` — "🔒 Activation pending" pill next to "● Live now" in the page header when `tournament.is_activated === false`.
- `src/pages/League.js` — same pill next to the IN SEASON status pill.
- `src/pages/TournamentManage.js` — yellow callout banner under the page header explaining the activation requirement and linking to `hello@rinkd.app`.
- `src/pages/LeagueManage.js` — same callout banner. Both managers explicitly call out that **setup still works** — only live scoring + pushes are locked.
- `src/pages/ScorerView.js`:
  - Load query selects `is_activated` on the joined tournament/league.
  - New gate page renders after the "Scorer access only" gate: if parent not activated, shows "🔒 Activation pending — Email hello@rinkd.app" with a back button. Doesn't render the scorer UI so users don't stare at a console that silently refuses every write.
- `send-recap-push` Edge Function (v2, ACTIVE, JWT enforced) — added `is_activated` to the tournament join + returns `{ sent: 0, reason: 'tournament_not_activated' }` early if false. No push fanout for non-activated events.
- `send-league-recap-push` Edge Function (v2, ACTIVE, JWT enforced) — same gate via league lookup. Returns `{ sent: 0, reason: 'league_not_activated' }`.

**Build:** clean (+2.7 kB gz on top of Phase 3b).

**How it works end-to-end:**
1. Organizer signs up + creates a tournament/league via the existing wizards. `is_activated=false` by default.
2. They can add teams, generate schedule, build bracket, customize everything. Public landing page shows their event. The "Activation pending" pill is visible everywhere.
3. They contact `hello@rinkd.app` (the banner copy points them here) and pay.
4. Pete opens `/admin/activations`, finds the event in the Pending list, taps the toggle. `is_activated → true`.
5. Live scoring + auto-recap pushes unlock immediately. Director/scorers can finalize games. Recap posts fan out to push subscribers.
6. If a refund/dispute lands, Pete flips the toggle back to false. Scoring re-locks. No data loss.

**Smoke-tests deferred to Pete (browser):**
1. Open `/admin/activations` — expect all 4 tournaments + 5 leagues showing ● Activated (backfill).
2. Toggle BLPA Cleveland off; load the tournament page in another tab — expect "🔒 Activation pending" pill. Open TournamentManage — yellow callout banner. Open ScorerView for any game — expect the activation-pending wall (not the scorer console). Toggle back on; reload; everything restored.
3. Create a fresh test league via `/league/create` — expect `is_activated=false` default. Try to score → wall. Activate → unlocks.
4. As a non-admin user, navigate to `/admin/activations` — expect the "🔒 Activations is Rinkd staff only" gate.

**Defense-in-depth layers (in order):**
- **RLS** (the security): can't UPDATE games / INSERT goals / INSERT penalties without parent activated. Server enforces.
- **Edge Functions** (defense in depth): both push functions refuse to fan out for non-activated events.
- **UX banners** (the usability): pills, callouts, ScorerView wall so users understand why writes fail.

**✅ MERGED to main May 19 evening** as part of `5eedabd0`. Activation panel + RLS gate live in prod.

### May 20, 2026 — League-customer day: KOHA onboarding + roster/manager flows + fixes

A full day shipping straight to `main` (post-merge) driven by standing up **KOHA (Kanata Oldtimers Hockey Association)** — the first real external league. Each item below is its own commit; all live in prod.

**Turnstile login fix (`af13dfab` + `ebd4f7ca`) — was breaking ALL logins.** The May 18 Turnstile rollout enabled CAPTCHA Protection globally at the Supabase project level but only rendered the widget on signup step 3. Every `/auth/v1/signin` + `/recover` was returning `captcha protection: request disallowed (no captcha_token found)`. Fix: render `<TurnstileWidget>` on the login + forgot-password forms; `signIn` + `resetPasswordForEmail` forward the token; widget remounts via a `turnstileResetKey` after a failed attempt (consumed tokens) + on mode switch. Found via the analytics funnel — 13 "login failures" were one session pounding the broken wall.

**AdminActivations fixes (`dbf64d33`, `73bf3c52`).** (a) The page SELECTed `logo_color`/`logo_initials` from tournaments, which don't exist there (only leagues have them; tournaments use `accent_color`). Split the SELECTs + normalized avatar fields at render. (b) Toggling an event you didn't found silently no-op'd — the `tournaments`/`leagues` UPDATE RLS gates on founder, not Rinkd-admin. Added `admin_set_activation(p_kind, p_id, p_value)` SECURITY DEFINER RPC gated on `profiles.is_admin`; the panel calls it instead of a direct UPDATE.

**Hosting banners gated (`42344635`).** "Run your league on Rinkd" / "Host your tournament on Rinkd" CTAs in the Info tabs now hide when `is_activated === true` — they're lead-gen, wrong to show a paying customer.

**Funnel instrumentation (`06e2ed8a`).** Added `auth_view`, `auth_first_input`, `signup_step_advanced`, `forgot_password_clicked`, `tournament_public_view`, `league_public_view`. The middle of the landing→signup funnel was a black box; these close it. Note: a large share of top-of-funnel may come via shared tournament/league URLs (which fire `*_public_view`, NOT `landing_view`), so compare those when reading the funnel.

**Per-game stream URL (`a69702f1`, migration `league_games_and_rinks_add_youtube_url`).** KOHA streams on YouTube, not LiveBarn. Added `youtube_url` to `league_games` + `rinks` (rink = default, game = override). New `src/lib/streamUrl.js` detects platform (YouTube/Twitch/Facebook/Vimeo/other) → labels the "▶ Watch on X" button + brand color. Independent of LiveBarn — a game can show both buttons. Generic despite the column name; only league side (mirrors `live_barn_venue_id` which also skips tournament `games`).

**League logo upload (`f2f5252c`).** The LeagueCreate wizard had upload from Phase 1, but the Settings tab on existing leagues didn't. Added the same 5MB + NSFW + uploadMedia flow to LeagueManage Settings. Wired `logo_url` rendering through League.js banner + Leagues.js index (PublicLeagueLanding + AdminActivations already rendered it).

**DatePicker timezone fix (`5eca7c4e`).** `new Date("2026-06-13")` parses as UTC midnight → renders the day before in Eastern. `parseLocalDate` now constructs via `new Date(y, m-1, d)` for date-only strings. Global fix — TournamentCreate + LeagueCreate both use the shared component.

**League-added teams are now real teams (`3db0aa7f`, migration `create_league_team_rpc_and_koha_backfill`).** Previously `LeagueManage` added unlinked `league_teams` rows (`team_id` NULL) — invisible on `/teams`, can't have a manager/roster. New `create_league_team(league_id, name, color, initials, division)` SECURITY DEFINER RPC (gated on `is_league_commissioner`) creates a real `public.teams` row (manager_id NULL = unclaimed, is_public true) + the link. `handleAddUnlinkedTeam` calls it. **KOHA's 8 teams backfilled** in the migration. (cshl + test-team-3e demos left unlinked.)

**Commissioner-grants-management UI (`a5936dce`, migration `assign_league_team_manager_rpc`).** LeagueManage Teams tab: each row shows manager status (Unclaimed / ✓ Manager: @handle) + a "+ Manager" / "+ Co-manager" inline form. `assign_league_team_manager(league_id, team_id, user_id)` RPC (SECURITY DEFINER, gated on commissioner + team-in-league) inserts `team_members(role=manager)` + promotes to founder if `manager_id` is NULL; else adds as co-manager (multi-team-manager pattern). `getLeagueTeams` now embeds `manager:profiles!teams_manager_id_fkey`. New lib `src/lib/leagueTeamManagers.js`.

**Email-invite path for team-manager grants (`90f6666d`, migration `team_manager_invites_email_path`).** When the target has no Rinkd account: `create_team_manager_invite` RPC mints a single-use 14-day token; `send-invite` Edge Function (v10, new `team_manager_invite` type) emails a magic link to `/accept-team-invite?token=…`. New `AcceptTeamInvite.js` page: signed-out → bounce to `/login?returnTo` (token survives); signed-in → `accept_team_manager_invite(token)` validates token (exists/unconsumed/unexpired/**email matches**) + grants. Both RPCs SECURITY DEFINER.

**Join-request flow review + fixes (`434ad328`).** Found: unclaimed teams (KOHA) couldn't have join requests actioned — no manager existed + commissioner had no RLS path. The live Howitzer→Cemented request was stuck. Added `is_league_commissioner_of_team(team_id, user_id)` helper; broadened `team_join_requests` read+update + `team_members` insert RLS to OR it in. Rewrote `notify_team_manager_on_join_request` to fan out to ALL managers + ALL league commissioners (was `LIMIT 1`), deduped, with locked search_path. `Team.js` now hydrates `joinRequested` from the DB on mount (was reload-resets-to-fresh-button).

**Team-roster loop closed (`01894320`, migration `notify_requester_on_join_decision`).** (a) New AFTER UPDATE trigger fires a notification to the REQUESTER on approve ("You've been added to X. Welcome to the roster.") or deny. Two new notification kinds registered in `KIND_META`. (b) `TeamManage.handleAddMember` now fires the `team_invite` email when a manager adds a player by email with no matching account — the existing `link_invited_player` auth trigger auto-fills `user_id` + flips status active on signup, so the email just motivates the signup.

### May 20, 2026 — Pricing model locked: per-season / per-event ladders. BIZ-TIER-1 SUPERSEDED.

Pete delivered a clean pricing guide (`docs/Rinkd_Pricing_Guide.docx`) that **replaces the May 17 BIZ-TIER-1 BenchBoss-arrangement model**. The new structure is simpler, easier to communicate, easier to bill, and aligns cleanly with the activation gate's binary toggle (one tier choice per activation event).

**Leagues — per-season fee, all features unlocked:**
| Tier | Teams | $/season |
|---|---|---|
| Starter | ≤6 | $299 |
| **Standard** ⭐ most popular | ≤12 | $599 |
| Pro | ≤20 | $999 |
| Division add-on | +1 division | +$99 |

**Tournaments — per-event fee:**
| Tier | Teams | $/event |
|---|---|---|
| Small | ≤8 | $149 |
| Standard | ≤16 | $299 |
| Large | ≤24 | $499 |
| Premier | 25+ | $799 |

**Cross-sell:**
- Year 1: first tournament FREE with any active league plan.
- Year 2+: 15% off all tournaments for active league members.

**Registration (when LA-1 / TOURN-REG-1 ship):**
- Platform fee: **1%** (down from the old 1.5-2% in BIZ-TIER-1).
- Payment processing: 2.9% + $0.30, **passed through at cost to the registrant at checkout** — no organizer absorption, no Rinkd markup. (Reverses the May 17 decision where organizer absorbed Stripe fees.)

**What this changes vs the old model:**
1. **BIZ-TIER-1 is dead.** Old "Community / Organizer-pays / Pass-through / Pro" framework superseded — see updated row in §7.
2. **Registration math shifted** — 1% platform fee, registrant absorbs Stripe.
3. **Activation gate maps cleanly to a tier** — each `is_activated=true` flip is implicitly a "Pete picked a tier at billing time" event. Currently the admin UI is binary; tier enforcement (team caps, upgrade prompts) is a Sprint-2 follow-up — defer until the first paying customer.
4. **BLPA Cleveland is explicitly OUT of this ladder.** Stays as a custom deal Pete is still negotiating; BIZ-BLPA-1 row updated to reflect "TBD custom contract".

**No code changes from this update** — pure docs + pricing alignment. The activation gate already exists; tier-enforcement build comes later.

### May 20, 2026 (continued) — Pre-pilot scale / reliability / security audit + fixes

Ran a full scale/cost/reliability pass (two code-audit agents over the data layer + Edge Functions, plus Supabase perf + security advisors and table-size checks). **Headline: the foundation is solid and nothing is breaking at scale** — both advisors are 0-ERROR; the largest table is `analytics_events` at 500 rows; feed pagination + embedded selects are already in place; push fanout is parallel + per-recipient isolated; ScorerView's write path is clean; email crons are idempotent via ledger tables. Five commits shipped straight to main + 2 Edge Function deploys + 1 migration. HEAD `ff792c5d`.

**🔴 Security — `submit-scoresheet` Edge Function hardened (`b52cb60c` + `ff792c5d`, deployed v8).** It ran on service-role but never verified the caller and took the recipient `manager_emails` straight from the request body — so any authenticated user could make `hello@rinkd.app` email an arbitrary PDF attachment to arbitrary addresses (domain-reputation abuse) and overwrite `scoresheet_url` on any game (tampering). Now: caller identified from JWT (`getUser(token)`); authorized for the specific game via assigned `scorekeeper_id` OR `is_tournament_director` / `is_league_commissioner` OR an assigned role-scorer (`tournament_roles`/`league_roles`) — a faithful mirror of the `games_update`/`league_games_update` RLS; recipients resolved server-side from the game's own teams (`tournament_teams.contact_email` / `league_teams`→`teams.manager_id`→`profiles.email`); body emails ignored. **⚠️ The happy path was NOT tested end-to-end** (couldn't mint a real director session JWT from Claude Code) — see the new §12 pre-pilot checklist item. Unauthorized path fails closed.

**🟠 Perf — live-standings reload debounced (`dcb0afc6`).** `Tournament.js` + `League.js` re-ran the entire page load (incl. the standings view recompute) on every realtime `games`/`league_games` change — so each goal tap by any scorer triggered a full reload for every spectator with the page open. Now coalesced into one reload per ~1.5s window. Same fix on both pages.

**🟢 Perf — Profile page (`4e35d21d`).** Collapsed a ~6-call serial-await waterfall into one `Promise.all`; capped the previously-unbounded `posts SELECT *` at 50.

**🟢 Auth default (`9b50a41f`).** Cold landing traffic now opens the auth screen on signup instead of login (Landing passes `defaultMode="signup"`); `/login` still opens on login for returning-user intent (bookmarks, "sign in" links, `returnTo` invite flows). Motivated by the May 20 traffic review: all 12 auth-screen sessions that day opened in login mode and 7 bounced without typing.

**🟢 Observability (`b52cb60c`).** `send-recap-push` (v3) now logs non-410/404 push delivery failures with context (were silently swallowed); `submit-scoresheet` surfaces Resend email failures instead of reporting `success`.

**🟢 Security hygiene — migration `lock_search_path_on_legacy_functions`.** Locked `search_path` on the 20 functions the advisor flagged `function_search_path_mutable` (incl. trigger functions like `bump_post_like_count`, `link_invited_player`, `notify_*`) — closes the search-path-hijack class the §9 trigger lesson warns about. 20/20 verified locked. All `public` except `mark_all_notifications_read` (`public, auth`).

**Deferred (not pilot-blocking, by decision):** `send-game-reminders` sequential email loop (only bites at ~100+ emails/hour); retry logic on web-push/email (crons self-heal); 100 `multiple_permissive_policies` advisor WARNs (behavior-affecting cleanup — do deliberately, read each cluster); 4 unindexed FKs on `team_manager_invites` (trivial); leaked-password protection toggle (HaveIBeenPwned — paid tier, Pete deferring until volume). The 33 `unused_index` INFO are expected at this data size — don't drop them, they're forward-looking.

### May 21, 2026 — GS-7 shipped (iOS PWA install banner); GS-3 held

**GS-7 — iOS PWA install banner (`1efb2124`).** iOS Safari only delivers web push once the PWA is installed to the home screen (16.4+), so push reach on iPhone was ≈0. New `src/components/IOSInstallBanner.js` (mounted in `Layout.js`) self-gates to iOS Safari that hasn't installed — renders `null` for Android/desktop/installed/iOS-Chrome, so zero blast radius elsewhere. Auto-shows on the 3rd app-open (per-session visit counter in localStorage) and immediately on a `rinkd:ios-install-prompt` event, which `Tournament.js handleFollowToggle` now dispatches when a user taps Follow and push is blocked — replacing the old dead-end "enable from Profile" alert (which couldn't work pre-install on iOS anyway). Dismiss hides it 14 days. Analytics: `ios_install_banner_shown {trigger}` / `ios_install_banner_dismissed`. Detection extracted to `src/lib/platform.js` (`detectPlatform` / `detectStandalone` / `iosCanInstallButHasnt`) as the canonical source for new code; the inline copies in `InstallButton.js` / `DownloadCTA.js` left untouched. **Improvement over the parity spec:** gated to iOS *Safari* only (the spec used a naive `/iphone/` UA test) — iOS Chrome/Firefox can't "Add to Home Screen", so prompting them would be wrong. **⚠️ Not browser-tested** — an iOS-only banner doesn't render on desktop; needs one real-iPhone eyeball (open in Safari → tap Follow → confirm it slides up above the nav) before relying on it. Additive + dismissible, so low risk.

**GS-3 — in-app game clock: HELD (not building).** Pete declined May 21. There's no data feed from arena scoreclock hardware (Daktronics/OES/etc.), so any in-app clock — GS-3, GameSheet's, anyone's — is an independent software clock the scorer runs manually. It can't track the real board (a hockey clock stops on every whistle; a scorer can't mirror that while recording events), so it drifts by minutes. A confident-but-wrong pre-filled `time_in_period` on the official record is worse than an empty field the scorer fills by glancing at the board. Revisit only if a venue staffs ONE person doing both scoreclock + scoresheet (then the app clock could *be* their clock). Captured in memory `feature-judgment-correctness-over-convenience`.

**Tape-job font on headers + wordmark (`f96c6d14`, `909d84d9`, `086cde2e`).** Pete's hand-made "tape job" alphabet specimen (`~/Downloads/Tapejob_font.png` — A–Z uppercase, white athletic tape on black) sliced into 26 transparent glyph PNGs in `public/tapejob/` (grid auto-detected by pixel projection via Pillow, tight-cropped, black→alpha with the woven texture preserved). New `src/components/TapeText.js` renders any string from those glyphs: keeps the real text as `aria-label` (accessible + SEO-indexable; the `<img>`s are `aria-hidden`), upper-cases input, gaps spaces, and falls back to condensed Barlow for digits/punctuation (only A–Z glyphs exist). Applied to the **static section headers**: Feed (CHIRPS), Teams, Notifications, Tournaments, Leagues, Discover, Store. Composed a tape **RINKD wordmark** (`public/rinkd-wordmark-tape.png`) and pointed both wordmark refs at it — the `RinkdLogo` lockup (desktop sidebar + mobile top bar) and the `Wordmark` component (Auth / Landing / ResetPassword heroes) — plus the landing-page three-up brand strip and the survey page header (both hardcoded the old `/rinkd-wordmark.png` directly, bypassing the components). **Scope decisions:** Profile's header is the user's *dynamic* name → left in the regular font; **Rinkside skipped** (it has its own dedicated logo image, a sub-brand mark, not a text title); **SEO `og:image` deliberately left on `/rinkd-wordmark-large.png`** — a transparent white wordmark would disappear on light social-share backgrounds (wants a proper opaque 1200×630 card, separate task). Old `/rinkd-wordmark.png` + `/rinkd-wordmark-large.png` are now unused but kept (easy revert). **To add a new tape header:** `import TapeText`, wrap a short uppercase string, pass `height` (px) — only ever scale DOWN from the ~200px source art. **⚠️ Verify on a real screen** — esp. the Auth 140px hero (source art ~200px tall, so it may look slightly soft at that size; the grungy texture mostly hides it). Verified the glyph cutouts + header sizing via render previews during the build; the live in-app render still wants an eyeball.

**Event-page view tracking fixed (`5ec7067c`).** `tournament_public_view` / `league_public_view` had recorded **zero** since they shipped May 20 — they fired only inside the anon `PublicTournamentLanding` / `PublicLeagueLanding` branch (`!currentUser`), but every real viewer (commissioner, team managers, signed-up fans) is logged in and never hits that branch. Moved the view event up to the top-level page component (`TournamentPage` / `LeaguePage`) so it fires for **every** visitor, now tagged with `{ anonymous: true|false }` (ref-guarded, once per page load). Total event-page interest is finally measurable; filter `anonymous=true` for share-driven/cold traffic. Rows should start accumulating once redeployed (gut-check in a day).

**Auth signup-default verified live (`9b50a41f`, shipped May 20).** May 21 traffic check: every auth-screen session that day opened in **signup** mode (vs 12 of 13 in *login* the day before) — confirms the cold-traffic login-wall fix is working in prod. Conversion lift still TBD (sample too small + half-day). `login_failed` holding at ~0/day, so the Turnstile login fix remains stable.

**`/pricing` page shipped (`73fea303`).** Public `/pricing` page (anon-shareable + Google-indexable, standalone like `/survey`) rendering the locked ladders from `docs/Rinkd_Pricing_Guide.docx`: league tiers ($299/$599/$999 + $99 division add-on), tournament tiers ($149/$299/$499/$799), the league-member cross-sell (Yr1 free / Yr2+ 15% off), and the 1% registration fee. Tape "PRICING" header. BLPA intentionally absent (custom deal). Wired into the organizer conversion path — **NOT a nav tab** (seller-facing, low-frequency): "See pricing" links on the Run-your-league / Host-your-tournament banners (`League.js` Info tab + `PublicTournamentLanding`), the Activation-pending banners (`TournamentManage` / `LeagueManage`), and a low-key row in `MoreDrawer`. New `src/pages/Pricing.js` + public route in `App.js`. No tier-enforcement dependency — pure marketing asset. ⚠️ Not visually verified from Claude Code — wants a desktop + mobile eyeball.

**⚠️ Known flow gap (change-later, Pete May 21):** the pricing-page CTAs route into the **free** create wizard (`/league/create` / `/tournament/create`) — there is no payment step, because today's model is create-free → configure → email `hello@rinkd.app` → Pete manually flips `is_activated` after out-of-band payment. Someone arriving via the pricing page has high purchase intent, so once Stripe ships (BIZ-INFRA-1 / LA-1 / TOURN-REG-1) the pricing CTAs should route into **checkout first**, not the bare wizard. Don't leave the free-wizard flow once payments exist. See memory `pricing-flow-needs-payment-gating` + the §7 revenue note. Until Stripe lands, the free flow stands.

**Store rebuilt as a native gear shop + Pure Hockey affiliate started (`607bd94e` + `587ec7e9`).** Store moved back into the More drawer (was dropped in the Complexity Diet) and `/store` rebuilt from a new `public.products` table (migration `create_products_table_for_store`) into a native Rinkd-design gear shop. **Two product sources** (`products.source`): **`pure_hockey`** — affiliate gear via AvantLink (Pure Hockey merchant), **DENIED by AvantLink May 22** (App **1601413**; generic "website/affiliate model not a fit" — typical first-pass rejection for a new low-traffic site; paths back: merchant-vouch or reapply with traction) — and **`rinkd_merch`** — Rinkd-branded merch (Printful fulfillment), **DEFERRED until Stripe (Pete, May 21)**: the manual external-link-out path felt clunky, so the target is **native checkout on Rinkd** (Printful API + Stripe), folded into the BIZ-INFRA-1/Stripe build — the "Rinkd Merch" section stays empty until then. **Decisions (Pete May 21):** feed-SYNC into our DB / CURATED collections / start CONSERVATIVE (Store page only; profile/team/Rinkside surfacing is Phase 2). Built + live: `products` table (public-read RLS `products_select_active`, no client write policies → service-role/admin only, upsert key `(source, external_id)`), `src/lib/products.js`, rebuilt `src/pages/Store.js` (Rinkd-design cards, curated collection sections, affiliate click-out `rel="sponsored"` new-tab, **FTC affiliate disclosure**, "Pro Shop dropping soon" state), `store_view` + `store_product_click` analytics. **Scaffolded, NOT deployed:** `supabase/functions/sync-avantlink-products/index.ts` (fetch feed → upsert; returns `skipped` until `AVANTLINK_FEED_URL` set). **If Pure Hockey unblocks (merchant vouch or reapply):** get our affiliate/website ID + Pure Hockey merchant ID + the datafeed URL/format, fill the feed mapping (illustrative TODO now), set the secret, deploy + schedule a daily cron. **Rinkd merch is parked until Stripe** — build it as native Printful+Stripe checkout, not the manual link-out. Full playbook in memory `store-pure-hockey-affiliate`. ⚠️ Store page wants a visual eyeball.

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
| GS-3 | **In-app game clock** — counts down period length, auto-pre-fills `time_in_period` on goal/penalty save | **⏸️ HELD May 21, 2026** | — | **Not building.** No arena-scoreboard sync exists, so a manual app clock drifts by minutes → confident-but-wrong timestamps on the official record (worse than an empty field). Revisit only if a venue staffs ONE person for clock+scoresheet. See §5 May 21 entry + memory `feature-judgment-correctness-over-convenience`. |
| GS-4 | **Referee tracking** — assign refs per game, post-tournament ref analytics (penalties called, misconducts) | **P2** | 2-3 days | New `referees` + `game_referees` tables; optional `game_penalties.referee_id` FK. Pre-game ref assignment UI. Per-ref stats from existing penalty joins. |
| GS-5 | **Roster / lineup validation** — jersey# → player_id resolver + pre-game eligibility check against active suspensions | **P3** | 3-4 days after ChillerStats import | **Gated on the same `players` table backfill the leaderboard depends on** (see "Still gated on populating `players`" below). Once unblocked, gives "✓ Rosters verified" badge on game pages. |
| GS-6 | **Embed widgets** — `/embed/tournament/:id/standings` + `/schedule` iframes for league/club websites | **P3** | 1-2 days | Two new no-auth routes outside ProtectedRoute. 30s polling (not realtime — iframes drop WebSockets). LeagueApps gap LA-8 below shares this architecture; build both at once. |
| ~~GS-7~~ | **iOS PWA install banner** | ~~P1~~ | — | ✅ **SHIPPED May 21, 2026 (`1efb2124`)** — `IOSInstallBanner` in `Layout.js`, gated to iOS Safari, 3rd-open + Follow-tap triggers. See §5 May 21 entry. ⚠️ Needs a real-iPhone eyeball (untested on device). |

### League engine — tournament parity build (Phase 1 ✅ SHIPPED May 19 evening, Phases 2 + 3 queued)

**Pete asked May 19 evening for the league flow to mirror tournaments + add league-specific features (start/end dates, separate playoff bracket, games-per-day, days-of-week multi-select, target-games-per-team auto-compute schedule).** Comprehensive gap analysis run + plan locked in. Decisions captured: playoff data model is `league_games.phase` column (NOT a separate table); cadence is ship-Phase-1-then-iterate (not big-bang); role model mirrors tournaments exactly (founder + additional commissioners + scorers); schedule generator UX is Option B (commissioner picks "30 games per team", system computes meetings + spread).

**Phase 1 build doc:** **`~/Downloads/rinkd_v4/LEAGUE_PARITY_PHASE_1_BUILD.md`** — self-contained build plan. **DONE** — see the "May 19 evening (continued)" §5 entry above for the shipped detail.

**Phase 1 — ✅ SHIPPED** (pending Pete's merge of `claude/laughing-nightingale-10d576`):
- ✅ Migration `leagues_add_dates_venue_accent_logo_url` — 6 new columns + 2 partial indexes.
- ✅ Migration `league_roles_table_and_is_league_commissioner_helper` — multi-commissioner support with founder-protection clause; helper function mirrors `is_tournament_director` / `is_team_manager`; `league_games` + `leagues` RLS broadened to use the helper.
- ✅ New `src/lib/leagueCommissioners.js` + `src/lib/leagueScorers.js`. `src/lib/leagues.js` extensions: `createLeague` accepts the new columns; `getUserLeagueRole` checks `league_roles` too.
- ✅ New `src/pages/LeagueCreate.js` — full 4-step wizard with cleanup-on-failure, batch team insert, mirror of TournamentCreate.
- ✅ Build clean, advisor pass clean (0 ERROR-level), 6 RLS smoke tests pass.

**Phase 2 — ✅ SHIPPED** (pending Pete's merge of `claude/laughing-nightingale-10d576`, same branch as Phase 1):
- ✅ Migration `posts_add_league_id_for_league_scoped_feed` — column + partial index.
- ✅ Migration `league_subscriptions_table_for_push_targeting` — table + RLS (self-scoped) + reverse-lookup index.
- ✅ New `src/lib/leagueSubscriptions.js`, extended `src/lib/posts.js` (3 functions touched + 1 new), extended `src/lib/push.js` (1 new function).
- ✅ Edge Function `send-league-recap-push` deployed (v1, ACTIVE, JWT enforced).
- ✅ `League.js` refactored: anon gate, inline `PublicLeagueLanding`, Feed tab + composer + recap renderer, Follow button + push subscribe flow, multi-commissioner check.
- ✅ `App.js` — `/league/:id` + `/leagues` opened to anon (mirror of May 16 tournament pattern).
- ✅ `ScorerView.js` finalize path now fires `createGameRecapPost({ leagueId })` + `triggerLeagueRecapPush(postId)` for league games.
- ✅ Build clean, advisor pass clean (0 ERROR-level), 6 RLS spot-checks pass.

**Phase 3a — ✅ SHIPPED** (pending Pete's merge of `claude/laughing-nightingale-10d576`, same branch as Phase 1 + Phase 2):
- ✅ Migration `league_games_add_phase_for_playoffs` — column + check constraint + composite index. 42 existing rows backfilled.
- ✅ `league_standings` view rebuilt with `WHERE phase = 'regular_season'` (security_invoker=on preserved).
- ✅ New `src/lib/leagueScheduleGenerator.js` — `computeScheduleShape`, `buildSlotTimeline`, `generateLeagueSchedule`. Pure functions; commissioner-friendly target-games math (Option B per Pete May 19); home/away flips on alternating meetings.
- ✅ `src/lib/scheduleBuilder.js` — `bulkInsertLeagueGames` writes `phase: g.phase || 'regular_season'` so both old and new paths produce tagged rows.
- ✅ `src/pages/LeagueManage.js` — Schedule tab now leads with `SmartScheduleGenerator` inline panel: target games / days-of-week chips / games-per-day / rink / first-puck time / spacing. Live preview re-runs the pure generator on every form change (no DB hit). Two-tap confirm before insert. Existing modal-based "Advanced" wizard kept as secondary path.
- ✅ `src/pages/LeagueCreate.js` — `FORMAT_PRESETS` expanded from 1 to **4 presets**: `classic_league`, `beer_league_no_ties`, `high_school_style`, `youth_short_game`.
- ✅ Build clean (+2.37 kB gz). Advisor 0-ERROR. DB smoke tests pass.

**Phase 3b — ✅ SHIPPED** (pending Pete's merge of `claude/laughing-nightingale-10d576`, same branch as Phase 1 + Phase 2 + Phase 3a):
- ✅ Migration `league_games_add_round_for_playoff_bracket` — `round text` column + partial composite index `(league_id, phase, round) WHERE phase='playoffs'`.
- ✅ New `src/lib/leaguePlayoffGenerator.js` — pure functions: `seedPairs`, `firstRoundLabel`, `generatePlayoffRoundOne`, `generatePlayoffNextRound`. Standard cross-bracket seeding (1v8/4v5/3v6/2v7 etc.); winner-pairing math for round N+1; optional bronze-game checkbox for the post-semis state.
- ✅ `src/pages/LeagueManage.js` — new 'Playoffs' tab. Inline `PlayoffsTab` (~270 lines) with bracket size + scheduling form + live preview + standings seeding card + current-bracket display grouped by round.
- ✅ Discovered + worked around structural constraint: `league_games.home_team_id`/`away_team_id` are NOT NULL (unlike tournament games), so the generator emits one round at a time with real teams — no TBD placeholders. Commissioner re-runs after each round to seed the next.
- ✅ Build clean (+3.5 kB gz). Advisor 0-ERROR. DB smoke pass.

**Phase 3 — ✅ COMPLETE.** All four pieces from the original Phase 3 spec shipped (`league_games.phase`, smart scheduler, playoff bracket UI, more presets).

**Deferred polish (post-pilot backlog, not pilot-blocking):**
- Per-rink balancing in the smart scheduler (today: single-rink; commissioners run separately per rink + interleave).
- Smart-schedule batch edit (today: per-game inline edit works fine).
- Phase selector on the manual "Add Single Game" form (today: rare edge case; SQL).
- 6-team bracket with byes (today: 2/4/8 only).
- Bracket auto-fill on game finalize (today: commissioner re-runs the generator after each round finalizes).

Total program effort: Phase 1 ~1 day, Phase 2 ~1 day, Phase 3a ~0.5 day, Phase 3b ~0.5 day — **~3 days actual vs the original 10-14 day estimate.** Done.

### League engine — LeagueApps parity (post-pilot)

Spec'd in **`rinkd_v4/LEAGUEAPPS_PARITY_GAPS.md`** (May 17). 8 gaps for the league-management surface (vs the tournament surface above). Per the spec doc: BLPA Cleveland is tournaments, **none of these are pilot-blocking**. First milestone after Cleveland per the doc: LA-1 (Stripe registration) + LA-2 (Waivers). Everything else is table stakes after that. **Note (May 19):** the tournament-parity build above (`LEAGUE_PARITY_PHASE_1_BUILD.md`) is a separate workstream from these LeagueApps-parity items — the parity build is foundational UX/scheduling, while these LA-* items are commercial features (Stripe, waivers, eligibility). The parity build should ship FIRST since it unblocks the entire league surface.

| # | Gap | Priority | Effort | Notes |
|---|---|---|---|---|
| LA-1 | **Stripe registration + payments** — teams register + pay season fees self-service; commissioner sees real-time registration + collection. **1% platform fee** to Rinkd; Stripe 2.9% + $0.30 **passed through to the registrant at checkout** (same math as TOURN-REG-1 per May 20 pricing guide). | **P0** post-pilot | 5-8 days | New `league_registrations` table; columns on `leagues` for fee + deadline + capacity. New `LeagueRegister` public page. New `stripe-webhook` Edge Function. New Vercel env `REACT_APP_STRIPE_PUBLISHABLE_KEY`; Supabase secrets `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Unlocks revenue. **Shares core build with TOURN-REG-1** — same Stripe Connect + webhook + Edge Function pattern; consider folding both into one polymorphic `registrations` table keyed by `(parent_type, parent_id)` to avoid duplication. |
| LA-2 | **Digital waivers** — commissioner attaches a waiver to a league; players sign before joining; signatures exportable | **P1** | 3-4 days | New `league_waivers` + `league_waiver_signatures` tables. New `WaiverModal` + standalone sign route `/league/:id/waiver/:waiverId`. Legal protection — pair with LA-1 before opening leagues to public sign-up. |
| LA-3 | **USA Hockey membership validation** — players enter USAH member # at registration; sanctioned leagues require valid active membership | **P1** for sanctioned leagues, **N/A** for BLPA-style rec leagues | 3-5 days | USAH has no public API — sanctioned path requires their bulk-export integration; non-sanctioned path is self-attestation. **Skip unless Rinkd pursues youth/sanctioned leagues.** |
| LA-4 | **Financial reporting** — commissioner dashboard with total collected, outstanding, refunds, Stripe net | **P1** (depends on LA-1) | 2-3 days | No new tables — derives from `league_registrations` + Stripe balance API. New `LeagueManage` → Financials tab. CSV export. |
| LA-5 | **Division eligibility enforcement** — divisions with age/skill rules; ineligible players blocked from rostering; commissioner can grant overrides with audit log | **P2** | 3-4 days | New `league_divisions` + `league_eligibility_overrides` tables; `league_teams.division_id` FK. New `EligibilityGate` wrapper for join flows. |
| LA-6 | **Multi-season management** — one league spans Fall 2025 / Spring 2026 / etc.; archive seasons; historical seasons remain browsable | **P2** | 2-3 days | New `league_seasons` table; `season_id` FK on `league_teams` + `league_games`. Partial unique index enforces one active season per league. Standings filter by season. Legacy rows treat NULL season_id as "pre-season-tracking." |
| LA-7 | **Commissioner analytics** — scoring/penalty leaderboards per league; RSVP fill rate; volunteer fill rate over the season | **P3** | 2-3 days | No schema changes — pure query work. New `getLeagueAnalytics()` helper. New `LeaderboardTable` reusable component. New Analytics tab in `LeagueManage`. |
| LA-8 | **League embed widgets** — `/embed/league/:id/{standings,schedule,leaders}` iframe routes for club websites | **P3** | 2-3 days | Shares architecture with GS-6 above — **build together**. Optional `?theme=&accent=` query params for white-label. |

### KOHA stats parity (hockeypage replacement) — prioritized May 22, 2026

KOHA's implicit first ask: don't make them lose stats vs their old system (hockeypage.com). Pete sent 8 season exports (standings, scoring, goalies, scoring-by-division, penalty frequency, raw penalty log, playoff scoring + goalies — analyzed this session). **Verdict: full parity is achievable with little-to-no schema change — Rinkd already CAPTURES everything; the gaps are reporting surfaces.** Captured today: `game_goals` (scorer + `assist1_number` + `assist2_number`), `game_penalties` (`penalty_type` + duration + period), `game_shots`, `game_goalie_changes`, `league_games.phase` (reg vs playoff).

**Key design rule: within-season leaderboards aggregate by `(team, jersey#)`, names from `team_members.invite_name` — the Phase-1 Stats tab must NOT depend on accounts (most players have none).** ⚠️ **But jersey# is a WITHIN-season key only.** KOHA re-drafts every year — new teams, new numbers — so jersey# does NOT carry a player's stats across seasons. **Cross-season / career stats require a persistent identity = the Rinkd account (Phase 2), AND multi-season support (LA-6, not built) to span league-seasons.** Today each KOHA season is effectively its own `league` row, so per-season scoping falls out naturally; jersey# is fine inside one season, useless across them. (`get_player_league_stats` is per-USER — that's the Phase-2 / career path, not the Phase-1 leaderboard.)

**Phasing (Pete, May 22):**
- **Phase 1 — review-only Stats tab.** New "Stats" tab/section on the **League page** (`League.js`, already anon-public) with jersey-based leaderboards so KOHA can just review via a shared link: skater scoring (G/A/PTS/PIM), goalie stats (GP/GA/GAA/SV%), penalty leaders + by-type, plus standings (already live). No accounts needed.
- **Phase 2 — tie to profiles.** Once players sign up + link to their roster row (`link_invited_player` backfills `user_id`), the same jersey-keyed stats surface on player profiles. No rebuild — accounts attach on top of the jersey aggregation.

**Parity gap list (reporting surfaces to build; ~no schema change):**
1. **Goalie leaderboard (GAA/SV%)** — the long pole: attribute shots-against + goals-against to whichever goalie was in net via the `game_goalie_changes` timeline.
2. **Penalty frequency-by-type + raw-penalty export** — aggregation of `game_penalties` (overlaps LA-7).
3. **Add team PIM to `league_standings`** view; make scoring/goalie leaderboards **phase-aware** (reg vs playoff) + **division-split**.
4. **Verify `get_top_scorers`** is jersey-based + includes A/PIM; extend if not.

Overlaps + extends **LA-7** (commissioner analytics). Post-pilot, KOHA-driven — prioritize once BLPA ships.

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

Spec'd by Pete May 17 + **pricing model locked May 20 via `docs/Rinkd_Pricing_Guide.docx`** (per-size ladder; superseded the old BIZ-TIER-1 4-arrangement model — see the May 20 §5 entry above). Two phases: Phase 1 (0-6 months — Ship Now) and Phase 2 (6-18 months — Build After Cleveland). All revenue items share a foundational dependency on BIZ-INFRA-1 (Stripe Connect platform-fee setup). **Tier enforcement (BIZ-TIER-2) is intentionally post-pilot — don't introduce pricing during Cleveland, ship as Sprint 1 work after.**

> **Pricing-page flow gap (flagged May 21, `73fea303`):** the live `/pricing` page's "Run your league" / "Host your tournament" CTAs currently drop into the **free** create wizard (no payment step) — today's create-free-then-manual-activate model. When this revenue cluster ships (BIZ-INFRA-1 + TOURN-REG-1 + LA-1), route the pricing CTAs into **checkout first** rather than the bare wizard, and retire the manual out-of-band activation for self-serve paid events. See the §5 May 21 entry + memory `pricing-flow-needs-payment-gating`.

**Key pricing decisions captured May 17 (don't re-litigate without explicit Pete review):**
- **Stripe fee absorption:** organizer eats the 2.9% + 30¢ processing fees on every checkout. Standard marketplace practice. Means BLPA gets ~$2,427 of a $2,500 entry fee per team (with $15 BenchBoss + $58 platform fee + Stripe deducted from the $2,515 gross).
- **BenchBoss fee label:** "Technology fee" (not "BenchBoss fee", not "Convenience fee") — softer than naming Rinkd directly, more transparent than vague convenience-fee framing. Standard label teams have seen elsewhere (Ticketmaster-style).
- **Refund policy:** sliding scale — 100% refund >14 days before event, 50% refund 7-14 days out, 0% refund inside 7 days. Technology fee non-refundable once event runs. Industry standard for amateur sports; protects bracket integrity against late dropouts.
- **Crease premium positioning:** kept as a **separate consumer track** (does NOT fold into B2B BenchBoss). Different audience (players + fans), scales independently. MONEY-1 Crease premium remains its own revenue stream alongside BenchBoss/marketplaces; not bundled.

**Phase 1 — Ship Now (0-6 months)**

| # | Item | Priority | Effort | Notes |
|---|---|---|---|---|
| BIZ-INFRA-1 | **Stripe Connect platform-fee setup** — onboard Rinkd as a Stripe platform, configure Connect accounts for tournament organizers + photographers + refs (later), enable platform-fee on every charge | **P0 (revenue track)** | 3-5 days | Foundation under every paid item below. Without this, Rinkd can take checkouts but can't take a cut. New Edge Function for Connect-account onboarding; webhook to mirror payouts to a `stripe_payouts` table for visibility. Organizer eats Stripe processing fees (standard). |
| TOURN-REG-1 | **Tournament registration + 1% platform fee** — teams register + pay entry fee via the tournament public landing; organizer keeps 99%, Rinkd takes **1%** as platform fee. Stripe processing (2.9% + $0.30) is **passed through at cost to the registrant at checkout** — no organizer absorption, no Rinkd markup. (Updated May 20 from the original 1.5-2% + organizer-absorbed model.) | **P0** | shares core build with LA-1 (extends to tournaments) | Reuses `league_registrations` schema pattern → `tournament_registrations` table (or fold into one polymorphic `registrations` table). Webhook updates `paid_at`; auto-approves team into `tournament_teams` on payment. Reference revenue at 1%: $1,000 per Mad Man event @ $100K gross. Pricing canonical in `docs/Rinkd_Pricing_Guide.docx`. |
| BIZ-1 | **Hotel affiliate (Lucid Travel / HotelPlanner)** — generate a hotel block URL per tournament; tracking pixel; 3-5% commission per room booked | **P1 (high ROI / zero engineering)** | 1-2 days | No payment infrastructure needed. New `tournament.hotel_affiliate_url` field; tournament public landing surfaces "Book your hotel" button; UTM-tracked affiliate link. Reference revenue: $300-800 per tournament passive, scales with attendance. **Ship before Stripe Connect even goes live** — doesn't depend on it. |
| BIZ-2 | **Tournament sponsorships** — "presented by" placement on tournament pages, brackets, and recap push notifications | **P1** | 5-7 days | New `tournament_sponsors` table (name, logo, tier, placement, contract dates). UI: sponsor logos on Tournament public page header + Bracket tab + game cards (subtle). Push integration: extend `send-recap-push` payload to include sponsor mention. Sponsorship management UI for organizers. Reference revenue: $200-1,500 per tournament. Revshare split TBD when shipping — historical default: organizer-sold = Rinkd 20-30%; Rinkd-sold-direct = Rinkd 70-80% with 20-30% kickback to organizer. |
| ~~BIZ-TIER-1~~ | **SUPERSEDED May 20, 2026** by the per-size pricing ladder in `docs/Rinkd_Pricing_Guide.docx`. Old "Community / Organizer-pays / Pass-through / Pro" 4-arrangement model dropped — simpler size-tier ladder takes its place (League Starter/Standard/Pro/Division-add-on at $299/$599/$999/$99-add; Tournament Small/Standard/Large/Premier at $149/$299/$499/$799). Year-1 first-tournament-free cross-sell for league plans; Year-2+ 15% off tournaments for active league members. See the May 20 §5 entry above. | — | — | Activation-gate UI is binary today; team-cap + tier enforcement (`tournaments.tier` / `leagues.tier` enum + UPGRADE prompts) is a Sprint-2 follow-up — defer until first paying customer. |
| BIZ-TIER-2 | **Per-size pricing ladder** (replaces BIZ-TIER-1) — League: Starter ≤6 $299, Standard ≤12 $599, Pro ≤20 $999, Division add-on +$99. Tournament: Small ≤8 $149, Standard ≤16 $299, Large ≤24 $499, Premier 25+ $799. All features unlocked at every tier — only the team cap differs. | **P0 post-pilot** (Sprint 1 work after BLPA Cleveland — NOT during pilot) | 3-5 days for tier enforcement build | Add `tier` text column to both tournaments + leagues (CHECK constraint per-shape). Optional `division_count` on leagues for the add-on math. Activation panel gets a tier dropdown next to the toggle. Team-cap enforcement at LeagueManage / TournamentManage when adding teams (warn before exceeding cap, hard block at +1 over). Canonical pricing in `docs/Rinkd_Pricing_Guide.docx`. |
| BIZ-BLPA-1 | **BLPA Cleveland — custom deal, TBD** (May 20). Explicitly OUT of the per-size pricing ladder. Pete is still negotiating the post-pilot arrangement. Original Pass-through model ($15/team Technology fee + 2% on registration) is on the table as one option but no longer the default. Document the final terms here once Pete locks them in. | **P1 post-pilot** | TBD once contract is signed | Hardcode the BLPA tournament(s) to whatever bespoke billing model Pete settles on. Probably a `tournaments.tier='custom'` enum value + bespoke handling rather than fitting into the standard ladder. |

**Phase 2 — Build After Cleveland (6-18 months)**

| # | Item | Priority | Effort | Notes |
|---|---|---|---|---|
| BIZ-3 | **Referee marketplace** — organizers post games needing officials, certified refs claim slots, Rinkd takes 8-12% booking fee | **P2** | 7-10 days (incl. GS-4 dependencies) | Builds on GS-4 (Referee tracking — currently P2 post-Cleveland). GS-4 gives us the `referees` table + per-game assignment; BIZ-3 adds the booking marketplace layer on top (open-slot listings, claim-with-deposit, payout via Stripe Connect, dispute flow). Reference revenue: $15-40 per game slot, 40-team tournament ≈ 30+ games = $450-1,200 per event. Marketplace fee transparency: show % to both sides openly (standard pattern). |
| BIZ-4 | **Photography marketplace** — organizers connect with local sports photographers, 15% booking fee, photos auto-drop into the Feed | **P2** | 5-7 days | Best **social-flywheel** item: photos auto-drop into auto-recap posts = engagement spike per game + photographer earns + organizer pays + spectator gets richer content. All three sides win. New `photographers` + `photography_bookings` tables; Storage bucket for photo uploads with proper RLS; integration into the existing `recap_for_game_id` post flow so the recap post gets a photo gallery attached. Reference revenue: $300-800 per tournament. |
| BIZ-5 | **Tournament insurance partnership** — K&K Insurance or Markel (standard in amateur sports), referral fee per policy issued through Rinkd | **P3** | 1 day build + weeks of partnership outreach | Mostly outreach. Lightweight referral form on the organizer Settings page; UTM-tagged redirect to the insurance partner; insurance partner pays per-issued-policy. Reference revenue: $50-150 referral per tournament, hands-off recurring once signed. |

**Total post-pilot revenue work:** ~30-40 days of build, sequenced across roughly 6 months if shipped serially. **Sprint 1 post-pilot cluster** (highest priority): BIZ-INFRA-1 + TOURN-REG-1 + LA-1 + BIZ-TIER-2 (tier enforcement build) + BIZ-1. BLPA-1 (custom deal) lands separately once Pete locks the contract terms.

**TBD-when-shipping (deferred decisions captured but not blocking):**
- Volume pricing on Organizer-pays tier (flat $25/team vs sliding scale vs per-event cap) — defer to first Operator sales conversation
- Free trial for new Operators (first event free vs 30-day money-back vs none) — defer; experiment when funnel exists
- Pro tier pricing benchmark (target: $5K-15K/year flat) — defer to first Pro sales conversation
- Marketplace fee transparency for BIZ-3 / BIZ-4 (show % to both sides openly = recommended) — decide when building
- Sales tax + 1099-K reporting via Stripe Tax + Stripe Connect — required when crossing $X/year per state; not blocking pilot
- International / multi-currency — defer until non-US tournament interest

#### Entitlements + usage tracking (design — build alongside BIZ-INFRA-1 / TOURN-REG-1 / BIZ-TIER-2)

How we track which package an org bought, the "free tournament with a league plan" cross-sell (so nobody gets a *second* free one), and tier/cap usage once Stripe is live. **`is_activated` stays the RLS gate — it just becomes the OUTPUT of this ledger instead of a manual flip.** Designed May 22 with Pete.

**Three tables:**
- **`purchases`** — immutable record of every Stripe payment (source of truth, written by the webhook): buyer `profile_id`, kind (`league_season` | `tournament_event`), tier, amount, `stripe_payment_intent`/checkout_session, parent (league/tournament id), season, created_at. Only ever mutated to mark refunds.
- **`plans`** — the active grant per league/tournament: owner, parent_type+parent_id, **tier**, **team_cap**, **season**, status (active/expired/refunded), period_start/end, `source_purchase_id`. Drives `is_activated` + the BIZ-TIER-2 team-cap enforcement.
- **`entitlement_credits`** — cross-sell freebies + redemption: owner, type (`free_tournament`), `granted_at`, `expires_at`, **`redeemed_at`** (null until used), `redeemed_on` (tournament id). The "no extra free" guarantee.

**Free-tournament flow:** buy a league season → webhook writes `purchases` + `plans` (league active) + grants **one** `entitlement_credits` row. Creating/activating a tournament checks for an unredeemed, unexpired credit the buyer owns → activate free + stamp `redeemed_at`/`redeemed_on`; else normal paid checkout. A second free tournament is structurally impossible without another qualifying league purchase (redemption flips a single row — not a counter that can be gamed).

**Answers the questions:** *what did they order?* → `plans.tier`/`team_cap`/`season` traced to `purchases`; *free tournament used?* → `entitlement_credits.redeemed_at`; *over team cap?* → team count vs `plans.team_cap`; *Year-2 15% off?* → checkout-time eligibility (active league plan?) → Stripe coupon (an eligibility lookup, not stored usage).

**Two correctness must-dos:**
1. **Webhook idempotency** — process each Stripe event id exactly once (`processed_stripe_events` table / unique constraint on payment_intent). A re-delivered "payment succeeded" would otherwise double-grant the free credit — the #1 "they got more free" bug.
2. **Activation is derived, not manual** — the webhook + credit redemption set `is_activated`; a refund flips it back + expires the plan. Keep the existing RLS gate; just stop flipping it by hand.

**Open decisions (lock before building):**
1. Free tournament **per league plan** or **per customer per year**? (Org runs 2 leagues = 2 free tournaments, or 1?) — drives per-plan vs per-customer credit granting.
2. **Season boundary** — does a season plan auto-expire on a date, or stay active until the season is marked complete? (affects renewals + when Year-2 pricing kicks in).
3. **Credit expiry** — does an unused free tournament expire at season/year end, or carry forever?

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
- **`league_games.phase` for regular-season vs playoffs (May 19 evening, Phase 3a).** `league_games.phase text NOT NULL DEFAULT 'regular_season' CHECK (phase IN ('regular_season','playoffs'))`. Composite index `league_games_league_phase_idx ON (league_id, phase)` covers the standings hot path. The `league_standings` view filters `WHERE phase = 'regular_season'` in both branches of its UNION ALL — playoff games are **structurally invisible** to regular-season standings. **When inserting league games via any path, default to `phase='regular_season'`** — both `bulkInsertLeagueGames` and the schema default already do this. Phase 3b's bracket generator will pass `phase='playoffs'` explicitly. **When recreating the view in the future, preserve `security_invoker=on`** (May 18 lesson — see [[security-definer-views]]).
- **AdminActivations toggle goes through an admin RPC, not direct UPDATE (May 20).** `tournaments`/`leagues` UPDATE RLS gates on founder (`is_tournament_director` / `is_league_commissioner`), NOT site-admin. So a Rinkd admin toggling an event they didn't create silently no-op'd (PostgREST returns 200 on a 0-row UPDATE). The `/admin/activations` page calls `admin_set_activation(p_kind, p_id, p_value)` — SECURITY DEFINER, self-gates on `profiles.is_admin = true`, scoped to the `is_activated` column only. **When building any other admin-only mutation across all orgs, use the same SECURITY-DEFINER-RPC-gated-on-is_admin pattern rather than broadening table RLS.** Also: tournaments have NO `logo_color`/`logo_initials` (only `accent_color` + `logo_url`); leagues have all four. Any code touching both must normalize.
- **League-added teams are real `public.teams` rows (May 20).** A commissioner adding a team in LeagueManage must go through `create_league_team(league_id, name, color, initials, division)` (SECURITY DEFINER, gated on `is_league_commissioner`) — NOT a bare `league_teams` insert. The RPC creates a real `teams` row (`manager_id` NULL = unclaimed, `is_public` true) AND the `league_teams` link in one transaction, so the team is discoverable on `/teams` + can take a manager/roster. The old bare-insert path produced `team_id`-NULL "ghost" rows invisible everywhere but the league. `bulkInsertLeagueGames` + the search-existing-team path are unaffected (they already had real team_ids). **When adding teams to a league programmatically, use the RPC or replicate its two-step.** KOHA's 8 teams were backfilled this way.
- **Commissioner can grant team management + invite by email (May 20).** Two RPCs, both SECURITY DEFINER + gated on `is_league_commissioner` + a team-in-this-league check: `assign_league_team_manager(league_id, team_id, user_id)` (existing account → grant now; promotes to founder if `manager_id` NULL, else co-manager) and `create_team_manager_invite(league_id, team_id, email)` (no account → mint a single-use 14-day token, emailed as a magic link via `send-invite` type `team_manager_invite`). The accept side is `accept_team_manager_invite(token)` (SECURITY DEFINER, bypasses the commissioner gate since the accepter isn't one) which validates token + **enforces email match** before granting. Magic link lands at `/accept-team-invite?token=…` (public route; bounces to `/login?returnTo` if signed out). Lib: `src/lib/leagueTeamManagers.js`. **The email-match check is load-bearing — don't drop it; it's what stops a leaked token from being claimed by the wrong account.**
- **Join requests can be actioned by team managers OR league commissioners (May 20).** `team_join_requests` read+update RLS + `team_members` insert RLS all OR in `is_league_commissioner_of_team(team_id, user_id)` (walks team → league_teams → leagues + league_roles). This is the fallback path for unclaimed teams that have no manager yet. The INSERT-trigger `notify_team_manager_on_join_request` fans out to ALL managers + ALL commissioners (was `LIMIT 1` — missed co-managers + never reached unclaimed-team commissioners). The UPDATE-trigger `notify_requester_on_join_decision` notifies the requester on approve/deny. **Both triggers are SECURITY DEFINER with locked `search_path`** (per the §9 trigger-hijack lesson). `Team.js` hydrates the "Request Sent" button state from the DB on mount — don't revert to client-only state or reloads show the button fresh.
- **Player email invites auto-link on signup (existing, reconfirmed May 20).** `addTeamMember` writes `status='pending'` + `invite_email` when no `user_id`. The `link_invited_player` trigger on `auth.users` INSERT backfills `user_id` + flips `status='active'` by case-insensitive `invite_email` match. `TeamManage.handleAddMember` now ALSO fires the `team_invite` email when adding by email with no existing account. **When adding a roster placeholder, always set `invite_email` so the auto-link can find it.**
- **Stream URL is generic despite the column name (May 20).** `league_games.youtube_url` + `rinks.youtube_url` hold ANY platform URL (YouTube/Twitch/Facebook/Vimeo). `src/lib/streamUrl.js` detects the platform at render time → button label + brand color. Per-game overrides the rink default (`resolveStreamUrl`). Tournament `games` does NOT have this column (mirrors the `live_barn_venue_id` distribution — leagues only). To extend to tournaments later, add the column + reuse the lib.
- **Funnel events (May 20).** `auth_view {mode}`, `auth_first_input {mode,field}`, `signup_step_advanced {from,to}`, `forgot_password_clicked`, `tournament_public_view {tournament_id}`, `league_public_view {league_id}` join the existing `landing_view` / `signup_success` etc. Key gotcha for analysis: shared tournament/league URLs fire `*_public_view` and NEVER `landing_view`, so a chunk of real top-of-funnel bypasses the landing page entirely — count both when measuring acquisition. **Updated May 21 (`5ec7067c`):** `tournament_public_view` / `league_public_view` now fire for ALL viewers (logged-in included), not just anon, and carry `{ anonymous: true|false }` — filter `anonymous=true` for the share-driven/cold subset. Before May 21 they were anon-only and recorded **zero**, because every real viewer of an event page is logged in and never hit the anon `PublicLanding` branch. **`ios_install_banner_shown {trigger}` / `ios_install_banner_dismissed`** also joined the set May 21 (GS-7).
- **DatePicker parses date-only strings as LOCAL midnight (May 20).** `parseLocalDate` in `src/components/DatePicker.js` builds `new Date(y, m-1, d)` for `YYYY-MM-DD` (was `new Date(str)` = UTC midnight = previous day in Eastern). Any new date-only round-trip should go through the component, not raw `new Date()`.
- **Activation gate (May 19 evening, monetization switch).** `tournaments.is_activated` + `leagues.is_activated` are `boolean NOT NULL DEFAULT false`. Both backfilled to `true` at migration time so nothing in flight broke. **The gate is at the RLS layer (hard, unbypassable):** `games_director_update`, `games_scorer_update`, `league_games_update`, `game_goals_insert_requires_activated`, `game_penalties_insert_requires_activated` all AND in `EXISTS parent WHERE is_activated = true`. Both push Edge Functions (`send-recap-push` v2, `send-league-recap-push` v2) also refuse to fanout when `is_activated=false` — defense-in-depth, not security. Admin toggle lives at `/admin/activations` (gated by `profiles.is_admin = true` via `useIsRinkdAdmin`). UX banners (header pill on Tournament/League, yellow callout on Manage, full-page wall in ScorerView) surface the state — they don't enforce it. **When adding new scoring-flavored write paths, default to ANDing in the same activation EXISTS check.** Reschedule / rink change / location edit / status='scheduled' tweaks all flow through `games`/`league_games` UPDATE and are currently also gated — accept this as a feature, not a bug (organizer "configures everything" pre-activation but can't sneak scoring in; minor tradeoff is they can't tweak start_time post-publish without activation, which is usually fine since they activate before going live).
- **Playoff bracket pattern for leagues (May 19 evening, Phase 3b).** Because `league_games.home_team_id`/`away_team_id` are **NOT NULL** (vs tournament `games` which permits TBD placeholders), the bracket generator in `src/lib/leaguePlayoffGenerator.js` emits **one round at a time with real teams** — never placeholder rounds. Flow: commissioner generates round 1 from `league_standings` (top N teams, standard 1v8/4v5/3v6/2v7 seeding); after that round is fully `status='final'`, the Playoffs tab pre-fills round 2 from the winners (and optionally a bronze game pairing the semi losers); repeat until the final lands. Round labels are free-form text — `'quarterfinal' | 'semifinal' | 'final' | 'bronze'` are the canonical values; no DB CHECK, so a Phase 4 play-in or third-place pattern can land without schema work. **When generating a next-round game, validate the previous round is fully final + no ties — return `incomplete_winners` cleanly instead of inserting bad data.** Both generators (`generatePlayoffRoundOne` + `generatePlayoffNextRound`) tag every row with `phase='playoffs'` so the standings view filters them out structurally.
- **Smart schedule generator pattern (May 19 evening, Phase 3a).** `src/lib/leagueScheduleGenerator.js` is **pure** (no DB calls) so the LeagueManage UI can render a live preview by re-running it on every form change. The DB write happens via the existing `bulkInsertLeagueGames` from `src/lib/scheduleBuilder.js` — the generator just returns proposed `{home_team_id, away_team_id, start_time, rink_id, status, phase}` rows for the caller to insert. **When adding new schedule-flavored UIs**, follow the same separation: pure generator → caller does the insert. Avoid coupling the math to Supabase. The home/away flip on alternating meetings means a team that hosted opponent X in meeting 1 visits X in meeting 2 — preserves fairness across multiple round-robins; don't undo this without thinking through the implications.
- **League-scoped feed + push pipeline (May 19 evening, Phase 2).** Direct mirror of the tournament-scoped feed (commit `4ec187c4`, May 18). `posts.league_id` is nullable: `NULL` = global/other-scope post, `NOT NULL` = scoped to the referenced league's Feed tab and filtered OUT of global/following feeds. `getPosts` + `getFollowingPosts` apply `.is('league_id', null)` alongside the existing `.is('tournament_id', null)` filter. The partial index `posts_league_id_created_at_idx` only covers rows where `league_id IS NOT NULL`. `createGameRecapPost` accepts both `tournamentId` and `leagueId` — exactly one is expected to be set; the column for the other side stays NULL. Push targeting goes through `league_subscriptions` (PK `(user_id, league_id)`) + the `send-league-recap-push` Edge Function (mirror of `send-recap-push`; same don't-trust-the-client architecture — client hands over a `post_id`, function walks `posts → league_games → leagues → league_subscriptions → push_subscriptions` under service role). Follow button on `/league/:id` is hidden for the commissioner (they're already seeing events from their own writes) — to smoke-test push as a non-commissioner, use a second account. **When adding any new feed-style query, decide which surface it serves and apply the matching filter** — global/following must filter NULL for BOTH `tournament_id` and `league_id`.
- **`/league/:id` and `/leagues` are anonymous-friendly (May 19 evening, Phase 2).** Both routes were dropped from `ProtectedRoute` so anon spectators can land on `PublicLeagueLanding` (rendered inside `League.js` when `!currentUser`). Mirror of the May 16 tournament pattern. RLS already allowed anon SELECT on `leagues` (is_public=true), `league_teams` (qual=true), `league_games` (qual=true), and `rinks` (qual=true), so no DB changes were needed. Live data (composer, Follow button, scorer affordances, Manage) all stay gated inside the `currentUser` branch. **When adding new league-detail features, default to gating them inside the `currentUser` branch unless they're explicitly safe to expose anonymously** — same rule as the tournament side.
- **Multi-commissioner permission model for leagues (May 19 evening, Phase 1).** Direct mirror of the multi-director (tournaments) + multi-manager (teams) patterns. `leagues.commissioner_id` is the founding commissioner — IMMUTABLE. Additional commissioners live in `league_roles` with `role='commissioner'`. DB-level source of truth: `is_league_commissioner(p_league_id, p_user_id)` (`STABLE SECURITY DEFINER` with `set search_path = public, auth`). All league-related RLS policies that gate by "is commissioner" use this helper — `leagues` UPDATE, `league_roles` SELECT/INSERT/DELETE, `league_games` INSERT/UPDATE/DELETE. The `league_games_update` policy preserves the legacy `scorekeeper_id = auth.uid()` path AND adds an `EXISTS league_roles WHERE role='scorer'` path — both routes work. RLS protects the founder's row from deletion via `not exists (... where l.commissioner_id = lr.user_id AND lr.role='commissioner')` — don't fight this; league transfer/destruction should go through different surfaces. **When adding any new league-gated UI, check via `getUserLeagueRole` or `isExtraCommissioner` (from `src/lib/leagueCommissioners.js`), not raw `league.commissioner_id`.** The `addCommissionerByInput` path is account-required (no email-invite) — commissioners have powerful permissions, we don't want to grant them to an unverified email address. Scorers (`addScorerByInput` in `src/lib/leagueScorers.js`) DO have an email-invite fallback path because their privilege is bounded to "score games on this league". **NOTE:** the helper function carries the same anon/authenticated `executable_security_definer` advisor WARN as `is_tournament_director` — same trade-off, same accepted state.
- **CSHL personal tracker is a "from the stands" use of the league surface (May 19 afternoon).** League `2f65dd9f-5c4a-4b58-9819-16a7c7bd84f6` (CSHL 10U Squirts 2026-27), team `d18e023c-354f-4d3b-b5a0-82574f05377d` (Shaker Heights Red Raiders), Pete as commissioner + manager. Henry Hessell #17 lives as a `team_members` roster row with `invite_name = 'Henry Hessell'` and `user_id = NULL` (COPPA — minors can't have Rinkd accounts; 13+ floor). CSHL is hosted on **Crossbar**; their public site exposes division standings at `/standings/show/<id>` and team stats at `/stats/division_instance/<id>` but renders client-side so WebFetch can't read it — Chrome MCP or manual paste is the import path when the 2026-27 schedule lands (expected mid-summer). The `leagues.settings` JSONB carries `source_org` + `source_url` + a `notes` string explaining the personal-tracker framing.

---

## 10. First thing to do in a new session

1. Read this doc top to bottom — **especially §13 (operational artifacts) which tells you what files/tools exist outside this doc**, then §5 (recent shipped work — most recent entries first), §7 (forward roadmap), §12 (pilot-readiness audit), and §9 (working notes — invariants you'll regret missing).
2. Run `cd ~/Downloads/rinkd_live && git log --oneline -10 && git status` to confirm state matches §4.
   - Expected `origin/main` HEAD: **`8f70aa31`** or later (`docs: AvantLink denied Pure Hockey` + small store/icon/copy commits since). If later, read the new commits. Working tree should be clean except the two long-standing strays (`scripts/chiller/data/seed-leagues.json`, `supabase/functions/send-onboarding-emails/index.ts`) — leave them.
   - Confirm BLPA Cleveland is seeded + active: `select name, start_date, end_date, status, is_activated, settings->>'venue_name' from public.tournaments where id = 'b2789d66-1d77-4a62-862d-00b550da6a98'` → `BLPA Cleveland · 2026-06-13 · 2026-06-14 · active · is_activated=true · Brunswick Auto Mart Arena (BAM)`. 8 teams, 12 pool games.
   - Confirm the league engine is live: `select proname from pg_proc where proname in ('is_league_commissioner','is_league_commissioner_of_team','create_league_team','assign_league_team_manager','admin_set_activation','accept_team_manager_invite')` should return all 6. `select count(*) from information_schema.columns where table_name in ('leagues','tournaments') and column_name='is_activated'` should return 2.
   - Confirm KOHA (first real external league): `select name, is_activated from public.leagues where name ilike '%kanata%'` → activated; its 8 teams now have real `public.teams` rows (`select count(*) from public.league_teams lt join public.teams t on t.id=lt.team_id where lt.league_id=(select id from leagues where name ilike '%kanata%')` = 8).
   - Confirm Edge Functions: `list_edge_functions` shows `send-recap-push` (v2), `send-league-recap-push` (v2), `send-invite` (v10) all ACTIVE + verify_jwt true.
   - Turnstile gates ALL auth endpoints (signup/login/recover) — the widget renders on all three forms as of May 20.
3. Ask Pete:
   - KOHA onboarding status — are the 8 team managers assigned/invited? Is their schedule loaded (they have the smart generator + per-game YouTube links available)? Is the Howitzer→Cemented join request handled?
   - Monsters Foundation / Rockin' Wildcats partnership outreach status (drafts were written this session — see conversation; not saved to disk).
   - Anything broken since the `01894320` push?
   - What next — §7 GameSheet/LeagueApps parity, tier-enforcement build (BIZ-TIER-2, gates pricing), iOS PWA banner (GS-7), or fresh requests?
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
7. **Pete** — **Verify the scoresheet submission flow end-to-end** (the May 20 `submit-scoresheet` security rewrite, deployed v8). Open a BLPA game's scoresheet as the director (or assigned scorekeeper), submit, and confirm BOTH the storage upload AND the email to team contacts succeed. The new caller-auth + server-side-recipient logic mirrors the scoring RLS but could **not** be tested from Claude Code (no real director session JWT). If it returns `forbidden` (403) for a legit director/scorer, or `email: skipped` when teams have contact emails, the role check or the server-side recipient lookup needs a look (see the §5 audit entry). The unauthorized path fails closed, so this is a "feature still works" check, not a security gate.
8. **Pete** — Send pilot URL `https://rinkd.app/tournament/b2789d66-1d77-4a62-862d-00b550da6a98` to BLPA captains. They'll see the public landing without signing up; sign-up CTA brings them into Rinkd, then they can Follow + receive recap pushes.
9. **Sat Jun 13 morning (pre-08:00 EDT at BAM)** — verify status is still `active` (it is now, but Pete may have flipped to draft for pre-event privacy).
10. **Sat Jun 13 (08:00 AM - ~3:30 PM EDT at BAM)** — Run all 12 pool games across 6 slots × 2 sheets (08:00 / 09:15 / 10:30 / 11:45 / 13:00 / 14:15). Standings populate live; auto-recap posts hit the tournament Feed tab + push subscribers as each game finalizes.
11. **Sat ~3:30 PM** — Pete clicks "🏆 Generate Bracket"; picks Sunday start time + rink. 8 championship games created (semis with teams; gold + bronze with TBD).
12. **Sun Jun 14** — Run championship games. SO winner prompt fires on tied bracket games; bracket auto-fills as each semi ends.
13. **Sun end** — Champion banner appears. Pete flips status to `complete`.

**P0 backlog is empty.** Remaining items are operations + content (team names from Nick) + smoke testing — but everything shipped May 20–22 is **build-verified only**; see the verification punch-list below before relying on any of it.

### 🔎 Verify-before-pilot punch-list (shipped May 20–22, NOT tested on real screens/devices/data from Claude Code)

A lot landed straight to main over May 20–22 (auth default→signup, the `submit-scoresheet` security rewrite, GS-7 iOS install banner, the full tape-job font rollout + wordmark, event-page view tracking, `/pricing`, the native Store, drawer icons, the in-app-browser nudge). All compile clean, but several couldn't be exercised from Claude Code (no real device / no real director session / iOS-only UI). Run these before trusting them — **the first two are pilot-critical:**

- 🔴 **Scoresheet submission, end-to-end** — the `submit-scoresheet` security rewrite (v8). Open a BLPA game's scoresheet as the director / assigned scorekeeper, submit, and confirm BOTH the storage upload AND the email to team contacts succeed. A `forbidden` (403) for a legit director, or `email: skipped` when teams have contact emails, means the role check or the server-side recipient lookup needs a look. Couldn't be run from here (no real director JWT). (= checklist item 7 above.)
- 🔴 **BLPA Cleveland `is_activated` is FALSE** — scoring is RLS-hard-blocked until it's flipped true, and the scoresheet path above can't be fully tested until then. Custom deal, so activation is a deliberate manual flip at `/admin/activations` — **must be ON before game day (Sat Jun 13).** Confirm: `select is_activated from tournaments where id='b2789d66-1d77-4a62-862d-00b550da6a98'`.
- 🟡 **iOS install banner (GS-7)** — iPhone Safari → tap Follow on a tournament → confirm the banner slides up above the nav. (iOS-only; never renders on desktop.)
- 🟡 **Tape-job font** — eyeball the section headers (Chirps / Teams / Notifications / Tournaments / Leagues / Store) + the RINKD wordmark, desktop + mobile. The Auth-page **140px hero wordmark** is the one that may look soft (source tape art is only ~200px tall).
- 🟡 **Native Store page** (`/store`) — desktop + mobile layout check.
- 🟡 **In-app-browser nudge** — post a rinkd.app link to Instagram, tap it (opens IG's in-app browser) → confirm the amber "open in your browser" nudge appears. This is the exact path the ~0%-converting social cohort takes.
- 🟡 **Drawer icons** — open the More drawer; confirm the duffle (Store), bracket (Tournaments), and standings-bars (Leagues) icons read right.

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
| `LEAGUE_PARITY_PHASE_1_BUILD.md` | **May 19 self-contained build doc for a fresh Claude Code session** — full Phase 1 instructions for bringing the league flow to tournament parity. Includes migration templates (schema + RLS), index choices, lib helper port-from-tournament instructions, 4-step `LeagueCreate.js` wizard spec, hot-path EXPLAIN queries, scale/reliability/stability guardrails, smoke-test plan, scope guardrails, and Definition of Done. | Read top-to-bottom BEFORE writing any code for the league parity work. |
| `RINKD_STATE_OF_PLAY.md` | Broader orientation doc — BLPA partnership context, post-pilot specs, pending tasks. Older than this handoff. | First-time new sessions; for partnership/business context. |
| `Rinkd_BenchBoss_Captain_Tier_Spec.md` | **SUPERSEDED** twice — first by BIZ-TIER-1 (4-arrangement model), then May 20 by the per-size pricing ladder in `~/Downloads/rinkd_live/docs/Rinkd_Pricing_Guide.docx`. Retained as historical reference only. | Don't act on it. |
| `~/Downloads/rinkd_live/docs/Rinkd_Pricing_Guide.docx` | **CANONICAL pricing source as of May 20, 2026.** Per-season league ladder (Starter $299 / Standard $599 / Pro $999 / Division add-on +$99), per-event tournament ladder (Small $149 / Standard $299 / Large $499 / Premier $799), Year-1 free-tournament + Year-2+ 15% cross-sell, 1% registration platform fee + Stripe pass-through. BLPA Cleveland is OUT (custom deal, TBD). | When quoting prices to customers; when building tier enforcement (BIZ-TIER-2). |
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
