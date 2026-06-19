#!/usr/bin/env node
/**
 * ENGAGE-1 milestone migration smoke — applies 20260619140000_player_milestones.sql
 * verbatim to a PROD-SHAPED PGlite Postgres and exercises detection:
 * first goal, 100th point (boundary), point streak, notify, and idempotency.
 * No network / no Supabase project:  node scripts/engage-smoke/milestones.mjs
 *
 * Stubs only the columns the migration's functions read, at prod types. Cannot
 * prove RLS (PGlite runs as superuser) — that's the branch/prod gate.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20260619140000_player_milestones.sql');
const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`); };
const q = async (sql, p) => (await db.query(sql, p)).rows;

// ── prod-shaped stubs (only what the migration touches) ──────────────────────
// Supabase roles the migration grants to (they exist on prod, not in bare PGlite).
await db.exec(`do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;`);
await db.exec(`
  create table public.profiles (id uuid primary key default gen_random_uuid(), name text);
  create table public.games (id uuid primary key default gen_random_uuid(), status text, start_time timestamptz, tournament_id uuid);
  create table public.league_games (id uuid primary key default gen_random_uuid(), status text, start_time timestamptz, league_id uuid);
  create table public.game_lineups (id uuid primary key default gen_random_uuid(), game_id uuid, game_source text, team_id uuid, user_id uuid, jersey_number int);
  create table public.game_goals (id uuid primary key default gen_random_uuid(), game_id uuid, team_id uuid, scorer_number int, assist1_number int, assist2_number int, is_shootout boolean default false, game_source text);
  create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid, actor_id uuid, kind text, body text, game_id uuid, metadata jsonb, read_at timestamptz, created_at timestamptz default now());
`);

// ── apply the migration ──────────────────────────────────────────────────────
try { await db.exec(readFileSync(MIG, 'utf8')); check('migration applies', true); }
catch (e) { check('migration applies', false, e.message.slice(0, 200)); console.log('\n❌ APPLY FAILED — fix before apply.'); process.exit(1); }

const TT = '11111111-1111-1111-1111-111111111111'; // a team id (opaque)
const mkProfile = async (name) => (await q(`insert into profiles(name) values ($1) returning id`, [name]))[0].id;
const mkGame = async (start) => (await q(`insert into games(status,start_time,tournament_id) values ('final',$1,gen_random_uuid()) returning id`, [start]))[0].id;
const dress = (game, user, jersey) => db.query(`insert into game_lineups(game_id,game_source,team_id,user_id,jersey_number) values ($1,'tournament',$2,$3,$4)`, [game, TT, user, jersey]);
const goal = (game, jersey, assist) => db.query(`insert into game_goals(game_id,team_id,scorer_number,assist1_number,game_source) values ($1,$2,$3,$4,'tournament')`, [game, TT, jersey, assist ?? null]);
const milestones = (u) => q(`select kind, value, label from player_milestones where user_id=$1 order by kind, value`, [u]);
const notifs = (kind) => q(`select recipient_id, body from notifications where kind=$1`, [kind]);

// ── Scenario A: first career goal ────────────────────────────────────────────
const alice = await mkProfile('Alice'), mate = await mkProfile('Mate');
const gA = await mkGame('2026-01-01T00:00:00Z');
await dress(gA, alice, 7); await dress(gA, mate, 9);
await goal(gA, 7);                                   // Alice scores her first ever
const newA = (await q(`select award_milestones_for_game($1,'tournament') as n`, [gA]))[0].n;
const mA = await milestones(alice);
check('first_goal awarded', mA.some(m => m.kind === 'first_goal' && m.value === 1), JSON.stringify(mA));
check('award returned a count', Number(newA) >= 1, `n=${newA}`);
check('player notified', (await q(`select 1 from notifications where recipient_id=$1 and kind='milestone'`, [alice])).length > 0);
check('teammate notified', (await q(`select 1 from notifications where recipient_id=$1 and kind='milestone'`, [mate])).length > 0);

// idempotency — re-run awards nothing new
const reA = (await q(`select award_milestones_for_game($1,'tournament') as n`, [gA]))[0].n;
check('idempotent re-run (0 new)', Number(reA) === 0, `n=${reA}`);
check('no duplicate milestone rows', (await milestones(alice)).filter(m => m.kind === 'first_goal').length === 1);

// ── Scenario B: 100th point + point streak (3 straight games w/ a point) ──────
const bob = await mkProfile('Bob');
// 99 prior career points in one earlier game (contrived but exercises the
// 100-boundary math): 99 goals.
const gPrior = await mkGame('2026-02-01T00:00:00Z');
await dress(gPrior, bob, 12);
for (let i = 0; i < 99; i++) await goal(gPrior, 12);
await (await q(`select award_milestones_for_game($1,'tournament') as n`, [gPrior]))[0]; // settle prior

// two more point games to build the streak, then the milestone game (100th pt)
const g2 = await mkGame('2026-02-02T00:00:00Z'); await dress(g2, bob, 12); await goal(g2, 12);
await q(`select award_milestones_for_game($1,'tournament') as n`, [g2]);
const g3 = await mkGame('2026-02-03T00:00:00Z'); await dress(g3, bob, 12); await goal(g3, 12);
await q(`select award_milestones_for_game($1,'tournament') as n`, [g3]);
// Bob now: 99 + 1 + 1 = 101 pts over 3 games; streak 3. (100-boundary crossed at g2.)

const mB = await milestones(bob);
check('points_100 awarded (boundary crossed)', mB.some(m => m.kind === 'points_100' && m.value === 100), JSON.stringify(mB));
check('point_streak 3 awarded', mB.some(m => m.kind === 'point_streak' && m.value === 3), JSON.stringify(mB));
check('no premature streak_5', !mB.some(m => m.kind === 'point_streak' && m.value === 5));

// streak breaks: a pointless game then a point game → streak resets, no new 3 (already have it)
const gBreak = await mkGame('2026-02-04T00:00:00Z'); await dress(gBreak, bob, 12); // no goal
await q(`select award_milestones_for_game($1,'tournament') as n`, [gBreak]);
const g5 = await mkGame('2026-02-05T00:00:00Z'); await dress(g5, bob, 12); await goal(g5, 12);
await q(`select award_milestones_for_game($1,'tournament') as n`, [g5]);
check('streak reset after a pointless game (still only streak_3)', (await milestones(bob)).filter(m => m.kind === 'point_streak').length === 1);

console.log(failed === 0 ? '\n✅ all milestone smoke checks passed' : `\n❌ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
