#!/usr/bin/env node
/**
 * LRS-1 migration harness — applies Migrations H, I, J verbatim to a REAL
 * Postgres (PGlite/WASM) seeded with PROD-SHAPED pre-state, then runs the
 * full GS-2/GS-5 behavior suite. No network, no Supabase project needed:
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
 * index names, or new columns exist on prod.
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

create table public.teams (
  id uuid primary key default gen_random_uuid(), name text, manager_id uuid
);
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

console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
