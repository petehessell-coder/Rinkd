-- ============================================================================
-- GOALIE-1 follow-up / Migration N — game_source backfill + skater-RPC
-- NULL tolerance
-- Stacks on Migration M (apply order: H → I → J → K → L → M → N).
--
-- THE BUG: the GS-1 write path (queuedWrite online inserts + the
-- sync-scorekeeper-queue replay) historically stamped NO game_source on
-- event rows — and at least one deployed path still doesn't (prod carries a
-- NULL-source game_goals row from Jun 5 2026 and four game_shots rows from
-- Jun 8). The live skater boards hard-filter game_source='league'/
-- 'tournament', so those rows silently vanish. Migration M already made the
-- GOALIE fns tolerant and the companion client/edge changes stamp
-- game_source going forward; this migration closes the remaining two gaps:
--
-- 1) BACKFILL (idempotent, fail-closed): rows whose game_id belongs to
--    league_games get 'league'; rows whose game_id belongs to games get
--    'tournament'. Guarded by an abort if any id ever appears in BOTH
--    parent tables (verified 0 on prod Jun 12 2026 — the guard makes the
--    assumption explicit instead of silent). Folded into the migration
--    rather than run as a manual prod UPDATE so it is atomic with the RPC
--    fix, runs exactly once, and catches any null rows created between now
--    and the post-pilot apply. Rows matching NEITHER parent (2 game_shots
--    rows from a deleted game, May 25) stay NULL on purpose: they are
--    unreachable through the parent-game joins and there is nothing to
--    attribute them to.
--
-- 2) SKATER RPC TOLERANCE: get_league_skater_stats (Migration K's
--    definition) and get_tournament_skater_stats (Migration I's) now accept
--    (game_source IS NULL OR game_source = '<expected>') on the EVENT
--    tables (game_goals / game_penalties), matching Migration M's goalie
--    fns. Safe because every event read is already scoped by game_id
--    against the right parent table — game_source is belt-and-suspenders,
--    and NULL must not mean invisible. game_lineups filters are unchanged:
--    its game_source column is NOT NULL, so tolerance there is dead code.
--
-- Bodies are otherwise byte-identical to K/I; signatures, grants, STABLE,
-- SECURITY INVOKER, search_path all frozen — live boards, additive only.
-- ============================================================================

-- 0 ── fail-closed guard + backfill ──────────────────────────────────────────
do $$
declare v_overlap integer;
begin
  select count(*) into v_overlap
  from public.games g join public.league_games lg on lg.id = g.id;
  if v_overlap > 0 then
    raise exception
      'game_source backfill aborted: % game id(s) exist in BOTH games and league_games — resolve before applying', v_overlap;
  end if;
end $$;

update public.game_goals set game_source = 'league'
  where game_source is null and game_id in (select id from public.league_games);
update public.game_goals set game_source = 'tournament'
  where game_source is null and game_id in (select id from public.games);

update public.game_penalties set game_source = 'league'
  where game_source is null and game_id in (select id from public.league_games);
update public.game_penalties set game_source = 'tournament'
  where game_source is null and game_id in (select id from public.games);

update public.game_shots set game_source = 'league'
  where game_source is null and game_id in (select id from public.league_games);
update public.game_shots set game_source = 'tournament'
  where game_source is null and game_id in (select id from public.games);

update public.game_goalie_changes set game_source = 'league'
  where game_source is null and game_id in (select id from public.league_games);
update public.game_goalie_changes set game_source = 'tournament'
  where game_source is null and game_id in (select id from public.games);

-- 1 ── get_league_skater_stats: Migration K body + NULL-tolerant event reads ─
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
    where (gg.game_source is null or gg.game_source = 'league')
      and coalesce(gg.is_shootout, false) = false and gg.scorer_number is not null
    union all
    select gg.game_id, gg.team_id, gg.assist1_number, 0, 1, 0
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where (gg.game_source is null or gg.game_source = 'league')
      and coalesce(gg.is_shootout, false) = false and gg.assist1_number is not null
    union all
    select gg.game_id, gg.team_id, gg.assist2_number, 0, 1, 0
    from public.game_goals gg join lgames on lgames.id = gg.game_id
    where (gg.game_source is null or gg.game_source = 'league')
      and coalesce(gg.is_shootout, false) = false and gg.assist2_number is not null
    union all
    select gp.game_id, gp.team_id, gp.player_number, 0, 0, coalesce(gp.duration_minutes, 0)
    from public.game_penalties gp join lgames on lgames.id = gp.game_id
    where (gp.game_source is null or gp.game_source = 'league')
      and gp.player_number is not null
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

-- 2 ── get_tournament_skater_stats: Migration I body + NULL-tolerant reads ───
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
    where (gg.game_source is null or gg.game_source = 'tournament')
      and coalesce(gg.is_shootout, false) = false
      and gg.scorer_number is not null
    group by gg.team_id, gg.scorer_number
  ),
  assists_cte as (
    select team_id, jersey, count(*)::int as assists
    from (
      select gg.team_id, gg.assist1_number as jersey
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament')
        and coalesce(gg.is_shootout, false) = false and gg.assist1_number is not null
      union all
      select gg.team_id, gg.assist2_number
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament')
        and coalesce(gg.is_shootout, false) = false and gg.assist2_number is not null
    ) a
    group by team_id, jersey
  ),
  pim_cte as (
    select gp.team_id, gp.player_number as jersey, sum(coalesce(gp.duration_minutes, 0))::int as pim
    from public.game_penalties gp
    join tgames on tgames.id = gp.game_id
    where (gp.game_source is null or gp.game_source = 'tournament')
      and gp.player_number is not null
    group by gp.team_id, gp.player_number
  ),
  appearances as (
    select team_id, jersey, count(distinct game_id)::int as gp
    from (
      select gl.team_id, gl.jersey_number as jersey, gl.game_id
      from public.game_lineups gl join tgames on tgames.id = gl.game_id
      where gl.game_source = 'tournament' and gl.jersey_number is not null
      union
      select gg.team_id, gg.scorer_number, gg.game_id
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament')
        and gg.scorer_number is not null
    ) ap
    group by team_id, jersey
  ),
  goalie_flag as (
    select gl.team_id, gl.jersey_number as jersey, bool_or(gl.is_goalie) as is_goalie
    from public.game_lineups gl join tgames on tgames.id = gl.game_id
    where gl.game_source = 'tournament' and gl.jersey_number is not null
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
    where gl.game_source = 'tournament' and gl.jersey_number is not null
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
    coalesce(ap.gp, 0) as gp,
    coalesce(g.goals, 0) as goals,
    coalesce(a.assists, 0) as assists,
    coalesce(g.goals, 0) + coalesce(a.assists, 0) as points,
    coalesce(pm.pim, 0) as pim,
    round((coalesce(g.goals, 0) + coalesce(a.assists, 0))::numeric / nullif(ap.gp, 0), 2) as points_per_game,
    coalesce(gf.is_goalie, false) as is_goalie,
    public.shield_minor_player_id(nm.player_id) as player_id
  from keys k
  left join goals_cte g on g.team_id = k.team_id and g.jersey = k.jersey
  left join assists_cte a on a.team_id = k.team_id and a.jersey = k.jersey
  left join pim_cte pm on pm.team_id = k.team_id and pm.jersey = k.jersey
  left join appearances ap on ap.team_id = k.team_id and ap.jersey = k.jersey
  left join names nm on nm.team_id = k.team_id and nm.jersey = k.jersey
  left join goalie_flag gf on gf.team_id = k.team_id and gf.jersey = k.jersey
  join public.tournament_teams tt on tt.id = k.team_id
  order by points desc, goals desc, pim asc;
$function$;
grant execute on function public.get_tournament_skater_stats(uuid, uuid) to anon, authenticated, service_role;
