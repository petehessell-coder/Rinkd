-- ============================================================================
-- YOUTH-PRIVACY · Migration D — no minor profile pages + results-only summary
-- ----------------------------------------------------------------------------
-- (1) Minor profiles are excluded from the profile stat RPCs (defense in depth
--     alongside the frontend 404). Minor stats render ONLY at team/event level
--     (leaderboards/scoresheets/recaps), jersey-keyed + shielded.
-- (2) public_team_summary() is the results-ONLY public read path for any team:
--     name, logo, record, and recent FINAL scores (date + opponent only). It
--     carries NO roster, NO contacts, NO schedule times, NO locations — so it
--     is safe to surface a youth team to a stranger.
-- ============================================================================

-- (1a) tournament profile stats — return nothing for a minor profile.
create or replace function public.get_player_tournament_stats(p_user_id uuid)
 returns table(tournament_id uuid, tournament_name text, division text, team_id uuid, team_name text, jersey_number integer, gp integer, goals integer, assists integer, points integer, pim integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with my_lineups as (   -- tournament games this user actually appeared in (+ jersey + team)
    select distinct gl.game_id, gl.team_id, gl.jersey_number as jersey
    from public.game_lineups gl
    where gl.user_id = p_user_id
      and not public.is_minor_profile(p_user_id)   -- YOUTH-PRIVACY: no minor profile stats
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
$function$;

-- (1b) league profile stats — early-return for a minor profile.
create or replace function public.get_player_league_stats(p_user_id uuid)
 returns table(league_id uuid, league_name text, season text, division text, team_id uuid, team_name text, team_logo_color text, team_logo_initials text, jersey_number integer, gp integer, goals integer, assists integer, points integer, pim integer)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
DECLARE
  m RECORD; lt RECORD;
  v_finals uuid[]; v_player_lineup uuid[]; v_total_lineups integer;
  v_window uuid[]; v_gp integer; v_goals integer; v_assists integer; v_pim integer;
BEGIN
  IF public.is_minor_profile(p_user_id) THEN RETURN; END IF;  -- YOUTH-PRIVACY: no minor profile stats
  FOR m IN
    SELECT tm.team_id AS tm_team_id, tm.jersey_number AS jersey,
           t.name AS tname, t.logo_color AS tcolor, t.logo_initials AS tinitials
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = p_user_id AND tm.status = 'active' AND tm.jersey_number IS NOT NULL
  LOOP
    FOR lt IN
      SELECT lte.id AS lt_id, lte.league_id AS lg_id,
             l.name AS lname, l.season AS lseason, l.division AS ldivision
      FROM league_teams lte JOIN leagues l ON l.id = lte.league_id
      WHERE lte.team_id = m.tm_team_id
    LOOP
      SELECT array_agg(lg.id) INTO v_finals FROM league_games lg
      WHERE (lg.home_team_id = lt.lt_id OR lg.away_team_id = lt.lt_id) AND lg.status = 'final';
      IF v_finals IS NULL OR array_length(v_finals,1) IS NULL THEN CONTINUE; END IF;

      SELECT array_agg(gl.game_id) INTO v_player_lineup FROM game_lineups gl
      WHERE gl.team_id = lt.lt_id AND gl.user_id = p_user_id AND gl.game_id = ANY(v_finals);
      SELECT count(*) INTO v_total_lineups FROM game_lineups gl
      WHERE gl.team_id = lt.lt_id AND gl.game_id = ANY(v_finals);

      IF v_total_lineups > 0 THEN v_window := COALESCE(v_player_lineup, ARRAY[]::uuid[]);
      ELSE v_window := v_finals; END IF;
      IF array_length(v_window,1) IS NULL THEN CONTINUE; END IF;
      v_gp := array_length(v_window,1);

      SELECT count(*) INTO v_goals FROM game_goals gg
      WHERE gg.game_id = ANY(v_window) AND gg.team_id = lt.lt_id AND gg.scorer_number = m.jersey;
      SELECT count(*) INTO v_assists FROM game_goals gg
      WHERE gg.game_id = ANY(v_window) AND gg.team_id = lt.lt_id
        AND (gg.assist1_number = m.jersey OR gg.assist2_number = m.jersey);
      SELECT COALESCE(sum(pen.duration_minutes),0) INTO v_pim FROM game_penalties pen
      WHERE pen.game_id = ANY(v_window) AND pen.team_id = lt.lt_id AND pen.player_number = m.jersey;

      IF v_goals = 0 AND v_assists = 0 AND v_pim = 0 AND v_gp = 0 THEN CONTINUE; END IF;

      league_id := lt.lg_id; league_name := lt.lname; season := lt.lseason; division := lt.ldivision;
      team_id := m.tm_team_id; team_name := m.tname;
      team_logo_color := m.tcolor; team_logo_initials := m.tinitials;
      jersey_number := m.jersey; gp := v_gp; goals := v_goals; assists := v_assists;
      points := v_goals + v_assists; pim := v_pim;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  RETURN;
END; $function$;

-- (2) Results-only public summary (safe for youth: no roster/contacts/locations/times).
create or replace function public.public_team_summary(p_team_id uuid)
returns table(
  team_id uuid, name text, logo_color text, logo_initials text, logo_url text,
  division text, is_youth boolean, visibility text,
  games_played int, wins int, losses int, ties int, goals_for int, goals_against int,
  recent jsonb
)
language sql stable security definer set search_path to 'public'
as $function$
  with t as (select * from public.teams where id = p_team_id),
  finals as (
    select tg.start_time::date as game_date, tg.opponent,
      case when tg.is_home then tg.home_score else tg.away_score end as gf,
      case when tg.is_home then tg.away_score else tg.home_score end as ga
    from public.team_games tg
    where tg.team_id = p_team_id and tg.status = 'final'
      and tg.home_score is not null and tg.away_score is not null
  ),
  agg as (
    select
      count(*)::int as games_played,
      coalesce(sum((gf > ga)::int),0)::int as wins,
      coalesce(sum((gf < ga)::int),0)::int as losses,
      coalesce(sum((gf = ga)::int),0)::int as ties,
      coalesce(sum(gf),0)::int as goals_for,
      coalesce(sum(ga),0)::int as goals_against
    from finals
  ),
  rec as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'date', game_date, 'opponent', opponent, 'gf', gf, 'ga', ga,
             'result', case when gf>ga then 'W' when gf<ga then 'L' else 'T' end
           ) order by game_date desc), '[]'::jsonb) as recent
    from (select * from finals order by game_date desc limit 5) r
  )
  select t.id, t.name, t.logo_color, t.logo_initials, t.logo_url, t.division,
         t.is_youth, t.visibility,
         agg.games_played, agg.wins, agg.losses, agg.ties, agg.goals_for, agg.goals_against,
         rec.recent
  from t, agg, rec;
$function$;

revoke all on function public.public_team_summary(uuid) from public;
grant execute on function public.public_team_summary(uuid) to anon, authenticated, service_role;
