# Rinkd — Pre-Pilot Production Readiness Audit
**Date:** 2026-06-05 · **Pilot:** BLPA Cleveland, Jun 13–14 2026 (8 days out) at BAM, Strongsville OH
**Stack:** Create-React-App (react-scripts 5) SPA · React 18 · react-router 6 · Supabase Postgres (ref `tbpoopsyhfuqcbugrjbh`) · 16 edge functions · Stripe · Vercel · Sentry · PWA/web-push
**Method:** Filesystem read of all 141 src files + 16 edge functions; live queries against the production database; Supabase security+performance advisors; Vercel deploy history; Sentry error history. Findings were verified against the actual code/DB — the PII leak below was reproduced live (real emails harvested with the public anon key) by two independent reviewers.

---

## 1. EXECUTIVE SUMMARY

**Overall readiness: 6 / 10 today → 8 / 10 achievable by Jun 13** with the conditions below.

**Launch recommendation: 🟡 GO WITH CONDITIONS.**

This is a genuinely well-built solo-founder application — better than the median pre-seed pilot. The security *foundations* are sound: RLS is enabled on every public table, the Stripe payment path is **not** forgeable, privilege-escalation **is** blocked by guard triggers, and DMs/orders are correctly tenant-sealed. A mid-May "pilot_audit" hardening pass did real work. Live single-scorer scoring is defensively coded, the service-worker update strategy is correct, and Vercel gives instant one-click rollback.

**But there are four P0 issues that will surface under normal pilot use, and all four are finishable in ≤1 day each (most in <1 hour) — none are architectural.** That is exactly why this is GO-WITH-CONDITIONS, not NO-GO:

1. **Live, anon-key PII leak** — every user's email + date-of-birth + `stripe_customer_id` and every survey lead's email are readable by anyone with the public anon key. Reproduced live. Trust- and legally-damaging (DOB on adult-league minors → COPPA exposure).
2. **Multi-scorer score divergence** — when a director and a scorekeeper are both on a game (the normal BLPA setup), the realtime layer syncs the goal *log* but not the *score*; the two screens silently show different scores and whoever taps Finalize writes the wrong one to standings.
3. **No in-flight guards on the scoring write buttons** — a double-tap on a laggy rink connection double-records a goal, or double-fires Finalize → duplicate recap post + a **duplicate push blast to every subscriber**.
4. **iOS push silently dead on the Feed banner** — iPhone users (most of the pilot) tap "Enable", believe they subscribed, and receive nothing, because iOS web-push requires an installed PWA and the Feed banner has no fallback.

Plus a fifth, pilot-defining gap that isn't a bug: **you cannot currently measure activation or D1 retention** — the single most important pilot KPIs — so without ~6 analytics events the pilot will produce no learnings.

**Condition for GO:** fix the four P0s + the cheap P1 cluster (push-icon 404, DB quick-wins, source-maps off, manual DB snapshot the morning of Jun 13, activation/retention events) before the pilot. All are listed in §5 and the §9 verdict.

**What is NOT wrong (verified clean — stop worrying about these):** payment forgery, privilege escalation, DM/order cross-tenant reads, RLS coverage, the standings math (GF/GA gated on `final`, OT/SO handled, no double-count), the embed-ambiguity footgun (currently clean), the service-worker "white-screen after deploy" risk (network-first navigation mitigates it), and the push *send* path (410-pruning, per-subscription cleanup).

---

## 2. CRITICAL FINDINGS

### P0 — must fix before pilot
| ID | Finding | Location |
|----|---------|----------|
| **P0-1** | **PII leak via anon key.** `profiles` `SELECT USING(true)` + column grants expose `email`, `date_of_birth`, `stripe_customer_id` to `anon`; `survey_responses` `SELECT USING(true)` + grants expose `email`,`name`; `team_members.invite_email` world-readable. Reproduced live (44 real emails harvested). | DB policies on `profiles`, `survey_responses`, `team_members`; client `select('*')` at `Profile.js:77`, `Settings.js:118` |
| **P0-2** | **Multi-scorer score divergence.** Realtime handler sets `goals` but never recomputes the displayed score → two scorers/director see different scores; Finalize commits the wrong one to standings. | `src/pages/ScorerView.js:246-251` |
| **P0-3** | **No in-flight guard on scoring writes.** Finalize disabled only on shootout-pick, not `saving`; Modal Save buttons never disable → double goal/penalty inserts, double Finalize → duplicate recap post + duplicate push-to-all. | `ScorerView.js:85-104, 494-535, 908-913` |
| **P0-4** | **iOS push silently fails on Feed banner.** `PushPrompt` shows "Enable" on iOS-non-installed; tap → `subscribeToPush` fails silently. (The Tournament Follow button handles this correctly — only the Feed banner regressed.) | `src/components/PushPrompt.js`; contrast `Tournament.js` Follow + `lib/platform.js:iosCanInstallButHasnt()` |

### P1 — should fix before pilot
| ID | Finding | Location |
|----|---------|----------|
| **P1-1** | **Push notification icons 404** — SW references `/rinkd_icon_192.png` & `/rinkd_icon_80.png`; neither exists. Every push renders unbranded. 1-line fix. | `public/service-worker.js` (push handler) |
| **P1-2** | **`send-invite` is an open, unescaped, branded email relay** — any logged-in user can send Rinkd-branded HTML to any address with attacker-controlled team/inviter names; no authz that caller manages the entity; values interpolated unescaped (phishing vector). | `supabase/functions/send-invite/index.ts:11-148` |
| **P1-3** | **Cannot measure activation** — no activation event/definition; no `tournament_followed` / `live_game_viewed` / `rsvp_set` / `standings_viewed` events. The headline pilot KPI is unmeasurable. | `src/lib/analytics*`; emit ~5 `track()` calls |
| **P1-4** | **No D1/D7 retention** — dashboard shows current-state dormancy cohorts, not signup-cohort retention. Sat→Sun return is the pilot's key number. | `src/pages/AdminAnalytics.js`; needs one cohort SQL query |
| **P1-5** | **DB perf hygiene regressed on post-May tables** — 10 unindexed FKs, 6 per-row `auth.uid()` RLS policies (DMs/orders/mentions), 1 duplicate index on the hottest-insert table. Copy-paste SQL in §5. | `messages, conversations, game_puck_votes, game_suspensions, order_items, league_games, analytics_events` |
| **P1-6** | **10 MB source map shipped to prod** (`GENERATE_SOURCEMAP` unset → CRA default on). (Note: repo is already public, so incremental exposure is small — but it bloats deploys and should feed Sentry instead.) | Vercel build env; `build/static/js/main.*.js.map` |
| **P1-7** | **Schema not in version control** — `supabase/migrations/` is empty; 131 migrations live only in the remote DB. No PR review of RLS changes (this is how the PII policy slipped in), no rebuild-from-scratch. | `supabase/migrations/` (empty) |
| **P1-8** | **Backup/DR posture unconfirmed** — likely daily-snapshot only, no PITR confirmed. A bad mutation mid-pilot = roll back to last night, lose the day. | Supabase project settings |
| **P1-9** | **Edge-function source drift** — 16 deployed, 13 in repo. `send-push`, `send-league-recap-push`, `sync-gamesheet` (runs every 3 min via cron), `schedule-ics` are deployed but **not in the repo** → no local source to patch mid-pilot. | `supabase/functions/` vs deployed list |
| **P1-10** | **Deep-linked spectators see a frozen score** — `GameDetail.js` has no realtime subscription; a shared single-game link never updates until manual reload. | `src/pages/GameDetail.js:56-133` |
| **P1-11** | **First load is heavy on rink cellular** — 1.26 MB gzip main chunk, **0 lazy routes**, all ~32k LOC on first paint; jspdf+autotable+signature-canvas+datepicker eagerly bundled. | `src/index.js` router (no `React.lazy`); `Scoresheet.js`, `DatePicker.js` |
| **P1-12** | **`load()` ignores Supabase `error` in ScorerView** — a transient query failure ejects the scorer mid-game via `navigate(-1)` with no message. | `ScorerView.js:163-175` |
| **P1-13** | **Cron auth gates fail-open** — `if (CRON_KEY) {check}` pattern: clearing the env var silently disables auth on `send-game-reminders`/`sync-gamesheet`; `send-onboarding-emails` has no gate at all. (Currently CRON_KEY is set — verified 403 — so not exploitable today.) | `supabase/functions/send-game-reminders`, `sync-gamesheet`, `send-onboarding-emails` |
| **P1-14** | **Leaked-password protection disabled** — Supabase Auth HIBP check is off on a public-anon app. | Supabase Auth settings |
| **P1-15** | **No uptime/edge-fn/Stripe-webhook alerting** — Sentry catches client render crashes only (1 event in 90d); a failing webhook or push-sender is invisible until a user complains. | Monitoring (none configured) |

### P2 — post-pilot
| ID | Finding | Location |
|----|---------|----------|
| P2-1 | 106 "multiple permissive policies" on hot tables (posts/comments/likes/games/follows) — OR-evaluated per read; consolidate the duplicate legacy-named twins. | DB RLS |
| P2-2 | No CI, no tests, `CI=false` in build suppresses CRA warnings-as-errors. Mitigant: Vercel instant rollback + deploy freeze. | repo / `vercel.json` |
| P2-3 | Async/network failures swallowed by `catch{}` everywhere → "which features failed" is unanswerable; no `feature_error` telemetry. | call sites across `src/pages`, `src/lib` |
| P2-4 | Wildcard `Access-Control-Allow-Origin: *` on Stripe/commerce edge fns (low risk — bearer auth, not cookies). | `supabase/functions/*/index.ts` |
| P2-5 | Unauthenticated client-callable counter/util RPCs (`increment_likes`, `resolve_tournament_bracket`) — integrity nuisance, no data disclosure. | DB functions |
| P2-6 | `enqueue_notification_push` has a hardcoded anon JWT in its body (not a secret — decodes to `role:anon` — but bad hygiene). | DB function |
| P2-7 | God components (LeagueManage 1660, TournamentManage 1552, Tournament 1213, League 1090 LOC) — maintainability/tech debt; no TypeScript across 32k LOC. | `src/pages/*` |
| P2-8 | `viewport` lacks `viewport-fit=cover`; minor safe-area underlap on notched iPhones. | `public/index.html` |
| P2-9 | Public GitHub repo + unsigned commits. Acceptable for stage; be aware full client+edge source is public. | GitHub `petehessell-coder/Rinkd` |
| P2-10 | `schedule-ics` IDOR — any team/league schedule pullable by UUID (mitigated by UUID unguessability; ICS is designed for unauth subscription). | `supabase/functions/schedule-ics` |

---

## 3. RISK MATRIX

| Issue | Severity | Likelihood | Impact | Recommendation |
|-------|----------|-----------|--------|----------------|
| PII leak (profiles/survey/invite emails) | P0 | **High** (trivial; repo public) | **Critical** (PII/DOB/COPPA, trust, legal) | REVOKE sensitive column grants + close survey SELECT policy (§5). <1d |
| Multi-scorer score divergence | P0 | **High** (director+scorer is the norm) | **High** (wrong final in standings, visible) | Recompute score from goal log in realtime handler. <1d |
| Scoring write double-submit | P0 | **High** (flaky rink wifi) | **High** (dup goals, dup push-to-all) | Disable buttons while `saving` + ref-lock. <1h |
| iOS push dead on Feed banner | P0 | **High** (iPhone-heavy, few install PWA) | **Med-High** (silent fail, can't re-engage) | Gate `PushPrompt` with `iosCanInstallButHasnt()`. <1h |
| Push icon 404 | P1 | High (100% of pushes) | Low-Med (unbranded, looks broken) | Fix SW icon paths. <1h |
| `send-invite` phishing relay | P1 | Medium (needs an account) | Medium (brand/phishing, email cost) | Authz + server-derived recipient + escape. <1d |
| Can't measure activation / D1 | P1 | Certain | High (pilot yields no learnings) | ~6 `track()` events + 1 retention query. <1d |
| DB FK indexes / InitPlan / dup index | P1 | Medium (grows with load) | Medium (feed/DM/standings latency) | Run §5 SQL block. <1h |
| Schema not in VC + DR/PITR | P1 | Low (but catastrophic) | High (no rebuild, up to 24h loss) | `supabase db pull` + manual snapshot Jun 13 AM + enable PITR. <1d |
| Edge-fn source drift | P1 | Low | Medium (can't patch mid-pilot) | `supabase functions download` the 4 missing. <1h |
| Frozen score on deep-linked game | P1 | Medium | Medium (spectator confusion) | Add realtime sub to GameDetail. <1d |
| Heavy first-load bundle | P1 | High (every first-time signup) | Medium (3–8s blank on LTE) | Lazy-load Scoresheet/jspdf + manage/admin routes. <1d |
| ScorerView ejects on transient error | P1 | Medium | Medium (scorer bounced mid-game) | Check `error`, show retry. <1h |
| Cron auth fail-open | P1 | Low (key currently set) | Medium (mass email if key cleared) | Fail-closed the gate. <1h |
| Leaked-password protection off | P1 | Medium | Low-Med | Toggle on in Auth settings. <1h |
| No uptime/webhook alerting | P1 | Medium | Medium (blind to outages) | UptimeRobot + Sentry rule + Stripe alert. <1h |
| Multiple permissive policies (106) | P2 | High | Low (small per-query tax) | Consolidate post-pilot. |
| No CI/tests | P2 | Medium | Medium | Deploy freeze + known rollback path for pilot. |
| God components / no TS | P2 | Low | Low (maintainability) | Refactor post-pilot. |

---

## 4. QUICK WINS (by effort)

**< 1 hour each (do all of these):**
- P0-3 scoring write-guards: add `disabled={saving || …}` to Finalize + a `busy` prop to `Modal`'s Save; ref-lock `changePeriod`/`saveGoal`/`savePenalty`. (`ScorerView.js`)
- P0-4 iOS push: swap the Feed `PushPrompt` Enable button for the install-instructions path when `iosCanInstallButHasnt()`.
- P1-1 push icon 404: change SW paths to `/icon-192.png` + `/favicon-64.png`, then send one real test push.
- P1-6 source maps: set `GENERATE_SOURCEMAP=false` in Vercel env.
- P1-12 ScorerView `error` check + retry.
- P1-13 cron auth fail-closed.
- P1-14 enable leaked-password protection (Auth settings toggle).
- P1-5 DB quick-win SQL block (§5) — one migration.
- P1-15 create 3 alerts: UptimeRobot on `rinkd.app`, Sentry "new issue / >10 events/5min", Stripe webhook-failure email.

**< 1 day each:**
- P0-1 PII lockdown (REVOKE column grants + survey policy + retest signup/settings).
- P0-2 multi-scorer score recompute in the realtime handler.
- P1-2 `send-invite` authz + server-derived recipient + HTML escape.
- P1-3 activation events + P1-4 retention query.
- P1-7/P1-9 `supabase db pull` + `functions download`; commit. P1-8 manual DB snapshot.
- P1-10 GameDetail realtime sub.
- P1-11 lazy-load Scoresheet+jspdf and the manage/admin/create routes.

**< 1 week each (post-pilot):**
- P2-1 consolidate the 106 permissive policies (start: posts/comments/likes).
- P2-2 minimal CI (build + smoke) + a handful of tests on scoring + RLS.
- P2-3 `feature_error` telemetry in key `catch` blocks.
- P2-7 break up the 4 god components; consider incremental TypeScript on `src/lib`.

---

## 5. PILOT HARDENING PLAN (prioritized: risk-reduction × low-effort × customer-impact)

**Order of operations for the next 8 days:**

1. **PII lockdown (P0-1)** — highest risk, ~½ day. Run the block below *after* confirming no UI reads a peer's email/DOB (grep verified: feed/profile embeds select only `id,name,handle,avatar,tier,position`).
2. **Scoring integrity (P0-2 + P0-3)** — ~1 day combined. The marquee live feature; the director-watching-the-scorer scenario is the most likely live trigger.
3. **iOS push fallback + icon (P0-4 + P1-1)** — ~1 hour. Then test a real push on a real iPhone over cellular.
4. **Make the pilot measurable (P1-3 + P1-4)** — ~½ day. Without this the pilot is unfalsifiable.
5. **DB quick-wins + DR floor (P1-5 + P1-7 + P1-8 + P1-9)** — ~½ day. Run SQL, pull schema, download functions, snapshot.
6. **`send-invite` lockdown (P1-2)** + cron fail-closed (P1-13) + leaked-password (P1-14) — ~2 hours.
7. **Bundle split + source maps off (P1-11 + P1-6)** — ~½ day; helps first-time-at-the-rink signups.
8. **Alerts (P1-15)** + GameDetail realtime (P1-10) — ~2 hours.

### Copy-paste DB quick-win block (idempotent; one migration)
```sql
-- Missing FK indexes
CREATE INDEX IF NOT EXISTS idx_messages_sender_id            ON public.messages          (sender_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg_sender ON public.conversations     (last_message_sender_id);
CREATE INDEX IF NOT EXISTS idx_gpv_voted_league_team         ON public.game_puck_votes   (voted_league_team_id);
CREATE INDEX IF NOT EXISTS idx_gpv_voted_tournament_team     ON public.game_puck_votes   (voted_tournament_team_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_source_game       ON public.game_suspensions  (source_game_id);
CREATE INDEX IF NOT EXISTS idx_suspensions_served_game       ON public.game_suspensions  (served_game_id);
CREATE INDEX IF NOT EXISTS idx_league_games_shootout_winner  ON public.league_games      (shootout_winner);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id        ON public.order_items       (variant_id);

-- Fix 6 per-row auth.uid() RLS policies (wrap in (select ...))
ALTER POLICY msg_insert ON public.messages
  WITH CHECK ((sender_id = (select auth.uid())) AND is_conversation_participant(conversation_id));
ALTER POLICY orders_select_own ON public.orders
  USING (buyer_profile_id = (select auth.uid()));
ALTER POLICY order_items_select_own ON public.order_items
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.buyer_profile_id = (select auth.uid())));
ALTER POLICY cp_update_self ON public.conversation_participants
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
ALTER POLICY comment_mentions_insert ON public.comment_mentions
  WITH CHECK (EXISTS (SELECT 1 FROM comments c WHERE c.id = comment_mentions.comment_id AND c.author_id = (select auth.uid())));
ALTER POLICY post_mentions_insert ON public.post_mentions
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_mentions.post_id AND p.author_id = (select auth.uid())));

-- Drop duplicate index on the hottest-insert table
DROP INDEX IF EXISTS public.analytics_events_event_idx;
```

### Copy-paste PII lockdown (P0-1) — apply with eyes open
```sql
-- survey_responses: close public read to admins only
DROP POLICY IF EXISTS "Anyone can select" ON public.survey_responses;
CREATE POLICY survey_read_admin ON public.survey_responses
  FOR SELECT TO authenticated USING (is_commissioner((select auth.uid())));

-- profiles: stop anon/auth from selecting sensitive columns.
-- Self-reads of own email should come from auth.users; peers never need these.
REVOKE SELECT (email, date_of_birth, stripe_customer_id) ON public.profiles FROM anon, authenticated;

-- team_members: stop exposing pending invitees' emails (tighten or null invite_email to non-managers).
-- (Implement via policy/view; verify TeamManage still shows invites to the manager.)
```
Test after applying: signup, account settings (own email), feed render, profile view, team-manage invites.

---

## 6. MISSING TESTS

There are **zero automated tests** in the repo. For the pilot, don't chase coverage — add a thin, targeted safety net around the things that can corrupt data or lose money:

**Unit (highest value first):**
- Standings/points math: `league_standings` derivation, OT/SO → OTL, GF/GA gating on `status='final'`, tie-break ordering.
- `leaguePlayoffGenerator` / target-games scheduler / `resolveBracketSlotsFromSemis` (bracket topology is native, not from GameSheet).
- Score-from-goal-log derivation (`syncScoreFromGoals`) — the function P0-2 depends on.
- `streamUrl.js` provider parsing; fee/amount calc used by `stripe-checkout`/`store-checkout`.

**Integration (RLS contract tests — would have caught P0-1):**
- Anon and a non-owner authenticated role attempting `SELECT email,date_of_birth,stripe_customer_id FROM profiles` → must return empty/error.
- Non-participant reading `messages`/`conversations` → empty. Non-buyer reading `orders`/`order_items` → empty.
- Non-admin `UPDATE profiles SET is_admin=true` and `UPDATE tournaments SET is_activated=true` → no-op (guard triggers).
- `send-invite` / `stripe-webhook` signature + authz happy/again-path.

**End-to-end (smoke, the demo path):** signup → onboarding → follow tournament → enable push → open live game → scorer adds goal/penalty → finalize → standings update → recap posts. Run on a real iPhone over cellular.

**Load:** a 30–50 concurrent-viewer burst on one live game (realtime subscriptions + standings reads) — the realistic BLPA peak. Confirm realtime fan-out and the feed/standings queries hold. (Current data is tiny; the risk is connection/subscription count, not row volume.)

**Security:** the RLS contract tests above + a scripted anon-key REST sweep of every table for `email`/`phone`/PII columns (turn P0-1's manual repro into a regression guard); Stripe webhook forged-signature rejection.

---

## 7. MONITORING CHECKLIST (Jun 13–14)

**Metrics to watch (refresh hourly during game windows):**
- `rinkd.app` reachable + interactive on a real iPhone on cellular (not arena wifi).
- Supabase → Edge Functions logs filtered to status ≥ 500 on: `sync-gamesheet` (every 3 min — if it dies, external scores stall), `send-recap-push`, `send-league-recap-push`, `send-notification-push`, `stripe-webhook`, `submit-scoresheet`.
- `push_subscriptions` row-count trend (are players actually subscribing? a flat line = P0-4 biting).
- Live event tail: `SELECT event,count(*) FROM analytics_events WHERE created_at>now()-interval '1 hour' GROUP BY 1 ORDER BY 2 DESC;`
- Realtime connection count (Supabase dashboard) during a live game.

**Alerts to create before Jun 13:**
- Uptime: 5-min HTTP check on `https://rinkd.app` → SMS (UptimeRobot free tier).
- Sentry: rule "new issue OR >10 events/5 min" → email/SMS.
- Stripe: Dashboard → Developers → Webhooks → enable failure email alerts.

**Dashboards to keep open:** `rinkd.app/admin/analytics`; Supabase Edge Function logs (status ≥ 500); Sentry issues (`environment:production`); Stripe Payments (if registration is live).

**Logs to capture/export after the pilot:** `analytics_events` for Jun 13–14 (retention + funnel post-mortem); push-sender invocation logs (delivery rate + dead-iOS prune counts); Sentry weekend issues by device/iOS version; `push_subscriptions` snapshot (iPhone vs Android subscribe rate — quantifies the P0-4 loss).

**Deploy posture:** **freeze deploys during games.** Rollback path = Vercel → Deployments → last-good → Promote to Production (instant; this is your main safety net given no CI/tests). The two most recent prod deploys are flagged rollback-candidates.

---

## 8. PER-DOMAIN NOTES (condensed)

- **Architecture:** Clean 3-tier (React SPA → Supabase RLS/RPC → edge functions for privileged/3rd-party work). No app server to scale — Supabase + Vercel absorb pilot load. Single points of failure: the Supabase project (DB + auth + realtime + functions all one project) and the `sync-gamesheet` cron. Service boundaries are reasonable; the main debt is the four 1000+-LOC page components.
- **Code quality:** Idiomatic React; consistent lib/ data layer; but no types, no lint config in repo, and four god components concentrate complexity and crash risk. Some dead/legacy paths (`send-push` legacy fn, `sync-avantlink-products` undeployed).
- **Reliability:** Top-level ErrorBoundary (`App.js:354`) + Sentry + a 10s auth watchdog + graceful SW reload mean a single throw won't white-screen the PWA. The real exposure is *concurrency* in live scoring (P0-2/P0-3) and a few `error`-ignoring call sites (P1-12).
- **Security:** Strong foundations (RLS everywhere, payments non-forgeable, priv-esc blocked, secrets clean, Turnstile on auth, search_path locked on all 47 DEFINER fns). The exploitable gap is data *exposure* (P0-1), not auth/payments.
- **Database:** Sound schema, correct standings views, proper uniqueness/double-charge guards. Gaps are post-May perf hygiene (P1-5) and the DR/version-control story (P1-7/P1-8). NO-ACTION FKs on games→team mean native team-delete must route through `admin_delete_*` RPCs (it does).
- **Performance:** 1.26 MB gzip first load, 0 route splitting — the one user-facing perf issue, worst for first-time signups at the rink. Row volumes are tiny; feed uses keyset pagination. Push send path is production-grade.
- **Frontend/UX:** Generally good loading/empty states; the iOS-install/push UX is handled correctly on the Tournament page but regressed on the Feed banner (P0-4). Spectator deep-link freshness (P1-10).
- **Mobile/PWA:** Installable, correct manifest + icons + SW versioning. iOS web-push is the headline mobile risk (P0-4). Add `viewport-fit=cover` (P2-8).
- **API/edge functions:** Consistent CORS/error shape; `stripe-webhook` verifies signatures on the raw body; cron auth pattern is fail-open (P1-13); 5 functions are `verify_jwt:false` and each was checked for its own auth.
- **DevOps:** Vercel auto-deploy from `main`, instant rollback (good). No CI/tests, `CI=false` build (risk, mitigated by rollback + freeze). Schema + 4 functions not in repo (P1-7/P1-9).
- **Analytics:** Solid signup/onboarding funnel + an admin dashboard, but the post-onboarding product loop is dark: activation (NO), retention (PARTIAL), feature-failure (NO). ~6 events + 1 query closes most of it (P1-3/P1-4).

---

## 9. FINAL VERDICT — "If the pilot were in 7 days, the top 10 to fix first"

1. **Lock down the PII leak** (P0-1) — REVOKE the `profiles` email/DOB/`stripe_customer_id` column grants + close the `survey_responses` SELECT policy + stop leaking `team_members.invite_email`. *The one finding that is actively exploitable right now with zero auth.*
2. **Fix multi-scorer score divergence** (P0-2) — recompute the score from the goal log in the realtime handler. *The marquee feature producing wrong standings in front of the customer.*
3. **Guard the scoring write buttons** (P0-3) — disable Finalize/Save while `saving` + ref-lock. *Stops duplicate goals and a duplicate push-blast to every subscriber.* (<1h)
4. **iOS push fallback on the Feed banner** (P0-4) + **fix the push icon 404** (P1-1) — then send a real test push from a real iPhone. *Push is a headline feature; silent failure is the predictable #1 complaint.*
5. **Instrument activation + D1 retention** (P1-3/P1-4) — ~6 `track()` events + one cohort query. *Otherwise the pilot produces no learnings.*
6. **Run the DB quick-win SQL** (P1-5) — FK indexes + 6 InitPlan policies + drop the dup index. (<1h, copy-paste in §5)
7. **DR floor** (P1-7/P1-8/P1-9) — `supabase db pull` + `functions download` + commit; take a manual DB snapshot the morning of Jun 13; confirm/enable PITR.
8. **Lock down `send-invite`** (P1-2) + **fail-closed the cron gates** (P1-13) + **enable leaked-password protection** (P1-14).
9. **Code-split the bundle + turn off source maps** (P1-11/P1-6) — lazy-load Scoresheet/jspdf and the manage/admin/create routes; `GENERATE_SOURCEMAP=false`.
10. **Stand up monitoring** (P1-15) — UptimeRobot + Sentry alert rule + Stripe webhook-failure alert; **freeze deploys during games** and rehearse the Vercel rollback.

Items 1–4 are the true pilot blockers and total well under two engineering days. Do those and the cheap half of 5–8, and this moves from a 6 to a confident 8 — GO.
