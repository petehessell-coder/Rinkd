#!/usr/bin/env node
/**
 * C06 · PR-1 migration harness — applies
 *   supabase/migrations/20260703100000_c06_p1_youth_shields.sql
 * verbatim (TWICE, for idempotency) to a REAL Postgres (PGlite/WASM) seeded with
 * a PROD-SHAPED pre-state, then proves the youth-privacy shields on BOTH RPCs.
 *
 *   node scripts/c06-smoke/pglite-migrations.mjs
 *
 * WHAT THIS PROVES (per C06 §2 PII-1 / PII-2):
 *   (a) get_game_recap_card + get_season_game_pucks apply CLEAN, TWICE (idempotent);
 *   (b) ADULT events: post-migration output is BYTE-IDENTICAL to the pre-migration
 *       prod function on the same fixtures (both RPCs) — no adult regression;
 *   (c) YOUTH events shield minor names:
 *         - youth TOURNAMENT: recap goals[].name → '#'||jersey; season → null name;
 *         - youth-competitive LEAGUE (settings.feature_profile='youth_competitive',
 *           the areScorersHidden() semantics): same;
 *         - a YOUTH TEAM playing up in an ADULT league (teams.is_youth): same;
 *         - a lone MINOR profile in an adult tournament: recap name → '#'||jersey.
 *
 * WHY THE SEED SHAPE MATTERS (migration_prod_shape_testing rule): the RPCs read
 * public.{league_games,games,team_games,league_teams,tournament_teams,teams,
 * leagues,rinks,game_lineups,game_goals,game_shots,game_penalties,profiles,
 * team_members,game_puck_votes} and call the DEFINER helpers is_youth_tournament,
 * is_youth_league_event, is_minor_profile. Column names/types/nullability below,
 * and the two prod function bodies, were audited LIVE 2026-07-03
 * (pg_get_functiondef). The pre-migration baselines are the verbatim prod bodies.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260703100000_c06_p1_youth_shields.sql',
);

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;

// ─── prod-shaped pre-state (audited live 2026-07-03) ─────────────────────────
await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null,
  account_type text not null default 'adult'   -- 'minor' triggers is_minor_profile
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}'::jsonb   -- feature_profile rides here (ARCH-DUAL-1)
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_youth boolean not null default false,
  status text
);

create table public.teams (id uuid primary key default gen_random_uuid(), name text, is_youth boolean);
create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, team_id uuid, team_name text,
  logo_initials text, logo_color text, logo_url text,
  is_sub_pool boolean default false
);
create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null, team_name text not null, logo_url text
);
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, user_id uuid, invite_name text, jersey_number integer, position text
);
create table public.rinks (id uuid primary key default gen_random_uuid(), name text);

create table public.league_games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, home_team_id uuid, away_team_id uuid,
  home_score integer, away_score integer, status text,
  start_time timestamptz not null default now(), rink_id uuid, location text
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null, home_team_id uuid, away_team_id uuid,
  home_score integer, away_score integer, status text,
  start_time timestamptz not null default now(), rink_id uuid, location text
);
create table public.team_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, opponent text, home_score integer, away_score integer,
  status text, start_time timestamptz not null default now(), location text
);

create table public.game_lineups (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null, game_source text not null, team_id uuid not null,
  user_id uuid, player_id uuid, invite_name text, jersey_number integer,
  is_goalie boolean, created_at timestamptz not null default now()
);
create table public.game_goals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null, team_id uuid not null, scorer_number integer,
  assist1_number integer, assist2_number integer, period integer not null default 1,
  time_in_period text, is_shootout boolean, game_source text
);
create table public.game_shots (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, team_id uuid, count integer not null default 0
);
create table public.game_penalties (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, team_id uuid, player_number integer, duration_minutes integer not null default 2
);
create table public.game_puck_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, league_game_id uuid,
  voted_tournament_team_id uuid, voted_league_team_id uuid, voted_jersey integer
);

-- DEFINER helpers at their exact prod definitions.
create function public.is_minor_profile(p_profile_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles p where p.id = p_profile_id and p.account_type = 'minor');
$$;
create function public.is_youth_tournament(p_tournament_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_youth from public.tournaments where id = p_tournament_id), false);
$$;
`);
check('prod-shaped pre-state seeded (leagues.settings jsonb, teams.is_youth, DEFINER helpers)', true);

// ─── PRE-migration baselines: verbatim prod bodies (the parity anchors) ──────
// get_game_recap_card + get_season_game_pucks EXACTLY as pg_get_functiondef
// returned from prod 2026-07-03 (the shield-free versions). is_youth_league_event
// does not exist yet — created by the migration — so these bodies do not ref it.
await db.exec(`
create function public.get_game_recap_card(p_game_id uuid, p_source text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v jsonb;
  v_home uuid; v_away uuid; v_hs int; v_as int; v_start timestamptz; v_rinkid uuid; v_loc text; v_owner uuid;
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
  v := jsonb_build_object(
    'game_id', p_game_id, 'source', p_source, 'owner_type', p_source, 'owner_id', v_owner,
    'date', v_start,
    'rink', coalesce((select name from rinks r where r.id = v_rinkid), v_loc),
    'home_score', v_hs, 'away_score', v_as);
  if p_source = 'team' then
    v := v || jsonb_build_object(
      'home', (select jsonb_build_object('name', t.name, 'logo_initials', null, 'logo_color', null, 'has_logo', false)
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
          'name', coalesce(
            (select p.name from game_lineups gl join profiles p on p.id = gl.user_id
               where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number limit 1),
            (select gl.invite_name from game_lineups gl
               where gl.game_id = p_game_id and gl.team_id = gg.team_id and gl.jersey_number = gg.scorer_number and gl.invite_name is not null limit 1),
            (case when p_source = 'league' then
              (select p.name from team_members tm join profiles p on p.id = tm.user_id join league_teams lt on lt.team_id = tm.team_id
                 where lt.id = gg.team_id and tm.jersey_number = gg.scorer_number limit 1) end),
            '#' || gg.scorer_number))
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

create function public.get_season_game_pucks_baseline(p_scope text, p_scope_id uuid, p_limit integer default 100)
 returns table(team_id uuid, jersey integer, pucks_won bigint, team_name text, player_name text)
 language sql stable security definer set search_path to 'public'
as $function$
  with per_game as (
    select coalesce(v.game_id, v.league_game_id) as g,
      coalesce(v.voted_tournament_team_id, v.voted_league_team_id) as team_id,
      v.voted_jersey as jersey, count(*) as votes,
      rank() over (partition by coalesce(v.game_id, v.league_game_id) order by count(*) desc) as rnk
    from public.game_puck_votes v
    where (p_scope = 'tournament' and v.game_id in (select id from public.games where tournament_id = p_scope_id))
       or (p_scope = 'league' and v.league_game_id in (select id from public.league_games where league_id = p_scope_id))
    group by 1, 2, 3
  ),
  winners as (select team_id, jersey, count(*) as pucks_won from per_game where rnk = 1 group by team_id, jersey)
  select w.team_id, w.jersey, w.pucks_won, coalesce(tt.team_name, lt.team_name) as team_name,
    (select gl.invite_name from public.game_lineups gl
       where gl.team_id = w.team_id and gl.jersey_number = w.jersey and gl.invite_name is not null limit 1) as player_name
  from winners w
  left join public.tournament_teams tt on tt.id = w.team_id
  left join public.league_teams lt on lt.id = w.team_id
  order by w.pucks_won desc, w.jersey asc
  limit greatest(1, least(p_limit, 500));
$function$;
`);

// ─── seed fixtures ───────────────────────────────────────────────────────────
const [adultPr] = await q(`insert into public.profiles (name, handle, account_type) values ('Adult Skater','askater','adult') returning id`);
const [minorPr] = await q(`insert into public.profiles (name, handle, account_type) values ('Minor Kid','mkid','minor') returning id`);
const [rink] = await q(`insert into public.rinks (name) values ('Main Arena') returning id`);

// teams.is_youth rows: an adult team, a youth team (plays up in an adult league)
const [adultTeamRow] = await q(`insert into public.teams (name, is_youth) values ('Adult FC', false) returning id`);
const [youthTeamRow] = await q(`insert into public.teams (name, is_youth) values ('Kid FC', true) returning id`);

// ADULT LEAGUE (feature_profile absent → adult) ───────────────────────────────
const [adultLg] = await q(`insert into public.leagues (name, settings) values ('Adult League','{}'::jsonb) returning id`);
const [alHome] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Home LT') returning id`, [adultLg.id, adultTeamRow.id]);
const [alAway] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Away LT') returning id`, [adultLg.id, adultTeamRow.id]);
const [alGame] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, home_score, away_score, status, rink_id)
  values ($1,$2,$3,2,1,'final',$4) returning id`, [adultLg.id, alHome.id, alAway.id, rink.id]);
// jersey 9 = adult profile (name shows), jersey 12 = invite_name ghost, jersey 21 = minor profile
await q(`insert into public.game_lineups (game_id, game_source, team_id, user_id, jersey_number) values ($1,'league',$2,$3,9)`, [alGame.id, alHome.id, adultPr.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number) values ($1,'league',$2,'Ghost Twelve',12)`, [alGame.id, alHome.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, user_id, jersey_number) values ($1,'league',$2,$3,21)`, [alGame.id, alAway.id, minorPr.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,9,1,'10:00')`, [alGame.id, alHome.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,12,2,'05:00')`, [alGame.id, alHome.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,21,3,'02:00')`, [alGame.id, alAway.id]);

// YOUTH-COMPETITIVE LEAGUE (settings.feature_profile='youth_competitive') ──────
const [youthLg] = await q(`insert into public.leagues (name, settings) values ('Youth League','{"feature_profile":"youth_competitive"}'::jsonb) returning id`);
const [ylHome] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'YHome') returning id`, [youthLg.id, adultTeamRow.id]);
const [ylAway] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'YAway') returning id`, [youthLg.id, adultTeamRow.id]);
const [ylGame] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$3,1,0,'final') returning id`, [youthLg.id, ylHome.id, ylAway.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number) values ($1,'league',$2,'Real Kid Name',7)`, [ylGame.id, ylHome.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,7,1,'08:00')`, [ylGame.id, ylHome.id]);

// YOUTH TEAM PLAYING UP in an ADULT league (teams.is_youth on the scoring LT) ──
const [mixedLg] = await q(`insert into public.leagues (name, settings) values ('Mixed League','{}'::jsonb) returning id`);
const [mlHome] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'YouthUp') returning id`, [mixedLg.id, youthTeamRow.id]);
const [mlAway] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'AdultOpp') returning id`, [mixedLg.id, adultTeamRow.id]);
const [mlGame] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$3,3,2,'final') returning id`, [mixedLg.id, mlHome.id, mlAway.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number) values ($1,'league',$2,'YouthUp Name',5)`, [mlGame.id, mlHome.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,5,1,'01:00')`, [mlGame.id, mlHome.id]);

// ADULT TOURNAMENT + YOUTH TOURNAMENT + lone MINOR-in-adult-tournament ─────────
const [adultT] = await q(`insert into public.tournaments (name, is_youth, status) values ('Adult Cup', false, 'active') returning id`);
const [atTeam] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'AT Home') returning id`, [adultT.id]);
const [atGame] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$2,2,0,'final') returning id`, [adultT.id, atTeam.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, user_id, jersey_number) values ($1,'tournament',$2,$3,8)`, [atGame.id, atTeam.id, adultPr.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, user_id, jersey_number) values ($1,'tournament',$2,$3,44)`, [atGame.id, atTeam.id, minorPr.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,8,1,'03:00')`, [atGame.id, atTeam.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,44,2,'07:00')`, [atGame.id, atTeam.id]);

const [youthT] = await q(`insert into public.tournaments (name, is_youth, status) values ('Youth Cup', true, 'active') returning id`);
const [ytTeam] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'YT Home') returning id`, [youthT.id]);
const [ytGame] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$2,1,0,'final') returning id`, [youthT.id, ytTeam.id]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number) values ($1,'tournament',$2,'Youth T Name',3)`, [ytGame.id, ytTeam.id]);
await q(`insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period) values ($1,$2,3,1,'04:00')`, [ytGame.id, ytTeam.id]);

// ── Game Puck votes so get_season_game_pucks returns rows for each scope ──────
// adult league game: jersey 9 wins
await q(`insert into public.game_puck_votes (league_game_id, voted_league_team_id, voted_jersey) values ($1,$2,9)`, [alGame.id, alHome.id]);
// youth league game: jersey 7 wins
await q(`insert into public.game_puck_votes (league_game_id, voted_league_team_id, voted_jersey) values ($1,$2,7)`, [ylGame.id, ylHome.id]);
// mixed (youth team up) game: jersey 5 wins
await q(`insert into public.game_puck_votes (league_game_id, voted_league_team_id, voted_jersey) values ($1,$2,5)`, [mlGame.id, mlHome.id]);
// adult tournament: jersey 8 wins
await q(`insert into public.game_puck_votes (game_id, voted_tournament_team_id, voted_jersey) values ($1,$2,8)`, [atGame.id, atTeam.id]);
// youth tournament: jersey 3 wins
await q(`insert into public.game_puck_votes (game_id, voted_tournament_team_id, voted_jersey) values ($1,$2,3)`, [ytGame.id, ytTeam.id]);

// ── baselines (pre-migration prod output) ────────────────────────────────────
const goalNames = (card) => (card.goals || []).map((g) => [g.jersey, g.name]);
const [beforeAdultLgRow] = await q(`select public.get_game_recap_card($1,'league') as c`, [alGame.id]);
const beforeAdultLg = goalNames(beforeAdultLgRow.c);
const [beforeAdultTRow] = await q(`select public.get_game_recap_card($1,'tournament') as c`, [atGame.id]);
const beforeAdultT = goalNames(beforeAdultTRow.c);
const beforeSpAdultLg = await q(`select jersey, player_name from public.get_season_game_pucks_baseline('league',$1) order by jersey`, [adultLg.id]);
const beforeSpAdultT = await q(`select jersey, player_name from public.get_season_game_pucks_baseline('tournament',$1) order by jersey`, [adultT.id]);

// ─── apply the migration TWICE (idempotency) ─────────────────────────────────
const sql = readFileSync(MIGRATION, 'utf8');
for (const pass of [1, 2]) {
  try {
    await db.exec(sql);
    check(`migration applies clean (pass ${pass}/2 — idempotent)`, true);
  } catch (e) {
    check(`migration applies clean (pass ${pass}/2)`, false, e.message);
    console.log('\n❌ APPLY FAILED — fix before touching a branch or prod.');
    process.exit(1);
  }
}

// ─── (a) signatures unchanged (no overload) ──────────────────────────────────
{
  const rows = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_game_recap_card','get_season_game_pucks') order by 1,2`);
  const recap = rows.filter((r) => r.proname === 'get_game_recap_card');
  const pucks = rows.filter((r) => r.proname === 'get_season_game_pucks');
  check('get_game_recap_card: exactly one signature (p_game_id uuid, p_source text)',
    recap.length === 1 && recap[0].args === 'p_game_id uuid, p_source text', JSON.stringify(recap.map((r) => r.args)));
  check('get_season_game_pucks: exactly one signature (p_scope text, p_scope_id uuid, p_limit integer)',
    pucks.length === 1 && pucks[0].args === 'p_scope text, p_scope_id uuid, p_limit integer', JSON.stringify(pucks.map((r) => r.args)));
}

// ─── (b) ADULT parity: byte-identical to pre-migration ───────────────────────
// NB: these adult events deliberately embed a lone MINOR jersey (21 / 44) to
// exercise PII-1's per-goal is_minor_profile shield — which is a WANTED behavior
// change on exactly that row. So the "byte-identical" parity is asserted over the
// NON-minor (genuinely adult) rows; the minor row's new shield is asserted below.
const nonMinor = (pairs, minorJersey) => pairs.filter(([j]) => j !== minorJersey);
{
  const [aLg] = await q(`select public.get_game_recap_card($1,'league') as c`, [alGame.id]);
  const [aT] = await q(`select public.get_game_recap_card($1,'tournament') as c`, [atGame.id]);
  check('recap ADULT league: non-minor goal names byte-identical to pre-migration',
    JSON.stringify(nonMinor(goalNames(aLg.c), 21)) === JSON.stringify(nonMinor(beforeAdultLg, 21)),
    `before=${JSON.stringify(nonMinor(beforeAdultLg, 21))} after=${JSON.stringify(nonMinor(goalNames(aLg.c), 21))}`);
  check('recap ADULT tournament: non-minor goal names byte-identical to pre-migration',
    JSON.stringify(nonMinor(goalNames(aT.c), 44)) === JSON.stringify(nonMinor(beforeAdultT, 44)),
    `before=${JSON.stringify(nonMinor(beforeAdultT, 44))} after=${JSON.stringify(nonMinor(goalNames(aT.c), 44))}`);

  const spLg = await q(`select jersey, player_name from public.get_season_game_pucks('league',$1) order by jersey`, [adultLg.id]);
  const spT = await q(`select jersey, player_name from public.get_season_game_pucks('tournament',$1) order by jersey`, [adultT.id]);
  check('season-pucks ADULT league: byte-identical to pre-migration',
    JSON.stringify(spLg) === JSON.stringify(beforeSpAdultLg),
    `before=${JSON.stringify(beforeSpAdultLg)} after=${JSON.stringify(spLg)}`);
  check('season-pucks ADULT tournament: byte-identical to pre-migration',
    JSON.stringify(spT) === JSON.stringify(beforeSpAdultT),
    `before=${JSON.stringify(beforeSpAdultT)} after=${JSON.stringify(spT)}`);

  // explicit adult SEMANTICS (names actually present, not just "unchanged")
  const alNames = Object.fromEntries(goalNames(aLg.c));
  check('adult league jersey 9 shows real profile name', alNames[9] === 'Adult Skater', JSON.stringify(alNames));
  check('adult league jersey 12 shows invite_name ghost', alNames[12] === 'Ghost Twelve', JSON.stringify(alNames));
  check('adult league jersey 21 (MINOR) shielded to "#21" (is_minor_profile, per-goal)', alNames[21] === '#21', JSON.stringify(alNames));
  const atNames = Object.fromEntries(goalNames(aT.c));
  check('adult tournament jersey 8 shows real profile name', atNames[8] === 'Adult Skater', JSON.stringify(atNames));
  check('adult tournament jersey 44 (MINOR) shielded to "#44" (is_minor_profile, per-goal)', atNames[44] === '#44', JSON.stringify(atNames));
}

// ─── (c) YOUTH shields ───────────────────────────────────────────────────────
{
  // youth-competitive LEAGUE (feature_profile)
  const [ylCard] = await q(`select public.get_game_recap_card($1,'league') as c`, [ylGame.id]);
  const ylNames = Object.fromEntries(goalNames(ylCard.c));
  check('recap YOUTH league (feature_profile): jersey 7 shielded to "#7"', ylNames[7] === '#7', JSON.stringify(ylNames));

  // youth TOURNAMENT
  const [ytCard] = await q(`select public.get_game_recap_card($1,'tournament') as c`, [ytGame.id]);
  const ytNames = Object.fromEntries(goalNames(ytCard.c));
  check('recap YOUTH tournament: jersey 3 shielded to "#3"', ytNames[3] === '#3', JSON.stringify(ytNames));

  // YOUTH TEAM playing up (teams.is_youth on scoring LT, adult league)
  const [mlCard] = await q(`select public.get_game_recap_card($1,'league') as c`, [mlGame.id]);
  const mlNames = Object.fromEntries(goalNames(mlCard.c));
  check('recap YOUTH-TEAM-UP (teams.is_youth): jersey 5 shielded to "#5"', mlNames[5] === '#5', JSON.stringify(mlNames));

  // season pucks — youth scopes → null name
  const spYl = await q(`select jersey, player_name from public.get_season_game_pucks('league',$1)`, [youthLg.id]);
  check('season-pucks YOUTH league: player_name null', spYl.length === 1 && spYl[0].player_name === null, JSON.stringify(spYl));
  const spYt = await q(`select jersey, player_name from public.get_season_game_pucks('tournament',$1)`, [youthT.id]);
  check('season-pucks YOUTH tournament: player_name null', spYt.length === 1 && spYt[0].player_name === null, JSON.stringify(spYt));
  const spMl = await q(`select jersey, player_name from public.get_season_game_pucks('league',$1)`, [mixedLg.id]);
  check('season-pucks YOUTH-TEAM-UP (teams.is_youth): player_name null', spMl.length === 1 && spMl[0].player_name === null, JSON.stringify(spMl));
}

// ─── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`❌ C06 PR-1 harness: ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✅ C06 PR-1 harness: all checks passed.');
