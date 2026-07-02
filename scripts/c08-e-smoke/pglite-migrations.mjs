#!/usr/bin/env node
/**
 * C08 · PR-E RLS-consolidation EQUIVALENCE harness — applies
 *   supabase/migrations/20260702230000_c08_e_rls_consolidation.sql
 * verbatim (TWICE, for idempotency) to a REAL Postgres (PGlite/WASM) seeded with
 * the ORIGINAL prod RLS policies + helper functions + prod-shaped tables, and
 * proves the SINGLE thing that matters for the highest-risk PR in the C08 plan:
 *
 *   the per-persona VISIBILITY / INSERT / UPDATE / DELETE matrix on
 *   posts · likes · comments · game_goals · games · follows
 *   is IDENTICAL, row-for-row, before vs after the migration.
 *
 *   node scripts/c08-e-smoke/pglite-migrations.mjs
 *
 * METHOD (migration_prod_shape_testing rule):
 *   1. Recreate the ORIGINAL policies (all the duplicate/paired policies exactly as
 *      they exist on prod, verified live 2026-07-02 via pg_policies) + the exact
 *      DEFINER helpers (current_profile_id, is_commissioner, can_view_team,
 *      is_team_insider, is_tournament_director) + prod-shaped tables.
 *   2. Seed a persona matrix: anon visitor · signed-in non-member · team member ·
 *      league member (commissioner) · tournament participant (director/scorer) ·
 *      post/comment author · admin · youth-team content · hidden/moderated content.
 *   3. Snapshot, PER PERSONA, PER TABLE: which rows are SELECT-visible, and whether
 *      an INSERT / UPDATE / DELETE of a probe row is permitted — UNDER THE ORIGINALS.
 *   4. Apply the migration (twice). Re-snapshot. Assert the matrix is byte-identical.
 *
 * RLS is enforced by running every probe as a non-owner role `app`; auth.uid() is
 * faked from GUC `test.uid` (the SECURITY DEFINER path prod uses). service_role /
 * superuser bypass is never used for the probes.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260702230000_c08_e_rls_consolidation.sql',
);

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;

// ─── prod-shaped schema + ORIGINAL helpers (verified live 2026-07-02) ────────
await db.exec(`
create role anon nologin;
create role authenticated nologin;   -- integration_auth_* policies target this role
create role authenticator nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

-- cold table the migration also touches (auth_rls_initplan fix). Present so the
-- migration applies; not part of the feed-visibility equivalence matrix.
create table public.integration_authorizations (
  id uuid primary key default gen_random_uuid(),
  owner_type text, owner_id uuid, authorized_by uuid
);
create function public.is_league_commissioner(p_owner_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$ select false $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null,
  auth_user_id uuid,
  account_type text not null default 'adult',
  is_admin boolean not null default false
);
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text, commissioner_id uuid, is_activated boolean not null default true
);
create table public.league_roles (
  id uuid primary key default gen_random_uuid(),
  league_id uuid, user_id uuid, role text
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text, director_id uuid, is_activated boolean not null default true, is_youth boolean not null default false
);
create table public.tournament_roles (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid, user_id uuid, role text
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text, visibility text not null default 'public'
);
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid, user_id uuid, status text default 'active'
);
create table public.league_games (
  id uuid primary key default gen_random_uuid(), league_id uuid
);
create table public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid, scorekeeper_id uuid,
  home_team_id uuid, away_team_id uuid, home_score int, away_score int, status text
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid, body text, team_id uuid, is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid, author_id uuid, body text, is_hidden boolean not null default false
);
create table public.likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid, user_id uuid
);
create table public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid, following_id uuid
);
create table public.game_goals (
  id uuid primary key default gen_random_uuid(),
  game_id uuid, team_id uuid, scorer_number int, is_shootout boolean, game_source text
);

-- DEFINER helpers at their exact prod definitions ---------------------------
create function public.current_profile_id() returns uuid
language sql stable security definer set search_path to 'public' as $$
  select id from public.profiles where auth_user_id = (select auth.uid())
$$;

create function public.is_commissioner(p_user_id uuid) returns boolean
language sql stable set search_path to 'public' as $$
  select exists (select 1 from public.leagues where commissioner_id = p_user_id)
$$;

create function public.is_team_insider(p_team_id uuid, p_profile_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p_team_id is not null and p_profile_id is not null and (
    exists (select 1 from public.profiles pr where pr.id = p_profile_id and pr.is_admin)
    or exists (select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.user_id = p_profile_id
        and coalesce(tm.status,'active') in ('active','pending'))
  );
$$;

create function public.can_view_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.teams t where t.id = p_team_id and t.visibility = 'public')
      or public.is_team_insider(p_team_id, public.current_profile_id());
$$;

create function public.is_tournament_director(p_tournament_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path to 'public','auth' as $$
  select exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.director_id = p_user_id)
      or exists (select 1 from public.tournament_roles tr
                 where tr.tournament_id = p_tournament_id and tr.user_id = p_user_id and tr.role = 'director');
$$;

-- probe role (RLS-enforced; never superuser for probes)
create role app nologin;
grant usage on schema public to app;
grant select, insert, update, delete on all tables in schema public to app;
`);

// ─── seed the ORIGINAL policies EXACTLY (pre-state) ──────────────────────────
async function applyOriginalPolicies() {
  await db.exec(`
  alter table public.posts enable row level security;
  alter table public.comments enable row level security;
  alter table public.likes enable row level security;
  alter table public.follows enable row level security;
  alter table public.game_goals enable row level security;
  alter table public.games enable row level security;

  -- posts (SELECT single; DELETE x3 dup; INSERT x3 dup; UPDATE x2)
  create policy posts_select_all on public.posts for select to public using (
    (((is_hidden = false) or ((select current_profile_id()) = author_id) or is_commissioner((select current_profile_id())))
     and ((team_id is null) or can_view_team(team_id) or ((select current_profile_id()) = author_id) or is_commissioner((select current_profile_id())))));
  create policy "Users can delete their own posts" on public.posts for delete to public using ((select current_profile_id()) = author_id);
  create policy "Users delete their own posts" on public.posts for delete to public using ((select current_profile_id()) = author_id);
  create policy posts_delete_own on public.posts for delete to public using ((select current_profile_id()) = author_id);
  create policy "Authenticated users can create posts" on public.posts for insert to public with check ((select current_profile_id()) = author_id);
  create policy "Users create their own posts" on public.posts for insert to public with check ((select current_profile_id()) = author_id);
  create policy posts_insert_own on public.posts for insert to public with check ((select current_profile_id()) = author_id);
  create policy "Users update their own posts" on public.posts for update to public using ((select current_profile_id()) = author_id);
  create policy posts_update_own on public.posts for update to public using ((select current_profile_id()) = author_id) with check ((select current_profile_id()) = author_id);

  -- likes (SELECT x2 dup; DELETE x2 dup; INSERT x2 dup)
  create policy "Likes are viewable by everyone" on public.likes for select to public using (true);
  create policy "Likes viewable by everyone" on public.likes for select to public using (true);
  create policy "Users can unlike their own likes" on public.likes for delete to public using ((select current_profile_id()) = user_id);
  create policy "Users delete their own likes" on public.likes for delete to public using ((select current_profile_id()) = user_id);
  create policy "Authenticated users can like" on public.likes for insert to public with check ((select current_profile_id()) = user_id);
  create policy "Users create their own likes" on public.likes for insert to public with check ((select current_profile_id()) = user_id);

  -- comments (SELECT single; DELETE x3 dup; INSERT x3 dup; UPDATE x2)
  create policy comments_select_all on public.comments for select to public using (
    ((is_hidden = false) or ((select current_profile_id()) = author_id) or is_commissioner((select current_profile_id()))));
  create policy "Users can delete their own comments" on public.comments for delete to public using ((select current_profile_id()) = author_id);
  create policy "Users delete their own comments" on public.comments for delete to public using ((select current_profile_id()) = author_id);
  create policy comments_delete_own on public.comments for delete to public using ((select current_profile_id()) = author_id);
  create policy "Authenticated users can comment" on public.comments for insert to public with check ((select current_profile_id()) = author_id);
  create policy "Users create their own comments" on public.comments for insert to public with check ((select current_profile_id()) = author_id);
  create policy comments_insert_own on public.comments for insert to public with check ((select current_profile_id()) = author_id);
  create policy "Users update their own comments" on public.comments for update to public using ((select current_profile_id()) = author_id);
  create policy comments_update_own on public.comments for update to public using ((select current_profile_id()) = author_id) with check ((select current_profile_id()) = author_id);

  -- follows (SKIPPED by migration — model to confirm it is left untouched)
  create policy "Anyone can read follows" on public.follows for select to public using (true);
  create policy "Users can manage own follows" on public.follows for all to public using ((select current_profile_id()) = follower_id);

  -- game_goals (SELECT single; DELETE single; INSERT x2 genuine)
  create policy goals_public_read on public.game_goals for select to public using (true);
  create policy goals_scorer_delete on public.game_goals for delete to public using ((select current_profile_id()) is not null);
  create policy game_goals_insert_requires_activated on public.game_goals for insert to public with check (
    (exists (select 1 from public.games g join public.tournaments t on t.id=g.tournament_id where g.id=game_goals.game_id and t.is_activated=true))
    or (exists (select 1 from public.league_games lg join public.leagues l on l.id=lg.league_id where lg.id=game_goals.game_id and l.is_activated=true))
    or (exists (select 1 from public.games g where g.id=game_goals.game_id and g.tournament_id is null)));
  create policy goals_scorer_insert on public.game_goals for insert to public with check ((select current_profile_id()) is not null);

  -- games (SELECT/INSERT/DELETE single; UPDATE x2 genuine)
  create policy games_public_read on public.games for select to public using (true);
  create policy games_insert on public.games for insert to public with check (
    (tournament_id is null) or (exists (select 1 from public.tournaments t where t.id=games.tournament_id and t.director_id=(select current_profile_id())))
    or (exists (select 1 from public.tournament_roles tr where tr.tournament_id=games.tournament_id and tr.user_id=(select current_profile_id()) and tr.role=any(array['director','scorer']))));
  create policy games_director_delete on public.games for delete to public using (
    (tournament_id is null) or is_tournament_director(tournament_id,(select current_profile_id())));
  create policy games_director_update on public.games for update to public using (
    (tournament_id is null) or (is_tournament_director(tournament_id,(select current_profile_id())) and exists(select 1 from public.tournaments t where t.id=games.tournament_id and t.is_activated=true)))
    with check (
    (tournament_id is null) or (is_tournament_director(tournament_id,(select current_profile_id())) and exists(select 1 from public.tournaments t where t.id=games.tournament_id and t.is_activated=true)));
  create policy games_scorer_update on public.games for update to public using (
    ((((select current_profile_id())=scorekeeper_id) or exists(select 1 from public.tournament_roles tr where tr.tournament_id=games.tournament_id and tr.user_id=(select current_profile_id()) and tr.role=any(array['director','scorer'])))
     and exists(select 1 from public.tournaments t where t.id=games.tournament_id and t.is_activated=true)));
  `);
}
await applyOriginalPolicies();
check('ORIGINAL prod-shape policies + DEFINER helpers seeded', true);

// ─── seed the persona + data fixture matrix ──────────────────────────────────
const AUTH = {}; // persona -> auth_user_id (uuid) ; anon = null
async function mkProfile(key, { admin = false, minor = false } = {}) {
  const authUid = crypto.randomUUID();
  const [p] = await q(
    `insert into public.profiles (name, handle, auth_user_id, is_admin, account_type)
     values ($1,$2,$3,$4,$5) returning id`,
    [key, key, authUid, admin, minor ? 'minor' : 'adult'],
  );
  AUTH[key] = authUid;
  return p.id;
}
const pAuthor = await mkProfile('author');
const pMember = await mkProfile('member');       // team member of the youth team
const pStranger = await mkProfile('stranger');   // signed-in non-member
const pComm = await mkProfile('commish');        // league commissioner
const pDir = await mkProfile('director');        // tournament director
const pScorer = await mkProfile('scorer');       // tournament scorer
const pAdmin = await mkProfile('admin', { admin: true });

// league (commish) + tournament (director/scorer) + activation states
const [lg] = await q(`insert into public.leagues (name, commissioner_id, is_activated) values ('L',$1,true) returning id`, [pComm]);
const [lgGame] = await q(`insert into public.league_games (league_id) values ($1) returning id`, [lg.id]);
const [tourAct] = await q(`insert into public.tournaments (name, director_id, is_activated) values ('T-active',$1,true) returning id`, [pDir]);
const [tourInact] = await q(`insert into public.tournaments (name, director_id, is_activated) values ('T-inactive',$1,false) returning id`, [pDir]);
await q(`insert into public.tournament_roles (tournament_id, user_id, role) values ($1,$2,'scorer')`, [tourAct.id, pScorer]);
await q(`insert into public.tournament_roles (tournament_id, user_id, role) values ($1,$2,'scorer')`, [tourInact.id, pScorer]);

// teams: one PUBLIC, one PRIVATE (youth). member belongs to the private team only.
const [teamPub] = await q(`insert into public.teams (name, visibility) values ('Pub','public') returning id`, []);
const [teamPriv] = await q(`insert into public.teams (name, visibility) values ('Youth','private') returning id`, []);
await q(`insert into public.team_members (team_id, user_id, status) values ($1,$2,'active')`, [teamPriv.id, pMember]);

// posts: global-visible, hidden(moderated), team-public, team-private(youth)
const [postGlobal] = await q(`insert into public.posts (author_id, body, team_id, is_hidden) values ($1,'global',null,false) returning id`, [pAuthor]);
const [postHidden] = await q(`insert into public.posts (author_id, body, team_id, is_hidden) values ($1,'hidden',null,true) returning id`, [pAuthor]);
const [postTeamPub] = await q(`insert into public.posts (author_id, body, team_id, is_hidden) values ($1,'teampub',$2,false) returning id`, [pAuthor, teamPub.id]);
const [postTeamPriv] = await q(`insert into public.posts (author_id, body, team_id, is_hidden) values ($1,'teampriv',$2,false) returning id`, [pAuthor, teamPriv.id]);

// comments: visible + hidden(moderated) on the global post
const [cVis] = await q(`insert into public.comments (post_id, author_id, body, is_hidden) values ($1,$2,'cvis',false) returning id`, [postGlobal.id, pAuthor]);
const [cHid] = await q(`insert into public.comments (post_id, author_id, body, is_hidden) values ($1,$2,'chid',true) returning id`, [postGlobal.id, pAuthor]);

// likes + follows
const [likeA] = await q(`insert into public.likes (post_id, user_id) values ($1,$2) returning id`, [postGlobal.id, pAuthor]);
const [followA] = await q(`insert into public.follows (follower_id, following_id) values ($1,$2) returning id`, [pAuthor, pMember]);

// games: activated tournament game + non-tournament (pickup) game
const [gameAct] = await q(`insert into public.games (tournament_id, scorekeeper_id, status) values ($1,$2,'live') returning id`, [tourAct.id, pScorer]);
const [gameInact] = await q(`insert into public.games (tournament_id, scorekeeper_id, status) values ($1,$2,'live') returning id`, [tourInact.id, pScorer]);
const [gamePickup] = await q(`insert into public.games (tournament_id, scorekeeper_id, status) values (null,null,'live') returning id`, []);

check('persona + content fixture matrix seeded', true);

// ─── the probe: run under RLS as `app`, faking auth.uid via GUC ──────────────
const PERSONAS = ['anon', 'author', 'member', 'stranger', 'commish', 'director', 'scorer', 'admin'];

// Each probe runs in its OWN transaction: BEGIN → set local role app + local
// test.uid GUC → run fn (may use savepoints) → ROLLBACK (state stays pristine).
// set_config(...,true) is transaction-local, so it must live inside the txn.
async function asPersona(persona, fn) {
  await db.exec('begin');
  await db.exec(`select set_config('test.uid', $q$${persona === 'anon' ? '' : AUTH[persona]}$q$, true)`);
  await db.exec('set local role app');
  try { return await fn(); }
  finally { await db.exec('rollback'); }
}

// SELECT visibility: ordered id list per (persona, table)
async function selectSnapshot() {
  const snap = {};
  for (const persona of PERSONAS) {
    snap[persona] = await asPersona(persona, async () => ({
      posts: (await q('select id from public.posts order by created_at, id')).map(r => r.id),
      comments: (await q('select id from public.comments order by id')).map(r => r.id),
      likes: (await q('select id from public.likes order by id')).map(r => r.id),
      follows: (await q('select id from public.follows order by id')).map(r => r.id),
      game_goals: (await q('select id from public.game_goals order by id')).map(r => r.id),
      games: (await q('select id from public.games order by id')).map(r => r.id),
    }));
  }
  return snap;
}

// write-permission probe: attempt an INSERT/UPDATE/DELETE inside a SAVEPOINT and
// record whether RLS allowed it. Runs INSIDE the caller's persona transaction;
// each attempt is savepoint-isolated so state stays pristine for the next probe.
async function tryWrite(sql, params) {
  await db.exec('savepoint p');
  try {
    const res = await db.query(sql, params);
    // INSERT/UPDATE/DELETE with no permitted/matching row → 0 rows; RLS violation → throw
    await db.exec('rollback to savepoint p');
    return { ok: true, rows: res.affectedRows ?? (res.rows ? res.rows.length : 0) };
  } catch (e) {
    await db.exec('rollback to savepoint p');
    return { ok: false, err: /row-level security|violates|permission/i.test(e.message) ? 'RLS' : e.message.slice(0, 80) };
  }
}

async function writeSnapshot() {
  const snap = {};
  for (const persona of PERSONAS) {
    const me = persona === 'anon' ? null : (await q(`select id from public.profiles where auth_user_id=$1`, [AUTH[persona]]))[0]?.id;
    snap[persona] = await asPersona(persona, async () => ({
      // posts: insert own vs insert-as-author(spoof); update/delete the author's global post
      post_insert_own: await tryWrite(`insert into public.posts (author_id, body) values ($1,'x')`, [me]),
      post_insert_spoof: await tryWrite(`insert into public.posts (author_id, body) values ($1,'x')`, [pAuthor]),
      post_update_authorpost: await tryWrite(`update public.posts set body='e' where id=$1`, [postGlobal.id]),
      post_delete_authorpost: await tryWrite(`delete from public.posts where id=$1`, [postGlobal.id]),
      // comments
      comment_insert_own: await tryWrite(`insert into public.comments (post_id, author_id, body) values ($1,$2,'x')`, [postGlobal.id, me]),
      comment_update_authorc: await tryWrite(`update public.comments set body='e' where id=$1`, [cVis.id]),
      comment_delete_authorc: await tryWrite(`delete from public.comments where id=$1`, [cVis.id]),
      // likes
      like_insert_own: await tryWrite(`insert into public.likes (post_id, user_id) values ($1,$2)`, [postGlobal.id, me]),
      like_insert_spoof: await tryWrite(`insert into public.likes (post_id, user_id) values ($1,$2)`, [postGlobal.id, pAuthor]),
      like_delete_authorlike: await tryWrite(`delete from public.likes where id=$1`, [likeA.id]),
      // follows (skipped table — must stay identical)
      follow_insert_own: await tryWrite(`insert into public.follows (follower_id, following_id) values ($1,$2)`, [me, pStranger]),
      follow_delete_ownfollow: await tryWrite(`delete from public.follows where id=$1`, [followA.id]),
      // game_goals: insert on activated tournament game / inactive / pickup
      goal_insert_active: await tryWrite(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,7)`, [gameAct.id, teamPub.id]),
      goal_insert_inactive: await tryWrite(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,7)`, [gameInact.id, teamPub.id]),
      goal_insert_pickup: await tryWrite(`insert into public.game_goals (game_id, team_id, scorer_number) values ($1,$2,7)`, [gamePickup.id, teamPub.id]),
      goal_delete: await tryWrite(`delete from public.game_goals where game_id=$1`, [gameAct.id]),
      // games: update activated-tournament game / inactive / pickup
      game_update_active: await tryWrite(`update public.games set status='final' where id=$1`, [gameAct.id]),
      game_update_inactive: await tryWrite(`update public.games set status='final' where id=$1`, [gameInact.id]),
      game_update_pickup: await tryWrite(`update public.games set status='final' where id=$1`, [gamePickup.id]),
    }));
  }
  return snap;
}

// seed one goal so goal_delete has a target
await db.exec('reset role');
await q(`insert into public.game_goals (game_id, team_id, scorer_number, game_source) values ($1,$2,1,'tournament')`, [gameAct.id, teamPub.id]);

const beforeSelect = await selectSnapshot();
const beforeWrite = await writeSnapshot();

// ─── apply the migration TWICE (idempotency) ─────────────────────────────────
const sql = readFileSync(MIGRATION, 'utf8');
for (const pass of [1, 2]) {
  try {
    await db.exec('reset role');
    await db.exec(sql);
    check(`migration applies clean (pass ${pass}/2 — idempotent)`, true);
  } catch (e) {
    check(`migration applies clean (pass ${pass}/2)`, false, e.message);
    console.log('\n❌ APPLY FAILED — fix before touching a branch or prod.');
    process.exit(1);
  }
}

const afterSelect = await selectSnapshot();
const afterWrite = await writeSnapshot();

// ─── assert the matrices are byte-identical ──────────────────────────────────
check('SELECT visibility matrix IDENTICAL pre vs post (all personas × all tables)',
  JSON.stringify(beforeSelect) === JSON.stringify(afterSelect),
  diff(beforeSelect, afterSelect));

check('WRITE (insert/update/delete) permission matrix IDENTICAL pre vs post',
  JSON.stringify(beforeWrite) === JSON.stringify(afterWrite),
  diff(beforeWrite, afterWrite));

// ─── explicit spot-assertions (documents the intended semantics) ─────────────
{
  // anon sees the global post + both team posts? team-private post must be HIDDEN to anon/stranger; VISIBLE to member/admin/commish/author.
  const anon = afterSelect.anon.posts;
  check('anon: hidden(moderated) post NOT visible', !anon.includes(postHidden.id));
  check('anon: youth/team-private post NOT visible', !anon.includes(postTeamPriv.id));
  check('anon: global + team-public posts visible', anon.includes(postGlobal.id) && anon.includes(postTeamPub.id));
  check('member (team insider): youth/team-private post IS visible', afterSelect.member.posts.includes(postTeamPriv.id));
  check('stranger (non-member): youth/team-private post NOT visible', !afterSelect.stranger.posts.includes(postTeamPriv.id));
  check('commish (is_commissioner): hidden post IS visible', afterSelect.commish.posts.includes(postHidden.id));
  check('author: own hidden post IS visible', afterSelect.author.posts.includes(postHidden.id));
  check('anon: hidden comment NOT visible; visible comment IS', !afterSelect.anon.comments.includes(cHid.id) && afterSelect.anon.comments.includes(cVis.id));
  // write semantics
  check('anon: cannot insert a post (RLS)', afterWrite.anon.post_insert_own.ok === false || afterWrite.anon.post_insert_own.rows === 0);
  check('author: can update+delete own post', afterWrite.author.post_update_authorpost.ok && afterWrite.author.post_delete_authorpost.ok);
  check('stranger: cannot delete author post (0 rows, RLS-filtered)', afterWrite.stranger.post_delete_authorpost.ok && afterWrite.stranger.post_delete_authorpost.rows === 0);
  check('scorer: goal insert allowed on ACTIVE tournament game', afterWrite.scorer.goal_insert_active.ok && afterWrite.scorer.goal_insert_active.rows === 1);
  check('director: game update allowed on ACTIVE tournament game', afterWrite.director.game_update_active.ok && afterWrite.director.game_update_active.rows === 1);
  check('director: game update BLOCKED on INACTIVE tournament (0 rows)', afterWrite.director.game_update_inactive.ok && afterWrite.director.game_update_inactive.rows === 0);
  check('any signed-in user: goal insert allowed on PICKUP game (tournament_id null OR uid-not-null)', afterWrite.stranger.goal_insert_pickup.ok && afterWrite.stranger.goal_insert_pickup.rows === 1);
}

// ─── confirm consolidation actually happened (policy count dropped) ──────────
{
  await db.exec('reset role');
  const counts = await q(`select tablename, cmd, count(*)::int n from pg_policies
    where tablename in ('posts','likes','comments','game_goals','games','follows')
    group by tablename, cmd order by tablename, cmd`);
  const get = (t, c) => (counts.find(r => r.tablename === t && r.cmd === c) || {}).n || 0;
  check('posts: DELETE 3→1', get('posts', 'DELETE') === 1);
  check('posts: INSERT 3→1', get('posts', 'INSERT') === 1);
  check('posts: UPDATE 2→1', get('posts', 'UPDATE') === 1);
  check('likes: SELECT 2→1', get('likes', 'SELECT') === 1);
  check('likes: DELETE 2→1', get('likes', 'DELETE') === 1);
  check('likes: INSERT 2→1', get('likes', 'INSERT') === 1);
  check('comments: DELETE 3→1', get('comments', 'DELETE') === 1);
  check('comments: INSERT 3→1', get('comments', 'INSERT') === 1);
  check('comments: UPDATE 2→1', get('comments', 'UPDATE') === 1);
  check('game_goals: INSERT 2→1', get('game_goals', 'INSERT') === 1);
  check('games: UPDATE 2→1', get('games', 'UPDATE') === 1);
  check('follows: SELECT untouched (still 1 SELECT + 1 ALL = SKIPPED by design)',
    get('follows', 'SELECT') === 1 && get('follows', 'ALL') === 1);
}

function diff(a, b) {
  const sa = JSON.stringify(a, null, 1).split('\n');
  const sb = JSON.stringify(b, null, 1).split('\n');
  const out = [];
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) out.push(`L${i}: BEFORE=${(sa[i]||'').trim()} AFTER=${(sb[i]||'').trim()}`);
    if (out.length > 8) break;
  }
  return out.join(' || ');
}

// ─── verdict ─────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log(`❌ C08 PR-E equivalence harness: ${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('✅ C08 PR-E equivalence harness: all checks passed — visibility/write matrix IDENTICAL pre vs post.');
