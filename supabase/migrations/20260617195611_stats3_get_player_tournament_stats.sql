-- STATS-3 Step 1: per-(tournament, team) skater stats for a player, mirroring
-- get_player_league_stats but anchored on game_lineups.user_id (tournaments
-- have no team_members link). SECURITY INVOKER + STABLE to match the league RPC.
create or replace function public.get_player_tournament_stats(p_user_id uuid)
returns table(
  tournament_id uuid, tournament_name text, division text,
  team_id uuid, team_name text, jersey_number integer,
  gp integer, goals integer, assists integer, points integer, pim integer
)
language sql stable set search_path to 'public' as $$
  with my_lineups as (   -- tournament games this user actually appeared in (+ jersey + team)
    select distinct gl.game_id, gl.team_id, gl.jersey_number as jersey
    from public.game_lineups gl
    where gl.user_id = p_user_id
      and gl.game_source = 'tournament'
      and gl.jersey_number is not null
  ),
  my_games as (          -- restrict to finalized tournament games
    select ml.game_id, ml.team_id, ml.jersey, g.tournament_id
    from my_lineups ml
    join public.games g on g.id = ml.game_id
    where g.tournament_id is not null and g.status = 'final'
  ),
  appearances as (
    select tournament_id, team_id, jersey, count(distinct game_id)::int as gp
    from my_games group by tournament_id, team_id, jersey
  ),
  goals_cte as (
    select mg.tournament_id, mg.team_id, mg.jersey, count(*)::int as goals
    from public.game_goals gg
    join my_games mg on mg.game_id = gg.game_id and mg.team_id = gg.team_id
    where (gg.game_source is null or gg.game_source = 'tournament')
      and coalesce(gg.is_shootout, false) = false
      and gg.scorer_number = mg.jersey
    group by mg.tournament_id, mg.team_id, mg.jersey
  ),
  assists_cte as (
    select mg.tournament_id, mg.team_id, mg.jersey, count(*)::int as assists
    from public.game_goals gg
    join my_games mg on mg.game_id = gg.game_id and mg.team_id = gg.team_id
    where (gg.game_source is null or gg.game_source = 'tournament')
      and coalesce(gg.is_shootout, false) = false
      and (gg.assist1_number = mg.jersey or gg.assist2_number = mg.jersey)
    group by mg.tournament_id, mg.team_id, mg.jersey
  ),
  pim_cte as (
    select mg.tournament_id, mg.team_id, mg.jersey, sum(coalesce(gp.duration_minutes,0))::int as pim
    from public.game_penalties gp
    join my_games mg on mg.game_id = gp.game_id and mg.team_id = gp.team_id
    where (gp.game_source is null or gp.game_source = 'tournament')
      and gp.player_number = mg.jersey
    group by mg.tournament_id, mg.team_id, mg.jersey
  )
  select
    ap.tournament_id,
    t.name as tournament_name,
    coalesce(td.name, '') as division,
    ap.team_id,
    tt.team_name,
    ap.jersey as jersey_number,
    ap.gp,
    coalesce(g.goals,0)  as goals,
    coalesce(a.assists,0) as assists,
    coalesce(g.goals,0) + coalesce(a.assists,0) as points,
    coalesce(pm.pim,0)   as pim
  from appearances ap
  join public.tournaments t        on t.id  = ap.tournament_id
  left join public.tournament_teams tt on tt.id = ap.team_id
  left join public.tournament_divisions td on td.id = tt.division_id
  left join goals_cte   g  on g.tournament_id=ap.tournament_id  and g.team_id=ap.team_id  and g.jersey=ap.jersey
  left join assists_cte a  on a.tournament_id=ap.tournament_id  and a.team_id=ap.team_id  and a.jersey=ap.jersey
  left join pim_cte     pm on pm.tournament_id=ap.tournament_id and pm.team_id=ap.team_id and pm.jersey=ap.jersey
  order by points desc, goals desc, pim asc;
$$;

-- mirror get_player_league_stats grants (anon + authenticated; service_role +
-- postgres come from Supabase default privileges, matching the league RPC).
grant execute on function public.get_player_tournament_stats(uuid) to anon, authenticated;
