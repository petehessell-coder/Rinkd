#!/usr/bin/env node
/**
 * LRS-1 + GOALIE-1 migration harness — applies Migrations H, I, J, K, L, M
 * verbatim to a REAL Postgres (PGlite/WASM) seeded with PROD-SHAPED
 * pre-state, then runs the full behavior suite (GS-2/GS-5, subs pools, lines
 * post, goalie-in-net attribution). No network, no Supabase project needed:
 *
 *   node scripts/lrs-smoke/pglite-migrations.mjs
 *
 * WHY THE SEED MATTERS (the lesson this file encodes): the first version of
 * this harness ran against an EMPTY database and missed an apply-blocker —
 * prod already had a game_suspensions table (an abandoned division-aware
 * stub: division_id / player_user_id / player_jersey / reason /
 * source_game_id / served_game_id), so Migration J's then-`create table if
 * not exists` silently kept the old shape and the very next index statement
 * errored. The seed below reproduces prod's pre-LRS state byte-for-byte
 * where it matters:
 *   - the OLD game_suspensions stub + its two stale policies (J must drop
 *     and recreate it — verified by shape assertions after apply)
 *   - game_lineups WITHOUT player_id/line (H adds them)
 *   - games WITHOUT rosters_verified_at/by (J adds them)
 *   - the four stat RPCs at their CURRENT prod signatures (I must drop and
 *     recreate them)
 * Audited against prod Jun 11 2026: these are the ONLY pre-existing objects
 * the cluster's migrations touch; none of the 11 new function names, 8 new
 * index names, or new columns exist on prod. (Migration L re-audited Jun 12:
 * posts is stubbed at its live column list; lines_for_game_id /
 * posts_lines_for_game_team_unique_idx / upsert_lineup_post don't exist on
 * prod; is_team_manager is stubbed at its exact prod definition.)
 * Migration M audited Jun 12 2026: game_goalie_changes stubbed at its prod
 * shape; parse_game_clock / game_clock_key / goalie_in_net_timeline /
 * goalie_game_lines and game_goals.empty_net don't exist on prod.
 * Migration N (game_source backfill + skater NULL tolerance): the pre-state
 * seeds NULL-source event rows (prod has them from the GS-1-era write path)
 * + an orphan row from a deleted game, so N's backfill is exercised against
 * the same shape it will meet on prod (overlap guard verified 0 on prod
 * Jun 12 2026).
 *
 * What this harness CANNOT prove: RLS enforcement (PGlite runs as superuser)
 * — that's the branch run of run.js, which clones prod and therefore carries
 * the old stub naturally. Together they're the apply gate (runbook).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const MIGRATIONS = [
  '20260615001000_lrs1_h_lineup_lines_player_id_minor_gate.sql',
  '20260615001100_lrs1_i_leaderboard_player_id.sql',
  '20260615001200_lrs2_j_game_suspensions.sql',
  '20260615001300_lrs3_k_subs_pools.sql',
  '20260615001400_lrs4_l_lineup_post.sql',
  '20260615001500_goalie1_m_in_net_attribution.sql',
  '20260615001600_goalie1_n_game_source_backfill_skater_null_tolerance.sql',
];

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectError = async (name, sql, re) => {
  try { await db.exec(sql); check(name, false, 'no error raised!'); }
  catch (e) { check(name, !re || re.test(e.message), e.message.slice(0, 110)); }
};

// ─── prod-shaped pre-state ───────────────────────────────────────────────────
// Columns mirror the live information_schema dump (Jun 11 2026); only tables/
// columns the three migrations reference are stubbed, at their prod types.
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text, handle text, account_type text default 'adult'
);
-- REG E + profile-context stubs (prod has the real ones; H hard-asserts E)
create function public.is_minor_profile(p_id uuid) returns boolean
language sql stable as
  $$ select exists (select 1 from public.profiles where id = p_id and account_type = 'minor') $$;
create function public.current_profile_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text, director_id uuid, is_activated boolean not null default true
);
create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id), team_name text, pool text
);
create table public.tournament_roles (
  tournament_id uuid, user_id uuid, role text
);
-- real prod definition
create function public.is_tournament_director(p_tournament_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.director_id = p_user_id)
      or exists (select 1 from public.tournament_roles tr where tr.tournament_id = p_tournament_id and tr.user_id = p_user_id and tr.role = 'director');
$$;

-- games: PRE-J shape (no rosters_verified_*)
create table public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id),
  home_team_id uuid, away_team_id uuid,
  start_time timestamptz, home_score integer default 0, away_score integer default 0,
  period integer default 1, status text default 'scheduled',
  scorekeeper_id uuid, round text default 'pool', pool text,
  division_id uuid, shootout_winner text
);
create table public.game_penalties (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null, team_id uuid not null,
  player_number integer, penalty_type text not null, severity text not null,
  duration_minutes integer not null, period integer not null,
  time_in_period text, created_at timestamptz default now(), game_source text
);
create table public.game_goals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, team_id uuid, scorer_number integer,
  assist1_number integer, assist2_number integer, period integer,
  time_in_period text, is_shootout boolean, created_at timestamptz default now(), game_source text
);
create table public.game_shots (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, team_id uuid, period integer, count integer,
  created_at timestamptz default now(), game_source text
);
-- GOALIE-1 pre-state: prod shape (information_schema dump Jun 12 2026).
-- Migration M reads it (goalie_in_net_timeline); M must NOT recreate it.
create table public.game_goalie_changes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null, team_id uuid not null,
  goalie_out_number integer, goalie_in_number integer,
  period integer not null, time_in_period text,
  created_at timestamptz default now(), game_source text
);

create table public.teams (
  id uuid primary key default gen_random_uuid(), name text, manager_id uuid, is_public boolean
);
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text, commissioner_id uuid, is_activated boolean default true
);
create table public.league_divisions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, name text, sort_order integer
);
-- stub matching the prod helper's semantics (founder check; role rows are
-- covered by the real definer fn on prod)
create function public.is_league_commissioner(p_league_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.leagues l where l.id = p_league_id and l.commissioner_id = p_user_id) $$;
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, user_id uuid, role text, jersey_number integer,
  position text, is_captain boolean, is_alternate boolean,
  status text, invite_email text, invite_name text
);
create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, team_id uuid, team_name text, division_id uuid
);
create table public.league_games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, home_team_id uuid, away_team_id uuid,
  start_time timestamptz, home_score integer, away_score integer,
  status text, decided_in text, shootout_winner uuid
);
create table public.team_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, status text
);

-- posts: PRE-L shape (no lines_for_game_id), columns mirroring the live
-- information_schema dump (Jun 12 2026). The teams FK is kept on purpose:
-- if upsert_lineup_post ever writes a league_teams.id into team_id instead
-- of the backing teams.id, the FK explodes here instead of on prod.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  tag text, tag_color text,
  likes integer default 0, comment_count integer default 0, repost_count integer default 0,
  created_at timestamptz default now(),
  media_url text, media_type text, livebarn_venue_id text,
  team_id uuid references public.teams(id) on delete set null,
  is_flagged boolean not null default false,
  is_hidden boolean not null default false,
  flag_reason text, flagged_at timestamptz,
  recap_for_game_id uuid,
  tournament_id uuid, league_id uuid, tournament_team_id uuid, league_team_id uuid,
  hidden_by uuid, hidden_at timestamptz,
  gamepuck_reveal_game_id uuid
);

-- real prod definition (founder OR team_members manager/coach — no status filter)
create function public.is_team_manager(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.manager_id = p_user_id
  ) or exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = p_user_id
      and tm.role in ('manager', 'coach')
  );
$$;

-- game_lineups: PRE-H shape (no player_id, no line)
create table public.game_lineups (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null, game_source text not null, team_id uuid not null,
  user_id uuid, invite_name text, jersey_number integer, position text,
  is_captain boolean default false, is_alternate boolean default false,
  is_goalie boolean default false, is_starter boolean default true,
  created_at timestamptz not null default now(), created_by uuid,
  usa_hockey_number text
);

-- the four stat RPCs at their CURRENT prod signatures — Migration I must
-- DROP these exact signatures and recreate with the player_id column.
create function public.get_league_skater_stats(p_league_id uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean)
 language sql stable as $$ select null::uuid, null::text, null::int, null::text, null::int, null::int, null::int, null::int, null::int, null::numeric, null::boolean where false $$;
create function public.get_league_goalie_stats(p_league_id uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer)
 language sql stable as $$ select null::uuid, null::text, null::int, null::text, null::int, null::int, null::int, null::numeric, null::numeric, null::int, null::int, null::int, null::int where false $$;
create function public.get_tournament_skater_stats(p_tournament_id uuid, p_division_id uuid default null::uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, player_name text, gp integer, goals integer, assists integer, points integer, pim integer, points_per_game numeric, is_goalie boolean)
 language sql stable as $$ select null::uuid, null::text, null::int, null::text, null::int, null::int, null::int, null::int, null::int, null::numeric, null::boolean where false $$;
create function public.get_tournament_goalie_stats(p_tournament_id uuid, p_division_id uuid default null::uuid)
 returns table(team_id uuid, team_name text, jersey_number integer, goalie_name text, gp integer, shots_against integer, goals_against integer, save_pct numeric, gaa numeric, wins integer, losses integer, ties integer, shutouts integer)
 language sql stable as $$ select null::uuid, null::text, null::int, null::text, null::int, null::int, null::int, null::numeric, null::numeric, null::int, null::int, null::int, null::int where false $$;

-- ⚠️ THE COLLISION: prod's abandoned game_suspensions stub, exact shape
-- (information_schema dump Jun 11 2026; 0 rows, 0 inbound FKs on prod) plus
-- its two stale policies. Migration J must drop ALL of this and recreate.
create table public.game_suspensions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  division_id uuid,
  team_id uuid,
  player_user_id uuid,
  player_jersey integer,
  player_name text,
  reason text not null default 'game_misconduct',
  games_remaining integer not null default 1,
  status text not null default 'active',
  source_game_id uuid,
  served_game_id uuid,
  created_at timestamptz default now()
);
alter table public.game_suspensions enable row level security;
create policy game_suspensions_director_all on public.game_suspensions
  for all using (true);
create policy game_suspensions_scorer_insert on public.game_suspensions
  for insert with check (auth.uid() is not null);

-- Migration N backfill fixture: NULL-source event rows that exist BEFORE the
-- chain applies (prod carries such rows from the GS-1-era write path). N must
-- stamp the parented ones and leave the orphan (deleted parent game) NULL.
insert into public.leagues (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'NullSource League');
insert into public.teams (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'NS Home'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'NS Away');
insert into public.league_teams (id, league_id, team_id, team_name) values
  ('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'NS Home'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'NS Away');
insert into public.league_games (id, league_id, home_team_id, away_team_id, status, home_score, away_score) values
  ('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000005', 'final', 1, 0);
insert into public.game_goals (game_id, team_id, scorer_number, period) values
  ('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000004', 77, 1);
insert into public.tournaments (id, name) values ('aaaaaaaa-0000-0000-0000-000000000007', 'NullSource Cup');
insert into public.tournament_teams (id, tournament_id, team_name) values
  ('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000007', 'NS Tigers');
insert into public.games (id, tournament_id, home_team_id, away_team_id, status, home_score, away_score) values
  ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000008', 'final', 1, 0);
insert into public.game_goals (game_id, team_id, scorer_number, period) values
  ('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000008', 66, 2);
insert into public.game_shots (game_id, team_id, period, count) values
  ('aaaaaaaa-0000-0000-0000-00000000000f', 'aaaaaaaa-0000-0000-0000-000000000004', 1, 10);
`);
check('prod-shaped pre-state seeded (incl. old game_suspensions stub + policies)', true);

// ─── apply H, I, J verbatim ──────────────────────────────────────────────────
for (const file of MIGRATIONS) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  try {
    await db.exec(sql);
    check(`${file} applies clean`, true);
  } catch (e) {
    check(`${file} applies clean`, false, e.message);
    console.log(`\n❌ APPLY FAILED — fix before touching a branch or prod.`);
    process.exit(1);
  }
}

// ─── post-apply shape assertions (the collision regression test) ─────────────
{
  const cols = (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='game_suspensions'`)).map(r => r.column_name);
  const newCols = ['game_id', 'penalty_id', 'suspension_type', 'notes', 'resolved_at', 'alerted_at', 'jersey_number'];
  const oldCols = ['division_id', 'player_user_id', 'player_jersey', 'reason', 'source_game_id', 'served_game_id'];
  check('game_suspensions has the NEW schema', newCols.every(c => cols.includes(c)),
    `missing: ${newCols.filter(c => !cols.includes(c)).join(',') || 'none'}`);
  check('old stub columns are GONE', oldCols.every(c => !cols.includes(c)),
    `lingering: ${oldCols.filter(c => cols.includes(c)).join(',') || 'none'}`);
  const pols = (await q(`select policyname from pg_policies where tablename='game_suspensions'`)).map(r => r.policyname);
  check('stale stub policies replaced by Migration J policies',
    pols.includes('game_suspensions_staff_select') && pols.includes('game_suspensions_scorer_insert') && !pols.includes('game_suspensions_director_all'),
    pols.join(','));
  const glCols = (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='game_lineups' and column_name in ('player_id','line')`)).map(r => r.column_name);
  check('H added game_lineups.player_id + line to the prod shape', glCols.length === 2, glCols.join(','));
  const gCols = (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='games' and column_name in ('rosters_verified_at','rosters_verified_by')`)).map(r => r.column_name);
  check('J added games.rosters_verified_at + by', gCols.length === 2, gCols.join(','));
}

// ─── H probes: minor gate + set_lineup against the migrated shape ────────────
const [dir] = await q(`insert into public.profiles (name) values ('Director') returning id`);
const [other] = await q(`insert into public.profiles (name) values ('Scorer') returning id`);
const [minor] = await q(`insert into public.profiles (name, account_type) values ('Kid', 'minor') returning id`);
const asUser = (id) => db.exec(`select set_config('test.uid', '${id}', false)`);

{
  const [team] = await q(`insert into public.teams (name) values ('LT') returning id`);
  const [lg] = await q(`insert into public.league_teams (team_id, team_name) values ($1, 'LT') returning id`, [team.id]);
  const [lgame] = await q(`insert into public.league_games (home_team_id, away_team_id, status) values ($1, $1, 'scheduled') returning id`, [lg.id]);
  await asUser(dir.id);
  await expectError('H gate: unanchored minor on a lineup is BLOCKED',
    `insert into public.game_lineups (game_id, game_source, team_id, user_id, jersey_number)
     values ('${lgame.id}', 'league', '${lg.id}', '${minor.id}', 17)`, /consented roster spot/i);
  await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status) values ($1, $2, 17, 'active')`, [team.id, minor.id]);
  const lineup = await q(`select * from public.set_lineup($1, 'league', $2,
    '[{"user_id":"${minor.id}","player_id":"${minor.id}","jersey_number":17,"line":2,"is_starter":true}]'::jsonb)`, [lgame.id, lg.id]);
  check('H gate + set_lineup: anchored minor saves with a line', lineup.length === 1 && lineup[0].line === 2, JSON.stringify(lineup[0] || {}));
}

// ─── I probes: the DROPs matched prod's signatures and the recreated fns
//     expose player_id (selecting it errors if the old stub survived) ─────────
for (const fn of [
  'get_league_skater_stats',
  'get_league_goalie_stats',
  'get_tournament_skater_stats',
  'get_tournament_goalie_stats',
]) {
  const ok = await db.query(`select player_id from public.${fn}(gen_random_uuid()) limit 0`)
    .then(() => true).catch(() => false);
  check(`I: ${fn} replaced prod signature, exposes player_id`, ok);
}

// ─── J behavior suite (ported, unchanged semantics) ──────────────────────────
const [t] = await q(`insert into public.tournaments (name, director_id) values ('T', $1) returning id`, [dir.id]);
const [tt] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1, 'TT') returning id`, [t.id]);
const [tt2] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1, 'TT2') returning id`, [t.id]);
const [g] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, status) values ($1,$2,$3,'scheduled') returning id`, [t.id, tt.id, tt2.id]);

const [s2] = await q(
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, jersey_number, suspension_type, games_remaining)
   values ($1,$2,$3,'Goon',4,'suspension_2',2) returning id`, [t.id, g.id, tt.id]);

await asUser(other.id);
await expectError('non-director serve raises 42501', `select public.serve_suspension('${s2.id}')`, /director/i);

await asUser(dir.id);
let r = await q(`select status, games_remaining, resolved_at from public.serve_suspension($1)`, [s2.id]);
check('serve #1 → pending, 1 left, unresolved', r[0].status === 'pending' && r[0].games_remaining === 1 && r[0].resolved_at === null, JSON.stringify(r[0]));
r = await q(`select status, games_remaining, resolved_at from public.serve_suspension($1)`, [s2.id]);
check('serve #2 → served, 0 left, resolved', r[0].status === 'served' && r[0].games_remaining === 0 && r[0].resolved_at !== null, JSON.stringify(r[0]));
await expectError('serve #3 fails (no over-serving)', `select public.serve_suspension('${s2.id}')`, /cannot be served/i);
r = await q(`select status, notes from public.overturn_suspension($1, 'video review')`, [s2.id]);
check('overturn from served + note appended', r[0].status === 'overturned' && /Overturned: video review/.test(r[0].notes || ''), JSON.stringify(r[0]));
await expectError('double overturn fails', `select public.overturn_suspension('${s2.id}')`, /already overturned/i);

const [si] = await q(
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, jersey_number, suspension_type, games_remaining)
   values ($1,$2,$3,'Indef',13,'indefinite',0) returning id`, [t.id, g.id, tt.id]);
await expectError('indefinite cannot be served', `select public.serve_suspension('${si.id}')`, /cannot be served|indefinite/i);

await expectError('CHECK: indefinite with games>0 rejected',
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining)
   values ('${t.id}','${g.id}','${tt.id}','X','indefinite',2)`, /check|indefinite_zero/i);
await expectError('CHECK: pending finite with games=0 rejected',
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining)
   values ('${t.id}','${g.id}','${tt.id}','X','suspension_1',0)`, /check|pending_has_games/i);
await expectError('CHECK: negative games_remaining rejected',
  `update public.game_suspensions set games_remaining = -1 where id = '${si.id}'`, /check/i);
await expectError('CHECK: served with games>0 rejected',
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining, status, resolved_at)
   values ('${t.id}','${g.id}','${tt.id}','X','suspension_2',1,'served',now())`, /check|served_zero/i);
await expectError('CHECK: pending with resolved_at rejected',
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining, status, resolved_at)
   values ('${t.id}','${g.id}','${tt.id}','X','suspension_1',1,'pending',now())`, /check|pending_unresolved/i);

r = await q(`select * from public.get_tournament_suspension_flags($1)`, [t.id]);
check('flags: 1 pending for TT, shape is (team_id, pending_count)',
  r.length === 1 && r[0].team_id === tt.id && r[0].pending_count === 1 && Object.keys(r[0]).length === 2,
  JSON.stringify(r));

const [g2] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, scorekeeper_id, status) values ($1,$2,$3,$4,'scheduled') returning id`, [t.id, tt.id, tt2.id, other.id]);
await asUser(other.id);
r = await q(`select public.verify_game_rosters($1) as res`, [g2.id]);
check('scorekeeper verifies clean game (conflicts 0)', r[0].res.verified === true && r[0].res.conflicts === 0, JSON.stringify(r[0].res));
r = await q(`select rosters_verified_by from public.games where id = $1`, [g2.id]);
check('rosters_verified_by stamped', r[0].rosters_verified_by === other.id, JSON.stringify(r[0]));

const [g3] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, scorekeeper_id, status) values ($1,$2,$3,$4,'scheduled') returning id`, [t.id, tt.id, tt2.id, other.id]);
await db.query(`insert into public.game_lineups (game_id, game_source, team_id, jersey_number, invite_name) values ($1,'tournament',$2,13,'Indef')`, [g3.id, tt.id]);
await expectError('conflict: scorekeeper verify blocked', `select public.verify_game_rosters('${g3.id}')`, /director must acknowledge/i);
await asUser(dir.id);
r = await q(`select public.verify_game_rosters($1) as res`, [g3.id]);
check('conflict: director acknowledges (conflicts 1)', r[0].res.verified === true && r[0].res.conflicts === 1, JSON.stringify(r[0].res));

await asUser(crypto.randomUUID());
await expectError('non-staff verify blocked', `select public.verify_game_rosters('${g3.id}')`, /staff/i);

await expectError('direct stamp of rosters_verified_at blocked (trigger)',
  `update public.games set rosters_verified_at = now() where id = '${g2.id}'`, /verify_game_rosters/i);
r = await q(`update public.games set status = 'live' where id = $1 returning status`, [g2.id]);
check('non-verification games updates unaffected by the guard', r[0].status === 'live', JSON.stringify(r[0]));

const [pen] = await q(`insert into public.game_penalties (game_id, team_id, penalty_type, severity, duration_minutes, period) values ($1,$2,'Game Misconduct','Game Misconduct',5,3) returning id`, [g.id, tt.id]);
const [spA] = await q(
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining, penalty_id)
   values ($1,$2,$3,'Dup','suspension_1',1,$4) returning id`, [t.id, g.id, tt.id, pen.id]);
check('filing with penalty link succeeds', !!spA?.id);
await expectError('second ACTIVE filing for the same penalty rejected (23505)',
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining, penalty_id)
   values ('${t.id}','${g.id}','${tt.id}','Dup2','suspension_3',3,'${pen.id}')`, /duplicate key|penalty_active_unique/i);
await asUser(dir.id);
await q(`select public.overturn_suspension($1, 'wrong length')`, [spA.id]);
r = await q(
  `insert into public.game_suspensions (tournament_id, game_id, team_id, player_name, suspension_type, games_remaining, penalty_id)
   values ($1,$2,$3,'Dup3','suspension_3',3,$4) returning id`, [t.id, g.id, tt.id, pen.id]);
check('re-filing after overturn is allowed (partial index)', !!r[0]?.id, JSON.stringify(r[0]));

// ─── K: subs pools ───────────────────────────────────────────────────────────
{
  const cols = (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='league_teams' and column_name in ('is_sub_pool','sub_pool_kind')`)).map(r => r.column_name);
  check('K added league_teams.is_sub_pool + sub_pool_kind', cols.length === 2, cols.join(','));
}

const [lgL] = await q(`insert into public.leagues (name, commissioner_id) values ('ESHL', $1) returning id`, [dir.id]);
const [subX] = await q(`insert into public.profiles (name) values ('Sub X') returning id`);
const [plY] = await q(`insert into public.profiles (name) values ('Roster Y') returning id`);
const [teamA] = await q(`insert into public.teams (name) values ('Team A') returning id`);
const [teamB] = await q(`insert into public.teams (name) values ('Team B') returning id`);
const [ltA] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Team A') returning id`, [lgL.id, teamA.id]);
const [ltB] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Team B') returning id`, [lgL.id, teamB.id]);
await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, role) values ($1,$2,42,'active','player')`, [teamA.id, plY.id]);

await asUser(other.id);
await expectError('non-commissioner cannot create sub pools (42501)',
  `select * from public.create_league_sub_pools('${lgL.id}')`, /commissioner/i);
await asUser(dir.id);
let pools = await q(`select * from public.create_league_sub_pools($1)`, [lgL.id]);
check('commissioner creates BOTH pools (skaters + goalies)',
  pools.length === 2 && new Set(pools.map(p => p.sub_pool_kind)).size === 2 && pools.every(p => p.is_sub_pool),
  JSON.stringify(pools.map(p => p.sub_pool_kind)));
{
  const again = await q(`select * from public.create_league_sub_pools($1)`, [lgL.id]);
  check('pool creation is idempotent (re-run adds none)', again.length === 0, `created ${again.length}`);
  const [mgr] = await q(`select manager_id from public.teams t join public.league_teams lt on lt.team_id = t.id where lt.id = $1`, [pools[0].id]);
  check('pool backing team is manager-owned by the commissioner', mgr.manager_id === dir.id, JSON.stringify(mgr));
}
const skatersPool = pools.find(p => p.sub_pool_kind === 'skaters');
await expectError('K trigger: a pool cannot be scheduled (home)',
  `insert into public.league_games (league_id, home_team_id, away_team_id, status) values ('${lgL.id}','${skatersPool.id}','${ltB.id}','scheduled')`, /cannot be scheduled/i);
await expectError('K trigger: a pool cannot be scheduled (away)',
  `insert into public.league_games (league_id, home_team_id, away_team_id, status) values ('${lgL.id}','${ltA.id}','${skatersPool.id}','scheduled')`, /cannot be scheduled/i);

// identity-keyed sub stats: game 1 — sub X wears Y's #42 (lineup says so);
// game 2 — no lineup, roster fallback attributes #42 to Y.
const [lgame1] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, status) values ($1,$2,$3,'final') returning id`, [lgL.id, ltA.id, ltB.id]);
const [lgame2] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, status) values ($1,$2,$3,'final') returning id`, [lgL.id, ltA.id, ltB.id]);
{
  // the day-of pull IS a set_lineup save that includes a non-rostered adult
  const r = await q(`select * from public.set_lineup($1, 'league', $2,
    '[{"user_id":"${subX.id}","player_id":"${subX.id}","invite_name":"Sub X","jersey_number":42,"is_starter":true}]'::jsonb)`, [lgame1.id, ltA.id]);
  check('day-of pull: ADULT sub (no roster on playing team) saves through set_lineup', r.length === 1 && r[0].user_id === subX.id, JSON.stringify(r[0] || {}));
}
await db.query(`insert into public.game_goals (game_id, team_id, scorer_number, game_source) values ($1,$2,42,'league')`, [lgame1.id, ltA.id]);
await db.query(`insert into public.game_goals (game_id, team_id, scorer_number, game_source) values ($1,$2,42,'league')`, [lgame2.id, ltA.id]);
{
  const board = await q(`select * from public.get_league_skater_stats($1)`, [lgL.id]);
  const xRow = board.find(r => r.player_id === subX.id);
  const yRow = board.find(r => r.player_id === plY.id);
  check('sub stats key on IDENTITY: lineup game attributes #42 to Sub X (1 goal, gp from lineup apps)',
    xRow?.goals === 1 && xRow?.gp === 1 && xRow?.player_name === 'Sub X' && xRow?.team_id === ltA.id,
    JSON.stringify(xRow || {}));
  check('roster fallback: non-lineup game attributes #42 to Roster Y (1 goal, team gp)',
    yRow?.goals === 1 && yRow?.gp === 2,
    JSON.stringify(yRow || {}));
  check('sub pools never seed board rows', !board.some(r => r.team_id === skatersPool.id), '');
}

// the pool flag is commissioner-only (adversarial P1: the loose league_teams
// policies would otherwise let a rival manager "pool-flag" an opponent's team
// off the schedule).
await asUser(other.id);
await expectError('non-commissioner cannot FLIP a playing team into a pool (trigger)',
  `update public.league_teams set is_sub_pool = true, sub_pool_kind = 'skaters' where id = '${ltB.id}'`, /commissioner/i);
await expectError('non-commissioner cannot INSERT a flagged pool row (trigger)',
  `insert into public.league_teams (league_id, team_id, team_name, is_sub_pool, sub_pool_kind)
   values ('${lgL.id}', '${teamB.id}', 'Fake Pool', true, 'goalies')`, /commissioner/i);
{
  await asUser(dir.id);
  const r = await q(`update public.league_teams set team_name = 'Team B renamed' where id = $1 returning team_name`, [ltB.id]);
  check('non-flag league_teams updates pass the guard untouched', r[0].team_name === 'Team B renamed', JSON.stringify(r[0]));
}

// the consent path: a MINOR anchored to the POOL is still blocked from being
// pulled onto another team's lineup (the H gate keys on the PLAYING team).
{
  const [minorSub] = await q(`insert into public.profiles (name, account_type) values ('Pool Kid','minor') returning id`);
  const [poolTeam] = await q(`select team_id from public.league_teams where id = $1`, [skatersPool.id]);
  await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, role) values ($1,$2,7,'active','player')`, [poolTeam.team_id, minorSub.id]);
  await expectError('day-of pull: MINOR sub (anchored to the pool, not the playing team) is BLOCKED',
    `select * from public.set_lineup('${lgame2.id}', 'league', '${ltA.id}',
      '[{"user_id":"${minorSub.id}","player_id":"${minorSub.id}","jersey_number":7,"is_starter":true}]'::jsonb)`, /consented roster spot/i);
}

// ─── L: tonight's-lines post (P4) ────────────────────────────────────────────
{
  const cols = (await q(`select column_name from information_schema.columns
    where table_schema='public' and table_name='posts' and column_name='lines_for_game_id'`)).map(r => r.column_name);
  check('L added posts.lines_for_game_id to the prod shape', cols.length === 1);
  const idx = await q(`select indexname from pg_indexes where indexname='posts_lines_for_game_team_unique_idx'`);
  check('L created the (game, team) idempotency index', idx.length === 1);
}

{
  const [mgrP]   = await q(`insert into public.profiles (name) values ('Lines Mgr') returning id`);
  const [coachP] = await q(`insert into public.profiles (name) values ('Lines Coach') returning id`);
  const [randoP] = await q(`insert into public.profiles (name) values ('Lines Rando') returning id`);
  const [teamC]  = await q(`insert into public.teams (name, manager_id) values ('Team C', $1) returning id`, [mgrP.id]);
  const [ltC]    = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Team C') returning id`, [lgL.id, teamC.id]);
  await db.query(`insert into public.team_members (team_id, user_id, role, status) values ($1,$2,'coach','active')`, [teamC.id, coachP.id]);
  const [lg3] = await q(`insert into public.league_games (league_id, home_team_id, away_team_id, status) values ($1,$2,$3,'scheduled') returning id`, [lgL.id, ltC.id, ltB.id]);

  await asUser(randoP.id);
  await expectError('L: a non-manager cannot post lines (42501)',
    `select * from public.upsert_lineup_post('${lg3.id}', 'league', '${ltC.id}', 'L1: x')`, /manager or coach/i);

  await asUser(mgrP.id);
  const [p1] = await q(`select * from public.upsert_lineup_post($1, 'league', $2, $3)`,
    [lg3.id, ltC.id, "\u{1F4CB} TONIGHT'S LINES\n\u{1F945} Starting: G One (#31)\nL1: A (#9) · B (#13)"]);
  check('L: manager creates the lines post on the TEAM feed (backing teams.id, Lineup tag, keyed to the game)',
    p1?.team_id === teamC.id && p1?.tag === 'Lineup' && p1?.lines_for_game_id === lg3.id
      && p1?.author_id === mgrP.id && p1?.league_id === null && p1?.tournament_id === null,
    JSON.stringify({ team_id: p1?.team_id, tag: p1?.tag, league_id: p1?.league_id }));

  // Re-finalize by a DIFFERENT staffer: the post refreshes in place — same
  // row, original author kept (recap posture), never a second post.
  await asUser(coachP.id);
  const [p2] = await q(`select * from public.upsert_lineup_post($1, 'league', $2, 'refreshed lines')`, [lg3.id, ltC.id]);
  const [cnt] = await q(`select count(*)::int as n from public.posts where lines_for_game_id = $1 and team_id = $2`, [lg3.id, teamC.id]);
  check('L: re-finalize by the coach UPDATES the same post (idempotent, author preserved)',
    p2?.id === p1.id && p2?.content === 'refreshed lines' && p2?.author_id === mgrP.id && cnt.n === 1,
    JSON.stringify({ same: p2?.id === p1.id, author: p2?.author_id === mgrP.id, n: cnt.n }));

  await expectError('L: cannot attach a lines post to a game the team does not play',
    `select * from public.upsert_lineup_post('${lgame2.id}', 'league', '${ltC.id}', 'x')`, /plays in/i);
  await expectError('L: tournament source fails closed (no team feed)',
    `select * from public.upsert_lineup_post('${lg3.id}', 'tournament', '${ltC.id}', 'x')`, /team feed/i);
  await expectError('L: empty content rejected',
    `select * from public.upsert_lineup_post('${lg3.id}', 'league', '${ltC.id}', '  ')`, /content/i);

  // team-source path: same feed, separate game key; participation enforced.
  const [tg1] = await q(`insert into public.team_games (team_id, status) values ($1,'scheduled') returning id`, [teamC.id]);
  const [p3] = await q(`select * from public.upsert_lineup_post($1, 'team', $2, 'team-game lines')`, [tg1.id, teamC.id]);
  check('L: team-game (game_source=team) lines post lands on the same team feed',
    p3?.team_id === teamC.id && p3?.id !== p1.id && p3?.lines_for_game_id === tg1.id, JSON.stringify({ id_differs: p3?.id !== p1.id }));
  const [tgB] = await q(`insert into public.team_games (team_id, status) values ($1,'scheduled') returning id`, [teamB.id]);
  await expectError('L: team-source participation enforced (another team’s game)',
    `select * from public.upsert_lineup_post('${tgB.id}', 'team', '${teamC.id}', 'x')`, /plays in/i);

  // The index is the idempotency authority even off the RPC path.
  await expectError('L: unique index blocks a second direct insert for the same (game, team)',
    `insert into public.posts (author_id, content, team_id, lines_for_game_id)
     values ('${mgrP.id}', 'dup', '${teamC.id}', '${lg3.id}')`, /duplicate key|posts_lines_for_game_team_unique_idx/i);

  // Per-TEAM key: the opponent posts their own lines for the same game.
  await db.query(`update public.teams set manager_id = $1 where id = $2`, [randoP.id, teamB.id]);
  await asUser(randoP.id);
  const [pB] = await q(`select * from public.upsert_lineup_post($1, 'league', $2, 'away-team lines')`, [lg3.id, ltB.id]);
  check('L: the opponent posts their OWN lines for the same game (per-team key)',
    pB?.team_id === teamB.id && pB?.id !== p1.id, JSON.stringify({ team_id: pB?.team_id }));
}

// ─── M: GOALIE-1 — goalie-in-net attribution ─────────────────────────────────
// Conventions under test (see the migration header):
//   * count-DOWN clock: earlier = higher time_in_period; key = period asc,
//     clock desc; a flipped comparison mis-attributes every mid-period goal.
//   * goal at the EXACT change instant → the OUTGOING goalie.
//   * empty_net flag is authoritative; NULL timeline segment is the backstop.
//   * unknown starter / unknown timeline never mis-attributes (charges no
//     one / falls back to the team residual row).
{
  const cols = (await q(`select column_name, is_nullable, column_default from information_schema.columns
    where table_schema='public' and table_name='game_goals' and column_name='empty_net'`));
  check('M added game_goals.empty_net (not null, default false)',
    cols.length === 1 && cols[0].is_nullable === 'NO' && /false/.test(cols[0].column_default),
    JSON.stringify(cols[0] || {}));

  // parse_game_clock + game_clock_key unit probes
  let r = await q(`select public.parse_game_clock('8:42') a, public.parse_game_clock(' 12:30 ') b,
    public.parse_game_clock('garbage') c, public.parse_game_clock(null) d, public.parse_game_clock('12:75') e`);
  check('parse_game_clock: mm:ss → seconds, garbage/null/bad-seconds → null',
    r[0].a === 522 && r[0].b === 750 && r[0].c === null && r[0].d === null && r[0].e === null, JSON.stringify(r[0]));
  r = await q(`select public.game_clock_key(2, '12:30') later, public.game_clock_key(2, '15:00') earlier,
    public.game_clock_key(2, null) period_start, public.game_clock_key(3, '20:00') p3`);
  check('game_clock_key: count-DOWN ordering (15:00 of P2 keys BEFORE 12:30 of P2; null clock = period start; P3 after all of P2)',
    Number(r[0].earlier) < Number(r[0].later) && Number(r[0].period_start) < Number(r[0].earlier)
      && Number(r[0].p3) > Number(r[0].later),
    JSON.stringify(r[0]));
}

// Dedicated league so earlier suites' numbers stay untouched.
const [g1lg]  = await q(`insert into public.leagues (name, commissioner_id) values ('GOALIE-1 League', $1) returning id`, [dir.id]);
const [teamAl] = await q(`insert into public.teams (name) values ('Team Alpha') returning id`);
const [teamBe] = await q(`insert into public.teams (name) values ('Team Beta') returning id`);
const [ltAl] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Team Alpha') returning id`, [g1lg.id, teamAl.id]);
const [ltBe] = await q(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,'Team Beta') returning id`, [g1lg.id, teamBe.id]);
const [greta] = await q(`insert into public.profiles (name) values ('Greta One') returning id`);
const [bea]   = await q(`insert into public.profiles (name) values ('Bea Two') returning id`);
const [wally] = await q(`insert into public.profiles (name) values ('Wally Solo') returning id`);
const [subG]  = await q(`insert into public.profiles (name) values ('Sub Goalie') returning id`);
// Alpha rosters TWO goalies (the ambiguous case M must resolve via lineups);
// Beta rosters exactly ONE (the n=1 roster fallback the old fn keyed on).
await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, position) values ($1,$2,31,'active','Goalie')`, [teamAl.id, greta.id]);
await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, position) values ($1,$2,35,'active','Goalie')`, [teamAl.id, bea.id]);
await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, position) values ($1,$2,1,'active','Goalie')`, [teamBe.id, wally.id]);

const lgGame = async (home, away, hs, as_) => (await q(
  `insert into public.league_games (league_id, home_team_id, away_team_id, status, home_score, away_score)
   values ($1,$2,$3,'final',$4,$5) returning id`, [g1lg.id, home, away, hs, as_]))[0];
const dress = (gameId, teamId, userId, jersey, opts = {}) => db.query(
  `insert into public.game_lineups (game_id, game_source, team_id, user_id, player_id, jersey_number, is_goalie, is_starter, line)
   values ($1,'league',$2,$3,$3,$4,true,$5,$6)`,
  [gameId, teamId, userId, jersey, opts.is_starter !== false, opts.line ?? null]);
const goal = (gameId, teamId, period, clock, opts = {}) => db.query(
  `insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period, is_shootout, empty_net, game_source, created_at)
   values ($1,$2,$3,$4,$5,false,$6,'league', now() + ($7 || ' seconds')::interval)`,
  [gameId, teamId, opts.scorer ?? 9, period, clock, opts.empty_net === true, String(opts.seq ?? 0)]);
const change = (gameId, teamId, out, inn, period, clock) => db.query(
  `insert into public.game_goalie_changes (game_id, team_id, goalie_out_number, goalie_in_number, period, time_in_period, game_source)
   values ($1,$2,$3,$4,$5,$6,'league')`, [gameId, teamId, out, inn, period, clock]);
const shots = (gameId, teamId, period, count) => db.query(
  `insert into public.game_shots (game_id, team_id, period, count, game_source) values ($1,$2,$3,$4,'league')`,
  [gameId, teamId, period, count]);

// ── Game 1: explicit starter + mid-period swap + exact-instant boundary ─────
// Alpha 3-2 Beta. Alpha: #31 (line 1) starts, #35 in at P3 10:00. Beta goals
// at P3 10:00 (the exact change instant → OUTGOING #31) and P3 4:00 (→ #35).
// Beta has no lineup → its single roster goalie #1 eats the game.
const lg1 = await lgGame(ltAl.id, ltBe.id, 3, 2);
await dress(lg1.id, ltAl.id, greta.id, 31, { line: 1 });
await dress(lg1.id, ltAl.id, bea.id, 35, { is_starter: false, line: 2 });
await change(lg1.id, ltAl.id, 31, 35, 3, '10:00');
await goal(lg1.id, ltBe.id, 3, '10:00', { seq: 4 });
await goal(lg1.id, ltBe.id, 3, '4:00',  { seq: 5 });
// Alpha's goals (vs Wally): the 3rd in clock order (P3 12:00) is the
// game-winner — at that instant Alpha still had #31 in net (12:00 is EARLIER
// than the 10:00 change on a count-down clock) → the W is #31's.
await goal(lg1.id, ltAl.id, 1, '10:00', { seq: 1 });
await goal(lg1.id, ltAl.id, 2, '8:00',  { seq: 2 });
await goal(lg1.id, ltAl.id, 3, '12:00', { seq: 3 });
await shots(lg1.id, ltBe.id, 1, 10); await shots(lg1.id, ltBe.id, 2, 8); await shots(lg1.id, ltBe.id, 3, 6);
await shots(lg1.id, ltAl.id, 1, 5);  await shots(lg1.id, ltAl.id, 2, 5);  await shots(lg1.id, ltAl.id, 3, 5);

{
  let r = await q(`select segment_index, goalie_number, open_k, close_k from public.goalie_in_net_timeline($1,'league',$2) order by segment_index`, [lg1.id, ltAl.id]);
  check('timeline: lineup starter + one change → [#31 | #35], contiguous keys',
    r.length === 2 && r[0].goalie_number === 31 && r[1].goalie_number === 35
      && String(r[0].close_k) === String(r[1].open_k) && r[1].close_k === null
      && String(r[1].open_k) === String(3 * 100000 + (99999 - 600)),
    JSON.stringify(r));
  r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,3,2,'W',2) order by goalie_number`, [lg1.id, ltAl.id, ltBe.id]);
  check('boundary: goal at the EXACT change instant charges the OUTGOING goalie (#31 ga 1, #35 ga 1)',
    r.length === 2 && r[0].goalie_number === 31 && r[0].ga === 1 && r[1].goalie_number === 35 && r[1].ga === 1,
    JSON.stringify(r));
  check('shots: period-start rule — mid-P3 swap leaves all 24 SA on #31, 0 on #35',
    r[0].sa === 24 && r[1].sa === 0, JSON.stringify(r.map(x => [x.goalie_number, x.sa])));
  check('W to the goalie of record (in net for the deciding goal), not the finisher',
    r[0].win === 1 && r[1].win === 0 && r[0].shutout === 0 && r[1].shutout === 0, JSON.stringify(r));
  r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,2,3,'L',3)`, [lg1.id, ltBe.id, ltAl.id]);
  check('roster n=1 fallback: Beta #1 carries the full game (ga 3, sa 15, L)',
    r.length === 1 && r[0].goalie_number === 1 && r[0].ga === 3 && r[0].sa === 15 && r[0].loss === 1,
    JSON.stringify(r));
}

// ── Game 2: sole dressed goalie + UNFLAGGED empty-netter (timeline backstop) ─
// Alpha 1-0 Beta. Beta pulls #1 at P3 1:30; Alpha scores at P3 0:58 with NO
// empty_net flag — the NULL segment must keep it off Wally (ga 1-1=0), the L
// still lands on him (finisher), and his shutout is denied (team GA != 0).
const lg2 = await lgGame(ltAl.id, ltBe.id, 1, 0);
await dress(lg2.id, ltAl.id, bea.id, 35);
await change(lg2.id, ltBe.id, 1, null, 3, '1:30');
await goal(lg2.id, ltAl.id, 3, '0:58', { seq: 1 });
await shots(lg2.id, ltBe.id, 3, 4);
await shots(lg2.id, ltAl.id, 1, 7);
{
  let r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,0,1,'L',1)`, [lg2.id, ltBe.id, ltAl.id]);
  check('EN backstop: unflagged goal into the pulled net charges NO ONE (Wally ga 0, still takes the L, no shutout)',
    r.length === 1 && r[0].goalie_number === 1 && r[0].ga === 0 && r[0].loss === 1 && r[0].shutout === 0,
    JSON.stringify(r));
  r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,1,0,'W',0)`, [lg2.id, ltAl.id, ltBe.id]);
  check('shutout: sole goalie + team GA 0 → W + SO to #35',
    r.length === 1 && r[0].goalie_number === 35 && r[0].ga === 0 && r[0].win === 1 && r[0].shutout === 1,
    JSON.stringify(r));
}

// ── Game 3: empty_net FLAG is authoritative even with a goalie in net ────────
// 2-2 tie. Beta's second goal is flagged empty_net while #31 is (per the
// timeline) still in net — scorekeeper input wins, #31 is not charged.
const lg3 = await lgGame(ltAl.id, ltBe.id, 2, 2);
await dress(lg3.id, ltAl.id, greta.id, 31);                       // is_starter true
await dress(lg3.id, ltAl.id, bea.id, 35, { is_starter: false }); // unique flagged starter, no line set
await goal(lg3.id, ltBe.id, 1, '5:00', { seq: 1 });
await goal(lg3.id, ltBe.id, 2, '3:00', { seq: 2, empty_net: true });
await goal(lg3.id, ltAl.id, 1, '2:00', { seq: 3 });
await goal(lg3.id, ltAl.id, 2, '9:00', { seq: 4 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,2,2,'T',2)`, [lg3.id, ltAl.id, ltBe.id]);
  check('empty_net flag authoritative: flagged goal charges no one even mid-segment (#31 ga 1 of 2, T as finisher)',
    r.length === 1 && r[0].goalie_number === 31 && r[0].ga === 1 && r[0].tie === 1,
    JSON.stringify(r));
}

// ── Game 4: UNKNOWN timeline → team residual row, never a guess ──────────────
// Alpha has two roster goalies, no lineup, no changes — nothing to key on.
const lg4 = await lgGame(ltAl.id, ltBe.id, 1, 1);
await goal(lg4.id, ltBe.id, 1, '6:00', { seq: 1 });
await goal(lg4.id, ltAl.id, 2, '6:00', { seq: 2 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,1,1,'T',1)`, [lg4.id, ltAl.id, ltBe.id]);
  check('unknown starter (2 roster goalies, no lineup/changes): one NULL residual line, full GA, no crash',
    r.length === 1 && r[0].goalie_number === null && r[0].ga === 1 && r[0].tie === 1,
    JSON.stringify(r));
}

// ── Game 5: unknown starter + mid-game entry — pre-entry goals charge NO ONE ─
// Alpha 0-2. Change at P2 10:00 brings #35 in (out unknown). The P1 goal
// lands in the unknown segment (charges no one); the P2 4:00 goal is #35's.
// n=1 math must still hold: ga(#35) = total 2 − 1 uncharged = 1.
const lg5 = await lgGame(ltAl.id, ltBe.id, 0, 2);
await change(lg5.id, ltAl.id, null, 35, 2, '10:00');
await goal(lg5.id, ltBe.id, 1, '8:00', { seq: 1 });
await goal(lg5.id, ltBe.id, 2, '4:00', { seq: 2 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,0,2,'L',2)`, [lg5.id, ltAl.id, ltBe.id]);
  check('mid-game first appearance: pre-entry goal charges no one; #35 ga 1, takes the L (finisher fallback)',
    r.length === 1 && r[0].goalie_number === 35 && r[0].ga === 1 && r[0].loss === 1,
    JSON.stringify(r));
}

// ── Games 6+7: SUB GOALIE across two teams + cross-team jersey collision ─────
// Sub G tends Alpha's net wearing #1 (Wally's number on BETA — same number,
// different team, must never cross), then Beta's net wearing #44.
const lg6 = await lgGame(ltAl.id, ltBe.id, 2, 1);
await dress(lg6.id, ltAl.id, subG.id, 1);
await goal(lg6.id, ltBe.id, 2, '7:00', { seq: 1 });
await goal(lg6.id, ltAl.id, 1, '9:00', { seq: 2 });
await goal(lg6.id, ltAl.id, 3, '5:00', { seq: 3 });
const lg7 = await lgGame(ltBe.id, ltAl.id, 0, 1);
await dress(lg7.id, ltBe.id, subG.id, 44);
await dress(lg7.id, ltAl.id, greta.id, 31, { line: 1 });
await goal(lg7.id, ltAl.id, 2, '11:00', { seq: 1 });

// ── Game 8: minor goalie — stats flow, player_id shielded for anon ───────────
const [kid] = await q(`insert into public.profiles (name, account_type) values ('Kid Glove','minor') returning id`);
await db.query(`insert into public.team_members (team_id, user_id, jersey_number, status, position) values ($1,$2,99,'active','Goalie')`, [teamAl.id, kid.id]);
const lg8 = await lgGame(ltAl.id, ltBe.id, 1, 1);
await dress(lg8.id, ltAl.id, kid.id, 99);
await goal(lg8.id, ltBe.id, 1, '4:00', { seq: 1 });
await goal(lg8.id, ltAl.id, 1, '3:00', { seq: 2 });

// ── Game 9: goal with NO clock in a single-goalie game → still charged ───────
const lg9 = await lgGame(ltAl.id, ltBe.id, 2, 1);
await dress(lg9.id, ltAl.id, greta.id, 31);
await goal(lg9.id, ltBe.id, 2, null,    { seq: 1 });
await goal(lg9.id, ltAl.id, 1, '7:00',  { seq: 2 });
await goal(lg9.id, ltAl.id, 3, '14:00', { seq: 3 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,2,1,'W',1)`, [lg9.id, ltAl.id, ltBe.id]);
  check('untimed goal, single goalie: charged (no clock needed when the period is uncontested)',
    r.length === 1 && r[0].goalie_number === 31 && r[0].ga === 1 && r[0].win === 1,
    JSON.stringify(r));
}

// ── Game 10: goal with NO clock in a SPLIT period → charges no one ───────────
const lg10 = await lgGame(ltAl.id, ltBe.id, 0, 1);
await dress(lg10.id, ltAl.id, greta.id, 31, { line: 1 });
await dress(lg10.id, ltAl.id, bea.id, 35, { is_starter: false, line: 2 });
await change(lg10.id, ltAl.id, 31, 35, 2, '10:00');
await goal(lg10.id, ltBe.id, 2, null, { seq: 1 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,0,1,'L',1) order by goalie_number`, [lg10.id, ltAl.id, ltBe.id]);
  check('untimed goal in a split period: ambiguous → charges NO ONE (#31 ga 0, #35 ga 0, L on the finisher #35)',
    r.length === 2 && r[0].ga === 0 && r[1].ga === 0 && r[0].win + r[0].loss + r[0].tie === 0 && r[1].loss === 1,
    JSON.stringify(r));
}

// ── The league BOARD: aggregation, identity keys, residuals, shield ──────────
await asUser(dir.id);
{
  const board = await q(`select * from public.get_league_goalie_stats($1)`, [g1lg.id]);
  const byId = (id) => board.filter(r => r.player_id === id);
  const gRow = byId(greta.id), bRow = byId(bea.id), wRow = byId(wally.id), kRow = byId(kid.id);
  check('board: Greta #31 line (gp 5, ga 3, sa 24, 3W 1T 1SO)',
    gRow.length === 1 && gRow[0].gp === 5 && gRow[0].goals_against === 3 && gRow[0].shots_against === 24
      && gRow[0].wins === 3 && gRow[0].ties === 1 && gRow[0].losses === 0 && gRow[0].shutouts === 1
      && gRow[0].jersey_number === 31 && gRow[0].goalie_name === 'Greta One' && gRow[0].team_id === ltAl.id,
    JSON.stringify(gRow));
  check('board: Bea #35 line (gp 4, ga 2, sa 4, 1W 2L 1SO)',
    bRow.length === 1 && bRow[0].gp === 4 && bRow[0].goals_against === 2 && bRow[0].shots_against === 4
      && bRow[0].wins === 1 && bRow[0].losses === 2 && bRow[0].shutouts === 1,
    JSON.stringify(bRow));
  check('board: Wally #1 keeps ONLY Beta games incl. roster-fallback ones (gp 9, ga 11, sa 22, 2W 4L 3T 2SO)',
    wRow.length === 1 && wRow[0].team_id === ltBe.id && wRow[0].gp === 9 && wRow[0].goals_against === 11
      && wRow[0].shots_against === 22 && wRow[0].wins === 2 && wRow[0].losses === 4 && wRow[0].ties === 3
      && wRow[0].shutouts === 2,
    JSON.stringify(wRow));
  const sRows = byId(subG.id);
  check('sub goalie: identity-keyed rows on BOTH teams (Alpha #1 W, Beta #44 L), jersey collision never crosses to Wally',
    sRows.length === 2
      && sRows.some(r => r.team_id === ltAl.id && r.jersey_number === 1 && r.wins === 1 && r.goals_against === 1)
      && sRows.some(r => r.team_id === ltBe.id && r.jersey_number === 44 && r.losses === 1 && r.goals_against === 1),
    JSON.stringify(sRows));
  const resid = board.filter(r => r.team_id === ltAl.id && r.jersey_number === null && r.player_id === null);
  check('residual: only the unknown-timeline game rolls to "Team Alpha (goaltending)" (gp 1, ga 1, 1T)',
    resid.length === 1 && resid[0].goalie_name === 'Team Alpha (goaltending)' && resid[0].gp === 1
      && resid[0].goals_against === 1 && resid[0].ties === 1,
    JSON.stringify(resid));
  check('minor goalie: stats flow with player_id visible to a signed-in caller',
    kRow.length === 1 && kRow[0].gp === 1 && kRow[0].goals_against === 1 && kRow[0].ties === 1,
    JSON.stringify(kRow));
}
{
  await db.exec(`select set_config('test.uid', '', false)`);
  const board = await q(`select * from public.get_league_goalie_stats($1)`, [g1lg.id]);
  const kAnon = board.filter(r => r.goalie_name === 'Kid Glove');
  const gAnon = board.filter(r => r.goalie_name === 'Greta One');
  check('minor shield: anon caller sees the minor goalie row with player_id NULL (adults keep theirs)',
    kAnon.length === 1 && kAnon[0].player_id === null && gAnon.length === 1 && gAnon[0].player_id === greta.id,
    JSON.stringify({ kid: kAnon[0]?.player_id, greta: gAnon[0]?.player_id }));
}

// ── Game 11: the ScorerView starter-NUDGE row (change at P1 period start) ────
// The nudge writes (out null, in #, period 1, time null). All timed P1 events
// must land on the nudged starter, and P1's shots must go to the INCOMING
// goalie (period-start lookups use the [open, close) boundary).
const lg11 = await lgGame(ltAl.id, ltBe.id, 0, 1);
await dress(lg11.id, ltAl.id, greta.id, 31);                      // both default
await dress(lg11.id, ltAl.id, bea.id, 35);                        // is_starter → ambiguous
await change(lg11.id, ltAl.id, null, 31, 1, null);                // the nudge row
await goal(lg11.id, ltBe.id, 1, '15:00', { seq: 1 });
await shots(lg11.id, ltBe.id, 1, 9);
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,0,1,'L',1) order by goalie_number`, [lg11.id, ltAl.id, ltBe.id]);
  check('starter nudge row: P1-start change → timed P1 goal AND P1 shots land on the nudged starter (#31), backup untouched',
    r.length === 1 && r[0].goalie_number === 31 && r[0].ga === 1 && r[0].sa === 9 && r[0].loss === 1,
    JSON.stringify(r));
}

// ── Game 12: two changes at the SAME instant — zero-length segment absorbs
// nothing; a goal at that exact instant charges the FIRST outgoing goalie. ──
const lg12 = await lgGame(ltAl.id, ltBe.id, 0, 1);
await dress(lg12.id, ltAl.id, greta.id, 31, { line: 1 });
await change(lg12.id, ltAl.id, 31, 35, 2, '8:00');
await change(lg12.id, ltAl.id, 35, 31, 2, '8:00'); // double-swap, same clock
await goal(lg12.id, ltBe.id, 2, '8:00', { seq: 1 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,0,1,'L',1) order by goalie_number`, [lg12.id, ltAl.id, ltBe.id]);
  const g31 = r.find(x => x.goalie_number === 31), g35 = r.find(x => x.goalie_number === 35);
  check('same-instant double change: zero-length segment absorbs nothing; boundary goal → first outgoing (#31), #35 ga 0',
    g31?.ga === 1 && (!g35 || g35.ga === 0),
    JSON.stringify(r));
}

// ── Game 13: SHARED 0-GA game → shutout to NO ONE, W to exactly one ─────────
const lg13 = await lgGame(ltAl.id, ltBe.id, 1, 0);
await dress(lg13.id, ltAl.id, greta.id, 31, { line: 1 });
await dress(lg13.id, ltAl.id, bea.id, 35, { is_starter: false, line: 2 });
await change(lg13.id, ltAl.id, 31, 35, 2, '10:00');
await goal(lg13.id, ltAl.id, 3, '5:00', { seq: 1 });
{
  const r = await q(`select * from public.goalie_game_lines($1,'league',$2,$3,1,0,'W',0) order by goalie_number`, [lg13.id, ltAl.id, ltBe.id]);
  check('shared 0-GA game: no shutout for either goalie; the W goes to exactly one (goalie of record)',
    r.length === 2 && r.every(x => x.shutout === 0) && r.reduce((s, x) => s + x.win, 0) === 1,
    JSON.stringify(r));
}

// ─── M: tournament side — SO decision, split GA, residual fallback ───────────
const [g1t]  = await q(`insert into public.tournaments (name, director_id) values ('GOALIE-1 Cup', $1) returning id`, [dir.id]);
const [tta] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'Avalanche') returning id`, [g1t.id]);
const [ttb] = await q(`insert into public.tournament_teams (tournament_id, team_name) values ($1,'Blizzard') returning id`, [g1t.id]);
const [pA] = await q(`insert into public.profiles (name) values ('Tina Net') returning id`);
const [pB] = await q(`insert into public.profiles (name) values ('Nora Pad') returning id`);

// T-Game 1: 2-2, decided by shootout (home wins). #30 (line 1) starts, #29 in
// at P3 5:00. SO decision has no deciding goal → the W goes to the FINISHER.
const [tg1] = await q(`insert into public.games (tournament_id, home_team_id, away_team_id, status, home_score, away_score, shootout_winner)
  values ($1,$2,$3,'final',2,2,'home') returning id`, [g1t.id, tta.id, ttb.id]);
const tDress = (gameId, teamId, userId, jersey, opts = {}) => db.query(
  `insert into public.game_lineups (game_id, game_source, team_id, user_id, player_id, jersey_number, is_goalie, is_starter, line)
   values ($1,'tournament',$2,$3,$3,$4,true,$5,$6)`,
  [gameId, teamId, userId, jersey, opts.is_starter !== false, opts.line ?? null]);
const tGoal = (gameId, teamId, period, clock, seq = 0, so = false) => db.query(
  `insert into public.game_goals (game_id, team_id, scorer_number, period, time_in_period, is_shootout, game_source, created_at)
   values ($1,$2,8,$3,$4,$5,'tournament', now() + ($6 || ' seconds')::interval)`,
  [gameId, teamId, period, clock, so, String(seq)]);
await tDress(tg1.id, tta.id, pA.id, 30, { line: 1 });
await tDress(tg1.id, tta.id, pB.id, 29, { is_starter: false, line: 2 });
await db.query(`insert into public.game_goalie_changes (game_id, team_id, goalie_out_number, goalie_in_number, period, time_in_period, game_source)
  values ($1,$2,30,29,3,'5:00','tournament')`, [tg1.id, tta.id]);
await tGoal(tg1.id, ttb.id, 1, '10:00', 1);
await tGoal(tg1.id, ttb.id, 3, '2:00', 2);
await tGoal(tg1.id, tta.id, 2, '6:00', 3);
await tGoal(tg1.id, tta.id, 2, '1:00', 4);
await tGoal(tg1.id, tta.id, 9, null, 5, true); // SO winner row — must stay out of GA

// T-Game 2: no lineups, no changes on either side → both teams fall back to
// residual rows (pre-M these games silently DROPPED off the tournament board).
await q(`insert into public.games (tournament_id, home_team_id, away_team_id, status, home_score, away_score)
  values ($1,$2,$3,'final',1,0) returning id`, [g1t.id, tta.id, ttb.id]);

await asUser(dir.id);
{
  const board = await q(`select * from public.get_tournament_goalie_stats($1)`, [g1t.id]);
  const a30 = board.find(r => r.player_id === pA.id);
  const a29 = board.find(r => r.player_id === pB.id);
  check('tournament: split GA lands per segment (#30 ga 1, #29 ga 1), SO goal row excluded',
    a30?.goals_against === 1 && a29?.goals_against === 1 && a30?.gp === 1 && a29?.gp === 1,
    JSON.stringify({ a30, a29 }));
  check('tournament: SO-decided W goes to the FINISHER (#29), no shared shutout',
    a29?.wins === 1 && a30?.wins === 0 && a30?.shutouts === 0 && a29?.shutouts === 0,
    JSON.stringify({ w30: a30?.wins, w29: a29?.wins }));
  const residA = board.find(r => r.team_id === tta.id && r.jersey_number === null);
  const residB = board.filter(r => r.team_id === ttb.id && r.jersey_number === null);
  // (T-game 2 has no goal rows — tournament GA stays row-count-based per the
  // pre-M semantics, so the residuals carry ga 0 from it, not the score. The
  // shutout cross-check against the official score keeps that data gap from
  // minting an SO in a 1-0 LOSS, while the winner's true 0-GA game keeps it.)
  check('tournament: unknown-timeline games surface as "(goaltending)" residuals instead of dropping',
    residA?.goalie_name === 'Avalanche (goaltending)' && residA?.gp === 1 && residA?.wins === 1
      && residA?.shutouts === 1
      && residB.length === 1 && residB[0].gp === 2 && residB[0].losses === 2 && residB[0].goals_against === 2
      && residB[0].shutouts === 0,
    JSON.stringify({ residA, residB }));
}

// ─── N: game_source backfill + skater-RPC NULL tolerance ─────────────────────
{
  // Backfill: pre-existing NULL-source rows stamped by parent table; the
  // orphan (deleted parent game) deliberately left NULL.
  let r = await q(`select game_source from public.game_goals where game_id = 'aaaaaaaa-0000-0000-0000-000000000006'`);
  check('N backfill: NULL-source league goal stamped league',
    r.length === 1 && r[0].game_source === 'league', JSON.stringify(r));
  r = await q(`select game_source from public.game_goals where game_id = 'aaaaaaaa-0000-0000-0000-000000000009'`);
  check('N backfill: NULL-source tournament goal stamped tournament',
    r.length === 1 && r[0].game_source === 'tournament', JSON.stringify(r));
  r = await q(`select game_source from public.game_shots where game_id = 'aaaaaaaa-0000-0000-0000-00000000000f'`);
  check('N backfill: orphan row (deleted parent game) stays NULL',
    r.length === 1 && r[0].game_source === null, JSON.stringify(r));

  // The boards now SEE the rows (these were invisible pre-N).
  const lb = await q(`select * from public.get_league_skater_stats('aaaaaaaa-0000-0000-0000-000000000001')`);
  const g77 = lb.find(x => x.jersey_number === 77);
  check('league skater board: backfilled goal visible (#77 ghost, 1 goal, team gp)',
    g77?.goals === 1 && g77?.gp === 1 && g77?.player_name === '#77', JSON.stringify(g77 || {}));
  const tb = await q(`select * from public.get_tournament_skater_stats('aaaaaaaa-0000-0000-0000-000000000007')`);
  const g66 = tb.find(x => x.jersey_number === 66);
  check('tournament skater board: backfilled goal visible (#66 ghost, 1 goal)',
    g66?.goals === 1 && g66?.gp === 1, JSON.stringify(g66 || {}));

  // TOLERANCE beyond the backfill: a NULL-source row written AFTER apply
  // (never backfilled) must still count — this is the filter fix itself.
  await db.query(`insert into public.game_goals (game_id, team_id, scorer_number, period)
    values ('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000004', 77, 2)`);
  const lb2 = await q(`select * from public.get_league_skater_stats('aaaaaaaa-0000-0000-0000-000000000001')`);
  const g77b = lb2.find(x => x.jersey_number === 77);
  check('skater tolerance: a NULL-source goal written post-backfill still counts (#77 → 2 goals)',
    g77b?.goals === 2, JSON.stringify(g77b || {}));

  // Signatures survived the N rewrite (deployed clients keep working).
  for (const fn of ['get_league_skater_stats', 'get_tournament_skater_stats']) {
    const ok = await db.query(`select player_id, is_goalie, points_per_game from public.${fn}(gen_random_uuid()) limit 0`)
      .then(() => true).catch(() => false);
    check(`N: ${fn} keeps its frozen signature`, ok);
  }
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
