#!/usr/bin/env node
/**
 * YOUTH-PRIVACY migration harness — applies Migrations A, B, C, D verbatim to a
 * REAL Postgres (PGlite/WASM) seeded with PROD-SHAPED pre-state, then proves
 * BOTH apply-cleanliness AND RLS enforcement.
 *
 *   node scripts/youth-privacy-smoke/pglite-rls.mjs
 *
 * RLS note: PGlite boots as superuser (owner), which BYPASSES RLS — so the
 * suite seeds every row as the owner, then `set role authenticated|anon` +
 * sets the jwt sub before each read so the very policies under test engage
 * (the SECURITY DEFINER helpers stay owner-run and read through RLS, exactly
 * like prod). profiles.id == auth_user_id on prod (verified Jun 21 2026), so
 * the jwt sub is the profile id.
 *
 * Pre-state mirrors the live information_schema + pg_proc dump (Jun 21 2026):
 * teams WITHOUT is_youth/visibility; the permissive (`true`) SELECT policies B
 * must replace; and the prod SECURITY DEFINER helpers my policies depend on
 * (current_profile_id, is_minor_profile, is_team_manager,
 * is_league_commissioner_of_team, is_guardian_of, can_manage_profile,
 * is_commissioner, lineup_backing_team_id) at their exact prod definitions.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');
const MIGRATIONS = [
  '20260621120000_youth_privacy_a_classification.sql',
  '20260621120100_youth_privacy_b_insider_rls.sql',
  '20260621120200_youth_privacy_c_contact_gating.sql',
  '20260621120300_youth_privacy_d_minor_lock_summary.sql',
];

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const exec = (sql) => db.exec(sql);
const expectError = async (name, sql, re) => {
  try { await db.exec(sql); check(name, false, 'no error raised!'); }
  catch (e) { check(name, !re || re.test(e.message), e.message.slice(0, 120)); }
};
// role impersonation: RLS engages; SECURITY DEFINER helpers still run as owner
const asRole = async (role, uid) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
  await db.exec(`set role ${role};`);
};
const owner = () => db.exec(`reset role; select set_config('test.uid', '', false);`);
// run a read as a role, return rows (best-effort; permission errors -> {err})
const readAs = async (role, uid, sql, params) => {
  await asRole(role, uid);
  try { const rows = (await db.query(sql, params)).rows; await owner(); return { rows }; }
  catch (e) { await owner(); return { err: e.message }; }
};

// ─── prod-shaped pre-state ───────────────────────────────────────────────────
await exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null, handle text not null default 'h',
  avatar_color text, avatar_initials text, bio text, position text, level text, home_rink text,
  points integer default 50, tier text default 'Mite', created_at timestamptz default now(),
  updated_at timestamptz default now(), email text, is_premium boolean not null default false,
  premium_until timestamptz, stripe_customer_id text, cover_image_url text,
  onboarding_completed_at timestamptz, welcome_seen boolean not null default false,
  avatar_url text, is_admin boolean not null default false, date_of_birth date, persona text,
  gender text, last_seen_at timestamptz, notification_email_transactional boolean not null default true,
  notification_email_marketing boolean not null default false, notification_push boolean not null default true,
  profile_complete boolean not null default false, auth_user_id uuid, account_type text not null default 'adult'
);
create table public.teams (
  id uuid primary key default gen_random_uuid(), name text not null, slug text, division text, level text,
  location text, home_rink text, logo_color text default '#D72638', logo_initials text, manager_id uuid,
  is_public boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(),
  source text not null default 'rinkd_native', external_id text, external_source_url text, claimed_by uuid,
  is_verified boolean not null default false, imported_at timestamptz, logo_url text
);
create table public.team_members (
  id uuid primary key default gen_random_uuid(), team_id uuid not null, user_id uuid, role text default 'player',
  jersey_number integer, position text, shot_hand text, is_captain boolean default false,
  is_alternate boolean default false, status text default 'active', joined_at timestamptz default now(),
  invite_email text, invite_name text, external_source text, external_id text
);
create table public.team_games (
  id uuid primary key default gen_random_uuid(), team_id uuid not null, opponent text not null,
  is_home boolean default true, location text, start_time timestamptz not null, home_score integer,
  away_score integer, status text default 'scheduled', notes text, created_at timestamptz default now(),
  source text not null default 'rinkd_native', external_id text, external_source_url text, imported_at timestamptz
);
create table public.team_game_rsvps (
  id uuid primary key default gen_random_uuid(), game_id uuid not null, user_id uuid not null,
  status text not null, note text, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.game_lineups (
  id uuid primary key default gen_random_uuid(), game_id uuid not null, game_source text not null,
  team_id uuid not null, user_id uuid, invite_name text, jersey_number integer, position text,
  is_goalie boolean default false, player_id uuid, line smallint, roster_status text not null default 'dressed',
  created_at timestamptz not null default now()
);
create table public.players (
  id uuid primary key default gen_random_uuid(), name text not null, profile_id uuid,
  source text not null default 'rinkd_native', is_visible boolean not null default true, created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.posts (
  id uuid primary key default gen_random_uuid(), author_id uuid not null, content text not null, tag text,
  is_hidden boolean not null default false, team_id uuid, league_id uuid, tournament_id uuid,
  created_at timestamptz default now()
);
create table public.leagues (id uuid primary key default gen_random_uuid(), name text not null, division text,
  level text, season text, commissioner_id uuid, is_public boolean default true, settings jsonb default '{}', usah_classification text);
create table public.league_teams (id uuid primary key default gen_random_uuid(), league_id uuid not null,
  team_id uuid, team_name text, division text);
create table public.league_games (id uuid primary key default gen_random_uuid(), league_id uuid not null,
  home_team_id uuid not null, away_team_id uuid not null, status text default 'scheduled', home_score integer, away_score integer);
create table public.league_roles (id uuid primary key default gen_random_uuid(), league_id uuid, user_id uuid, role text);
create table public.households (id uuid primary key default gen_random_uuid(), name text);
create table public.household_members (id uuid primary key default gen_random_uuid(), household_id uuid not null,
  profile_id uuid not null, role text not null, status text not null default 'active');
create table public.guardianship_claims (id uuid primary key default gen_random_uuid(), minor_profile_id uuid not null,
  claimant_profile_id uuid not null, household_id uuid not null, status text default 'pending');
-- stat-RPC dependencies (so D's CREATE OR REPLACE matches prod-ish shape)
create table public.tournaments (id uuid primary key default gen_random_uuid(), name text);
create table public.tournament_teams (id uuid primary key default gen_random_uuid(), tournament_id uuid, team_name text, division_id uuid);
create table public.tournament_divisions (id uuid primary key default gen_random_uuid(), name text);
create table public.games (id uuid primary key default gen_random_uuid(), tournament_id uuid, status text, division_id uuid);
create table public.game_goals (id uuid primary key default gen_random_uuid(), game_id uuid, team_id uuid,
  scorer_number integer, assist1_number integer, assist2_number integer, is_shootout boolean, game_source text);
create table public.game_penalties (id uuid primary key default gen_random_uuid(), game_id uuid, team_id uuid,
  player_number integer, duration_minutes integer, game_source text);

-- prod SECURITY DEFINER helpers my policies depend on (exact prod semantics)
create function public.current_profile_id() returns uuid language sql stable security definer set search_path to 'public'
  as $$ select id from public.profiles where auth_user_id = (select auth.uid()) $$;
create function public.is_minor_profile(p_profile_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select exists (select 1 from public.profiles p where p.id = p_profile_id and p.account_type = 'minor') $$;
create function public.is_team_manager(p_team_id uuid, p_user_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select exists (select 1 from public.teams t where t.id=p_team_id and t.manager_id=p_user_id)
        or exists (select 1 from public.team_members tm where tm.team_id=p_team_id and tm.user_id=p_user_id and tm.role in ('manager','coach')) $$;
create function public.is_league_commissioner_of_team(p_team_id uuid, p_user_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select exists (select 1 from public.league_teams lt join public.leagues l on l.id=lt.league_id
        where lt.team_id=p_team_id and (l.commissioner_id=p_user_id
          or exists (select 1 from public.league_roles lr where lr.league_id=l.id and lr.user_id=p_user_id and lr.role in ('commissioner','manager')))) $$;
create function public.is_guardian_of(p_minor_profile_id uuid, p_guardian_profile_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select exists (select 1 from public.household_members g join public.household_members m on m.household_id=g.household_id
        where g.profile_id=p_guardian_profile_id and g.role='guardian' and g.status='active'
          and m.profile_id=p_minor_profile_id and m.role='minor' and m.status='active') $$;
create function public.can_manage_profile(p_profile_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select p_profile_id = public.current_profile_id() or exists (
        select 1 from public.household_members g join public.household_members m on m.household_id=g.household_id
        join public.profiles p on p.id=m.profile_id
        where g.profile_id=public.current_profile_id() and g.role='guardian' and g.status='active'
          and m.profile_id=p_profile_id and m.status='active' and m.role in ('minor','adult') and p.auth_user_id is null) $$;
create function public.is_commissioner(p_profile_id uuid) returns boolean language sql stable security definer set search_path to 'public'
  as $$ select exists (select 1 from public.leagues l where l.commissioner_id=p_profile_id)
        or exists (select 1 from public.league_roles lr where lr.user_id=p_profile_id and lr.role='commissioner') $$;
create function public.lineup_backing_team_id(p_game_source text, p_team_id uuid) returns uuid language sql stable set search_path to 'public'
  as $$ select case when p_game_source='team' then p_team_id
        when p_game_source='league' then (select lt.team_id from public.league_teams lt where lt.id=p_team_id) else null end $$;
-- prod stat RPCs at current signatures (D replaces them)
create function public.get_player_tournament_stats(p_user_id uuid)
 returns table(tournament_id uuid, tournament_name text, division text, team_id uuid, team_name text, jersey_number integer, gp integer, goals integer, assists integer, points integer, pim integer)
 language sql stable set search_path to 'public' as $$ select null::uuid,null::text,null::text,null::uuid,null::text,null::int,null::int,null::int,null::int,null::int,null::int where false $$;
create function public.get_player_league_stats(p_user_id uuid)
 returns table(league_id uuid, league_name text, season text, division text, team_id uuid, team_name text, team_logo_color text, team_logo_initials text, jersey_number integer, gp integer, goals integer, assists integer, points integer, pim integer)
 language plpgsql stable set search_path to 'public' as $$ begin return; end $$;

-- current (pre-migration) permissive policies B must replace + prod grants
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_games enable row level security;
alter table public.team_game_rsvps enable row level security;
alter table public.game_lineups enable row level security;
alter table public.players enable row level security;
alter table public.posts enable row level security;
alter table public.profiles enable row level security;
create policy teams_public_read on public.teams for select to public using (is_public = true);
create policy team_members_public_read on public.team_members for select to public using (true);
create policy team_games_public_read on public.team_games for select to public using (true);
create policy rsvp_public_read on public.team_game_rsvps for select to public using (true);
create policy game_lineups_select on public.game_lineups for select to public using (true);
create policy players_public_read on public.players for select to public using (is_visible = true);
create policy posts_select_all on public.posts for select to public using
  ((is_hidden = false) or ((select public.current_profile_id()) = author_id) or public.is_commissioner((select public.current_profile_id())));
create policy "Profiles are viewable by everyone" on public.profiles for select to public using (true);
-- prod's teams UPDATE policy (so the declassify trigger is actually reachable by a manager)
create policy teams_manager_update on public.teams for update to public
  using (public.is_team_manager(id, public.current_profile_id()))
  with check (public.is_team_manager(id, public.current_profile_id()));

-- grants mirroring prod: anon has NO select on profiles/team_members; authenticated reads all
grant select on public.teams, public.team_games, public.team_game_rsvps, public.game_lineups, public.players, public.posts to anon;
grant select on public.teams, public.team_members, public.team_games, public.team_game_rsvps, public.game_lineups, public.players, public.posts, public.profiles to authenticated;
grant select on all tables in schema public to service_role;
grant update on public.teams to authenticated; -- prod grants this; needed to reach the declassify trigger
`);
check('prod-shaped pre-state seeded (permissive policies + prod helpers)', true);

// ─── seed actors + an ADULT public team and a YOUTH private team ─────────────
const mk = async (name, acct = 'adult', admin = false, noAuth = false) => {
  const [p] = await q(`insert into public.profiles (name, handle, account_type, is_admin, email, auth_user_id)
    values ($1,$2,$3,$4,$5,$6) returning id`,
    [name, name.replace(/\s/g, '').toLowerCase(), acct, admin, name.replace(/\s/g, '.').toLowerCase() + '@x.com',
     noAuth ? null : null]);
  // profiles.id == auth_user_id on prod for real users; set it unless no-auth (minor)
  if (!noAuth) await q(`update public.profiles set auth_user_id = id where id = $1`, [p.id]);
  return p.id;
};
const member   = await mk('Adult Member');
const outsider = await mk('Random Outsider');
const guardian = await mk('Parent Guardian');
const admin    = await mk('Site Admin', 'adult', true);
const coach    = await mk('Youth Coach');
const minor    = await mk('Kid Player', 'minor', false, true); // no auth_user_id

// guardian household linking guardian <-> minor
const [hh] = await q(`insert into public.households (name) values ('Fam') returning id`);
await q(`insert into public.household_members (household_id, profile_id, role) values ($1,$2,'guardian'),($1,$3,'minor')`, [hh.id, guardian, minor]);

// ADULT public team (beer league): member rostered
const [adultTeam] = await q(`insert into public.teams (name, division, level, manager_id, is_public) values ('Beer Necessities','Open','Beer League',$1,true) returning id`, [member]);
await q(`insert into public.team_members (team_id, user_id, role, jersey_number, status, invite_email) values ($1,$2,'manager',9,'active','adult.member@x.com')`, [adultTeam.id, member]);
const [adultGame] = await q(`insert into public.team_games (team_id, opponent, location, start_time, status, home_score, away_score, is_home) values ($1,'Goon Squad','Main Rink 6:00pm', now(), 'final', 5, 3, true) returning id`, [adultTeam.id]);
await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in')`, [adultGame.id, member]);

// YOUTH team (14U AAA): coach manages, minor rostered, a ghost invite slot
const [youthTeam] = await q(`insert into public.teams (name, division, level, manager_id, is_public) values ('Northern Prospects U14','14U','AAA',$1,true) returning id`, [coach]);
await q(`insert into public.team_members (team_id, user_id, role, jersey_number, status) values ($1,$2,'coach',0,'active')`, [youthTeam.id, coach]);
await q(`insert into public.team_members (team_id, user_id, role, jersey_number, status) values ($1,$2,'player',17,'active')`, [youthTeam.id, minor]);
await q(`insert into public.team_members (team_id, user_id, invite_name, role, jersey_number, status, invite_email) values ($1,null,'Ghost Kid','player',18,'pending','ghost.parent@x.com')`, [youthTeam.id]);
const [youthGame] = await q(`insert into public.team_games (team_id, opponent, location, start_time, status, home_score, away_score, is_home) values ($1,'Rival Elite','Secret Practice Rink 7am', now() + interval '2 days', 'scheduled', null, null, true) returning id`, [youthTeam.id]);
const [youthFinal] = await q(`insert into public.team_games (team_id, opponent, location, start_time, status, home_score, away_score, is_home) values ($1,'Rival Elite','Home Barn', now() - interval '2 days', 'final', 4, 2, true) returning id`, [youthTeam.id]);
await q(`insert into public.team_game_rsvps (game_id, user_id, status) values ($1,$2,'in')`, [youthGame.id, minor]);
await q(`insert into public.game_lineups (game_id, game_source, team_id, user_id, invite_name, jersey_number) values ($1,'team',$2,$3,'Kid Player',17)`, [youthGame.id, youthTeam.id, minor]);
await q(`insert into public.posts (author_id, content, team_id) values ($1,'Practice moved to the Secret Rink at 7am, bring Timmy', $2)`, [coach, youthTeam.id]);

check('seeded adult-public + youth team (coach, minor, guardian, ghost slot, games, rsvp, lineup, feed post)', true);

// ─── apply A, B, C, D verbatim ───────────────────────────────────────────────
for (const file of MIGRATIONS) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  try { await db.exec(sql); check(`${file} applies clean`, true); }
  catch (e) { check(`${file} applies clean`, false, e.message); console.log('\n❌ APPLY FAILED.'); process.exit(1); }
}
await owner();

// ─── A: classification + visibility + trigger ────────────────────────────────
{
  const [yt] = await q(`select is_youth, visibility, is_public from public.teams where id=$1`, [youthTeam.id]);
  check('A backfill: youth team -> is_youth=true, visibility=private, is_public mirrored false',
    yt.is_youth === true && yt.visibility === 'private' && yt.is_public === false, JSON.stringify(yt));
  const [at] = await q(`select is_youth, visibility, is_public from public.teams where id=$1`, [adultTeam.id]);
  check('A backfill: adult team -> is_youth=false, visibility=public, is_public mirrored true',
    at.is_youth === false && at.visibility === 'public' && at.is_public === true, JSON.stringify(at));
  await expectError('A trigger: youth team cannot be set public (update)',
    `update public.teams set visibility='public' where id='${youthTeam.id}'`, /youth team cannot be made public/i);
  await expectError('A trigger: youth team cannot be INSERTED public',
    `insert into public.teams (name, is_youth, visibility) values ('X', true, 'public')`, /youth team cannot/i);
  const [flip] = await q(`update public.teams set visibility='private' where id=$1 returning visibility, is_public`, [adultTeam.id]);
  check('A trigger: adult team CAN go private (manager opt) + mirrors is_public', flip.visibility === 'private' && flip.is_public === false, JSON.stringify(flip));
  await q(`update public.teams set visibility='public' where id=$1`, [adultTeam.id]); // restore
  // declassification guard: a youth-team MANAGER cannot two-step it public by
  // flipping is_youth->false; the no-auth migration/service path stays exempt.
  await owner();
  const [tmpY] = await q(`insert into public.teams (name, manager_id, is_youth, visibility) values ('Temp Youth',$1,true,'private') returning id`, [coach]);
  await q(`insert into public.team_members (team_id, user_id, role, status) values ($1,$2,'manager','active')`, [tmpY.id, coach]);
  await asRole('authenticated', coach);
  await expectError('A guard: a youth-team manager cannot reclassify it as adult',
    `update public.teams set is_youth=false where id='${tmpY.id}'`, /only an admin can reclassify/i);
  await owner();
  const [svc] = await q(`update public.teams set is_youth=false where id=$1 returning is_youth, visibility`, [tmpY.id]);
  check('A guard: no-auth/service path CAN reclassify (exempt)', svc.is_youth === false && svc.visibility === 'private', JSON.stringify(svc));
  const d = await q(`select public.derive_is_youth('14U','AAA') a, public.derive_is_youth('Open','Beer League') b,
    public.derive_is_youth('','') c, public.derive_is_youth('10U Squirts','Youth') d, public.derive_is_youth('Thursday C West','Beer League') e`);
  check('derive_is_youth: 14U/AAA=youth, beer=adult, unknown=youth(conservative), 10U=youth, C-beer=adult',
    d[0].a === true && d[0].b === false && d[0].c === true && d[0].d === true && d[0].e === false, JSON.stringify(d[0]));
}

// ─── B: RLS enforcement ──────────────────────────────────────────────────────
// anon (logged-out): youth team data must be invisible; adult readable
{
  let r = await readAs('anon', '', `select * from public.team_games where team_id=$1`, [youthTeam.id]);
  check('RLS anon: youth team_games (location/time) DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length} rows`);
  r = await readAs('anon', '', `select * from public.team_games where team_id=$1`, [adultTeam.id]);
  check('RLS anon: adult team_games visible', (r.rows || []).length === 1, r.err || `${r.rows?.length} rows`);
  r = await readAs('anon', '', `select * from public.game_lineups where team_id=$1 and game_source='team'`, [youthTeam.id]);
  check('RLS anon: youth team-source lineup (invite_name) DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('anon', '', `select * from public.posts where team_id=$1`, [youthTeam.id]);
  check('RLS anon: youth team feed post DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
}
// outsider (authenticated, not a member)
{
  let r = await readAs('authenticated', outsider, `select id, role, jersey_number, status from public.team_members where team_id=$1`, [youthTeam.id]);
  check('RLS outsider: youth roster DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length} rows`);
  r = await readAs('authenticated', outsider, `select id, role, jersey_number, status from public.team_members where team_id=$1`, [adultTeam.id]);
  check('RLS outsider: adult roster visible (public team)', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select * from public.teams where id=$1`, [youthTeam.id]);
  check('RLS outsider: youth teams row DENIED (not discoverable)', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select * from public.team_game_rsvps where game_id=$1`, [youthGame.id]);
  check('RLS outsider: youth RSVP DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select id, name, account_type from public.profiles where id=$1`, [minor]);
  check('RLS outsider: minor profile row DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select id, name, account_type from public.profiles where id=$1`, [member]);
  check('RLS outsider: adult profile visible', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
}
// rostered member / coach / guardian / admin
{
  let r = await readAs('authenticated', coach, `select id, role, jersey_number, status from public.team_members where team_id=$1`, [youthTeam.id]);
  check('RLS coach(member): youth roster visible', (r.rows || []).length === 3, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', coach, `select * from public.team_games where team_id=$1`, [youthTeam.id]);
  check('RLS coach: youth schedule (location/time) visible', (r.rows || []).length === 2, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', guardian, `select id, role, jersey_number, status from public.team_members where team_id=$1`, [youthTeam.id]);
  check('RLS guardian(of rostered minor): youth roster visible', (r.rows || []).length === 3, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', guardian, `select id, name, account_type from public.profiles where id=$1`, [minor]);
  check('RLS guardian: own minor profile visible', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', admin, `select * from public.team_games where team_id=$1`, [youthTeam.id]);
  check('RLS admin: youth schedule visible', (r.rows || []).length === 2, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', coach, `select * from public.posts where team_id=$1`, [youthTeam.id]);
  check('RLS coach: youth team feed visible', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
}
// players minor gate
{
  await owner();
  await q(`insert into public.players (name, profile_id, is_visible) values ('Kid Player',$1,true)`, [minor]);
  await q(`insert into public.players (name, profile_id, is_visible) values ('Adult Joe',$1,true)`, [member]);
  let r = await readAs('anon', '', `select * from public.players where profile_id=$1`, [minor]);
  check('RLS anon: minor-linked players row DENIED', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('anon', '', `select * from public.players where profile_id=$1`, [member]);
  check('RLS anon: adult players row visible', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
}

// ─── C: contact gating (column grants + RPCs) ────────────────────────────────
{
  let r = await readAs('authenticated', outsider, `select email from public.profiles where id=$1`, [member]);
  check('C: authenticated cannot SELECT profiles.email (column revoked)', !!r.err && /permission denied/i.test(r.err), r.err || 'no error');
  r = await readAs('authenticated', outsider, `select date_of_birth from public.profiles where id=$1`, [member]);
  check('C: authenticated cannot SELECT profiles.date_of_birth', !!r.err && /permission denied/i.test(r.err), r.err || 'no error');
  r = await readAs('authenticated', outsider, `select id, name, tier from public.profiles where id=$1`, [member]);
  check('C: authenticated CAN still select non-contact columns', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select invite_email from public.team_members where team_id=$1`, [adultTeam.id]);
  check('C: authenticated cannot SELECT team_members.invite_email', !!r.err && /permission denied/i.test(r.err), r.err || 'no error');
  r = await readAs('authenticated', member, `select * from public.get_my_contact()`);
  check('C: get_my_contact returns OWN email', (r.rows || [])[0]?.email === 'adult.member@x.com', r.err || JSON.stringify(r.rows));
  r = await readAs('authenticated', coach, `select * from public.get_team_contacts($1)`, [youthTeam.id]);
  check('C: insider get_team_contacts returns roster contacts', (r.rows || []).length === 3, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', outsider, `select * from public.get_team_contacts($1)`, [youthTeam.id]);
  check('C: non-insider get_team_contacts returns NOTHING', (r.rows || []).length === 0, r.err || `${r.rows?.length}`);
  r = await readAs('authenticated', coach, `select * from public.team_invite_emails($1)`, [youthTeam.id]);
  check('C: insider team_invite_emails returns ghost slot email', (r.rows || []).length === 1, r.err || `${r.rows?.length}`);
  // link_pending_team_invites binds the ghost slot to a signing-up parent
  await owner();
  const [parent] = await q(`insert into public.profiles (name, handle, email) values ('Ghost Parent','ghostp','ghost.parent@x.com') returning id`);
  await q(`update public.profiles set auth_user_id = id where id = $1`, [parent.id]);
  r = await readAs('authenticated', parent.id, `select public.link_pending_team_invites('ghost.parent@x.com') as n`);
  check('C: link_pending_team_invites binds the matching pending slot (1)', (r.rows || [])[0]?.n === 1, r.err || JSON.stringify(r.rows));
}

// ─── D: minor stat guards + public_team_summary ──────────────────────────────
{
  let r = await q(`select * from public.get_player_tournament_stats($1)`, [minor]);
  check('D: get_player_tournament_stats returns 0 rows for a MINOR', r.length === 0, `${r.length}`);
  r = await q(`select * from public.get_player_league_stats($1)`, [minor]);
  check('D: get_player_league_stats returns 0 rows for a MINOR', r.length === 0, `${r.length}`);
  // public_team_summary: results-only, callable by an OUTSIDER for a youth team
  const res = await readAs('authenticated', outsider, `select * from public.public_team_summary($1)`, [youthTeam.id]);
  const row = (res.rows || [])[0];
  check('D: public_team_summary works for outsider on youth team (team-level only)',
    !!row && row.name === 'Northern Prospects U14' && row.is_youth === true, res.err || JSON.stringify(row));
  const cols = Object.keys(row || {});
  check('D: public_team_summary carries NO location/roster/contact columns',
    !cols.includes('location') && !cols.includes('invite_email') && !cols.includes('start_time'), cols.join(','));
  check('D: public_team_summary record from FINAL only (1 final: 1-0, recent has no location)',
    row?.games_played === 1 && row?.wins === 1 && Array.isArray(row?.recent) && row.recent.length === 1
      && row.recent[0].opponent === 'Rival Elite' && !('location' in row.recent[0]),
    JSON.stringify({ gp: row?.games_played, w: row?.wins, recent: row?.recent }));
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`} — youth-privacy A–D (apply + RLS + contacts + minor-lock)`);
process.exit(failed === 0 ? 0 : 1);
