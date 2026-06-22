-- ============================================================================
-- YOUTH-PRIVACY · Migration B — insider predicate + default-deny RLS
-- ----------------------------------------------------------------------------
-- The DB is the source of truth. For a PRIVATE (youth) team, the roster,
-- schedule (times + LOCATIONS), RSVPs, team feed, team-game lineups, and minor
-- profiles are readable ONLY by insiders: rostered members, the team
-- manager/coach/owner, the league commissioner/manager, a guardian of a
-- rostered minor, or a global admin. PUBLIC (adult) teams stay broadly
-- readable (personal contacts gated in Migration C). Team-level competition
-- results stay public for everyone via the standings views + public_team_summary.
-- ============================================================================

-- ---- helpers ----------------------------------------------------------------
-- (current_user_is_admin() is defined in Migration A — it backs the trigger's
--  declassification guard and is reused by the policies below.)

-- The single insider predicate. SECURITY DEFINER so it can read team_members /
-- profiles without tripping the very policies it backs.
create or replace function public.is_team_insider(p_team_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select p_team_id is not null and p_profile_id is not null and (
    -- global admin
    exists (select 1 from public.profiles pr where pr.id = p_profile_id and pr.is_admin)
    -- rostered member (player/goalie/coach/manager — incl. self)
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.user_id = p_profile_id
        and coalesce(tm.status,'active') in ('active','pending')
    )
    -- team manager / coach / founding owner
    or public.is_team_manager(p_team_id, p_profile_id)
    -- league commissioner / manager of the team's league
    or public.is_league_commissioner_of_team(p_team_id, p_profile_id)
    -- guardian of a rostered minor on this team
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.user_id is not null
        and public.is_guardian_of(tm.user_id, p_profile_id)
    )
  );
$$;

-- A team's gated data is visible if the team is public OR the viewer is an insider.
create or replace function public.can_view_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.teams t where t.id = p_team_id and t.visibility = 'public')
      or public.is_team_insider(p_team_id, public.current_profile_id());
$$;

-- Minor profile visibility: self/guardian, admin, or a teammate-insider of a
-- team the minor is rostered on.
create or replace function public.can_view_minor_profile(p_minor_profile_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.can_manage_profile(p_minor_profile_id)
      or public.current_user_is_admin()
      or exists (
        select 1 from public.team_members tm
        where tm.user_id = p_minor_profile_id
          and public.is_team_insider(tm.team_id, public.current_profile_id())
      );
$$;

revoke all on function public.is_team_insider(uuid, uuid) from public;
revoke all on function public.can_view_team(uuid) from public;
revoke all on function public.can_view_minor_profile(uuid) from public;
grant execute on function public.is_team_insider(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_view_team(uuid) to anon, authenticated, service_role;
grant execute on function public.can_view_minor_profile(uuid) to anon, authenticated, service_role;

-- ---- teams: was (is_public = true) -> visibility/insider ---------------------
drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams for select to public
using ( visibility = 'public' or public.is_team_insider(id, public.current_profile_id()) );

-- ---- team_members (roster + names): insiders of the team only ----------------
drop policy if exists team_members_public_read on public.team_members;
create policy team_members_read on public.team_members for select to public
using ( public.can_view_team(team_id) );

-- ---- team_games (schedule incl. LOCATION + time): insiders of the team -------
drop policy if exists team_games_public_read on public.team_games;
create policy team_games_read on public.team_games for select to public
using ( public.can_view_team(team_id) );

-- ---- team_game_rsvps: gated by the parent team_game's team -------------------
drop policy if exists rsvp_public_read on public.team_game_rsvps;
create policy rsvp_read on public.team_game_rsvps for select to public
using ( public.can_view_team( (select tg.team_id from public.team_games tg where tg.id = game_id) ) );

-- ---- game_lineups: gate ONLY team-source rows (the youth-team surface).
--      league/tournament lineups stay readable so jersey-keyed leaderboards
--      (SECURITY INVOKER) keep working; their youth-name suppression is handled
--      at the event level (settings.feature_profile='youth_competitive'). ------
drop policy if exists game_lineups_select on public.game_lineups;
create policy game_lineups_select on public.game_lineups for select to public
using (
  game_source <> 'team'
  or coalesce((select t.visibility from public.teams t where t.id = game_lineups.team_id), 'private') = 'public'
  or public.is_team_insider(game_lineups.team_id, public.current_profile_id())
);

-- ---- posts: keep hidden/author/commissioner logic; additionally gate
--      team-scoped posts behind team visibility (youth team feed = insiders). --
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts for select to public
using (
  (
    (is_hidden = false)
    or ((select public.current_profile_id()) = author_id)
    or public.is_commissioner((select public.current_profile_id()))
  )
  and (
    team_id is null
    or public.can_view_team(team_id)
    or ((select public.current_profile_id()) = author_id)
    or public.is_commissioner((select public.current_profile_id()))
  )
);

-- ---- players (number->name entity): hide minor-linked rows from outsiders ----
drop policy if exists players_public_read on public.players;
create policy players_public_read on public.players for select to public
using (
  is_visible = true
  and (
    profile_id is null
    or not public.is_minor_profile(profile_id)
    or public.can_view_minor_profile(profile_id)
  )
);

-- ---- profiles: adults unchanged (fully readable); minor profiles gated to
--      self/guardian/admin/teammate-insider. No browsable minor profiles. -----
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy profiles_select on public.profiles for select to public
using (
  account_type is distinct from 'minor'
  or public.can_view_minor_profile(id)
);
