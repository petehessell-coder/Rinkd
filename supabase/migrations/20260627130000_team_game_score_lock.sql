-- TEAM-GAME SCORE LOCK — managers/coaches manage the SCHEDULE; they may not
-- write game RESULTS. Results (home_score/away_score, finalizing status) are
-- only writable by league staff (commissioner of the team's league) or the
-- official sync source (service_role import). Closes the score-edit hole opened
-- by the unified-schedule manager UPDATE policy.
--
-- Mapping of "scorer / commissioner / director" onto team_games:
--   * In-app ScorerView writes to games / league_games, NOT team_games — there
--     is no per-game scorer assignment on a team's own schedule. The official
--     score source for team_games is the external sync (service_role).
--   * Commissioner = league commissioner/manager of the team's league.
--   * Director is a TOURNAMENT role; tournament games live in `games`, not
--     team_games, so it does not apply here.
-- RLS still scopes WHICH rows each actor can touch; the trigger adds the
-- per-column (result) guard on top.

-- 1) Broaden the UPDATE policy: managers/coaches OR a league commissioner of the
--    team. Managers can reschedule/edit; the trigger (below) blocks managers
--    from result columns. Commissioners are allowed through both layers.
drop policy if exists team_games_update on public.team_games;
create policy team_games_update on public.team_games
  for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_games.team_id
        and tm.user_id = (select current_profile_id())
        and tm.role = any (array['manager','coach'])
    )
    or public.is_league_commissioner_of_team(team_games.team_id, (select current_profile_id()))
  )
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_games.team_id
        and tm.user_id = (select current_profile_id())
        and tm.role = any (array['manager','coach'])
    )
    or public.is_league_commissioner_of_team(team_games.team_id, (select current_profile_id()))
  );

-- 2) Result guard: reject score changes and status→'final' unless the writer is
--    the service_role sync or a league commissioner of the team. Schedule edits
--    (title/location/time/opponent/home-away/notes) and status→'cancelled'/
--    'scheduled' are untouched, so managers keep full schedule control.
create or replace function public.guard_team_game_result_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  -- No result/finalize change? Allow (this is a plain schedule edit).
  if new.home_score is not distinct from old.home_score
     and new.away_score is not distinct from old.away_score
     and not (new.status is distinct from old.status and new.status = 'final')
  then
    return new;
  end if;

  -- Trusted server contexts may write results:
  --   * the external score sync runs as service_role (PostgREST + service key), and
  --   * direct DB / migration / admin connections carry NO request JWT at all.
  -- Web end-users (managers/anon) always arrive with a JWT and role
  -- authenticated/anon, so neither branch lets them through.
  if coalesce(auth.role(), '') = 'service_role'
     or nullif(current_setting('request.jwt.claims', true), '') is null then
    return new;
  end if;

  -- League staff may correct results.
  uid := (select current_profile_id());
  if uid is not null and public.is_league_commissioner_of_team(new.team_id, uid) then
    return new;
  end if;

  raise exception 'Scores are set by the official scorer or league staff — you can edit the schedule but not the result.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_guard_team_game_result_edit on public.team_games;
create trigger trg_guard_team_game_result_edit
  before update on public.team_games
  for each row execute function public.guard_team_game_result_edit();

revoke all on function public.guard_team_game_result_edit() from public;
