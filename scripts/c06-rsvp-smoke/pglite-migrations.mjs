#!/usr/bin/env node
/**
 * C06 PR-2 · RSVP polymorphic-schema migration harness — applies
 *   supabase/migrations/20260703101000_c06_p2_rsvp_polymorphic.sql
 * verbatim (TWICE, for idempotency) to a REAL Postgres (PGlite/WASM) seeded
 * with a PROD-SHAPED pre-state, then proves BUG-1's fix end to end. No network,
 * no Supabase project:
 *
 *   node scripts/c06-rsvp-smoke/pglite-migrations.mjs
 *
 * WHY THE SEED SHAPE MATTERS (migration_prod_shape_testing): the migration
 * alters team_game_rsvps and references team_games, league_games, games,
 * tournaments, league_teams, plus the DEFINER helper can_view_team(). Their prod
 * shapes were audited live 2026-07-02 and reproduced below at their real
 * column names / types / nullability / FK targets:
 *   - team_game_rsvps: game_id uuid NOT NULL FK team_games(id) ON DELETE CASCADE,
 *       user_id uuid NOT NULL FK profiles(id), status text CHECK in/out/maybe,
 *       UNIQUE(game_id,user_id), index (user_id)
 *   - league_games.home_team_id/away_team_id → league_teams(id)  (NOT team_games!)
 *   - league_teams.team_id uuid NULLABLE → teams(id)
 *   - games.tournament_id uuid NOT NULL → tournaments(id)
 *   - tournaments.is_youth boolean NOT NULL default false
 *   - can_view_team(team_id) = public team OR is_team_insider(team_id, me)
 * Prod has NO league_game_id / tournament_game_id columns and none of the three
 * partial unique indexes, so the migration's adds cannot collide with a stub.
 *
 * ASSERTS: exactly-one CHECK enforced; per-source uniqueness (team/league/
 * tournament) each independently; a LEGACY team_games RSVP row seeded before the
 * migration survives untouched; cascade deletes from all three parents; RLS
 * own-row read semantics intact across all three sources for a real
 * non-superuser client role.
 *
 * RLS NOTE: PGlite runs as superuser (BYPASSRLS). To PROVE the read policy we
 * create NOLOGIN non-superuser roles, grant privileges, `set role`, and assert
 * visibility per source.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260703101000_c06_p2_rsvp_polymorphic.sql',
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
  catch (e) { check(name, !re || re.test(e.message), e.message.slice(0, 120)); }
};

// ─── prod-shaped pre-state (audited live 2026-07-02) ─────────────────────────
await db.exec(`
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  name text not null default 'x',
  is_admin boolean not null default false
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null default 'public'   -- 'public' | 'private' (prod shape)
);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid,
  status text default 'active'
);

create table public.team_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  event_type text default 'game'
);

create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id)     -- NULLABLE (prod shape)
);

create table public.league_games (
  id uuid primary key default gen_random_uuid(),
  home_team_id uuid references public.league_teams(id),
  away_team_id uuid references public.league_teams(id)
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_youth boolean not null default false      -- NOT NULL default false
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade
);

-- team_game_rsvps at its EXACT prod pre-migration shape.
create table public.team_game_rsvps (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.team_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status = any (array['in','out','maybe'])),
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint team_game_rsvps_game_id_user_id_key unique (game_id, user_id)
);
create index team_game_rsvps_user_id_idx on public.team_game_rsvps (user_id);
alter table public.team_game_rsvps enable row level security;

-- DEFINER helpers — shape-faithful (self-manage; public-team OR team_member
-- insider). Defined BEFORE the policies that reference them.
create function public.current_profile_id() returns uuid
language sql stable security definer set search_path to 'public' as
  $$ select id from public.profiles where auth_user_id = (select auth.uid()) $$;

create function public.can_manage_profile(p_profile_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as
  $$ select p_profile_id = public.current_profile_id() $$;

create function public.is_team_insider(p_team_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p_team_id is not null and p_profile_id is not null and exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = p_profile_id
      and coalesce(tm.status,'active') in ('active','pending')
  );
$$;

create function public.can_view_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.teams t where t.id = p_team_id and t.visibility = 'public')
      or public.is_team_insider(p_team_id, public.current_profile_id());
$$;

-- Pre-migration RLS (the exact prod policies). rsvp_read hard-assumes game_id.
create policy rsvp_read on public.team_game_rsvps for select to public
using (public.can_view_team((select tg.team_id from public.team_games tg where tg.id = team_game_rsvps.game_id)));
create policy rsvp_user_insert on public.team_game_rsvps for insert to public
with check (public.can_manage_profile(user_id));
create policy rsvp_user_update on public.team_game_rsvps for update to public
using (public.can_manage_profile(user_id)) with check (public.can_manage_profile(user_id));
create policy rsvp_user_delete on public.team_game_rsvps for delete to public
using (public.can_manage_profile(user_id));
`);
check('prod-shaped pre-state seeded (team_game_rsvps at prod pre-migration shape)', true);

// ─── seed a LEGACY team RSVP row BEFORE the migration (must survive) ──────────
const [alice] = await q(`insert into public.profiles (auth_user_id, name) values (gen_random_uuid(),'Alice') returning id, auth_user_id`);
const [pubTeam]  = await q(`insert into public.teams (name, visibility) values ('Public Team','public') returning id`);
const [privTeam] = await q(`insert into public.teams (name, visibility) values ('Private Team','private') returning id`);
await q(`insert into public.team_members (team_id, user_id, status) values ($1,$2,'active')`, [privTeam.id, alice.id]);
const [teamGame] = await q(`insert into public.team_games (team_id) values ($1) returning id`, [pubTeam.id]);
const [legacyRsvp] = await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in') returning id`, [teamGame.id, alice.id]);
check('legacy team RSVP row seeded pre-migration', !!legacyRsvp.id);

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

// ─── the legacy row survived untouched ───────────────────────────────────────
{
  const [row] = await q(`select game_id, league_game_id, tournament_game_id, user_id, status
    from public.team_game_rsvps where id = $1`, [legacyRsvp.id]);
  check('legacy team RSVP survives migration untouched (game_id kept, siblings null)',
    row && row.game_id === teamGame.id && row.league_game_id === null &&
    row.tournament_game_id === null && row.status === 'in', JSON.stringify(row));
}

// ─── post-apply shape assertions ─────────────────────────────────────────────
{
  const cols = (await q(`select column_name, is_nullable from information_schema.columns
    where table_schema='public' and table_name='team_game_rsvps'
      and column_name in ('game_id','league_game_id','tournament_game_id')
    order by column_name`));
  const byName = Object.fromEntries(cols.map(c => [c.column_name, c.is_nullable]));
  check('game_id now NULLABLE; both new FK columns exist + NULLABLE',
    byName.game_id === 'YES' && byName.league_game_id === 'YES' && byName.tournament_game_id === 'YES',
    JSON.stringify(byName));

  const idx = (await q(`select indexname from pg_indexes
    where schemaname='public' and tablename='team_game_rsvps'`)).map(r => r.indexname);
  check('three per-source partial unique indexes present',
    ['team_game_rsvps_team_user_uidx','team_game_rsvps_league_user_uidx','team_game_rsvps_tournament_user_uidx']
      .every(n => idx.includes(n)), idx.join(','));
  check('covering indexes on both new FK columns present',
    idx.includes('team_game_rsvps_league_game_id_idx') && idx.includes('team_game_rsvps_tournament_game_id_idx'),
    idx.join(','));
  check('old composite UNIQUE(game_id,user_id) constraint dropped',
    !idx.includes('team_game_rsvps_game_id_user_id_key'), idx.join(','));

  const fks = await q(`select conname, confrelid::regclass::text as target from pg_constraint
    where conrelid='public.team_game_rsvps'::regclass and contype='f' order by conname`);
  check('FKs point at team_games, league_games, games (+ profiles)',
    fks.some(f => f.target === 'team_games') && fks.some(f => f.target === 'league_games') &&
    fks.some(f => f.target === 'games') && fks.some(f => f.target === 'profiles'),
    JSON.stringify(fks));
}

// ─── seed one game per source + a second profile ─────────────────────────────
const [bob] = await q(`insert into public.profiles (auth_user_id, name) values (gen_random_uuid(),'Bob') returning id, auth_user_id`);
const [lt] = await q(`insert into public.league_teams (team_id) values ($1) returning id`, [pubTeam.id]);
const [leagueGame] = await q(`insert into public.league_games (home_team_id, away_team_id) values ($1, null) returning id`, [lt.id]);
const [adultTourn] = await q(`insert into public.tournaments (name, is_youth) values ('Adult Cup', false) returning id`);
const [youthTourn] = await q(`insert into public.tournaments (name, is_youth) values ('Youth Cup', true) returning id`);
const [adultGame] = await q(`insert into public.games (tournament_id) values ($1) returning id`, [adultTourn.id]);
const [youthGame] = await q(`insert into public.games (tournament_id) values ($1) returning id`, [youthTourn.id]);

// ─── exactly-one CHECK ───────────────────────────────────────────────────────
await expectError('CHECK: zero id columns rejected',
  () => db.query(`insert into public.team_game_rsvps (user_id, status) values ($1,'in')`, [bob.id]),
  /num_nonnulls|check|null/i);
await expectError('CHECK: two id columns rejected (game_id + league_game_id)',
  () => db.query(`insert into public.team_game_rsvps (game_id, league_game_id, user_id, status) values ($1,$2,$3,'in')`,
    [teamGame.id, leagueGame.id, bob.id]), /num_nonnulls|check/i);
await expectError('CHECK: three id columns rejected',
  () => db.query(`insert into public.team_game_rsvps (game_id, league_game_id, tournament_game_id, user_id, status) values ($1,$2,$3,$4,'in')`,
    [teamGame.id, leagueGame.id, adultGame.id, bob.id]), /num_nonnulls|check/i);
{
  // exactly one is accepted for each source
  const [r1] = await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in') returning id`, [teamGame.id, bob.id]);
  const [r2] = await q(`insert into public.team_game_rsvps (league_game_id, user_id, status) values ($1,$2,'in') returning id`, [leagueGame.id, bob.id]);
  const [r3] = await q(`insert into public.team_game_rsvps (tournament_game_id, user_id, status) values ($1,$2,'in') returning id`, [adultGame.id, bob.id]);
  check('exactly-one accepted for all three sources (same user, three rows)', !!(r1.id && r2.id && r3.id));
}

// ─── per-source uniqueness ───────────────────────────────────────────────────
await expectError('UNIQUE: duplicate team (game_id,user) rejected',
  () => db.query(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'out')`, [teamGame.id, bob.id]),
  /unique|duplicate/i);
await expectError('UNIQUE: duplicate league (league_game_id,user) rejected',
  () => db.query(`insert into public.team_game_rsvps (league_game_id, user_id, status) values ($1,$2,'out')`, [leagueGame.id, bob.id]),
  /unique|duplicate/i);
await expectError('UNIQUE: duplicate tournament (tournament_game_id,user) rejected',
  () => db.query(`insert into public.team_game_rsvps (tournament_game_id, user_id, status) values ($1,$2,'out')`, [adultGame.id, bob.id]),
  /unique|duplicate/i);
{
  // different user on the same league game is allowed
  const [r] = await q(`insert into public.team_game_rsvps (league_game_id, user_id, status) values ($1,$2,'in') returning id`, [leagueGame.id, alice.id]);
  check('per-source uniqueness scoped to (game,user) — a 2nd user can RSVP the same league game', !!r.id);
}

// ─── ON CONFLICT upsert targets each partial index (matches lib/rsvp.js) ──────
{
  await db.query(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'maybe')
    on conflict (game_id, user_id) where game_id is not null do update set status = excluded.status`, [teamGame.id, bob.id]);
  const [row] = await q(`select status from public.team_game_rsvps where game_id=$1 and user_id=$2`, [teamGame.id, bob.id]);
  check('upsert on (game_id,user_id) partial index updates in place (no dup)', row.status === 'maybe', JSON.stringify(row));
}

// ─── cascade deletes from all three parents ──────────────────────────────────
{
  const [g] = await q(`insert into public.team_games (team_id) values ($1) returning id`, [pubTeam.id]);
  await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in')`, [g.id, alice.id]);
  await q(`delete from public.team_games where id=$1`, [g.id]);
  const [n] = await q(`select count(*)::int n from public.team_game_rsvps where game_id=$1`, [g.id]);
  check('cascade: deleting a team_game removes its RSVP rows', n.n === 0, JSON.stringify(n));
}
{
  await q(`delete from public.league_games where id=$1`, [leagueGame.id]);
  const [n] = await q(`select count(*)::int n from public.team_game_rsvps where league_game_id=$1`, [leagueGame.id]);
  check('cascade: deleting a league_game removes its RSVP rows', n.n === 0, JSON.stringify(n));
}
{
  await q(`delete from public.games where id=$1`, [adultGame.id]);
  const [n] = await q(`select count(*)::int n from public.team_game_rsvps where tournament_game_id=$1`, [adultGame.id]);
  check('cascade: deleting a tournament game removes its RSVP rows', n.n === 0, JSON.stringify(n));
}

// ─── RLS read semantics across all three sources (non-superuser client) ──────
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert, update, delete on public.team_game_rsvps to authenticated;
  -- The rsvp_read policy's subselects read these parent tables as the invoking
  -- role (only can_view_team/can_manage_profile run SECURITY DEFINER). Prod grants
  -- authenticated SELECT on them already; reproduce that so the policy can resolve.
  grant select on public.team_games, public.league_games, public.games,
    public.tournaments, public.league_teams, public.teams to authenticated;`);
const asUser = (authId) => db.exec(`select set_config('test.uid', '${authId ?? ''}', false)`);

// fresh, clean rows for the read test (previous ones were cascaded away)
const [lg2] = await q(`insert into public.league_games (home_team_id, away_team_id) values ($1, null) returning id`, [lt.id]);
const [tg2] = await q(`insert into public.games (tournament_id) values ($1) returning id`, [adultTourn.id]);
await q(`insert into public.team_game_rsvps (league_game_id, user_id, status) values ($1,$2,'in')`, [lg2.id, alice.id]);
await q(`insert into public.team_game_rsvps (tournament_game_id, user_id, status) values ($1,$2,'in')`, [tg2.id, alice.id]);
// a YOUTH tournament RSVP — should be hidden from the public read branch
await q(`insert into public.team_game_rsvps (tournament_game_id, user_id, status) values ($1,$2,'in')`, [youthGame.id, alice.id]);
// a PRIVATE-team team_game RSVP where alice IS an insider (member) — visible to her, not to bob
const [privGame] = await q(`insert into public.team_games (team_id) values ($1) returning id`, [privTeam.id]);
await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in')`, [privGame.id, alice.id]);

await db.exec(`set role authenticated`);
await asUser(bob.auth_user_id);
{
  // pubTeam legacy team row (public team) → visible
  const [teamVis] = await q(`select count(*)::int n from public.team_game_rsvps where game_id=$1`, [teamGame.id]);
  check('RLS team source: public-team RSVP visible to any viewer', teamVis.n >= 1, JSON.stringify(teamVis));
  // league row → visible (home league_team maps to a public team)
  const [lgVis] = await q(`select count(*)::int n from public.team_game_rsvps where league_game_id=$1`, [lg2.id]);
  check('RLS league source: RSVP on a public-team league game is visible', lgVis.n === 1, JSON.stringify(lgVis));
  // adult tournament row → visible
  const [tgVis] = await q(`select count(*)::int n from public.team_game_rsvps where tournament_game_id=$1`, [tg2.id]);
  check('RLS tournament source: adult-tournament RSVP visible', tgVis.n === 1, JSON.stringify(tgVis));
  // youth tournament row → HIDDEN (fail-closed youth branch)
  const [youthVis] = await q(`select count(*)::int n from public.team_game_rsvps where tournament_game_id=$1`, [youthGame.id]);
  check('RLS tournament source: YOUTH-tournament RSVP hidden from public reader', youthVis.n === 0, JSON.stringify(youthVis));
  // private-team team_game row → hidden from bob (not an insider)
  const [privVisBob] = await q(`select count(*)::int n from public.team_game_rsvps where game_id=$1`, [privGame.id]);
  check('RLS team source: private-team RSVP hidden from a non-insider', privVisBob.n === 0, JSON.stringify(privVisBob));
}
// own-row write posture: bob can insert his own row, not alice's
await expectError('RLS write: bob cannot insert an RSVP for alice (can_manage_profile)',
  () => db.query(`insert into public.team_game_rsvps (league_game_id, user_id, status) values ($1,$2,'in')`, [lg2.id, alice.id]),
  /policy|denied|violates/i);
{
  const [r] = await q(`insert into public.team_game_rsvps (tournament_game_id, user_id, status) values ($1,$2,'in') returning id`, [tg2.id, bob.id]);
  check('RLS write: bob CAN insert his own RSVP (own-row semantics intact)', !!r.id);
}
// private-team insider (alice) sees her own private row
await asUser(alice.auth_user_id);
{
  const [privVisAlice] = await q(`select count(*)::int n from public.team_game_rsvps where game_id=$1`, [privGame.id]);
  check('RLS team source: private-team insider sees the RSVP', privVisAlice.n === 1, JSON.stringify(privVisAlice));
}
await db.exec(`reset role`);

// ─── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`❌ C06 RSVP harness: ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✅ C06 RSVP harness: all checks passed.');
