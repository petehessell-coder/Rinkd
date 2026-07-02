#!/usr/bin/env node
/**
 * C08 · PR-A migration harness — applies
 *   supabase/migrations/20260702200000_c08_a_stats_bounds_and_indexes.sql
 * verbatim (TWICE, for idempotency) to a REAL Postgres (PGlite/WASM) seeded with
 * a PROD-SHAPED pre-state, then proves the four behaviors PR-A promises:
 *
 *   node scripts/c08-smoke/pglite-migrations.mjs
 *
 * WHAT THIS PROVES (per the C08 §3 PR-A spec):
 *   (a) each RPC respects p_limit and DEFAULTS to 100 (clamped 1..500);
 *   (b) the youth name-shield still returns '#'||jersey for minors/youth events —
 *       byte-identical to the PRE-migration function on the same fixture;
 *   (c) the OLD single-/two-arg overloads are GONE (calling them errors);
 *   (d) the four hot FK indexes exist.
 *
 * WHY THE SEED SHAPE MATTERS (migration_prod_shape_testing rule): the RPCs read
 * public.{games,tournaments,tournament_teams,game_lineups,game_goals,
 * game_penalties,profiles} and call the DEFINER helpers is_youth_tournament(),
 * is_minor_profile(), shield_minor_player_id(). Column names/types/nullability
 * below were audited LIVE 2026-07-02 (see the pg_get_functiondef / columns pulls
 * in the PR-A work log). The 4 leaderboard RPC bodies on prod are byte-identical
 * to 20260621130000_youth_privacy_e_event_minor_shield.sql (no drift), and
 * get_season_game_pucks exists only on prod (no repo migration) — both facts
 * verified before writing the migration.
 *
 * We drive the TOURNAMENT-SKATER path end-to-end: it is self-contained (no
 * league_games / goalie_game_lines timeline needed) yet exercises the exact
 * shield branch `is_youth_tournament(...) OR is_minor_profile(...)  -> '#'||jersey`.
 * The migration is applied whole, so all five signatures are re-created and
 * asserted regardless of which one we query for output parity.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260702200000_c08_a_stats_bounds_and_indexes.sql',
);

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectError = async (name, fn, re) => {
  try { await fn(); check(name, false, 'no error raised!'); }
  catch (e) { check(name, !re || re.test(e.message), e.message.slice(0, 140)); }
};

// ─── prod-shaped pre-state (audited live 2026-07-02) ─────────────────────────
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
  account_type text not null default 'adult',   -- 'minor' triggers is_minor_profile
  is_admin boolean not null default false,
  auth_user_id uuid
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  division_id uuid,
  is_youth boolean not null default false,       -- NOT NULL default false (prod shape)
  status text
);

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  team_name text not null,
  pool text not null default 'A',
  division_id uuid
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  home_team_id uuid,
  away_team_id uuid,
  home_score integer,
  away_score integer,
  status text,
  shootout_winner text,
  division_id uuid,
  forfeit boolean not null default false,
  start_time timestamptz not null default now()
);

create table public.game_lineups (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  game_source text not null,
  team_id uuid not null,
  user_id uuid,
  player_id uuid,
  invite_name text,
  jersey_number integer,
  position text,
  is_goalie boolean,
  roster_status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.game_goals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  team_id uuid not null,
  scorer_number integer,
  assist1_number integer,
  assist2_number integer,
  period integer not null default 1,
  time_in_period text,
  is_shootout boolean,
  game_source text,
  empty_net boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.game_penalties (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  team_id uuid not null,
  player_number integer,
  penalty_type text not null default 'minor',
  severity text not null default 'minor',
  duration_minutes integer not null default 2,
  period integer not null default 1,
  game_source text
);

-- tables the OTHER RPCs (league boards, season pucks) reference at apply time.
create table public.league_games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, home_team_id uuid, away_team_id uuid,
  home_score integer, away_score integer, status text
);
create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, team_id uuid, team_name text, is_sub_pool boolean default false
);
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, user_id uuid, invite_name text, jersey_number integer, position text
);
create table public.teams (id uuid primary key default gen_random_uuid(), name text, is_youth boolean);
create table public.game_puck_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, league_game_id uuid,
  voted_tournament_team_id uuid, voted_league_team_id uuid, voted_jersey integer
);

-- FK-index target tables (columns audited live).
create table public.featured_operator_events (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid, league_id uuid, tournament_id uuid
);
create table public.gamesheet_links (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, tournament_id uuid
);
create table public.game_puck_results (
  id uuid primary key default gen_random_uuid(),
  post_id uuid
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

create function public.shield_minor_player_id(p_player_id uuid) returns uuid
language sql stable set search_path to 'public' as $$
  select case
    when p_player_id is not null and auth.uid() is null and public.is_minor_profile(p_player_id) then null
    else p_player_id
  end;
$$;

-- goalie_game_lines: signature-only stub so the two goalie RPC bodies compile at
-- CREATE time. Real body is out of PR-A scope (we drive the skater path for
-- output parity); returns no rows so the goalie boards run without a timeline.
create function public.goalie_game_lines(
  p_game_id uuid, p_game_source text, p_team_id uuid, p_opp_team_id uuid,
  p_team_score integer, p_opp_score integer, p_result text, p_ga_total integer)
returns table(goalie_number integer, ga integer, sa integer, win integer, loss integer, tie integer, shutout integer)
language sql stable set search_path to 'public' as $$ select null::int, null::int, null::int, null::int, null::int, null::int, null::int where false $$;
`);
check('prod-shaped pre-state seeded (tournaments.is_youth not-null, profiles.account_type, DEFINER helpers)', true);

// ─── snapshot the PRE-migration tournament-skater RPC (the parity baseline) ──
// Byte-identical prod/repo body, minus the LIMIT — so post-migration output at a
// generous p_limit must equal this row-for-row (the shield behavior is unchanged).
await db.exec(`
create function public.get_tournament_skater_stats(p_tournament_id uuid, p_division_id uuid default null)
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
    from public.game_goals gg join tgames on tgames.id = gg.game_id
    where (gg.game_source is null or gg.game_source = 'tournament')
      and coalesce(gg.is_shootout, false) = false and gg.scorer_number is not null
    group by gg.team_id, gg.scorer_number
  ),
  assists_cte as (
    select team_id, jersey, count(*)::int as assists from (
      select gg.team_id, gg.assist1_number as jersey
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament')
        and coalesce(gg.is_shootout, false) = false and gg.assist1_number is not null
      union all
      select gg.team_id, gg.assist2_number
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament')
        and coalesce(gg.is_shootout, false) = false and gg.assist2_number is not null
    ) a group by team_id, jersey
  ),
  pim_cte as (
    select gp.team_id, gp.player_number as jersey, sum(coalesce(gp.duration_minutes,0))::int as pim
    from public.game_penalties gp join tgames on tgames.id = gp.game_id
    where (gp.game_source is null or gp.game_source = 'tournament') and gp.player_number is not null
    group by gp.team_id, gp.player_number
  ),
  appearances as (
    select team_id, jersey, count(distinct game_id)::int as gp from (
      select gl.team_id, gl.jersey_number as jersey, gl.game_id
      from public.game_lineups gl join tgames on tgames.id = gl.game_id
      where gl.game_source = 'tournament' and gl.jersey_number is not null
      union
      select gg.team_id, gg.scorer_number, gg.game_id
      from public.game_goals gg join tgames on tgames.id = gg.game_id
      where (gg.game_source is null or gg.game_source = 'tournament') and gg.scorer_number is not null
    ) ap group by team_id, jersey
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
    from public.game_lineups gl join tgames on tgames.id = gl.game_id
    left join public.profiles pr on pr.id = coalesce(gl.player_id, gl.user_id)
    where gl.game_source = 'tournament' and gl.jersey_number is not null
    order by gl.team_id, gl.jersey_number,
      (coalesce(nullif(trim(gl.invite_name),''), pr.name, pr.handle) is not null) desc,
      (coalesce(gl.player_id, gl.user_id) is not null) desc, gl.created_at desc, gl.id
  ),
  keys as (
    select team_id, jersey from goals_cte
    union select team_id, jersey from assists_cte
    union select team_id, jersey from pim_cte
    union select team_id, jersey from appearances
  )
  select
    k.team_id, tt.team_name, k.jersey as jersey_number,
    case when public.is_youth_tournament(p_tournament_id) or public.is_minor_profile(nm.player_id) then '#'||k.jersey
         else coalesce(nm.player_name, '#'||k.jersey) end as player_name,
    coalesce(ap.gp,0) as gp, coalesce(g.goals,0) as goals, coalesce(a.assists,0) as assists,
    coalesce(g.goals,0)+coalesce(a.assists,0) as points, coalesce(pm.pim,0) as pim,
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
  join public.tournament_teams tt on tt.id=k.team_id
  order by points desc, goals desc, pim asc;
$function$;
`);

// ─── seed an ADULT and a YOUTH tournament fixture ────────────────────────────
const [adultPr] = await q(`insert into public.profiles (name, handle, account_type) values ('Adult Skater','askater','adult') returning id`);
const [minorPr] = await q(`insert into public.profiles (name, handle, account_type) values ('Minor Kid','mkid','minor') returning id`);

// ADULT tournament with 12 distinct scoring jerseys (to exercise LIMIT clamping).
const [adultT] = await q(`insert into public.tournaments (name, is_youth, status) values ('Adult Cup', false, 'active') returning id`);
const [adultTeam] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'Adult Team') returning id`, [adultT.id]);
const [adultG] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$2,3,1,'final') returning id`, [adultT.id, adultTeam.id]);
// jersey 10 = the adult profile (name should show through), jerseys 11..21 = ghosts w/ invite_name
await db.query(`insert into public.game_lineups (game_id, game_source, team_id, player_id, invite_name, jersey_number, is_goalie)
  values ($1,'tournament',$2,$3,null,10,false)`, [adultG.id, adultTeam.id, adultPr.id]);
for (let j = 11; j <= 21; j++) {
  await db.query(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number, is_goalie)
    values ($1,'tournament',$2,$3,$4,false)`, [adultG.id, adultTeam.id, `Ghost ${j}`, j]);
}
// give every jersey a goal so all 12 appear as keys
for (let j = 10; j <= 21; j++) {
  await db.query(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,$3)`, [adultG.id, adultTeam.id, j]);
}

// YOUTH tournament: one adult-named lineup entry + one minor profile; both must shield.
const [youthT] = await q(`insert into public.tournaments (name, is_youth, status) values ('Youth Cup', true, 'active') returning id`);
const [youthTeam] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'Youth Team') returning id`, [youthT.id]);
const [youthG] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, home_score, away_score, status)
  values ($1,$2,$2,2,0,'final') returning id`, [youthT.id, youthTeam.id]);
await db.query(`insert into public.game_lineups (game_id, game_source, team_id, invite_name, jersey_number) values ($1,'tournament',$2,'Real Youth Name',7)`, [youthG.id, youthTeam.id]);
await db.query(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,7)`, [youthG.id, youthTeam.id]);

// MINOR-in-adult-tournament: a minor profile on the ADULT team must ALSO shield.
await db.query(`insert into public.game_lineups (game_id, game_source, team_id, player_id, jersey_number) values ($1,'tournament',$2,$3,99)`, [adultG.id, adultTeam.id, minorPr.id]);
await db.query(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,99)`, [adultG.id, adultTeam.id]);

// baseline snapshots (PRE-migration function output) — no auth uid set.
const beforeAdult = await q(`select jersey_number, player_name, points from public.get_tournament_skater_stats($1) order by jersey_number`, [adultT.id]);
const beforeYouth = await q(`select jersey_number, player_name from public.get_tournament_skater_stats($1) order by jersey_number`, [youthT.id]);

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

// ─── (c) OLD overloads are GONE ──────────────────────────────────────────────
// NB: a bare 2-arg CALL cannot prove the overload is gone — Postgres resolves it
// to the NEW 3-arg function via the p_limit default. The authoritative proof is
// at the catalog level: EXACTLY ONE signature per RPC, each carrying p_limit and
// NONE carrying the old arity. (drop-then-create in the migration guarantees it.)
{
  const rows = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('get_league_skater_stats','get_league_goalie_stats','get_tournament_skater_stats',
       'get_tournament_goalie_stats','get_season_game_pucks') order by 1`);
  const sigs = rows.map(r => `${r.proname}(${r.args})`);
  check('exactly 5 leaderboard signatures total (no lingering overloads)', rows.length === 5, JSON.stringify(sigs));
  check('every signature carries p_limit integer', rows.every(r => /p_limit integer/.test(r.args)), JSON.stringify(sigs));
  // explicit: the specific old arities are absent.
  const oldGone = [
    ['get_league_skater_stats', 'p_league_id uuid'],
    ['get_league_goalie_stats', 'p_league_id uuid'],
    ['get_tournament_skater_stats', 'p_tournament_id uuid, p_division_id uuid'],
    ['get_tournament_goalie_stats', 'p_tournament_id uuid, p_division_id uuid'],
    ['get_season_game_pucks', 'p_scope text, p_scope_id uuid'],
  ].every(([n, a]) => !rows.some(r => r.proname === n && r.args === a));
  check('every OLD (pre-p_limit) signature is dropped', oldGone, JSON.stringify(sigs));
}

// ─── (a) p_limit DEFAULTS to 100 and clamps ──────────────────────────────────
// adult fixture has 13 distinct jerseys (10..21 = 12, + minor 99), all appear at default 100.
{
  const dflt = await q(`select count(*)::int n from public.get_tournament_skater_stats($1)`, [adultT.id]);
  check('default (no p_limit) returns all 13 fixture rows (default=100 ≥ 13)', dflt[0].n === 13, JSON.stringify(dflt[0]));
  const lim3 = await q(`select count(*)::int n from public.get_tournament_skater_stats($1, null, 3)`, [adultT.id]);
  check('p_limit=3 returns exactly 3 rows', lim3[0].n === 3, JSON.stringify(lim3[0]));
  const lim0 = await q(`select count(*)::int n from public.get_tournament_skater_stats($1, null, 0)`, [adultT.id]);
  check('p_limit=0 clamps up to 1 (greatest(1,·))', lim0[0].n === 1, JSON.stringify(lim0[0]));
  const limNeg = await q(`select count(*)::int n from public.get_tournament_skater_stats($1, null, -5)`, [adultT.id]);
  check('p_limit=-5 clamps up to 1', limNeg[0].n === 1, JSON.stringify(limNeg[0]));
  const limBig = await q(`select count(*)::int n from public.get_tournament_skater_stats($1, null, 100000)`, [adultT.id]);
  check('p_limit=100000 clamps down to ≤500 (still all 13 rows here)', limBig[0].n === 13, JSON.stringify(limBig[0]));
}
// season-pucks default clamp sanity (no votes seeded → 0 rows, but call must succeed w/ default).
{
  const sp = await q(`select count(*)::int n from public.get_season_game_pucks('tournament', $1)`, [adultT.id]);
  check('get_season_game_pucks callable with defaulted p_limit', sp[0].n === 0, JSON.stringify(sp[0]));
}

// ─── (b) youth name-shield BYTE-IDENTICAL to pre-migration output ────────────
{
  const afterAdult = await q(`select jersey_number, player_name, points from public.get_tournament_skater_stats($1, null, 500) order by jersey_number`, [adultT.id]);
  const afterYouth = await q(`select jersey_number, player_name from public.get_tournament_skater_stats($1, null, 500) order by jersey_number`, [youthT.id]);
  check('ADULT board: post-migration output byte-identical to pre-migration',
    JSON.stringify(afterAdult) === JSON.stringify(beforeAdult),
    `before=${JSON.stringify(beforeAdult)} after=${JSON.stringify(afterAdult)}`);
  check('YOUTH board: post-migration output byte-identical to pre-migration',
    JSON.stringify(afterYouth) === JSON.stringify(beforeYouth),
    `before=${JSON.stringify(beforeYouth)} after=${JSON.stringify(afterYouth)}`);

  // and assert the shield SEMANTICS explicitly (not just "unchanged"):
  const y7 = afterYouth.find(r => r.jersey_number === 7);
  check('youth jersey 7 shielded to "#7" (invite_name "Real Youth Name" hidden)', y7 && y7.player_name === '#7', JSON.stringify(y7));
  const a10 = afterAdult.find(r => r.jersey_number === 10);
  check('adult jersey 10 shows the real profile name (not shielded)', a10 && a10.player_name === 'Adult Skater', JSON.stringify(a10));
  const a11 = afterAdult.find(r => r.jersey_number === 11);
  check('adult ghost jersey 11 shows its invite_name', a11 && a11.player_name === 'Ghost 11', JSON.stringify(a11));
  const a99 = afterAdult.find(r => r.jersey_number === 99);
  check('minor-in-adult-tournament jersey 99 shielded to "#99" (is_minor_profile)', a99 && a99.player_name === '#99', JSON.stringify(a99));
}

// ─── (d) the four hot FK indexes exist ───────────────────────────────────────
{
  const idx = (await q(`select indexname from pg_indexes where schemaname='public'
    and indexname in ('idx_featured_operator_events_league_id','idx_featured_operator_events_tournament_id',
                      'idx_gamesheet_links_league_id','idx_game_puck_results_post_id')`)).map(r => r.indexname).sort();
  check('all 4 hot FK indexes created', idx.length === 4,
    idx.join(','));
}

// ─── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`❌ C08 PR-A harness: ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✅ C08 PR-A harness: all checks passed.');
