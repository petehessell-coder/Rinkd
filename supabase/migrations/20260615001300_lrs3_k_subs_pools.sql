-- ============================================================================
-- LRS-1 Phase 3 / Migration K — ESHL subs pools + identity-keyed sub stats
-- Branch: feature/lineup-roster-subs (stacks on Migrations H + I + J).
--
-- A subs pool IS a league_team (the brief's core design move): it reuses the
-- team primitive, so it gets a page, a roster (join requests, manager
-- invites), stats, and a feed for free. What's new here is only:
--   1. the flag (is_sub_pool + kind) — two pools per division, skaters and
--      goalies;
--   2. NON-SCHEDULED enforcement — a DB trigger refuses any league_games row
--      that names a pool as home or away. Standings need no change: the
--      league_standings view derives teams purely from games played, so a
--      team that can never be scheduled can never appear. The client also
--      filters pools out of the scheduler/playoff/game pickers, but this
--      trigger is the backstop that makes "never in schedule/standings" a
--      database invariant rather than a UI convention;
--   3. day-of pull = a plain game_lineups row for a user with NO
--      team_members row on the playing team — written through set_lineup, so
--      Migration H's minor gate fires unchanged: an ADULT sub passes, a
--      MINOR sub (anchored to the pool, not the playing team) is BLOCKED by
--      design until a consented sub path exists. This migration adds no new
--      lineup write path on purpose;
--   4. identity-keyed league skater stats — the brief's "sub stats key on
--      user_id, NOT jersey". get_league_skater_stats now attributes each
--      stat event through the GAME'S OWN lineup first (game+team+jersey →
--      coalesce(player_id, user_id)) and only falls back to the season
--      roster mapping when the game has no lineup identity for that jersey.
--      A sub wearing #42 for one night gets their goals; the rostered
--      #42-wearer keeps theirs in every other game. Rows collapse by
--      IDENTITY across jersey changes; pure ghosts stay jersey-keyed
--      exactly as before. GP becomes lineup-appearances when the player
--      appears on lineups (falls back to team GP otherwise — the legacy
--      behavior for leagues that never set lineups). KNOWN TRADEOFF: in a
--      league with PARTIAL lineup coverage, a rostered player with no lineup
--      rows of their own still reads team GP, which can overstate their
--      games — accepted, since the alternative (guessing absences) is worse;
--      full lineup adoption converges to exact GP. Goalie boards are
--      untouched: goalie-sub stats stay gated on GOALIE-1 per the brief.
--
-- Prod collision audit (Jun 11, the Migration-J lesson): league_teams has
-- neither column, no function/index/trigger name below exists on prod, and
-- league_games has no triggers at all.
-- ============================================================================

-- 1 ── Pool flag ─────────────────────────────────────────────────────────────
alter table public.league_teams
  add column if not exists is_sub_pool boolean not null default false,
  add column if not exists sub_pool_kind text
    check (sub_pool_kind in ('skaters', 'goalies'));

comment on column public.league_teams.is_sub_pool is
  'LRS-1 P3: this league_team is a subs pool — roster/stats/feed via the team primitive, but never schedulable (tr_block_sub_pool_scheduling) and excluded from standings/boards.';

alter table public.league_teams
  drop constraint if exists league_teams_sub_pool_kind_consistency;
alter table public.league_teams
  add constraint league_teams_sub_pool_kind_consistency
  check (is_sub_pool = (sub_pool_kind is not null));

-- Two pools per division (skaters + goalies); NULL division_id (single-
-- division league) collapses to a sentinel so the uniqueness still binds.
create unique index if not exists league_teams_sub_pool_unique
  on public.league_teams (league_id, coalesce(division_id, '00000000-0000-0000-0000-000000000000'::uuid), sub_pool_kind)
  where is_sub_pool;

-- Adversarial review (P1): the existing league_teams policies are loose —
-- INSERT is any authed user and UPDATE is any league MANAGER — so without a
-- guard, a team manager could flip is_sub_pool=true on an OPPONENT's team,
-- vanishing it from pickers/standings and making it unschedulable. The pool
-- designation is commissioner-only: this trigger gates any INSERT carrying
-- the flag and any UPDATE that changes it. create_league_sub_pools passes
-- because auth.uid() (the commissioner caller) flows through SECURITY
-- DEFINER; service-role writes (seeds/admin) pass via current_user.
create or replace function public.tg_protect_sub_pool_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_sub_pool then return new; end if;
  else
    if new.is_sub_pool = old.is_sub_pool
       and new.sub_pool_kind is not distinct from old.sub_pool_kind then
      return new;
    end if;
  end if;
  if current_user = 'service_role' then return new; end if;
  if public.is_league_commissioner(new.league_id, (select auth.uid())) then
    return new;
  end if;
  raise exception 'only a league commissioner can designate a subs pool'
    using errcode = '42501';
end $$;
revoke all on function public.tg_protect_sub_pool_flag() from public;

drop trigger if exists tr_protect_sub_pool_flag on public.league_teams;
create trigger tr_protect_sub_pool_flag
  before insert or update of is_sub_pool, sub_pool_kind on public.league_teams
  for each row execute function public.tg_protect_sub_pool_flag();

-- 2 ── Non-scheduled enforcement ─────────────────────────────────────────────
create or replace function public.tg_block_sub_pool_scheduling()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.league_teams lt
    where lt.id in (new.home_team_id, new.away_team_id) and lt.is_sub_pool
  ) then
    raise exception 'a subs pool cannot be scheduled into a game'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.tg_block_sub_pool_scheduling() from public;

drop trigger if exists tr_block_sub_pool_scheduling on public.league_games;
create trigger tr_block_sub_pool_scheduling
  before insert or update of home_team_id, away_team_id on public.league_games
  for each row execute function public.tg_block_sub_pool_scheduling();

-- 3 ── Pool creation RPC ─────────────────────────────────────────────────────
-- Creates the skaters + goalies pools for a league (optionally per division):
-- a backing teams row each (so the roster/feed/join-request machinery works),
-- the commissioner as manager (manager_id + a team_members manager row, the
-- createTeam shape), and the flagged league_teams row. Idempotent — a pool
-- that already exists for (league, division, kind) is skipped, so re-running
-- after adding a division only fills the gap. SECURITY DEFINER with a
-- fail-closed commissioner check (it inserts across three tables).
create or replace function public.create_league_sub_pools(
  p_league_id uuid, p_division_id uuid default null
) returns setof public.league_teams
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_div_name text;
  v_kind text;
  v_label text;
  v_team_id uuid;
  v_lt public.league_teams;
begin
  if v_uid is null or not public.is_league_commissioner(p_league_id, v_uid) then
    raise exception 'only a league commissioner can create sub pools'
      using errcode = '42501';
  end if;
  if p_division_id is not null then
    select d.name into v_div_name
    from public.league_divisions d
    where d.id = p_division_id and d.league_id = p_league_id;
    if v_div_name is null then
      raise exception 'division does not belong to this league';
    end if;
  end if;

  foreach v_kind in array array['skaters', 'goalies'] loop
    if exists (
      select 1 from public.league_teams lt
      where lt.league_id = p_league_id
        and lt.division_id is not distinct from p_division_id
        and lt.is_sub_pool and lt.sub_pool_kind = v_kind
    ) then
      continue;
    end if;
    v_label := initcap(v_kind) || ' Sub Pool' || coalesce(' — ' || v_div_name, '');

    insert into public.teams (name, manager_id, is_public)
    values (v_label, v_uid, true)
    returning id into v_team_id;
    -- createTeam parity: the founder holds a manager roster row too
    -- (is_team_manager checks both shapes).
    insert into public.team_members (team_id, user_id, role, status)
    values (v_team_id, v_uid, 'manager', 'active');

    insert into public.league_teams
      (league_id, team_id, team_name, division_id, is_sub_pool, sub_pool_kind)
    values
      (p_league_id, v_team_id, v_label, p_division_id, true, v_kind)
    returning * into v_lt;
    return next v_lt;
  end loop;
  return;
end $$;
revoke all on function public.create_league_sub_pools(uuid, uuid) from public, anon;
grant execute on function public.create_league_sub_pools(uuid, uuid) to authenticated, service_role;

-- 4 ── Identity-keyed league skater stats ────────────────────────────────────
-- Same signature as Migration I (additive shape preserved: deployed clients
-- keep working). Attribution order per stat event (game, team, jersey):
--   1. the game's own lineup — coalesce(player_id, user_id) for that jersey
--      in THAT game (a jersey worn by two identities in one game is a data
--      error and fails closed to the roster fallback);
--   2. the season-roster jersey mapping (legacy path);
--   3. nothing → jersey-keyed ghost row ('#42'), exactly as before.
-- Rows are keyed by identity when known (jersey changes collapse into one
-- player), by team+jersey otherwise. Sub-pool teams never seed rows: their
-- members' stats attach to the team they subbed FOR via path 1.
drop function if exists public.get_league_skater_stats(uuid);
create function public.get_league_skater_stats(p_league_id uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with lgames as (
    select id, home_team_id, away_team_id, status from public.league_games where league_id = p_league_id
  ),
  -- (game, team, jersey) → the ONE identity who wore it that night.
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl join lgames on lgames.id = gl.game_id
    where gl.game_source = 'league' and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  -- per-identity lineup presence on a team: GP + goalie flag
  ident_apps as (
    select gl.team_id, coalesce(gl.player_id, gl.user_id) as identity,
           count(distinct gl.game_id)::int as gp,
           bool_or(coalesce(gl.is_goalie, false)) as is_goalie
    from public.game_lineups gl join lgames on lgames.id = gl.game_id
    where gl.game_source = 'league' and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.team_id, coalesce(gl.player_id, gl.user_id)
  ),
  -- season roster, jersey-keyed (legacy fallback; sub pools excluded)
  roster as (
    select distinct on (lt.id, tm.jersey_number)
      lt.id as lt_id, tm.jersey_number as jersey,
      coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) as player_name,
      (tm.position = 'Goalie') as is_goalie,
      tm.user_id as player_id
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.jersey_number is not null
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id and coalesce(lt.is_sub_pool, false) = false
    order by lt.id, tm.jersey_number, (coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) is not null) desc, tm.user_id
  ),
  -- season roster, identity-keyed (names/goalie flag for identity rows)
  roster_ident as (
    select distinct on (lt.id, tm.user_id)
      lt.id as lt_id, tm.user_id as identity,
      coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) as player_name,
      (tm.position = 'Goalie') as is_goalie
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.user_id is not null
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id and coalesce(lt.is_sub_pool, false) = false
    order by lt.id, tm.user_id, tm.jersey_number
  ),
  team_gp as (
    select lt_id, count(*)::int as gp from (
      select home_team_id as lt_id from lgames where status = 'final'
      union all
      select away_team_id from lgames where status = 'final'
    ) z group by lt_id
  ),
  events as (
    select gg.game_id, gg.team_id, gg.scorer_number as jersey, 1 as goals, 0 as assists, 0 as pim
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where gg.game_source = 'league' and coalesce(gg.is_shootout, false) = false and gg.scorer_number is not null
    union all
    select gg.game_id, gg.team_id, gg.assist1_number, 0, 1, 0
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where gg.game_source = 'league' and coalesce(gg.is_shootout, false) = false and gg.assist1_number is not null
    union all
    select gg.game_id, gg.team_id, gg.assist2_number, 0, 1, 0
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where gg.game_source = 'league' and coalesce(gg.is_shootout, false) = false and gg.assist2_number is not null
    union all
    select gp.game_id, gp.team_id, gp.player_number, 0, 0, coalesce(gp.duration_minutes, 0)
    from public.game_penalties gp join lgames on lgames.id = gp.game_id
    where gp.game_source = 'league' and gp.player_number is not null
  ),
  attributed as (
    select e.team_id, e.jersey, e.goals, e.assists, e.pim,
           coalesce(li.identity, r.player_id) as identity
    from events e
    left join lineup_ident li
      on li.game_id = e.game_id and li.team_id = e.team_id and li.jersey = e.jersey
    left join roster r
      on r.lt_id = e.team_id and r.jersey = e.jersey
  ),
  agg as (
    select team_id, identity,
           case when identity is null then jersey end as ghost_jersey,
           max(jersey) as last_jersey,
           sum(goals)::int as goals, sum(assists)::int as assists, sum(pim)::int as pim
    from attributed
    group by team_id, identity, case when identity is null then jersey end
  ),
  keyed as (
    select team_id, identity, ghost_jersey, last_jersey, goals, assists, pim from agg
    union all
    -- full roster listing: rostered players with no attributed events
    select r.lt_id, r.player_id,
           case when r.player_id is null then r.jersey end,
           r.jersey, 0, 0, 0
    from roster r
    where not exists (
      select 1 from agg a
      where a.team_id = r.lt_id
        and ((r.player_id is not null and a.identity = r.player_id)
          or (r.player_id is null and a.ghost_jersey = r.jersey))
    )
  )
  select
    k.team_id,
    coalesce(t.name, lt.team_name) as team_name,
    k.last_jersey as jersey_number,
    coalesce(pr.name, pr.handle, ri.player_name, rg.player_name, '#' || k.last_jersey) as player_name,
    coalesce(ia.gp, tg.gp, 0) as gp,
    k.goals, k.assists,
    k.goals + k.assists as points,
    k.pim,
    round((k.goals + k.assists)::numeric / nullif(coalesce(ia.gp, tg.gp), 0), 2) as points_per_game,
    coalesce(ia.is_goalie, ri.is_goalie, rg.is_goalie, false) as is_goalie,
    public.shield_minor_player_id(k.identity) as player_id
  from keyed k
  left join ident_apps ia on ia.team_id = k.team_id and ia.identity = k.identity
  left join roster_ident ri on ri.lt_id = k.team_id and ri.identity = k.identity
  left join roster rg on k.identity is null and rg.lt_id = k.team_id and rg.jersey = k.ghost_jersey
  left join public.profiles pr on pr.id = k.identity
  left join team_gp tg on tg.lt_id = k.team_id
  join public.league_teams lt on lt.id = k.team_id
  left join public.teams t on t.id = lt.team_id
  order by points desc, goals desc, pim asc;
$function$;
grant execute on function public.get_league_skater_stats(uuid) to anon, authenticated, service_role;
