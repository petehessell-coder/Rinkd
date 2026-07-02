-- ============================================================================
-- C08 · PR-E — RLS permissive-policy consolidation on the hot feed tables
-- ============================================================================
-- Fable Elevation Program · C08_performance.md §3 PR-E · 2026-07-02
--
-- WHY: prod performance advisor (multiple_permissive_policies) reports 15 hits
-- each on posts/likes/comments, 5 each on follows/game_goals/games. Postgres OR's
-- permissive policies for a (role, action) BUT evaluates EACH per row — on the
-- hottest feed tables that is a per-row policy tax on every read. The advisor's
-- "15" is INFLATED by per-role double-counting: every one of these policies targets
-- role `public`, and the advisor counts each policy once per grantee role
-- (anon, authenticated, authenticator, dashboard_user, supabase_privileged_role = 5x).
-- The TRUE multiplicity is 15/5 = 3 (posts, likes, comments) and 5/5 = 1
-- (follows, game_goals, games) genuinely-multiple (role,action) findings.
--
-- Nature of the duplication (all verified live 2026-07-02 via pg_policies):
--   * posts / likes / comments — the duplicate policies for each (cmd) carry
--     BYTE-IDENTICAL qual/with_check. Pure historical dupes (a legacy human-named
--     policy + a machine-named `*_own` policy created later). Consolidation = drop
--     the redundant copies, keep ONE canonical policy. Semantics provably unchanged
--     because the surviving predicate is textually equal to every dropped one.
--   * game_goals INSERT / games UPDATE — TWO genuinely-different predicates. Merged
--     into ONE policy whose WITH CHECK / USING is the exact OR of the originals.
--
-- INITPLAN: every surviving/merged predicate here already calls the auth layer via
--   (select current_profile_id()) — current_profile_id() itself wraps
--   (select auth.uid()) internally — so the auth_rls_initplan optimization is ALREADY
--   present on these six tables; no change to the predicate internals is required.
--   (This migration does NOT re-introduce a bare auth.uid() anywhere.)
--
-- ALSO (cheap, same theme): the 3 auth_rls_initplan findings on the COLD
--   integration_authorizations table — wrap bare auth.uid() in (select auth.uid()).
--
-- SKIPPED — follows (SELECT, 1 finding): the 2nd policy `Users can manage own
--   follows` is FOR ALL, so it also covers INSERT/UPDATE/DELETE. Isolating its
--   SELECT arm to fold into `Anyone can read follows` (qual `true`) would mean
--   splitting one ALL policy into four per-cmd policies — more surface, more risk,
--   on a cold path where the read predicate is already a constant `true` (no per-row
--   function call, so no meaningful per-row tax). Not clearly safe AND not clearly a
--   win → left as-is by design. See §3 PR-E "if the pattern generalizes cheaply".
--
-- ============================================================================
-- PRE-STATE — every original policy recorded VERBATIM so it is recoverable
-- ============================================================================
-- posts (RLS on, no force):
--   SELECT posts_select_all : USING (((is_hidden = false) OR ((select current_profile_id()) = author_id) OR is_commissioner((select current_profile_id()))) AND ((team_id IS NULL) OR can_view_team(team_id) OR ((select current_profile_id()) = author_id) OR is_commissioner((select current_profile_id()))))   [KEPT AS-IS, single SELECT policy]
--   DELETE "Users can delete their own posts" : USING ((select current_profile_id()) = author_id)
--   DELETE "Users delete their own posts"     : USING ((select current_profile_id()) = author_id)
--   DELETE posts_delete_own                   : USING ((select current_profile_id()) = author_id)
--   INSERT "Authenticated users can create posts" : WITH CHECK ((select current_profile_id()) = author_id)
--   INSERT "Users create their own posts"         : WITH CHECK ((select current_profile_id()) = author_id)
--   INSERT posts_insert_own                       : WITH CHECK ((select current_profile_id()) = author_id)
--   UPDATE "Users update their own posts" : USING ((select current_profile_id()) = author_id)  WITH CHECK NULL
--   UPDATE posts_update_own               : USING ((select current_profile_id()) = author_id)  WITH CHECK ((select current_profile_id()) = author_id)
-- likes (RLS on, no force):
--   SELECT "Likes are viewable by everyone" : USING (true)
--   SELECT "Likes viewable by everyone"     : USING (true)
--   DELETE "Users can unlike their own likes" : USING ((select current_profile_id()) = user_id)
--   DELETE "Users delete their own likes"     : USING ((select current_profile_id()) = user_id)
--   INSERT "Authenticated users can like"      : WITH CHECK ((select current_profile_id()) = user_id)
--   INSERT "Users create their own likes"      : WITH CHECK ((select current_profile_id()) = user_id)
-- comments (RLS on, no force):
--   SELECT comments_select_all : USING ((is_hidden = false) OR ((select current_profile_id()) = author_id) OR is_commissioner((select current_profile_id())))   [KEPT AS-IS, single SELECT policy]
--   DELETE "Users can delete their own comments" : USING ((select current_profile_id()) = author_id)
--   DELETE "Users delete their own comments"     : USING ((select current_profile_id()) = author_id)
--   DELETE comments_delete_own                   : USING ((select current_profile_id()) = author_id)
--   INSERT "Authenticated users can comment"     : WITH CHECK ((select current_profile_id()) = author_id)
--   INSERT "Users create their own comments"     : WITH CHECK ((select current_profile_id()) = author_id)
--   INSERT comments_insert_own                   : WITH CHECK ((select current_profile_id()) = author_id)
--   UPDATE "Users update their own comments" : USING ((select current_profile_id()) = author_id)  WITH CHECK NULL
--   UPDATE comments_update_own               : USING ((select current_profile_id()) = author_id)  WITH CHECK ((select current_profile_id()) = author_id)
-- follows (RLS on, no force):  [SKIPPED — recorded for completeness]
--   SELECT "Anyone can read follows"      : USING (true)
--   ALL    "Users can manage own follows" : USING ((select current_profile_id()) = follower_id)  WITH CHECK NULL
-- game_goals (RLS on, no force):
--   SELECT goals_public_read : USING (true)   [single, untouched]
--   DELETE goals_scorer_delete : USING ((select current_profile_id()) IS NOT NULL)   [single, untouched]
--   INSERT game_goals_insert_requires_activated : WITH CHECK (
--       (EXISTS (SELECT 1 FROM games g JOIN tournaments t ON t.id=g.tournament_id
--                WHERE g.id=game_goals.game_id AND t.is_activated=true))
--    OR (EXISTS (SELECT 1 FROM league_games lg JOIN leagues l ON l.id=lg.league_id
--                WHERE lg.id=game_goals.game_id AND l.is_activated=true))
--    OR (EXISTS (SELECT 1 FROM games g WHERE g.id=game_goals.game_id AND g.tournament_id IS NULL)) )
--   INSERT goals_scorer_insert : WITH CHECK ((select current_profile_id()) IS NOT NULL)
-- games (RLS on, no force):
--   SELECT games_public_read   : USING (true)   [single, untouched]
--   INSERT games_insert        : WITH CHECK (...director/scorer...)   [single, untouched]
--   DELETE games_director_delete : USING (...)   [single, untouched]
--   UPDATE games_director_update : USING ((tournament_id IS NULL) OR (is_tournament_director(tournament_id,(select current_profile_id())) AND EXISTS(SELECT 1 FROM tournaments t WHERE t.id=games.tournament_id AND t.is_activated=true)))  WITH CHECK (same)
--   UPDATE games_scorer_update   : USING ((((select current_profile_id())=scorekeeper_id) OR EXISTS(SELECT 1 FROM tournament_roles tr WHERE tr.tournament_id=games.tournament_id AND tr.user_id=(select current_profile_id()) AND tr.role=ANY(ARRAY['director','scorer']))) AND EXISTS(SELECT 1 FROM tournaments t WHERE t.id=games.tournament_id AND t.is_activated=true))  WITH CHECK NULL
-- integration_authorizations (RLS on) — initplan fix targets:
--   SELECT integration_auth_select / INSERT integration_auth_insert / UPDATE integration_auth_update
--     — all use bare auth.uid() (3 auth_rls_initplan findings).
--
-- ============================================================================
-- APPLY-RUNBOOK (applies via MCP AFTER QA — no prod write from this branch):
--   1. Run the PGlite equivalence harness GREEN:
--        node scripts/c08-e-smoke/pglite-migrations.mjs
--      (proves the per-persona visibility/insert/update/delete matrix is IDENTICAL
--       row-for-row pre vs post, and idempotent across two applies).
--   2. Apply on prod via Supabase MCP apply_migration (name: c08_e_rls_consolidation).
--   3. Re-pull advisors (performance): expect multiple_permissive_policies to drop
--      to 0 on posts/likes/comments/game_goals/games (follows retains its 5 by
--      design) and auth_rls_initplan on integration_authorizations to drop to 0.
--   4. Live REST verification matrix (anon / member / author / admin × global /
--      team / league / tournament feeds) confirms feed visibility + youth privacy
--      unchanged.
-- This migration is IDEMPOTENT: it drops BOTH the legacy names AND the new names
--   (IF EXISTS) before every create, so re-apply is a no-op.
-- ============================================================================

begin;

-- ─── posts ───────────────────────────────────────────────────────────────────
-- SELECT: single policy, unchanged. DELETE/INSERT/UPDATE: dedupe identical dupes.
drop policy if exists "Users can delete their own posts" on public.posts;
drop policy if exists "Users delete their own posts"     on public.posts;
drop policy if exists posts_delete_own                   on public.posts;
create policy posts_delete_own on public.posts
  for delete to public
  using ((select current_profile_id()) = author_id);

drop policy if exists "Authenticated users can create posts" on public.posts;
drop policy if exists "Users create their own posts"         on public.posts;
drop policy if exists posts_insert_own                       on public.posts;
create policy posts_insert_own on public.posts
  for insert to public
  with check ((select current_profile_id()) = author_id);

drop policy if exists "Users update their own posts" on public.posts;
drop policy if exists posts_update_own               on public.posts;
create policy posts_update_own on public.posts
  for update to public
  using ((select current_profile_id()) = author_id)
  with check ((select current_profile_id()) = author_id);

-- ─── likes ───────────────────────────────────────────────────────────────────
drop policy if exists "Likes are viewable by everyone" on public.likes;
drop policy if exists "Likes viewable by everyone"     on public.likes;
drop policy if exists likes_select_all                 on public.likes;
create policy likes_select_all on public.likes
  for select to public
  using (true);

drop policy if exists "Users can unlike their own likes" on public.likes;
drop policy if exists "Users delete their own likes"     on public.likes;
drop policy if exists likes_delete_own                   on public.likes;
create policy likes_delete_own on public.likes
  for delete to public
  using ((select current_profile_id()) = user_id);

drop policy if exists "Authenticated users can like" on public.likes;
drop policy if exists "Users create their own likes" on public.likes;
drop policy if exists likes_insert_own               on public.likes;
create policy likes_insert_own on public.likes
  for insert to public
  with check ((select current_profile_id()) = user_id);

-- ─── comments ────────────────────────────────────────────────────────────────
-- SELECT: single policy comments_select_all, unchanged.
drop policy if exists "Users can delete their own comments" on public.comments;
drop policy if exists "Users delete their own comments"     on public.comments;
drop policy if exists comments_delete_own                   on public.comments;
create policy comments_delete_own on public.comments
  for delete to public
  using ((select current_profile_id()) = author_id);

drop policy if exists "Authenticated users can comment"  on public.comments;
drop policy if exists "Users create their own comments"  on public.comments;
drop policy if exists comments_insert_own                on public.comments;
create policy comments_insert_own on public.comments
  for insert to public
  with check ((select current_profile_id()) = author_id);

drop policy if exists "Users update their own comments" on public.comments;
drop policy if exists comments_update_own               on public.comments;
create policy comments_update_own on public.comments
  for update to public
  using ((select current_profile_id()) = author_id)
  with check ((select current_profile_id()) = author_id);

-- ─── game_goals — INSERT merge (genuine OR of two WITH CHECKs) ───────────────
-- OR of: (a) game_goals_insert_requires_activated  (b) goals_scorer_insert.
-- SELECT (goals_public_read) and DELETE (goals_scorer_delete) are single, untouched.
drop policy if exists game_goals_insert_requires_activated on public.game_goals;
drop policy if exists goals_scorer_insert                  on public.game_goals;
drop policy if exists game_goals_insert_consolidated       on public.game_goals;
create policy game_goals_insert_consolidated on public.game_goals
  for insert to public
  with check (
    (
      (exists ( select 1
                  from public.games g
                  join public.tournaments t on t.id = g.tournament_id
                 where g.id = game_goals.game_id and t.is_activated = true))
      or (exists ( select 1
                     from public.league_games lg
                     join public.leagues l on l.id = lg.league_id
                    where lg.id = game_goals.game_id and l.is_activated = true))
      or (exists ( select 1
                     from public.games g
                    where g.id = game_goals.game_id and g.tournament_id is null))
    )
    or ((select current_profile_id()) is not null)
  );

-- ─── games — UPDATE merge (genuine OR of two policies) ───────────────────────
-- games_scorer_update had WITH CHECK NULL → its check equals its USING; so the
-- merged WITH CHECK is (director_using OR scorer_using), identical to the OR of the
-- two originals' effective checks. SELECT/INSERT/DELETE are single, untouched.
drop policy if exists games_director_update      on public.games;
drop policy if exists games_scorer_update        on public.games;
drop policy if exists games_update_consolidated  on public.games;
-- USING/WITH CHECK = ( games_director_update predicate ) OR ( games_scorer_update
-- predicate ), each pasted VERBATIM from prod pg_policies (games_scorer_update had
-- WITH CHECK NULL, so its effective check equals its USING — hence identical OR here).
create policy games_update_consolidated on public.games
  for update to public
  using (
    ((tournament_id IS NULL) OR (is_tournament_director(tournament_id, ( SELECT current_profile_id() AS uid)) AND (EXISTS ( SELECT 1
       FROM tournaments t
      WHERE ((t.id = games.tournament_id) AND (t.is_activated = true))))))
    OR
    (((( SELECT current_profile_id() AS uid) = scorekeeper_id) OR (EXISTS ( SELECT 1
       FROM tournament_roles tr
      WHERE ((tr.tournament_id = games.tournament_id) AND (tr.user_id = ( SELECT current_profile_id() AS uid)) AND (tr.role = ANY (ARRAY['director'::text, 'scorer'::text])))))) AND (EXISTS ( SELECT 1
       FROM tournaments t
      WHERE ((t.id = games.tournament_id) AND (t.is_activated = true)))))
  )
  with check (
    ((tournament_id IS NULL) OR (is_tournament_director(tournament_id, ( SELECT current_profile_id() AS uid)) AND (EXISTS ( SELECT 1
       FROM tournaments t
      WHERE ((t.id = games.tournament_id) AND (t.is_activated = true))))))
    OR
    (((( SELECT current_profile_id() AS uid) = scorekeeper_id) OR (EXISTS ( SELECT 1
       FROM tournament_roles tr
      WHERE ((tr.tournament_id = games.tournament_id) AND (tr.user_id = ( SELECT current_profile_id() AS uid)) AND (tr.role = ANY (ARRAY['director'::text, 'scorer'::text])))))) AND (EXISTS ( SELECT 1
       FROM tournaments t
      WHERE ((t.id = games.tournament_id) AND (t.is_activated = true)))))
  );

-- ─── integration_authorizations — auth_rls_initplan (wrap bare auth.uid()) ───
-- Same predicate, bare auth.uid() → (select auth.uid()): identical result,
-- evaluated once per query instead of once per row.
drop policy if exists integration_auth_select on public.integration_authorizations;
create policy integration_auth_select on public.integration_authorizations
  for select to authenticated
  using (
    ((owner_type = 'league'::text)     and is_league_commissioner(owner_id, (select auth.uid())))
    or ((owner_type = 'tournament'::text) and is_tournament_director(owner_id, (select auth.uid())))
  );

drop policy if exists integration_auth_insert on public.integration_authorizations;
create policy integration_auth_insert on public.integration_authorizations
  for insert to authenticated
  with check (
    (authorized_by = (select auth.uid()))
    and (
      ((owner_type = 'league'::text)     and is_league_commissioner(owner_id, (select auth.uid())))
      or ((owner_type = 'tournament'::text) and is_tournament_director(owner_id, (select auth.uid())))
    )
  );

drop policy if exists integration_auth_update on public.integration_authorizations;
create policy integration_auth_update on public.integration_authorizations
  for update to authenticated
  using (
    ((owner_type = 'league'::text)     and is_league_commissioner(owner_id, (select auth.uid())))
    or ((owner_type = 'tournament'::text) and is_tournament_director(owner_id, (select auth.uid())))
  )
  with check (
    ((owner_type = 'league'::text)     and is_league_commissioner(owner_id, (select auth.uid())))
    or ((owner_type = 'tournament'::text) and is_tournament_director(owner_id, (select auth.uid())))
  );

commit;
