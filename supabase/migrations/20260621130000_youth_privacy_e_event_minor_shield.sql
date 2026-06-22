-- ============================================================================
-- YOUTH-PRIVACY · Migration E — event-level minor-name shielding
-- ----------------------------------------------------------------------------
-- Closes the league/tournament minor-name surface left by A–D (which gated
-- youth TEAMS). Two leaks, both for a youth team playing in a league/tournament:
--   (1) raw game_lineups.invite_name / usa_hockey_number were world-readable for
--       game_source in ('league','tournament') — a direct REST scrape of a
--       minor's full name + USA Hockey #. Now ROW-gated for youth events
--       (operational readers — insiders, the game's scorekeeper/scorer,
--       directors, admins — keep access; the public does not).
--   (2) the 4 leaderboard RPCs returned minor names; they were SECURITY INVOKER
--       so an in-RPC teams.is_youth check read NULL for non-insiders. Now
--       SECURITY DEFINER + the player/goalie name is shielded to '#'||jersey for
--       youth rows (league via teams.is_youth — covers minor profiles AND
--       invite_name ghosts; tournament via tournaments.is_youth OR
--       is_minor_profile). Adult boards are byte-identical (the shield is a
--       no-op when nothing is youth/minor — parity-tested).
-- Plus defense-in-depth on player_milestones / tournament_player_links.
-- ============================================================================

-- 1) ─ tournaments.is_youth — the missing event youth signal (for tournament ghosts).
alter table public.tournaments
  add column if not exists is_youth boolean not null default false;
comment on column public.tournaments.is_youth is
  'True = youth tournament (minor names shielded to #jersey on boards + lineups gated). Auto-derived from division text on insert; admin/director may override.';

-- Strict youth check for EVENTS (tournaments): true only on a CLEAR youth signal
-- (no conservative unknown->youth, so adult/blank tournaments are not over-shielded).
create or replace function public.text_has_youth_signal(p_text text)
returns boolean language sql immutable set search_path to 'public'
as $$
  select coalesce(lower(p_text),'') ~
    '(\m\d{1,2}\s*u\M|\mu\d{1,2}\M|mite|squirt|pee.?wee|peewee|bantam|midget|youth|prep|varsity|\mjv\M|high.?school|\m1[0-8]\M)';
$$;

create or replace function public.is_youth_tournament(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce((select is_youth from public.tournaments where id = p_tournament_id), false); $$;
revoke all on function public.is_youth_tournament(uuid) from public;
grant execute on function public.is_youth_tournament(uuid) to anon, authenticated, service_role;
grant execute on function public.text_has_youth_signal(text) to anon, authenticated, service_role;

create or replace function public.tg_tournaments_derive_is_youth()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  -- derive on INSERT from division text (+ any youth division age_group); only
  -- auto-sets true, an explicit true (admin/director) is preserved.
  if not coalesce(NEW.is_youth, false) then
    NEW.is_youth := public.text_has_youth_signal(
      concat_ws(' ', NEW.division, NEW.division_label, NEW.usah_classification));
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_tournaments_derive_is_youth on public.tournaments;
create trigger trg_tournaments_derive_is_youth
  before insert on public.tournaments
  for each row execute function public.tg_tournaments_derive_is_youth();

-- backfill existing tournaments
update public.tournaments t set is_youth = (
  public.text_has_youth_signal(concat_ws(' ', t.division, t.division_label, t.usah_classification))
  or exists (select 1 from public.tournament_divisions td
             where td.tournament_id = t.id and public.text_has_youth_signal(td.age_group))
);

-- 2) ─ game_lineups row-gate for youth events (keeps operational readers).
create or replace function public.can_view_lineup(p_game_source text, p_team_id uuid, p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select case p_game_source
    when 'team' then public.can_view_team(p_team_id)
    when 'league' then
      case
        when not coalesce((select t.is_youth
              from public.league_teams lt join public.teams t on t.id = lt.team_id
              where lt.id = p_team_id), false)
          then true  -- adult league team: public
        else
          public.current_user_is_admin()
          or public.is_team_insider(
               (select lt.team_id from public.league_teams lt where lt.id = p_team_id),
               public.current_profile_id())
          or exists (select 1 from public.league_games lg
               where lg.id = p_game_id and lg.scorekeeper_id = public.current_profile_id())
          or exists (select 1 from public.league_games lg
               join public.league_roles lr on lr.league_id = lg.league_id
               where lg.id = p_game_id and lr.user_id = public.current_profile_id()
                 and lr.role in ('scorer','commissioner','manager'))
      end
    when 'tournament' then
      case
        when not coalesce((select tr.is_youth
              from public.games g join public.tournaments tr on tr.id = g.tournament_id
              where g.id = p_game_id), false)
          then true  -- adult tournament: public
        else
          public.current_user_is_admin()
          or public.is_tournament_director(
               (select g.tournament_id from public.games g where g.id = p_game_id),
               public.current_profile_id())
          or exists (select 1 from public.games g
               where g.id = p_game_id and g.scorekeeper_id = public.current_profile_id())
          or exists (select 1 from public.tournament_roles tro
               join public.games g on g.tournament_id = tro.tournament_id
               where g.id = p_game_id and tro.user_id = public.current_profile_id()
                 and tro.role in ('scorer','director'))
      end
    else true
  end;
$$;
revoke all on function public.can_view_lineup(text, uuid, uuid) from public;
grant execute on function public.can_view_lineup(text, uuid, uuid) to anon, authenticated, service_role;

drop policy if exists game_lineups_select on public.game_lineups;
create policy game_lineups_select on public.game_lineups for select to public
using ( public.can_view_lineup(game_source, team_id, game_id) );

-- 3) ─ defense-in-depth: hide minor rows on the two using(true) tables.
drop policy if exists pm_select_all on public.player_milestones;
create policy pm_select_all on public.player_milestones for select to public
using ( not public.is_minor_profile(user_id) or public.can_view_minor_profile(user_id) );

drop policy if exists tpl_read on public.tournament_player_links;
create policy tpl_read on public.tournament_player_links for select to public
using ( not public.is_minor_profile(user_id) or public.can_view_minor_profile(user_id) );

-- 4) ─ leaderboard RPCs: SECURITY DEFINER (bypass the lineup row-gate + read
--      teams.is_youth) + name shielded to '#'||jersey for youth/minor rows.
--      Bodies are verbatim from prod; ONLY the header (SECURITY DEFINER) and the
--      player/goalie name output column change. Adult/non-minor rows: identical.

create or replace function public.get_league_skater_stats(p_league_id uuid)
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
  order by points desc, goals desc, pim asc;
$function$;

create or replace function public.get_league_goalie_stats(p_league_id uuid)
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
  order by gaa asc nulls last;
$function$;

create or replace function public.get_tournament_skater_stats(p_tournament_id uuid, p_division_id uuid DEFAULT NULL::uuid)
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
  order by points desc, goals desc, pim asc;
$function$;

create or replace function public.get_tournament_goalie_stats(p_tournament_id uuid, p_division_id uuid DEFAULT NULL::uuid)
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
  order by gaa asc nulls last, save_pct desc;
$function$;
