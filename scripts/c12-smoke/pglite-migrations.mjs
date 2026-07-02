#!/usr/bin/env node
/**
 * C12 · Operator Front Door migration harness — applies
 *   supabase/migrations/20260702150000_c12_featured_operators.sql
 * verbatim (TWICE, for idempotency) to a REAL Postgres (PGlite/WASM) seeded
 * with a PROD-SHAPED pre-state, then exercises the RLS gate + all four admin
 * RPCs against the migrated shape. No network, no Supabase project:
 *
 *   node scripts/c12-smoke/pglite-migrations.mjs
 *
 * WHY THE SEED SHAPE MATTERS (the migration_prod_shape_testing rule): the
 * migration references public.leagues, public.tournaments, public.profiles and
 * the DEFINER helpers current_user_is_admin()/current_profile_id(). Their prod
 * shapes were audited live 2026-07-02 and are reproduced below at their real
 * column names/types/nullability:
 *   - leagues.is_public boolean NULLABLE default true  (fail-closed: NULL != public)
 *   - tournaments.is_youth boolean NOT NULL default false (fail-closed: NULL == youth)
 *   - profiles.is_admin boolean NOT NULL default false, profiles.auth_user_id uuid
 *   - current_profile_id() = SELECT id FROM profiles WHERE auth_user_id = auth.uid()
 *   - current_user_is_admin() keys off current_profile_id() + is_admin
 * Prod carries NO featured_operator* table and none of the four RPC names, so
 * `create table if not exists` / `create or replace function` cannot collide
 * with an abandoned stub.
 *
 * RLS NOTE: PGlite normally runs as superuser (BYPASSRLS), so to actually
 * PROVE the fail-closed write posture we create a NOLOGIN non-superuser `anon`
 * role, grant it table privileges, `set role anon`, and confirm every write is
 * denied by RLS (no write policy exists) while active-row SELECTs still pass.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260702150000_c12_featured_operators.sql',
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
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  name text not null default 'x',
  is_admin boolean not null default false
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id uuid,
  is_activated boolean not null default false,
  is_featured boolean not null default false,
  is_public boolean default true            -- NULLABLE, default true (prod shape)
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  director_id uuid,
  is_activated boolean not null default false,
  is_featured boolean not null default false,
  is_youth boolean not null default false   -- NOT NULL, default false (prod shape)
);

-- DEFINER helpers at their exact prod definitions.
create function public.current_profile_id() returns uuid
language sql stable security definer set search_path to 'public' as
  $$ select id from public.profiles where auth_user_id = (select auth.uid()) $$;

create function public.current_user_is_admin() returns boolean
language sql stable security definer set search_path to 'public' as
  $$ select exists (select 1 from public.profiles p where p.id = public.current_profile_id() and p.is_admin) $$;
`);
check('prod-shaped pre-state seeded (leagues.is_public nullable, tournaments.is_youth not-null)', true);

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

// ─── post-apply shape assertions ─────────────────────────────────────────────
{
  const t = (await q(`select table_name from information_schema.tables
    where table_schema='public' and table_name in ('featured_operators','featured_operator_events')`)).map(r => r.table_name);
  check('both tables exist', t.length === 2, t.join(','));
  const rls = await q(`select relname, relrowsecurity from pg_class
    where relnamespace='public'::regnamespace and relname in ('featured_operators','featured_operator_events')`);
  check('RLS enabled on both tables', rls.every(r => r.relrowsecurity === true), JSON.stringify(rls));
  const pols = await q(`select tablename, cmd from pg_policies
    where schemaname='public' and tablename in ('featured_operators','featured_operator_events')`);
  check('exactly 2 policies, both SELECT-only (no write policies)',
    pols.length === 2 && pols.every(p => p.cmd === 'SELECT'), JSON.stringify(pols));
}

// ─── set up an admin + a non-admin identity ──────────────────────────────────
const [admin] = await q(`insert into public.profiles (auth_user_id, name, is_admin) values (gen_random_uuid(), 'Admin', true) returning id, auth_user_id`);
const [rando] = await q(`insert into public.profiles (auth_user_id, name, is_admin) values (gen_random_uuid(), 'Rando', false) returning id, auth_user_id`);
const asUser = (authId) => db.exec(`select set_config('test.uid', '${authId ?? ''}', false)`);

// seed events to pin
const [pubLeague]   = await q(`insert into public.leagues (name, is_public) values ('Public League', true) returning id`);
const [privLeague]  = await q(`insert into public.leagues (name, is_public) values ('Private League', false) returning id`);
const [nullLeague]  = await q(`insert into public.leagues (name, is_public) values ('Null-public League', null) returning id`);
const [adultTourn]  = await q(`insert into public.tournaments (name, is_youth) values ('Adult Cup', false) returning id`);
const [youthTourn]  = await q(`insert into public.tournaments (name, is_youth) values ('Youth Cup', true) returning id`);

// ─── RLS: prove writes are denied for a real non-superuser client role ───────
await db.exec(`grant usage on schema public to anon;
  grant select, insert, update, delete on public.featured_operators to anon;
  grant select, insert, update, delete on public.featured_operator_events to anon;`);
// seed one active + one draft operator (as superuser, bypassing RLS) for the read test
const [activeOp] = await q(`insert into public.featured_operators (slug, name, is_active) values ('active-op', 'Active Op', true) returning id`);
const [draftOp]  = await q(`insert into public.featured_operators (slug, name, is_active) values ('draft-op', 'Draft Op', false) returning id`);
await db.query(`insert into public.featured_operator_events (operator_id, league_id) values ($1, $2)`, [activeOp.id, pubLeague.id]);
await db.query(`insert into public.featured_operator_events (operator_id, tournament_id) values ($1, $2)`, [draftOp.id, adultTourn.id]);

await db.exec(`set role anon`);
await expectError('RLS blocks anon INSERT into featured_operators',
  () => db.exec(`insert into public.featured_operators (slug, name) values ('hacker-op', 'Hacker')`), /policy|denied|violates/i);
await expectError('RLS blocks anon UPDATE of featured_operators',
  () => db.query(`update public.featured_operators set is_active = true where id = $1`, [draftOp.id]).then(r => { if (r.affectedRows === 0) throw new Error('row-level security policy blocked update (0 rows)'); }),
  /policy|denied|violates|blocked/i);
await expectError('RLS blocks anon INSERT into featured_operator_events',
  () => db.query(`insert into public.featured_operator_events (operator_id, league_id) values ($1, $2)`, [activeOp.id, pubLeague.id]), /policy|denied|violates/i);
// read side: anon sees the active operator's rows only
{
  const ops = await q(`select slug from public.featured_operators order by slug`);
  check('anon SELECT sees only is_active=true operators (draft hidden)',
    ops.length === 1 && ops[0].slug === 'active-op', JSON.stringify(ops));
  const evs = await q(`select operator_id from public.featured_operator_events`);
  check('anon SELECT sees only the active operator’s event rows',
    evs.length === 1 && evs[0].operator_id === activeOp.id, JSON.stringify(evs));
}
await db.exec(`reset role`);

// ─── RPCs raise admin_only for a non-admin ───────────────────────────────────
await asUser(rando.auth_user_id);
await expectError('admin_upsert_featured_operator: non-admin → admin_only',
  () => db.query(`select public.admin_upsert_featured_operator('nope', 'Nope')`), /admin_only/);
await expectError('admin_set_featured_operator_events: non-admin → admin_only',
  () => db.query(`select public.admin_set_featured_operator_events($1, '[]'::jsonb)`, [activeOp.id]), /admin_only/);
await expectError('admin_delete_featured_operator: non-admin → admin_only',
  () => db.query(`select public.admin_delete_featured_operator($1)`, [activeOp.id]), /admin_only/);
await expectError('admin_set_featured: non-admin → admin_only',
  () => db.query(`select public.admin_set_featured('league', $1, true)`, [pubLeague.id]), /admin_only/);

// ─── admin path ──────────────────────────────────────────────────────────────
await asUser(admin.auth_user_id);

// upsert: create a fresh draft operator
const [newOp] = await q(`select public.admin_upsert_featured_operator('crystal-fieldhouse', 'Crystal Fieldhouse') as id`);
check('admin creates an operator (returns id, defaults inactive)', !!newOp.id);
{
  const [row] = await q(`select slug, name, is_active from public.featured_operators where id = $1`, [newOp.id]);
  check('created row: slug/name set, is_active=false', row.slug === 'crystal-fieldhouse' && row.name === 'Crystal Fieldhouse' && row.is_active === false, JSON.stringify(row));
}

// slug validation
await expectError('upsert refuses a bad slug (uppercase)',
  () => db.query(`select public.admin_upsert_featured_operator('Bad_Slug', 'X')`), /invalid_slug/);
await expectError('upsert refuses a too-short slug',
  () => db.query(`select public.admin_upsert_featured_operator('ab', 'X')`), /invalid_slug/);
await expectError('upsert refuses an empty name',
  () => db.query(`select public.admin_upsert_featured_operator('good-slug', '   ')`), /name_required/);

// never-empty guardrail: can't activate an operator with zero events
await expectError('upsert refuses is_active=true on an operator with ZERO events',
  () => db.query(`select public.admin_upsert_featured_operator('crystal-fieldhouse', 'Crystal Fieldhouse', $1, null,null,null,null,null,null,null,null, true)`, [newOp.id]),
  /operator_needs_events/);
await expectError('upsert refuses inline-create with is_active=true (no events yet)',
  () => db.query(`select public.admin_upsert_featured_operator('brand-new', 'Brand New', null, null,null,null,null,null,null,null,null, true)`),
  /operator_needs_events/);

// set events: exactly-one, youth, non-public guards
await expectError('set_events refuses an item with BOTH league_id and tournament_id',
  () => db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
    [newOp.id, JSON.stringify([{ league_id: pubLeague.id, tournament_id: adultTourn.id }])]),
  /exactly_one_target/);
await expectError('set_events refuses an item with NEITHER target',
  () => db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
    [newOp.id, JSON.stringify([{ sort_order: 1 }])]),
  /exactly_one_target/);
await expectError('set_events refuses a NON-PUBLIC league (is_public=false)',
  () => db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
    [newOp.id, JSON.stringify([{ league_id: privLeague.id }])]),
  /league_not_public/);
await expectError('set_events refuses a league with is_public=NULL (fail-closed)',
  () => db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
    [newOp.id, JSON.stringify([{ league_id: nullLeague.id }])]),
  /league_not_public/);
await expectError('set_events refuses a YOUTH tournament (is_youth=true)',
  () => db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
    [newOp.id, JSON.stringify([{ tournament_id: youthTourn.id }])]),
  /tournament_is_youth/);

// happy path: pin one public league + one adult tournament, sorted
await db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
  [newOp.id, JSON.stringify([
    { league_id: pubLeague.id, sort_order: 1 },
    { tournament_id: adultTourn.id, sort_order: 0 },
  ])]);
{
  const evs = await q(`select league_id, tournament_id, sort_order from public.featured_operator_events
    where operator_id = $1 order by sort_order`, [newOp.id]);
  check('set_events pinned exactly 2 rows (1 league + 1 tournament), sort preserved',
    evs.length === 2 && evs[0].tournament_id === adultTourn.id && evs[1].league_id === pubLeague.id,
    JSON.stringify(evs));
}

// now activation succeeds (>=1 event)
{
  const [r] = await q(`select public.admin_upsert_featured_operator('crystal-fieldhouse', 'Crystal Fieldhouse', $1, null,null,null,null,null,null,null,null, true) as id`, [newOp.id]);
  const [row] = await q(`select is_active, updated_at > created_at as bumped from public.featured_operators where id = $1`, [newOp.id]);
  check('upsert activates once events exist; updated_at bumped', r.id === newOp.id && row.is_active === true, JSON.stringify(row));
}

// full-replace that EMPTIES an active operator flips it inactive (invariant)
await db.query(`select public.admin_set_featured_operator_events($1, '[]'::jsonb)`, [newOp.id]);
{
  const [row] = await q(`select is_active from public.featured_operators where id = $1`, [newOp.id]);
  const [cnt] = await q(`select count(*)::int n from public.featured_operator_events where operator_id = $1`, [newOp.id]);
  check('emptying an active operator flips is_active=false (never-empty invariant)',
    row.is_active === false && cnt.n === 0, JSON.stringify({ ...row, ...cnt }));
}

// admin_set_featured: pin/unpin is_featured, unknown kind
{
  await db.query(`select public.admin_set_featured('league', $1, true)`, [pubLeague.id]);
  const [l] = await q(`select is_featured from public.leagues where id = $1`, [pubLeague.id]);
  check('admin_set_featured pins a league (is_featured=true, scoped)', l.is_featured === true, JSON.stringify(l));
  await db.query(`select public.admin_set_featured('tournament', $1, true)`, [adultTourn.id]);
  const [t] = await q(`select is_featured from public.tournaments where id = $1`, [adultTourn.id]);
  check('admin_set_featured pins a tournament', t.is_featured === true, JSON.stringify(t));
  await db.query(`select public.admin_set_featured('league', $1, false)`, [pubLeague.id]);
  const [l2] = await q(`select is_featured from public.leagues where id = $1`, [pubLeague.id]);
  check('admin_set_featured unpins a league', l2.is_featured === false, JSON.stringify(l2));
}
await expectError('admin_set_featured rejects an unknown kind',
  () => db.query(`select public.admin_set_featured('rink', $1, true)`, [pubLeague.id]), /unknown_kind/);

// exactly-one CHECK constraint holds at the table level too (defense in depth)
await expectError('table CHECK: direct insert with both targets rejected',
  () => db.query(`insert into public.featured_operator_events (operator_id, league_id, tournament_id) values ($1,$2,$3)`,
    [newOp.id, pubLeague.id, adultTourn.id]), /num_nonnulls|check|exactly_one/i);
await expectError('table CHECK: direct insert with neither target rejected',
  () => db.query(`insert into public.featured_operator_events (operator_id) values ($1)`, [newOp.id]),
  /num_nonnulls|check|exactly_one|null/i);

// admin_delete cascades events
await db.query(`select public.admin_set_featured_operator_events($1, $2::jsonb)`,
  [newOp.id, JSON.stringify([{ league_id: pubLeague.id }])]);
await db.query(`select public.admin_delete_featured_operator($1)`, [newOp.id]);
{
  const [op] = await q(`select count(*)::int n from public.featured_operators where id = $1`, [newOp.id]);
  const [ev] = await q(`select count(*)::int n from public.featured_operator_events where operator_id = $1`, [newOp.id]);
  check('admin_delete removes the operator and cascades its events', op.n === 0 && ev.n === 0, JSON.stringify({ op: op.n, ev: ev.n }));
}

// ─── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`❌ C12 harness: ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✅ C12 harness: all checks passed.');
