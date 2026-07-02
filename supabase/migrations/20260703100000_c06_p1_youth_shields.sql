-- ============================================================================
-- C06 · PR-1 — Youth-privacy shields (P0, minors' PII, correctness-critical)
-- ----------------------------------------------------------------------------
-- Closes two SERVER-SIDE minor-name leaks the C06 audit found (§2, PII-1/PII-2),
-- both in SECURITY DEFINER RPCs that render on public / anon-reachable surfaces:
--
--   (1) get_game_recap_card  — the in-feed RINKD GAME RECAP card. goals[].name
--       coalesces profiles.name → invite_name → team_members name → '#'||jersey
--       with NO youth check, so every youth final auto-posts a recap printing a
--       minor's real name to any viewer of a public league/tournament feed.
--       (RecapCard.js renders it unconditionally on Home/Feed/League/Tournament/
--       TeamFeed — the DISPLAY path, distinct from the SHARE path which is
--       already gated in gameCardData.js.)
--   (2) get_season_game_pucks  — the season "Game Pucks won" board. player_name
--       is pulled raw from game_lineups.invite_name with NO youth check;
--       SeasonGamePucks.js renders it on the anon-visible public Stats tab.
--
-- FIX PATTERN (mirrors the strongest existing precedent —
-- 20260621130000_youth_privacy_e_event_minor_shield.sql's leaderboard shields):
--   * bodies are RECREATED BYTE-IDENTICAL to the live prod definitions below;
--     ONLY the goals[].name / player_name output expression gains a youth shield.
--   * youth is determined FAIL-CLOSED, matching the leaderboard RPCs + the client
--     helpers in src/lib/publicShare.js:
--       - tournament: shield when is_youth_tournament(owner) OR the individual
--         resolved profile is is_minor_profile(...).
--       - league:     shield when the LEAGUE is youth (settings->>'feature_profile'
--         = 'youth_competitive' — the exact semantics of areScorersHidden()),
--         OR the SCORING team's teams.is_youth is not false (a youth team playing
--         up in an adult league — mirrors get_league_skater_stats' per-team
--         coalesce(t.is_youth,false) shield), OR the individual profile is a minor.
--   * shielded name renders as '#'||jersey (recap card) / NULL (season pucks;
--     SeasonGamePucks.js renders '#'||jersey when player_name is null).
--   * signatures UNCHANGED (no overload), grants + search_path preserved.
--
-- Also commits both prod definitions as tracked migrations for the FIRST time
-- (both were untracked-in-repo per the audit — get_game_recap_card entirely,
-- get_season_game_pucks first tracked in C08-A 20260702200000). Pre-state
-- verbatim recorded below (recovery + ends the untracked-RPC blind spot).
-- All prod facts fetched live via pg_get_functiondef 2026-07-03.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared helper: is_youth_league_event(p_league_id)
--   Server-side mirror of publicShare.js areScorersHidden(settings):
--     areScorersHidden = (settings.feature_profile === 'youth_competitive').
--   SECURITY DEFINER so a non-insider (incl. anon) can read leagues.settings for
--   the check even under RLS — same reason the leaderboard RPCs are DEFINER.
--   Fail-closed: a NULL/absent setting is NOT youth (adult default), identical to
--   the client helper (which only flips youth on an EXPLICIT 'youth_competitive').
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_youth_league_event(p_league_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select l.settings->>'feature_profile' = 'youth_competitive'
       from public.leagues l where l.id = p_league_id),
    false);
$$;
revoke all on function public.is_youth_league_event(uuid) from public;
grant execute on function public.is_youth_league_event(uuid) to anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) get_game_recap_card — shield goals[].name on youth events.
-- ─────────────────────────────────────────────────────────────────────────────
-- PROD PRE-STATE (verbatim, pg_get_functiondef 2026-07-03 — untracked in repo):
--
-- CREATE OR REPLACE FUNCTION public.get_game_recap_card(p_game_id uuid, p_source text)
--  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- declare
--   v jsonb;
--   v_home uuid; v_away uuid; v_hs int; v_as int; v_start timestamptz; v_rinkid uuid; v_loc text; v_owner uuid;
-- begin
--   if p_source = 'league' then
--     select home_team_id, away_team_id, home_score, away_score, start_time, rink_id, location, league_id
--       into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
--     from league_games where id = p_game_id;
--   elsif p_source = 'tournament' then
--     select home_team_id, away_team_id, home_score, away_score, start_time, rink_id, location, tournament_id
--       into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
--     from games where id = p_game_id;
--   elsif p_source = 'team' then
--     select null::uuid, null::uuid, home_score, away_score, start_time, null::uuid, location, team_id
--       into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
--     from team_games where id = p_game_id;
--   else
--     return null;
--   end if;
--   if v_hs is null and v_as is null and v_start is null then return null; end if;
--   v := jsonb_build_object(
--     'game_id', p_game_id, 'source', p_source, 'owner_type', p_source, 'owner_id', v_owner,
--     'date', v_start,
--     'rink', coalesce((select name from rinks r where r.id = v_rinkid), v_loc),
--     'home_score', v_hs, 'away_score', v_as);
--   if p_source = 'team' then
--     v := v || jsonb_build_object(
--       'home', (select jsonb_build_object('name', t.name, 'logo_initials', t.logo_initials, 'logo_color', t.logo_color, 'has_logo', t.logo_url is not null)
--                from team_games tg join teams t on t.id = tg.team_id where tg.id = p_game_id),
--       'away', (select jsonb_build_object('name', tg.opponent, 'logo_initials', null, 'logo_color', null, 'has_logo', false)
--                from team_games tg where tg.id = p_game_id),
--       'goals', '[]'::jsonb, 'stats_available', false);
--     return v;
--   end if;
--   if p_source = 'league' then
--     v := v
--       || jsonb_build_object('home', (select jsonb_build_object('name', team_name, 'logo_initials', logo_initials, 'logo_color', logo_color, 'has_logo', logo_url is not null) from league_teams where id = v_home))
--       || jsonb_build_object('away', (select jsonb_build_object('name', team_name, 'logo_initials', logo_initials, 'logo_color', logo_color, 'has_logo', logo_url is not null) from league_teams where id = v_away));
--   else
--     v := v
--       || jsonb_build_object('home', (select jsonb_build_object('name', team_name, 'logo_initials', null, 'logo_color', null, 'has_logo', logo_url is not null) from tournament_teams where id = v_home))
--       || jsonb_build_object('away', (select jsonb_build_object('name', team_name, 'logo_initials', null, 'logo_color', null, 'has_logo', logo_url is not null) from tournament_teams where id = v_away));
--   end if;
--   v := v
--     || jsonb_build_object('stats_available', true)
--     || jsonb_build_object('goals', coalesce((
--         select jsonb_agg(jsonb_build_object(
--           'side', case when gg.team_id = v_home then 'H' else 'A' end,
--           'jersey', gg.scorer_number, 'period', gg.period, 'time', gg.time_in_period,
--           'name', coalesce(
--             (select p.name from game_lineups gl join profiles p on p.id = gl.user_id
--                where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number limit 1),
--             (select gl.invite_name from game_lineups gl
--                where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number and gl.invite_name is not null limit 1),
--             (case when p_source = 'league' then
--               (select p.name from team_members tm join profiles p on p.id = tm.user_id join league_teams lt on lt.team_id = tm.team_id
--                  where lt.id = gg.team_id and tm.jersey_number = gg.scorer_number limit 1) end),
--             '#' || gg.scorer_number))
--         order by gg.period, gg.time_in_period)
--         from game_goals gg where gg.game_id = p_game_id and coalesce(gg.is_shootout, false) = false), '[]'::jsonb))
--     || jsonb_build_object(
--         'shots_home', (select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_home),
--         'shots_away', (select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_away),
--         'pim_home',   (select coalesce(sum(duration_minutes),0) from game_penalties where game_id = p_game_id and team_id = v_home),
--         'pim_away',   (select coalesce(sum(duration_minutes),0) from game_penalties where game_id = p_game_id and team_id = v_away),
--         'saves_home', greatest((select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_away) - coalesce(v_as,0), 0),
--         'saves_away', greatest((select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_home) - coalesce(v_hs,0), 0),
--         'period_scores', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'side', case when team_id = v_home then 'H' else 'A' end, 'goals', c) order by period)
--             from (select period, team_id, count(*) c from game_goals where game_id = p_game_id and coalesce(is_shootout,false)=false group by period, team_id) ps), '[]'::jsonb));
--   return v;
-- end; $function$
--
-- Prod grants (verbatim 2026-07-03): EXECUTE to service_role, authenticated,
-- anon, postgres, PUBLIC. No `revoke ... from public` on prod today — preserved.
-- ─────────────────────────────────────────────────────────────────────────────
-- CHANGE vs pre-state (goals[].name output ONLY — everything else byte-identical):
--   the resolved name is wrapped in a youth shield. When the event is youth, or
--   the individual scorer's resolved profile is a minor, the name collapses to
--   '#'||gg.scorer_number (the same fallback the coalesce already ends with).
--   Youth is resolved once per call into v_is_youth_event (tournament via
--   is_youth_tournament; league via is_youth_league_event OR the scoring team's
--   teams.is_youth). The per-goal is_minor_profile check covers a lone minor
--   playing in an otherwise-adult event.
create or replace function public.get_game_recap_card(p_game_id uuid, p_source text)
 returns jsonb
 language plpgsql
 stable security definer set search_path to 'public'
as $function$
declare
  v jsonb;
  v_home uuid; v_away uuid; v_hs int; v_as int; v_start timestamptz; v_rinkid uuid; v_loc text; v_owner uuid;
  v_is_youth_event boolean := false;
begin
  if p_source = 'league' then
    select home_team_id, away_team_id, home_score, away_score, start_time, rink_id, location, league_id
      into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
    from league_games where id = p_game_id;
  elsif p_source = 'tournament' then
    select home_team_id, away_team_id, home_score, away_score, start_time, rink_id, location, tournament_id
      into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
    from games where id = p_game_id;
  elsif p_source = 'team' then
    select null::uuid, null::uuid, home_score, away_score, start_time, null::uuid, location, team_id
      into v_home, v_away, v_hs, v_as, v_start, v_rinkid, v_loc, v_owner
    from team_games where id = p_game_id;
  else
    return null;
  end if;
  if v_hs is null and v_as is null and v_start is null then return null; end if;

  -- YOUTH-PRIVACY (C06 PR-1): resolve event-level youth once, fail-closed.
  --   tournament: the tournament is youth.
  --   league:     the league is youth (feature_profile='youth_competitive' —
  --               areScorersHidden semantics) OR either scoring league_team maps
  --               to a youth team (teams.is_youth) — a youth team playing up.
  if p_source = 'tournament' then
    v_is_youth_event := public.is_youth_tournament(v_owner);
  elsif p_source = 'league' then
    v_is_youth_event := public.is_youth_league_event(v_owner)
      or exists (
        select 1 from public.league_teams lt join public.teams t on t.id = lt.team_id
        where lt.id in (v_home, v_away) and coalesce(t.is_youth, false) = true);
  end if;

  v := jsonb_build_object(
    'game_id', p_game_id, 'source', p_source, 'owner_type', p_source, 'owner_id', v_owner,
    'date', v_start,
    'rink', coalesce((select name from rinks r where r.id = v_rinkid), v_loc),
    'home_score', v_hs, 'away_score', v_as
  );

  if p_source = 'team' then
    v := v || jsonb_build_object(
      'home', (select jsonb_build_object('name', t.name, 'logo_initials', t.logo_initials, 'logo_color', t.logo_color, 'has_logo', t.logo_url is not null)
               from team_games tg join teams t on t.id = tg.team_id where tg.id = p_game_id),
      'away', (select jsonb_build_object('name', tg.opponent, 'logo_initials', null, 'logo_color', null, 'has_logo', false)
               from team_games tg where tg.id = p_game_id),
      'goals', '[]'::jsonb, 'stats_available', false);
    return v;
  end if;

  if p_source = 'league' then
    v := v
      || jsonb_build_object('home', (select jsonb_build_object('name', team_name, 'logo_initials', logo_initials, 'logo_color', logo_color, 'has_logo', logo_url is not null) from league_teams where id = v_home))
      || jsonb_build_object('away', (select jsonb_build_object('name', team_name, 'logo_initials', logo_initials, 'logo_color', logo_color, 'has_logo', logo_url is not null) from league_teams where id = v_away));
  else
    v := v
      || jsonb_build_object('home', (select jsonb_build_object('name', team_name, 'logo_initials', null, 'logo_color', null, 'has_logo', logo_url is not null) from tournament_teams where id = v_home))
      || jsonb_build_object('away', (select jsonb_build_object('name', team_name, 'logo_initials', null, 'logo_color', null, 'has_logo', logo_url is not null) from tournament_teams where id = v_away));
  end if;

  v := v
    || jsonb_build_object('stats_available', true)
    || jsonb_build_object('goals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'side', case when gg.team_id = v_home then 'H' else 'A' end,
          'jersey', gg.scorer_number, 'period', gg.period, 'time', gg.time_in_period,
          -- YOUTH-PRIVACY (C06 PR-1): shield the resolved name to '#'||jersey when
          -- the event is youth, or when the individual resolved profile is a minor.
          -- The inner coalesce is byte-identical to prod; only the outer CASE is new.
          'name', case
            when v_is_youth_event then '#' || gg.scorer_number
            when public.is_minor_profile(
                   (select gl.user_id from game_lineups gl
                      where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number and gl.user_id is not null limit 1))
              then '#' || gg.scorer_number
            else coalesce(
              (select p.name from game_lineups gl join profiles p on p.id = gl.user_id
                 where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number limit 1),
              (select gl.invite_name from game_lineups gl
                 where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number and gl.invite_name is not null limit 1),
              (case when p_source = 'league' then
                (select p.name from team_members tm join profiles p on p.id = tm.user_id join league_teams lt on lt.team_id = tm.team_id
                   where lt.id = gg.team_id and tm.jersey_number = gg.scorer_number limit 1) end),
              '#' || gg.scorer_number)
          end)
        order by gg.period, gg.time_in_period)
        from game_goals gg where gg.game_id = p_game_id and coalesce(gg.is_shootout, false) = false), '[]'::jsonb))
    || jsonb_build_object(
        'shots_home', (select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_home),
        'shots_away', (select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_away),
        'pim_home',   (select coalesce(sum(duration_minutes),0) from game_penalties where game_id = p_game_id and team_id = v_home),
        'pim_away',   (select coalesce(sum(duration_minutes),0) from game_penalties where game_id = p_game_id and team_id = v_away),
        'saves_home', greatest((select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_away) - coalesce(v_as,0), 0),
        'saves_away', greatest((select coalesce(sum(count),0) from game_shots where game_id = p_game_id and team_id = v_home) - coalesce(v_hs,0), 0),
        'period_scores', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'side', case when team_id = v_home then 'H' else 'A' end, 'goals', c) order by period)
            from (select period, team_id, count(*) c from game_goals where game_id = p_game_id and coalesce(is_shootout,false)=false group by period, team_id) ps), '[]'::jsonb));
  return v;
end; $function$;

-- Grants preserved verbatim from prod (PUBLIC grant intact — no revoke on prod).
grant execute on function public.get_game_recap_card(uuid, text) to anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) get_season_game_pucks — shield player_name on youth events.
-- ─────────────────────────────────────────────────────────────────────────────
-- PROD PRE-STATE (verbatim, pg_get_functiondef 2026-07-03; body byte-identical to
-- the tracked copy in 20260702200000_c08_a_stats_bounds_and_indexes.sql:552-599):
--
-- CREATE OR REPLACE FUNCTION public.get_season_game_pucks(p_scope text, p_scope_id uuid, p_limit integer DEFAULT 100)
--  RETURNS TABLE(team_id uuid, jersey integer, pucks_won bigint, team_name text, player_name text)
--  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
--   with per_game as ( … rank() over (partition by game order by count desc) … ),
--   winners as ( select team_id, jersey, count(*) as pucks_won from per_game where rnk = 1 group by team_id, jersey )
--   select w.team_id, w.jersey, w.pucks_won,
--     coalesce(tt.team_name, lt.team_name) as team_name,
--     ( select gl.invite_name from public.game_lineups gl
--         where gl.team_id = w.team_id and gl.jersey_number = w.jersey and gl.invite_name is not null limit 1 ) as player_name
--   from winners w
--   left join public.tournament_teams tt on tt.id = w.team_id
--   left join public.league_teams     lt on lt.id = w.team_id
--   order by w.pucks_won desc, w.jersey asc
--   limit greatest(1, least(p_limit, 500));
-- $function$
--
-- Prod grants (verbatim): revoke all from public; EXECUTE to anon, authenticated,
-- service_role (NO PUBLIC grant — set in C08-A). Preserved.
-- ─────────────────────────────────────────────────────────────────────────────
-- CHANGE vs pre-state (player_name output ONLY — signature + everything else
-- byte-identical): player_name → NULL when the scope event is youth, by the same
-- fail-closed semantics as #1 (tournament: is_youth_tournament; league:
-- is_youth_league_event OR the winning team's teams.is_youth). A minor whose
-- name only ever appears via invite_name has no profile to key is_minor_profile
-- on here, so the EVENT-level gate is the operative shield (matches the season
-- boards, which shield the whole youth event). Client (SeasonGamePucks.js)
-- renders '#'||jersey whenever player_name is null.
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
  ),
  -- YOUTH-PRIVACY (C06 PR-1): resolve the scope's youth flag once, fail-closed.
  scope_youth as (
    select case
      when p_scope = 'tournament' then public.is_youth_tournament(p_scope_id)
      when p_scope = 'league'     then public.is_youth_league_event(p_scope_id)
      else false
    end as is_youth
  )
  select
    w.team_id,
    w.jersey,
    w.pucks_won,
    coalesce(tt.team_name, lt.team_name) as team_name,
    -- shield: youth event (scope-level OR a youth team playing up via teams.is_youth)
    -- → NULL name (client renders '#'||jersey). Adult events: byte-identical to prod.
    case
      when (select is_youth from scope_youth)
        or coalesce(t.is_youth, false) = true
        then null
      else (
        select gl.invite_name
        from public.game_lineups gl
        where gl.team_id = w.team_id
          and gl.jersey_number = w.jersey
          and gl.invite_name is not null
        limit 1
      )
    end as player_name
  from winners w
  left join public.tournament_teams tt on tt.id = w.team_id
  left join public.league_teams     lt on lt.id = w.team_id
  left join public.teams            t  on t.id  = lt.team_id
  order by w.pucks_won desc, w.jersey asc
  limit greatest(1, least(p_limit, 500));
$function$;
revoke all on function public.get_season_game_pucks(text, uuid, int) from public;
grant execute on function public.get_season_game_pucks(text, uuid, int) to anon, authenticated, service_role;
