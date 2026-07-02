-- ============================================================================
-- C08 · PR-A — "Bound the stats stack + hot indexes"  (one migration)
-- Plan: Fable_Elevation_Program/audits/C08_performance.md §3 PR-A (P0, Opus 4.8)
-- ----------------------------------------------------------------------------
-- WHAT & WHY
--   The Stats tab is the pilot's hottest surface. Its 5 leaderboard RPCs return
--   EVERY row with zero SQL LIMIT — a Saturday-Night failure at pilot load. This
--   migration:
--     1. Adds a bounded `p_limit int default 100` to the 4 leaderboard RPCs and
--        to get_season_game_pucks, clamped LIMIT greatest(1, least(p_limit,500)).
--     2. Indexes 4 hot unindexed FKs (the /o/ page + the */3 poller join these).
--     3. Documents (comment-only) the 12 live cron jobs — see §CRON below for
--        why the commands are NOT reproduced here.
--
--   ⚠ OVERLOAD, not replacement. Adding a parameter creates a NEW Postgres
--   signature; `create or replace` cannot drop the old arity. Each RPC is
--   therefore `drop function if exists <old-signature>` THEN recreated with the
--   new signature. Bodies are BYTE-FOR-BYTE the prod definitions (fetched live
--   via pg_get_functiondef 2026-07-02, diffed against
--   20260621130000_youth_privacy_e_event_minor_shield.sql — no drift) with ONLY
--   the added `p_limit` param and the trailing `LIMIT ...` line changed. The
--   youth jersey-shield logic, SECURITY DEFINER clause, and search_path are
--   preserved exactly. Grants are TIGHTENED to the repo convention (revoke from
--   public + explicit anon/authenticated/service_role): prod's current ACL also
--   carries an implicit PUBLIC EXECUTE, which this migration deliberately drops —
--   every PostgREST role keeps execute. Clients pass named args, so an added
--   defaulted param is backward-compatible — old single-arg callers keep working.
--
-- IDEMPOTENCY
--   drop-if-exists + create-or-replace + create-index-if-not-exists throughout.
--   Safe to run twice. PGlite prod-shape verified: scripts/c08-smoke/pglite-migrations.mjs
--
-- APPLY RUNBOOK
--   1. Merge to main (repo migration; other agents own src/*).
--   2. Prod-shape test:  node scripts/c08-smoke/pglite-migrations.mjs   (must be green)
--   3. Apply to prod via Supabase MCP apply_migration OR `supabase db push`.
--   4. Verify overloads are gone (no old single-arg signature remains):
--        select proname, pg_get_function_identity_arguments(oid)
--        from pg_proc where proname in
--          ('get_league_skater_stats','get_league_goalie_stats',
--           'get_tournament_skater_stats','get_tournament_goalie_stats',
--           'get_season_game_pucks');
--      Each must show exactly ONE row carrying `p_limit integer`.
--   5. explain analyze one board pre/post to confirm the LIMIT pushes down.
--   NOTE: no client change is required to ship this; the p_limit is optional.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a) get_league_skater_stats  (drop 1-arg overload → recreate with p_limit)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_league_skater_stats(uuid);

create or replace function public.get_league_skater_stats(p_league_id uuid, p_limit int default 100)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean, player_id uuid)
 language sql stable security definer set search_path to 'public'
as $function$
  with lgames as (
    select id, home_team_id, away_team_id, status from public.league_games where league_id = p_league_id
  ),
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl join lgames on lgames.id = gl.game_id
    where gl.game_source = 'league' and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  ident_apps as (
    select gl.team_id, coalesce(gl.player_id, gl.user_id) as identity,
           count(distinct gl.game_id)::int as gp,
           bool_or(coalesce(gl.is_goalie, false)) as is_goalie
    from public.game_lineups gl join lgames on lgames.id = gl.game_id
    where gl.game_source = 'league' and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.team_id, coalesce(gl.player_id, gl.user_id)
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
    where lt.league_id = p_league_id and coalesce(lt.is_sub_pool, false) = false
    order by lt.id, tm.jersey_number, (coalesce(nullif(trim(tm.invite_name),''), pr.name, pr.handle) is not null) desc, tm.user_id
  ),
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
    case when coalesce(t.is_youth, false) then '#' || k.last_jersey
         else coalesce(pr.name, pr.handle, ri.player_name, rg.player_name, '#' || k.last_jersey) end as player_name,
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
  order by points desc, goals desc, pim asc
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_league_skater_stats(uuid, int) from public;
grant execute on function public.get_league_skater_stats(uuid, int) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b) get_league_goalie_stats
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_league_goalie_stats(uuid);

create or replace function public.get_league_goalie_stats(p_league_id uuid, p_limit int default 100)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql stable security definer set search_path to 'public'
as $function$
  with lf as (
    select lg.id as game_id, lg.home_team_id as lt_id, lg.away_team_id as opp_id,
           coalesce(lg.home_score, 0) as gf, coalesce(lg.away_score, 0) as ga
    from public.league_games lg
    where lg.league_id = p_league_id and lg.status = 'final'
      and lg.home_team_id is not null and lg.away_team_id is not null
    union all
    select lg.id, lg.away_team_id, lg.home_team_id,
           coalesce(lg.away_score, 0), coalesce(lg.home_score, 0)
    from public.league_games lg
    where lg.league_id = p_league_id and lg.status = 'final'
      and lg.home_team_id is not null and lg.away_team_id is not null
  ),
  lines as (
    select lf.lt_id, lf.game_id,
           gl.goalie_number, gl.ga, gl.sa, gl.win, gl.loss, gl.tie, gl.shutout
    from lf
    cross join lateral public.goalie_game_lines(
      lf.game_id, 'league', lf.lt_id, lf.opp_id,
      lf.gf, lf.ga,
      case when lf.gf > lf.ga then 'W' when lf.gf < lf.ga then 'L' else 'T' end,
      lf.ga
    ) gl
  ),
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl
    join public.league_games lg on lg.id = gl.game_id and lg.league_id = p_league_id
    where (gl.game_source is null or gl.game_source = 'league')
      and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  roster as (
    select distinct on (lt.id, tm.jersey_number)
      lt.id as lt_id, tm.jersey_number as jersey,
      coalesce(nullif(trim(tm.invite_name), ''), pr.name, pr.handle) as player_name,
      tm.user_id as identity
    from public.league_teams lt
    join public.team_members tm on tm.team_id = lt.team_id and tm.jersey_number is not null
    left join public.profiles pr on pr.id = tm.user_id
    where lt.league_id = p_league_id and coalesce(lt.is_sub_pool, false) = false
    order by lt.id, tm.jersey_number,
      (coalesce(nullif(trim(tm.invite_name), ''), pr.name, pr.handle) is not null) desc,
      tm.user_id
  ),
  attributed as (
    select l.lt_id, l.game_id, l.goalie_number as jersey,
           l.ga, l.sa, l.win, l.loss, l.tie, l.shutout,
           case when l.goalie_number is null then null
                else coalesce(li.identity, r.identity) end as identity
    from lines l
    left join lineup_ident li
      on l.goalie_number is not null
     and li.game_id = l.game_id and li.team_id = l.lt_id and li.jersey = l.goalie_number
    left join roster r
      on l.goalie_number is not null
     and r.lt_id = l.lt_id and r.jersey = l.goalie_number
  ),
  agg as (
    select lt_id, identity,
           case when identity is null then jersey end as ghost_jersey,
           max(jersey) as last_jersey,
           count(*)::integer as gp,
           sum(ga)::integer as ga, sum(sa)::integer as sa,
           sum(win)::integer as wins, sum(loss)::integer as losses,
           sum(tie)::integer as ties, sum(shutout)::integer as shutouts
    from attributed
    group by lt_id, identity, case when identity is null then jersey end
  )
  select
    a.lt_id as team_id,
    coalesce(t.name, lt.team_name) as team_name,
    a.last_jersey as jersey_number,
    case
      when coalesce(t.is_youth, false) and a.identity is not null then '#' || a.last_jersey
      when coalesce(t.is_youth, false) and a.ghost_jersey is not null then '#' || a.ghost_jersey
      when a.identity is not null then coalesce(pr.name, pr.handle, rg.player_name, '#' || a.last_jersey)
      when a.ghost_jersey is not null then coalesce(rg.player_name, '#' || a.ghost_jersey)
      else coalesce(t.name, lt.team_name) || ' (goaltending)'
    end as goalie_name,
    a.gp,
    a.sa as shots_against,
    a.ga as goals_against,
    round((a.sa - a.ga)::numeric / nullif(a.sa, 0), 3) as save_pct,
    round(a.ga::numeric / nullif(a.gp, 0), 2) as gaa,
    a.wins, a.losses, a.ties, a.shutouts,
    public.shield_minor_player_id(a.identity) as player_id
  from agg a
  join public.league_teams lt on lt.id = a.lt_id
  left join public.teams t on t.id = lt.team_id
  left join public.profiles pr on pr.id = a.identity
  left join roster rg on rg.lt_id = a.lt_id and rg.jersey = a.last_jersey
  order by gaa asc nulls last
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_league_goalie_stats(uuid, int) from public;
grant execute on function public.get_league_goalie_stats(uuid, int) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1c) get_tournament_skater_stats  (2-arg → 3-arg; p_division_id kept default)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_tournament_skater_stats(uuid, uuid);

create or replace function public.get_tournament_skater_stats(p_tournament_id uuid, p_division_id uuid DEFAULT NULL::uuid, p_limit int default 100)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean, player_id uuid)
 language sql stable security definer set search_path to 'public'
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
    case when public.is_youth_tournament(p_tournament_id) or public.is_minor_profile(nm.player_id) then '#'||k.jersey
         else coalesce(nm.player_name, '#'||k.jersey) end as player_name,
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
  order by points desc, goals desc, pim asc
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_tournament_skater_stats(uuid, uuid, int) from public;
grant execute on function public.get_tournament_skater_stats(uuid, uuid, int) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1d) get_tournament_goalie_stats
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_tournament_goalie_stats(uuid, uuid);

create or replace function public.get_tournament_goalie_stats(p_tournament_id uuid, p_division_id uuid DEFAULT NULL::uuid, p_limit int default 100)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer, player_id uuid)
 language sql stable security definer set search_path to 'public'
as $function$
  with tgames as (
    select id from public.games
    where tournament_id = p_tournament_id
      and (p_division_id is null or division_id = p_division_id)
  ),
  tf as (
    select g.id as game_id, g.home_team_id as tt_id, g.away_team_id as opp_id,
           coalesce(g.home_score, 0) as gf, coalesce(g.away_score, 0) as ga,
           case
             when coalesce(g.home_score, 0) > coalesce(g.away_score, 0) then 'W'
             when coalesce(g.home_score, 0) < coalesce(g.away_score, 0) then 'L'
             when g.shootout_winner = 'home' then 'W'
             when g.shootout_winner = 'away' then 'L'
             else 'T'
           end as result
    from public.games g
    where g.tournament_id = p_tournament_id and g.status = 'final'
      and (p_division_id is null or g.division_id = p_division_id)
      and g.home_team_id is not null and g.away_team_id is not null
    union all
    select g.id, g.away_team_id, g.home_team_id,
           coalesce(g.away_score, 0), coalesce(g.home_score, 0),
           case
             when coalesce(g.away_score, 0) > coalesce(g.home_score, 0) then 'W'
             when coalesce(g.away_score, 0) < coalesce(g.home_score, 0) then 'L'
             when g.shootout_winner = 'away' then 'W'
             when g.shootout_winner = 'home' then 'L'
             else 'T'
           end
    from public.games g
    where g.tournament_id = p_tournament_id and g.status = 'final'
      and (p_division_id is null or g.division_id = p_division_id)
      and g.home_team_id is not null and g.away_team_id is not null
  ),
  lines as (
    select tf.tt_id, tf.game_id,
           gl.goalie_number, gl.ga, gl.sa, gl.win, gl.loss, gl.tie, gl.shutout
    from tf
    cross join lateral public.goalie_game_lines(
      tf.game_id, 'tournament', tf.tt_id, tf.opp_id,
      tf.gf, tf.ga, tf.result,
      (select count(*)::integer from public.game_goals gg
        where gg.game_id = tf.game_id and gg.team_id = tf.opp_id
          and (gg.game_source is null or gg.game_source = 'tournament')
          and coalesce(gg.is_shootout, false) = false)
    ) gl
  ),
  lineup_ident as (
    select gl.game_id, gl.team_id, gl.jersey_number as jersey,
           min(coalesce(gl.player_id, gl.user_id)::text)::uuid as identity
    from public.game_lineups gl
    join tgames on tgames.id = gl.game_id
    where (gl.game_source is null or gl.game_source = 'tournament')
      and gl.jersey_number is not null
      and coalesce(gl.player_id, gl.user_id) is not null
    group by gl.game_id, gl.team_id, gl.jersey_number
    having count(distinct coalesce(gl.player_id, gl.user_id)) = 1
  ),
  names as (
    select distinct on (gl.team_id, gl.jersey_number)
      gl.team_id, gl.jersey_number as jersey,
      coalesce(nullif(trim(gl.invite_name), ''), pr.name, pr.handle) as player_name,
      coalesce(gl.player_id, gl.user_id) as identity
    from public.game_lineups gl
    join tgames on tgames.id = gl.game_id
    left join public.profiles pr on pr.id = coalesce(gl.player_id, gl.user_id)
    where (gl.game_source is null or gl.game_source = 'tournament')
      and gl.jersey_number is not null
    order by gl.team_id, gl.jersey_number,
      (coalesce(nullif(trim(gl.invite_name), ''), pr.name, pr.handle) is not null) desc,
      (coalesce(gl.player_id, gl.user_id) is not null) desc,
      gl.created_at desc, gl.id
  ),
  attributed as (
    select l.tt_id, l.game_id, l.goalie_number as jersey,
           l.ga, l.sa, l.win, l.loss, l.tie, l.shutout,
           case when l.goalie_number is null then null
                else coalesce(li.identity, nm.identity) end as identity
    from lines l
    left join lineup_ident li
      on l.goalie_number is not null
     and li.game_id = l.game_id and li.team_id = l.tt_id and li.jersey = l.goalie_number
    left join names nm
      on l.goalie_number is not null
     and nm.team_id = l.tt_id and nm.jersey = l.goalie_number
  ),
  agg as (
    select tt_id, identity,
           case when identity is null then jersey end as ghost_jersey,
           max(jersey) as last_jersey,
           count(*)::integer as gp,
           sum(ga)::integer as ga, sum(sa)::integer as sa,
           sum(win)::integer as wins, sum(loss)::integer as losses,
           sum(tie)::integer as ties, sum(shutout)::integer as shutouts
    from attributed
    group by tt_id, identity, case when identity is null then jersey end
  )
  select
    a.tt_id as team_id,
    tt.team_name,
    a.last_jersey as jersey_number,
    case
      when public.is_youth_tournament(p_tournament_id) and a.identity is not null then '#' || a.last_jersey
      when public.is_youth_tournament(p_tournament_id) and a.ghost_jersey is not null then '#' || a.ghost_jersey
      when public.is_minor_profile(a.identity) then '#' || a.last_jersey
      when a.identity is not null then coalesce(pr.name, pr.handle, nm.player_name, '#' || a.last_jersey)
      when a.ghost_jersey is not null then coalesce(nm.player_name, '#' || a.ghost_jersey)
      else tt.team_name || ' (goaltending)'
    end as goalie_name,
    a.gp,
    a.sa as shots_against,
    a.ga as goals_against,
    round((a.sa - a.ga)::numeric / nullif(a.sa, 0), 3) as save_pct,
    round(a.ga::numeric / nullif(a.gp, 0), 2) as gaa,
    a.wins, a.losses, a.ties, a.shutouts,
    public.shield_minor_player_id(a.identity) as player_id
  from agg a
  join public.tournament_teams tt on tt.id = a.tt_id
  left join public.profiles pr on pr.id = a.identity
  left join names nm on nm.team_id = a.tt_id and nm.jersey = a.last_jersey
  order by gaa asc nulls last, save_pct desc
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_tournament_goalie_stats(uuid, uuid, int) from public;
grant execute on function public.get_tournament_goalie_stats(uuid, uuid, int) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) get_season_game_pucks  (2-arg → 3-arg with p_limit; prod-def fetched live —
--    NOT present in any repo migration; drop-then-create to shed the old overload)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_season_game_pucks(text, uuid);

create or replace function public.get_season_game_pucks(p_scope text, p_scope_id uuid, p_limit int default 100)
 returns table(team_id uuid, jersey integer, pucks_won bigint, team_name text, player_name text)
 language sql stable security definer set search_path to 'public'
as $function$
  with per_game as (
    select
      coalesce(v.game_id, v.league_game_id) as g,
      coalesce(v.voted_tournament_team_id, v.voted_league_team_id) as team_id,
      v.voted_jersey as jersey,
      count(*) as votes,
      rank() over (
        partition by coalesce(v.game_id, v.league_game_id)
        order by count(*) desc
      ) as rnk
    from public.game_puck_votes v
    where (p_scope = 'tournament'
             and v.game_id in (select id from public.games where tournament_id = p_scope_id))
       or (p_scope = 'league'
             and v.league_game_id in (select id from public.league_games where league_id = p_scope_id))
    group by 1, 2, 3
  ),
  winners as (
    select team_id, jersey, count(*) as pucks_won
    from per_game
    where rnk = 1
    group by team_id, jersey
  )
  select
    w.team_id,
    w.jersey,
    w.pucks_won,
    coalesce(tt.team_name, lt.team_name) as team_name,
    (
      select gl.invite_name
      from public.game_lineups gl
      where gl.team_id = w.team_id
        and gl.jersey_number = w.jersey
        and gl.invite_name is not null
      limit 1
    ) as player_name
  from winners w
  left join public.tournament_teams tt on tt.id = w.team_id
  left join public.league_teams     lt on lt.id = w.team_id
  order by w.pucks_won desc, w.jersey asc
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_season_game_pucks(text, uuid, int) from public;
grant execute on function public.get_season_game_pucks(text, uuid, int) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Hot unindexed FK indexes (create if not exists — idempotent)
--    Verified 2026-07-02: none of these four exist on prod today.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_featured_operator_events_league_id
  on public.featured_operator_events (league_id);
create index if not exists idx_featured_operator_events_tournament_id
  on public.featured_operator_events (tournament_id);
create index if not exists idx_gamesheet_links_league_id
  on public.gamesheet_links (league_id);
create index if not exists idx_game_puck_results_post_id
  on public.game_puck_results (post_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- §CRON — the 12 live pg_cron jobs (DOCUMENTATION ONLY — see SECRETS note)
-- ─────────────────────────────────────────────────────────────────────────────
-- These jobs were applied out-of-band via the Supabase MCP and never recorded as
-- migrations (the "no cron.schedule in repo" drift finding in C08 §Edge/cron).
--
-- SECRETS — WHY THE COMMANDS ARE NOT REPRODUCED HERE.
--   Fetched the full command text of every job live (`select command from cron.job`,
--   2026-07-02). 7 of the 12 net.http_post commands embed live bearer credentials
--   in their Authorization header — a `cronk_…` cron key (send-game-reminders,
--   sync-gamesheet, send-lineup-reminders, send-gameday-hype) or a full anon JWT
--   (sync-printful-products, sync-hockeyshift live + daily). Committing those
--   commands verbatim would leak service credentials into git history. So this is
--   a COMMENT-ONLY inventory: no cron.schedule() calls are executed. To rotate or
--   re-declare a job, edit it via the Supabase dashboard / MCP with the secret
--   pulled from the environment — never paste a token into a repo migration.
--
--   The 5 secret-free jobs (pure SQL RPCs or unauth'd http_post) are documented
--   the same way for a single, complete source of truth.
--
-- INVENTORY (jobid · jobname · schedule · target — no commands, no secrets):
--    1 · rinkd-game-reminders-hourly       · 5 * * * *                  · fn send-game-reminders        [cronk bearer]
--    2 · rinkd-onboarding-emails-hourly     · 15 * * * *                 · fn send-onboarding-emails     [no auth header]
--    3 · rinkd-gamesheet-sync               · */3 * * * *                · fn sync-gamesheet             [cronk bearer]
--    4 · rinkd-printful-sync-daily          · 15 8 * * *                 · fn sync-printful-products     [anon JWT]
--    7 · rinkd-analytics-maintenance-daily  · 30 8 * * *                 · SELECT public.analytics_daily_maintenance()  [SQL, no secret]
--    8 · sync-hockeyshift-live              · */5 22,23,0,1,2,3 * 7,8 *  · fn sync-hockeyshift           [anon JWT]
--    9 · sync-hockeyshift-daily             · 0 12 * * *                 · fn sync-hockeyshift           [anon JWT]
--   11 · rinkd-settle-game-pucks            · */5 * * * *                · SELECT public.settle_due_game_pucks()        [SQL, no secret]
--   12 · rinkd-reg4-mark-past-due           · 5 7 * * *                  · SELECT public.reg4_mark_past_due()           [SQL, no secret]
--   13 · rinkd-reg4-reconcile-nightly       · 10 7 * * *                 · SELECT public.reg4_reconcile()               [SQL, no secret]
--   14 · rinkd-lineup-reminders-hourly      · 20 * * * *                 · fn send-lineup-reminders      [cronk bearer]
--   15 · rinkd-gameday-hype                 · */30 * * * *               · fn send-gameday-hype          [cronk bearer]
-- (jobids 5, 6, 10 are retired — not present in cron.job as of 2026-07-02.)
-- ─────────────────────────────────────────────────────────────────────────────
