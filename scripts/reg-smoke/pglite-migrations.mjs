#!/usr/bin/env node
/**
 * REG mega-build migration harness — applies Migrations A→G verbatim to a
 * REAL Postgres (PGlite/WASM) seeded with PROD-SHAPED pre-state, then runs
 * shape assertions + behavior probes. No network, no Supabase project:
 *
 *   node scripts/reg-smoke/pglite-migrations.mjs
 *
 * WHY THE SEED MATTERS: LRS-1 Migration J hit a confirmed apply-blocker
 * because prod carried an abandoned same-name table and the empty-DB harness
 * couldn't see it. REG A–G were audited against live prod on Jun 12 2026 —
 * ZERO collisions (every plain CREATE is new; the 5 pre-existing functions
 * B replaces match prod's signatures exactly; all 7 plain DROP POLICY and
 * all 11 plain DROP CONSTRAINT names exist on prod verbatim; Migration D's
 * hardcoded Henry/Pete rows re-verified live) — but every one of those
 * exact-name DROPs is an assumption that can DRIFT between now and the
 * post-pilot apply. This seed encodes the audited prod state, so re-running
 * this file proves the chain still applies; if a hotfix renames a policy or
 * constraint in the meantime, the corresponding seed line goes stale WITH
 * prod and this harness fails the way prod would.
 *
 * Seeded prod facts (information_schema/pg_catalog dump, Jun 12 2026):
 *   - profiles: id FK→auth.users (profiles_id_fkey, CASCADE), NO id default,
 *     date_of_birth present, 3 policies by exact name, guard +
 *     auto-follow triggers, NO auth_user_id/account_type
 *   - the 11 named FK constraints Migration A drops (incl. volunteer_slots'
 *     DOUBLE-FK on assigned_user_id — →profiles kept, →auth.users dropped)
 *   - team_members + team_game_rsvps policies by exact name (E drops them)
 *   - auth.users trigger on_auth_user_created + link_invited_player() (B
 *     retires both)
 *   - the 4 functions B hand-rewrites, at prod signatures/return types
 *   - Henry #17's team_members row + Pete's profile at their REAL prod ids,
 *     so Migration D exercises its REAL path (not the off-prod no-op)
 *
 * What this cannot prove: RLS enforcement (superuser session) — that's
 * scripts/reg-smoke/run.js on a disposable branch (branches clone prod, so
 * they carry all of the above naturally).
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const MIGRATIONS = [
  '20260615000000_reg1_a_profiles_decouple_identity.sql',
  '20260615000100_reg1_b_rls_current_profile_id.sql',
  '20260615000200_reg1_c_households_consent_spine.sql',
  '20260615000300_reg1_d_migrate_henry.sql',
  '20260615000400_reg2_e_roster_anchor_and_onbehalf_rsvp.sql',
  '20260615000500_reg3_f_registrations_money_spine.sql',
  '20260615000600_reg4_g_installments_ar_autopay.sql',
];

// Migration D's real prod ids (ground truth re-verified live Jun 12 2026).
const HENRY_TM = '489491f3-5b79-4ab3-80db-b8593a9099ba';
const HENRY_TEAM = 'd18e023c-354f-4d3b-b5a0-82574f05377d';
const PETE = 'fc0018c2-0a7d-4eda-9d91-4077f2f138a4';
const HENRY = 'b3c1a7e2-9f4d-4c6b-8a2e-5d7f0c3e9a11';

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
await db.exec(`
create role anon; create role authenticated; create role service_role;
-- pg_cron stub (prod has the extension; G schedules two nightly jobs)
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

-- profiles at prod shape: id IS the auth uid (FK, CASCADE), no default.
create table public.profiles (
  id uuid primary key,
  name text, handle text unique, avatar_color text, avatar_initials text,
  bio text, email text, is_admin boolean default false, is_premium boolean default false,
  date_of_birth date, persona text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade
);
alter table public.profiles enable row level security;
create policy "Profiles are viewable by everyone" on public.profiles
  for select using (true);
create policy "Users can insert their own profile" on public.profiles
  for insert with check (( select auth.uid() as uid) = id);
create policy "Users can update their own profile" on public.profiles
  for update using (( select auth.uid() as uid) = id);

-- prod guard + auto-follow + invite-link machinery B hand-rewrites/retires.
create function public.guard_profile_privileged_columns() returns trigger
language plpgsql security definer as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.uid() is null then
    raise exception 'nope';
  end if;
  return new;
end $$;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

create function public.auto_follow_seed_accounts_on_profile_insert() returns trigger
language plpgsql security definer as $$ begin return new; end $$;
create trigger tr_auto_follow_seed_accounts
  after insert on public.profiles
  for each row execute function public.auto_follow_seed_accounts_on_profile_insert();

create function public.link_invited_player() returns trigger
language plpgsql security definer as $$ begin return new; end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_invited_player();

create function public.accept_team_manager_invite(p_token text)
returns table(league_id uuid, team_id uuid) language plpgsql security definer as
$$ begin if auth.uid() is null then raise exception 'x'; end if; return; end $$;
create function public.accept_league_manager_invite(p_token text)
returns table(league_id uuid) language plpgsql security definer as
$$ begin if auth.uid() is null then raise exception 'x'; end if; return; end $$;

-- existing role helpers REG's SQL functions reference (analyzed at CREATE).
create table public.teams (id uuid primary key default gen_random_uuid(), name text, manager_id uuid);
create function public.is_team_manager(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.teams t where t.id = p_team_id and t.manager_id = p_user_id) $$;
create function public.is_league_commissioner_of_team(p_team_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as $$ select false $$;
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text, commissioner_id uuid, start_date date
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text, director_id uuid, start_date date
);
create function public.is_league_commissioner(p_league_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.leagues l where l.id = p_league_id and l.commissioner_id = p_user_id) $$;
create function public.is_tournament_director(p_tournament_id uuid, p_user_id uuid)
returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.director_id = p_user_id) $$;

-- the 7 tables whose named FK constraints Migration A drops/repoints,
-- exactly as on prod (incl. volunteer_slots' double FK on assigned_user_id).
create table public.league_manager_invites (
  id uuid primary key default gen_random_uuid(), invited_by uuid, consumed_by_user_id uuid,
  constraint league_manager_invites_invited_by_fkey
    foreign key (invited_by) references auth.users(id),
  constraint league_manager_invites_consumed_by_user_id_fkey
    foreign key (consumed_by_user_id) references auth.users(id)
);
create table public.team_manager_invites (
  id uuid primary key default gen_random_uuid(), invited_by uuid, consumed_by_user_id uuid,
  constraint team_manager_invites_invited_by_fkey
    foreign key (invited_by) references auth.users(id),
  constraint team_manager_invites_consumed_by_user_id_fkey
    foreign key (consumed_by_user_id) references auth.users(id)
);
create table public.league_roles (
  league_id uuid, user_id uuid, role text,
  constraint league_roles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
alter table public.league_roles enable row level security;
-- a policy with auth.uid() in the qual — B's mechanical sweep must rewrite it.
create policy league_roles_self_read on public.league_roles
  for select using (user_id = ( select auth.uid() as uid));
create table public.league_subscriptions (
  league_id uuid, user_id uuid,
  constraint league_subscriptions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create table public.tournament_subscriptions (
  tournament_id uuid, user_id uuid,
  constraint tournament_subscriptions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create table public.nav_pins (
  user_id uuid, target text,
  constraint nav_pins_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create table public.volunteer_slots (
  id uuid primary key default gen_random_uuid(), assigned_user_id uuid, created_by uuid,
  constraint volunteer_slots_assigned_user_id_fkey
    foreign key (assigned_user_id) references auth.users(id),
  constraint volunteer_slots_assigned_user_id_profiles_fkey
    foreign key (assigned_user_id) references public.profiles(id),
  constraint volunteer_slots_created_by_fkey
    foreign key (created_by) references auth.users(id)
);

-- team_members + team_game_rsvps with the exact policy names E drops.
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id),
  user_id uuid references public.profiles(id),
  role text, jersey_number integer, position text, status text,
  invite_email text, invite_name text
);
alter table public.team_members enable row level security;
create policy team_members_public_read on public.team_members for select using (true);
create policy team_members_insert_by_manager on public.team_members
  for insert with check (is_team_manager(team_id, ( select auth.uid() as uid)));
create policy team_members_manager_update on public.team_members
  for update using (is_team_manager(team_id, ( select auth.uid() as uid)))
  with check (is_team_manager(team_id, ( select auth.uid() as uid)));
create policy team_members_manager_delete on public.team_members
  for delete using (is_team_manager(team_id, ( select auth.uid() as uid)));

create table public.team_game_rsvps (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, user_id uuid references public.profiles(id),
  status text, note text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.team_game_rsvps enable row level security;
create policy rsvp_public_read on public.team_game_rsvps for select using (true);
create policy rsvp_user_insert on public.team_game_rsvps
  for insert with check (user_id = ( select auth.uid() as uid));
create policy rsvp_user_update on public.team_game_rsvps
  for update using (user_id = ( select auth.uid() as uid));
create policy rsvp_user_delete on public.team_game_rsvps
  for delete using (user_id = ( select auth.uid() as uid));

-- legacy registration tables Migration F alters + mirrors (prod shapes).
create table public.league_registrations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id),
  team_name text, contact_name text, contact_email text, status text,
  stripe_session_id text, paid_at timestamptz, fee_cents integer,
  league_team_id uuid, created_at timestamptz default now()
);
create table public.tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id),
  team_name text, contact_name text, contact_email text, status text,
  stripe_session_id text, paid_at timestamptz, fee_cents integer,
  tournament_team_id uuid, created_at timestamptz default now()
);
`);

// Seed data: Pete (auth-backed, at his real prod id) + Henry's ghost roster
// row at its real id — Migration D must take its REAL path here.
await db.query(`insert into auth.users (id, email) values ($1, 'pete@rinkd.app')`, [PETE]);
await db.query(
  `insert into public.profiles (id, name, handle, avatar_initials, email) values ($1, 'Pete Hessel', 'pete', 'PH', 'pete@rinkd.app')`, [PETE]);
await db.query(`insert into public.teams (id, name, manager_id) values ($1, 'Shaker Heights Squirt 1', $2)`, [HENRY_TEAM, PETE]);
await db.query(
  `insert into public.team_members (id, team_id, user_id, invite_name, jersey_number, status, role)
   values ($1, $2, null, 'Henry Hessell', 17, 'active', 'player')`, [HENRY_TM, HENRY_TEAM]);
check('prod-shaped pre-state seeded (named constraints, policies, fns, Henry/Pete rows)', true);

// ─── apply A→G verbatim ──────────────────────────────────────────────────────
for (const file of MIGRATIONS) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  try {
    await db.exec(sql);
    check(`${file} applies clean`, true);
  } catch (e) {
    check(`${file} applies clean`, false, e.message);
    console.log('\n❌ APPLY FAILED — fix before touching a branch or prod.');
    process.exit(1);
  }
}

// ─── A: decouple assertions ──────────────────────────────────────────────────
{
  const fk = await q(`select count(*)::int as n from pg_constraint where conname='profiles_id_fkey'`);
  check('A: profiles_id_fkey dropped', fk[0].n === 0);
  const r = await q(`select auth_user_id, account_type from public.profiles where id = $1`, [PETE]);
  check('A: Pete backfilled auth_user_id = id, account_type adult',
    r[0].auth_user_id === PETE && r[0].account_type === 'adult', JSON.stringify(r[0]));
  const repointed = await q(
    `select count(*)::int as n from pg_constraint c
     where c.conname in ('league_roles_user_id_fkey','nav_pins_user_id_fkey','league_subscriptions_user_id_fkey','tournament_subscriptions_user_id_fkey')
       and c.confrelid = 'public.profiles'::regclass`);
  check('A: straggler FKs repointed at profiles', repointed[0].n === 4, `repointed=${repointed[0].n}`);
  const vs = await q(`select count(*)::int as n from pg_constraint where conname='volunteer_slots_assigned_user_id_fkey'`);
  check('A: volunteer_slots auth-side FK dropped (profiles-side kept)', vs[0].n === 0);
  await expectError('A: minor-no-login CHECK binds',
    `insert into public.profiles (id, name, handle, account_type, auth_user_id)
     values (gen_random_uuid(), 'Bad', 'bad-minor', 'minor', '${PETE}')`, /minor_no_login|check/i);
}

// ─── B: indirection + mechanical sweeps ──────────────────────────────────────
const asUser = (id) => db.exec(`select set_config('test.uid', '${id}', false)`);
{
  await asUser(PETE);
  const r = await q(`select public.current_profile_id() as pid`);
  check('B: current_profile_id() resolves auth uid → profile', r[0].pid === PETE, JSON.stringify(r[0]));
  const pol = await q(`select qual from pg_policies where policyname='league_roles_self_read'`);
  check('B: mechanical policy sweep rewrote auth.uid() → current_profile_id()',
    /current_profile_id/.test(pol[0]?.qual || '') && !/auth\.uid/.test(pol[0]?.qual || ''), pol[0]?.qual);
  const trg = await q(`select count(*)::int as n from pg_trigger where tgname='on_auth_user_created'`);
  check('B: on_auth_user_created retired', trg[0].n === 0);
  const lip = await q(`select count(*)::int as n from pg_proc where proname='link_invited_player'`);
  check('B: link_invited_player() retired (replaced by _on_profile)', lip[0].n === 0);
  const newTrg = await q(`select count(*)::int as n from pg_trigger where tgname='tr_link_invited_player_on_profile'`);
  check('B: tr_link_invited_player_on_profile installed', newTrg[0].n === 1);
}

// ─── C: household spine probes ───────────────────────────────────────────────
let householdId = null;
{
  await asUser(PETE);
  // D already created Pete's household (real path) — create_household for a
  // SECOND adult proves the RPC; for Pete, reuse via the guardian row.
  const hh = await q(
    `select hm.household_id from public.household_members hm
     where hm.profile_id = $1 and hm.role='guardian' and hm.status='active'`, [PETE]);
  householdId = hh[0]?.household_id;
  check('C+D: Pete holds a guardian row in a household', !!householdId, JSON.stringify(hh));
  const minor = await q(
    `select * from public.create_managed_profile($1, 'Casey Hessel', '2015-03-01'::date, 'minor')`, [householdId]);
  check('C: create_managed_profile mints a login-less minor',
    minor[0]?.profile_id != null && minor[0]?.outcome != null, JSON.stringify(minor[0] || {}));
  const mp = await q(`select account_type, auth_user_id from public.profiles where id = $1`, [minor[0].profile_id]);
  check('C: minor is account_type=minor with NO login',
    mp[0].account_type === 'minor' && mp[0].auth_user_id === null, JSON.stringify(mp[0]));
  const can = await q(`select public.can_manage_profile($1) as ok`, [minor[0].profile_id]);
  check('C: guardian can_manage_profile(minor)', can[0].ok === true);
  const ismin = await q(`select public.is_minor_profile($1) as ok`, [minor[0].profile_id]);
  check('E: is_minor_profile(minor) true', ismin[0].ok === true);
}

// ─── D: Henry migrated through the REAL path ─────────────────────────────────
{
  const h = await q(`select account_type, auth_user_id, handle from public.profiles where id = $1`, [HENRY]);
  check('D: Henry profile minted at the fixed id (minor, no login)',
    h[0]?.account_type === 'minor' && h[0]?.auth_user_id === null, JSON.stringify(h[0] || {}));
  const tm = await q(`select user_id from public.team_members where id = $1`, [HENRY_TM]);
  check('D: Henry #17 roster row repointed to the minor profile', tm[0].user_id === HENRY, JSON.stringify(tm[0]));
  const g = await q(`select public.is_guardian_of($1, $2) as ok`, [HENRY, PETE]);
  check('D: Pete is Henry\'s guardian', g[0].ok === true);
}

// ─── E: minor roster-bind trigger (the RLS halves run in the branch suite) ───
{
  const ghost = await q(
    `insert into public.team_members (team_id, invite_name, jersey_number, status, role)
     values ('${HENRY_TEAM}', 'Ghost 99', 99, 'active', 'player') returning id`);
  await expectError('E: repointing a ghost slot onto a minor is BLOCKED (trigger)',
    `update public.team_members set user_id = '${HENRY}' where id = '${ghost[0].id}'`, /consented flow/i);
  await db.exec(`begin; set local rinkd.allow_minor_roster = 'on';
    update public.team_members set user_id = '${HENRY}' where id = '${ghost[0].id}'; rollback;`);
  check('E: the GUC escape works inside a transaction (then rolled back)', true);
  const r = await q(`update public.team_members set jersey_number = 18 where id = $1 returning jersey_number`, [HENRY_TM]);
  check('E: editing a legit minor row without touching user_id still works', r[0].jersey_number === 18);
}

// ─── F: money spine + legacy mirror ──────────────────────────────────────────
{
  const fee = await q(`select * from public.reg_fee_breakdown(10000)`);
  check('F: reg_fee_breakdown(10000) = 10330 / 100 / 330 (ledger == Stripe to the cent)',
    fee[0].total_cents === 10330 && fee[0].platform_fee_cents === 100 && fee[0].processing_fee_cents === 330,
    JSON.stringify(fee[0]));
  const [lg] = await q(`insert into public.leagues (name, commissioner_id) values ('REG League', $1) returning id`, [PETE]);
  const [lr] = await q(
    `insert into public.league_registrations (league_id, team_name, contact_name, contact_email, status, fee_cents, paid_at)
     values ($1, 'Mirror Test', 'Cap', 'cap@x.test', 'approved', 10000, now()) returning id`, [lg.id]);
  const mirrored = await q(
    `select count(*)::int as n from public.registrations
     where source_kind = 'league_registration' and source_id = $1`, [lr.id]);
  check('F: legacy INSERT mirrors into the registrations spine (trigger did not swallow)',
    mirrored[0].n === 1, JSON.stringify(mirrored[0]));
}

// ─── G: installment lifecycle + refund scale ─────────────────────────────────
{
  const chk = await q(`select pg_get_constraintdef(oid) as def from pg_constraint where conname='payment_installments_status_check'`);
  check('G: installment status CHECK swapped (cancelled joined the lifecycle)',
    /cancelled/.test(chk[0]?.def || ''), chk[0]?.def);
  const pct = await q(`select public.reg4_refund_pct((current_date + 30)::date) as far,
                              public.reg4_refund_pct((current_date + 10)::date) as mid,
                              public.reg4_refund_pct((current_date + 2)::date) as near,
                              public.reg4_refund_pct(null) as none`);
  check('G: refund scale 100/50/0 and NULL→no-guess',
    pct[0].far === 100 && pct[0].mid === 50 && pct[0].near === 0 && pct[0].none === null,
    JSON.stringify(pct[0]));
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
