-- ============================================================================
-- LRS-1 Phase 1 / Migration I — leaderboard RPCs expose player_id
-- Depends on: Migration H (game_lineups.player_id).
--
-- Adds a `player_id uuid` column to all four stat RPCs so the boards can link
-- jersey-keyed rows to real profiles (the GS-5 payoff). Identity source:
--   league boards:      team_members.user_id (the REG roster)
--   tournament boards:  coalesce(game_lineups.player_id, game_lineups.user_id)
-- Name resolution on the tournament boards now also prefers the resolved
-- profile, so a ghost row that the resolver attributed shows the player's
-- real name instead of '#42'.
--
-- Additive JSON field over PostgREST — deployed clients ignore it. The return
-- type changes, so each function is DROPped and recreated with the exact
-- prior attributes (SQL, STABLE, SECURITY INVOKER, search_path=public) and
-- grants (anon, authenticated, service_role — the boards are login-gated in
-- the client, not at the RPC layer; unchanged here).
--
-- MINOR SHIELD: player NAMES on the boards are pre-existing public surface,
-- but a minor's stable profiles.id is new exposure — so player_id is nulled
-- for ANON callers when the profile is a minor (signed-in users keep the
-- profile link; matches the login-gated app surface where minor profiles are
-- already reachable via rosters). Adults are returned to everyone.
-- ============================================================================

-- 0 ── Anon-shield helper ────────────────────────────────────────────────────
create or replace function public.shield_minor_player_id(p_player_id uuid)
returns uuid language sql stable security invoker set search_path = public as $$
  select case
    when p_player_id is not null
     and auth.uid() is null
     and public.is_minor_profile(p_player_id) then null
    else p_player_id
  end;
$$;
revoke all on function public.shield_minor_player_id(uuid) from public;
grant execute on function public.shield_minor_player_id(uuid) to anon, authenticated, service_role;

-- 1 ── get_league_skater_stats ───────────────────────────────────────────────
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
  goals_cte as (
    select gg.team_id, gg.scorer_number as jersey, count(*)::int as goals
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where gg.game_source='league' and coalesce(gg.is_shootout,false)=false and gg.scorer_number is not null
    group by gg.team_id, gg.scorer_number
  ),
  assists_cte as (
    select team_id, jersey, count(*)::int as assists from (
      select gg.team_id, gg.assist1_number as jersey from public.game_goals gg join lgames on lgames.id=gg.game_id
        where gg.game_source='league' and coalesce(gg.is_shootout,false)=false and gg.assist1_number is not null
      union all
      select gg.team_id, gg.assist2_number from public.game_goals gg join lgames on lgames.id=gg.game_id
        where gg.game_source='league' and coalesce(gg.is_shootout,false)=false and gg.assist2_number is not null
    ) a group by team_id, jersey
  ),
  pim_cte as (
    select gp.team_id, gp.player_number as jersey, sum(coalesce(gp.duration_minutes,0))::int as pim
    from public.game_penalties gp join lgames on lgames.id = gp.game_id
    where gp.game_source='league' and gp.player_number is not null
    group by gp.team_id, gp.player_number
  ),
  team_gp as (
    select lt_id, count(*)::int as gp from (
      select home_team_id as lt_id from lgames where status='final'
      union all
      select away_team_id from lgames where status='final'
    ) z group by lt_id
  ),
  roster as (
    select distinct on (lt.id, tm.jersey_number)
      lt.id as lt_id, tm.jersey_number as jersey,
      coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) as player_name,
      (tm.position = 'Goalie') as is_goalie,
      tm.user_id as player_id
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.jersey_number is not null
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id
    -- tm.user_id tiebreak: a shared jersey must pick the SAME row (and thus
    -- the same player_id) on every call, not flap between two profiles.
    order by lt.id, tm.jersey_number, (coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) is not null) desc, tm.user_id
  ),
  keys as (
    select team_id, jersey from goals_cte
    union select team_id, jersey from assists_cte
    union select team_id, jersey from pim_cte
    union select lt_id, jersey from roster
  )
  select
    k.team_id,
    coalesce(t.name, lt.team_name) as team_name,
    k.jersey as jersey_number,
    coalesce(r.player_name, '#'||k.jersey) as player_name,
    coalesce(tg.gp, 0) as gp,
    coalesce(g.goals,0) as goals,
    coalesce(a.assists,0) as assists,
    coalesce(g.goals,0)+coalesce(a.assists,0) as points,
    coalesce(pm.pim,0) as pim,
    round((coalesce(g.goals,0)+coalesce(a.assists,0))::numeric / nullif(tg.gp,0), 2) as points_per_game,
    coalesce(r.is_goalie, false) as is_goalie,
    public.shield_minor_player_id(r.player_id) as player_id
  from keys k
  left join goals_cte g on g.team_id=k.team_id and g.jersey=k.jersey
  left join assists_cte a on a.team_id=k.team_id and a.jersey=k.jersey
  left join pim_cte pm on pm.team_id=k.team_id and pm.jersey=k.jersey
  left join roster r on r.lt_id=k.team_id and r.jersey=k.jersey
  left join team_gp tg on tg.lt_id=k.team_id
  join public.league_teams lt on lt.id = k.team_id
  left join public.teams t on t.id = lt.team_id
  order by points desc, goals desc, pim asc;
$function$;
grant execute on function public.get_league_skater_stats(uuid) to anon, authenticated, service_role;

-- 2 ── get_league_goalie_stats ───────────────────────────────────────────────
-- Per-team goaltending, attributed to the roster goalie when a team has
-- exactly one (n = 1) — player_id follows the same rule.
drop function if exists public.get_league_goalie_stats(uuid);
create function public.get_league_goalie_stats(p_league_id uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with lf as (
    select home_team_id as lt_id, away_team_id as opp_id, id as game_id,
           home_score as gf, away_score as ga
    from public.league_games where league_id = p_league_id and status='final'
    union all
    select away_team_id, home_team_id, id, away_score, home_score
    from public.league_games where league_id = p_league_id and status='final'
  ),
  team_shots as (
    select game_id, team_id, sum(count)::int as sa
    from public.game_shots where game_source='league'
    group by game_id, team_id
  ),
  per_team as (
    select lf.lt_id,
      count(*)::int as gp,
      sum(lf.ga)::int as goals_against,
      coalesce(sum(ts.sa),0)::int as shots_against,
      count(*) filter (where lf.gf > lf.ga)::int as wins,
      count(*) filter (where lf.gf < lf.ga)::int as losses,
      count(*) filter (where lf.gf = lf.ga)::int as ties,
      count(*) filter (where lf.ga = 0)::int as shutouts
    from lf
    left join team_shots ts on ts.game_id = lf.game_id and ts.team_id = lf.opp_id
    group by lf.lt_id
  ),
  goalies as (
    select lt.id as lt_id, count(*) as n,
      max(tm.jersey_number) as jersey,
      max(coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle)) as gname,
      max(tm.user_id::text) as guid
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.position = 'Goalie'
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id
    group by lt.id
  )
  select
    pt.lt_id as team_id,
    coalesce(t.name, lt.team_name) as team_name,
    case when g.n = 1 then g.jersey else null end as jersey_number,
    case when g.n = 1 then g.gname else coalesce(t.name, lt.team_name) || ' (goaltending)' end as goalie_name,
    pt.gp, pt.shots_against, pt.goals_against,
    round((pt.shots_against - pt.goals_against)::numeric / nullif(pt.shots_against,0), 3) as save_pct,
    round(pt.goals_against::numeric / nullif(pt.gp,0), 2) as gaa,
    pt.wins, pt.losses, pt.ties, pt.shutouts,
    public.shield_minor_player_id(case when g.n = 1 then g.guid::uuid else null end) as player_id
  from per_team pt
  join public.league_teams lt on lt.id = pt.lt_id
  left join public.teams t on t.id = lt.team_id
  left join goalies g on g.lt_id = pt.lt_id
  order by gaa asc nulls last;
$function$;
grant execute on function public.get_league_goalie_stats(uuid) to anon, authenticated, service_role;

-- 3 ── get_tournament_skater_stats ───────────────────────────────────────────
drop function if exists public.get_tournament_skater_stats(uuid, uuid);
create function public.get_tournament_skater_stats(p_tournament_id uuid, p_division_id uuid default null::uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with tgames as (
    select id from public.games
    where tournament_id = p_tournament_id
      and (p_division_id is null or division_id = p_division_id)
  ),
  goals_cte as (
    select gg.team_id, gg.scorer_number as jersey, count(*)::int as goals
    from public.game_goals gg
    join tgames on tgames.id = gg.game_id
    where gg.game_source = 'tournament'
      and coalesce(gg.is_shootout,false) = false
      and gg.scorer_number is not null
    group by gg.team_id, gg.scorer_number
  ),
  assists_cte as (
    select team_id, jersey, count(*)::int as assists
    from (
      select gg.team_id, gg.assist1_number as jersey
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where gg.game_source='tournament' and coalesce(gg.is_shootout,false)=false and gg.assist1_number is not null
      union all
      select gg.team_id, gg.assist2_number
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where gg.game_source='tournament' and coalesce(gg.is_shootout,false)=false and gg.assist2_number is not null
    ) a
    group by team_id, jersey
  ),
  pim_cte as (
    select gp.team_id, gp.player_number as jersey, sum(coalesce(gp.duration_minutes,0))::int as pim
    from public.game_penalties gp
    join tgames on tgames.id = gp.game_id
    where gp.game_source='tournament' and gp.player_number is not null
    group by gp.team_id, gp.player_number
  ),
  appearances as (
    select team_id, jersey, count(distinct game_id)::int as gp
    from (
      select gl.team_id, gl.jersey_number as jersey, gl.game_id
      from public.game_lineups gl join tgames on tgames.id = gl.game_id
      where gl.game_source='tournament' and gl.jersey_number is not null
      union
      select gg.team_id, gg.scorer_number, gg.game_id
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where gg.game_source='tournament' and gg.scorer_number is not null
    ) ap
    group by team_id, jersey
  ),
  goalie_flag as (
    select gl.team_id, gl.jersey_number as jersey, bool_or(gl.is_goalie) as is_goalie
    from public.game_lineups gl join tgames on tgames.id = gl.game_id
    where gl.game_source='tournament' and gl.jersey_number is not null
    group by gl.team_id, gl.jersey_number
  ),
  names as (
    select distinct on (gl.team_id, gl.jersey_number)
      gl.team_id, gl.jersey_number as jersey,
      coalesce(nullif(trim(gl.invite_name),''), pr.name, pr.handle) as player_name,
      coalesce(gl.player_id, gl.user_id) as player_id
    from public.game_lineups gl
    join tgames on tgames.id = gl.game_id
    left join public.profiles pr on pr.id = coalesce(gl.player_id, gl.user_id)
    where gl.game_source='tournament' and gl.jersey_number is not null
    order by gl.team_id, gl.jersey_number,
      (coalesce(nullif(trim(gl.invite_name),''), pr.name, pr.handle) is not null) desc,
      (coalesce(gl.player_id, gl.user_id) is not null) desc,
      gl.created_at desc,
      gl.id
  ),
  keys as (
    select team_id, jersey from goals_cte
    union select team_id, jersey from assists_cte
    union select team_id, jersey from pim_cte
    union select team_id, jersey from appearances
  )
  select
    k.team_id,
    tt.team_name,
    k.jersey as jersey_number,
    coalesce(nm.player_name, '#'||k.jersey) as player_name,
    coalesce(ap.gp,0) as gp,
    coalesce(g.goals,0) as goals,
    coalesce(a.assists,0) as assists,
    coalesce(g.goals,0)+coalesce(a.assists,0) as points,
    coalesce(pm.pim,0) as pim,
    round((coalesce(g.goals,0)+coalesce(a.assists,0))::numeric / nullif(ap.gp,0), 2) as points_per_game,
    coalesce(gf.is_goalie,false) as is_goalie,
    public.shield_minor_player_id(nm.player_id) as player_id
  from keys k
  left join goals_cte g on g.team_id=k.team_id and g.jersey=k.jersey
  left join assists_cte a on a.team_id=k.team_id and a.jersey=k.jersey
  left join pim_cte pm on pm.team_id=k.team_id and pm.jersey=k.jersey
  left join appearances ap on ap.team_id=k.team_id and ap.jersey=k.jersey
  left join names nm on nm.team_id=k.team_id and nm.jersey=k.jersey
  left join goalie_flag gf on gf.team_id=k.team_id and gf.jersey=k.jersey
  join public.tournament_teams tt on tt.id = k.team_id
  order by points desc, goals desc, pim asc;
$function$;
grant execute on function public.get_tournament_skater_stats(uuid, uuid) to anon, authenticated, service_role;

-- 4 ── get_tournament_goalie_stats ───────────────────────────────────────────
drop function if exists public.get_tournament_goalie_stats(uuid, uuid);
create function public.get_tournament_goalie_stats(p_tournament_id uuid, p_division_id uuid default null::uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql
 stable
 set search_path to 'public'
as $function$
  with fgames as (
    select id, home_team_id, away_team_id, home_score, away_score, shootout_winner
    from public.games
    where tournament_id = p_tournament_id and status = 'final'
      and (p_division_id is null or division_id = p_division_id)
  ),
  goalie_rec as (
    select distinct on (gl.game_id, gl.team_id)
      gl.game_id, gl.team_id, gl.jersey_number,
      coalesce(nullif(trim(gl.invite_name),''), pr.name, pr.handle) as goalie_name,
      coalesce(gl.player_id, gl.user_id) as player_id
    from public.game_lineups gl
    join fgames fg on fg.id = gl.game_id
    left join public.profiles pr on pr.id = coalesce(gl.player_id, gl.user_id)
    where gl.game_source='tournament' and gl.is_goalie = true and gl.jersey_number is not null
    order by gl.game_id, gl.team_id, gl.is_starter desc nulls last, gl.created_at asc, gl.id
  ),
  per_game as (
    select
      gr.team_id, gr.jersey_number, gr.goalie_name, gr.player_id, fg.id as game_id,
      (gr.team_id = fg.home_team_id) as team_is_home,
      case when gr.team_id = fg.home_team_id then fg.home_score else fg.away_score end as team_score,
      case when gr.team_id = fg.home_team_id then fg.away_score else fg.home_score end as opp_score,
      fg.shootout_winner,
      (select count(*) from public.game_goals gg
        where gg.game_id = fg.id and gg.game_source='tournament'
          and gg.team_id = case when gr.team_id = fg.home_team_id then fg.away_team_id else fg.home_team_id end
          and coalesce(gg.is_shootout,false)=false)::int as ga,
      coalesce((select sum(gs.count) from public.game_shots gs
        where gs.game_id = fg.id and gs.game_source='tournament'
          and gs.team_id = case when gr.team_id = fg.home_team_id then fg.away_team_id else fg.home_team_id end),0)::int as sa
    from goalie_rec gr
    join fgames fg on fg.id = gr.game_id
  ),
  scored as (
    select pg.*,
      case
        when pg.team_score > pg.opp_score then 'W'
        when pg.team_score < pg.opp_score then 'L'
        when pg.shootout_winner = 'home' then case when pg.team_is_home then 'W' else 'L' end
        when pg.shootout_winner = 'away' then case when pg.team_is_home then 'L' else 'W' end
        else 'T'
      end as result
    from per_game pg
  )
  select
    s.team_id,
    tt.team_name,
    s.jersey_number,
    max(s.goalie_name) as goalie_name,
    count(*)::int as gp,
    sum(s.sa)::int as shots_against,
    sum(s.ga)::int as goals_against,
    round((sum(s.sa)-sum(s.ga))::numeric / nullif(sum(s.sa),0), 3) as save_pct,
    round(sum(s.ga)::numeric / nullif(count(*),0), 2) as gaa,
    count(*) filter (where s.result='W')::int as wins,
    count(*) filter (where s.result='L')::int as losses,
    count(*) filter (where s.result='T')::int as ties,
    count(*) filter (where s.ga=0)::int as shutouts,
    public.shield_minor_player_id(max(s.player_id::text)::uuid) as player_id
  from scored s
  join public.tournament_teams tt on tt.id = s.team_id
  group by s.team_id, tt.team_name, s.jersey_number
  order by gaa asc nulls last, save_pct desc;
$function$;
grant execute on function public.get_tournament_goalie_stats(uuid, uuid) to anon, authenticated, service_role;
