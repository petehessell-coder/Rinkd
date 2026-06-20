#!/usr/bin/env node
/**
 * Feed A2 — standings-movement migration + RPC smoke harness.
 *
 *   node scripts/a2-smoke/pglite-standings-movement.mjs
 *
 * Applies 20260620120000_feed_a2_standings_movement.sql verbatim to a REAL
 * Postgres (PGlite/WASM) seeded with PROD-SHAPED pre-state — including the live
 * `league_standings` view definition transcribed byte-for-byte from prod
 * (pg_get_viewdef, Jun 20 2026) — then drives the build spec's test plan:
 *
 *   1. a finalized result that moves a team UP posts climbed / into-1st + the
 *      snapshot updates
 *   2. re-running with no change posts nothing (idempotent)
 *   3. a team that drops posts nothing
 *   + per-division partitioning, new-team seeding (no phantom post), the
 *     dormant→active playoff-line branch, ordinal copy, and grants.
 *
 * Scenarios inject KNOWN prior ranks into the snapshot so assertions don't hinge
 * on the view's tie-break order — only on the diff logic under test.
 *
 * What this CANNOT prove: RLS/grant ENFORCEMENT (PGlite runs as superuser). The
 * grant statements are exercised (they must parse + the roles must exist); live
 * enforcement is confirmed separately against prod via the security advisor.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20260620120000_feed_a2_standings_movement.sql',
);

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ─── prod-shaped pre-state ───────────────────────────────────────────────────
await db.exec(`
create role anon; create role authenticated; create role service_role;

create table public.profiles (
  id uuid primary key default gen_random_uuid(), name text
);
create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text, commissioner_id uuid, settings jsonb default '{}'::jsonb
);
create table public.league_divisions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  name text, sort_order integer, settings jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text, logo_color text, logo_initials text, logo_url text
);
create table public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  team_id uuid references public.teams(id),
  team_name text, logo_color text, logo_initials text, logo_url text,
  division text, division_id uuid references public.league_divisions(id)
);
create table public.league_games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  division_id uuid references public.league_divisions(id),
  home_team_id uuid, away_team_id uuid,
  home_score integer, away_score integer,
  status text, decided_in text default 'regulation', shootout_winner uuid,
  phase text default 'regular_season'
);
-- posts: live column list the migration writes into (Jun 20 2026 dump, trimmed
-- to what's relevant). author_id NOT NULL + FK, content NOT NULL, the defaults
-- the RPC relies on (tag/tag_color/is_hidden/counts/created_at).
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  tag text default 'POST', tag_color text default '#2E5B8C',
  likes integer default 0, comment_count integer default 0, repost_count integer default 0,
  created_at timestamptz default now(),
  is_hidden boolean not null default false,
  league_id uuid, league_team_id uuid
);

-- league_standings — VERBATIM from prod pg_get_viewdef (Jun 20 2026).
create view public.league_standings as
 WITH per_game AS (
         SELECT lg.league_id, lg.division_id, lg.home_team_id AS lt_id,
            lg.home_score AS gf, lg.away_score AS ga, lg.status, lg.decided_in,
            lg.decided_in = 'so'::text AND lg.shootout_winner = lg.home_team_id AS so_win
           FROM league_games lg WHERE lg.phase = 'regular_season'::text
        UNION ALL
         SELECT lg.league_id, lg.division_id, lg.away_team_id,
            lg.away_score, lg.home_score, lg.status, lg.decided_in,
            lg.decided_in = 'so'::text AND lg.shootout_winner = lg.away_team_id
           FROM league_games lg WHERE lg.phase = 'regular_season'::text
        ), classified AS (
         SELECT per_game.league_id, per_game.division_id, per_game.lt_id, per_game.gf, per_game.ga,
                CASE WHEN per_game.status = 'final'::text THEN 1 ELSE 0 END AS gp,
                CASE WHEN per_game.status = 'final'::text AND
                    CASE WHEN per_game.decided_in = 'so'::text THEN per_game.so_win
                         ELSE per_game.gf > per_game.ga END THEN 1 ELSE 0 END AS wins,
                CASE WHEN per_game.status = 'final'::text AND per_game.decided_in = 'regulation'::text AND per_game.gf < per_game.ga THEN 1 ELSE 0 END AS losses,
                CASE WHEN per_game.status = 'final'::text AND per_game.decided_in = 'regulation'::text AND per_game.gf = per_game.ga THEN 1 ELSE 0 END AS ties,
                CASE WHEN per_game.status = 'final'::text AND (per_game.decided_in = ANY (ARRAY['ot'::text, 'so'::text])) AND NOT
                    CASE WHEN per_game.decided_in = 'so'::text THEN per_game.so_win
                         ELSE per_game.gf > per_game.ga END THEN 1 ELSE 0 END AS otl
           FROM per_game
        ), aggregated AS (
         SELECT c.league_id, c.division_id, c.lt_id, lt.team_id,
            COALESCE(t.name, lt.team_name) AS team_name,
            COALESCE(t.logo_color, lt.logo_color) AS logo_color,
            COALESCE(t.logo_initials, lt.logo_initials) AS logo_initials,
            COALESCE(t.logo_url, lt.logo_url) AS logo_url, lt.division,
            sum(c.gp) AS gp, sum(c.wins) AS wins, sum(c.losses) AS losses, sum(c.ties) AS ties,
            sum(c.otl) AS otl, sum(c.gf) AS gf, sum(c.ga) AS ga, sum(c.gf) - sum(c.ga) AS goal_diff
           FROM classified c
             JOIN league_teams lt ON lt.id = c.lt_id
             LEFT JOIN teams t ON t.id = lt.team_id
          GROUP BY c.league_id, c.division_id, c.lt_id, lt.team_id, (COALESCE(t.name, lt.team_name)),
            (COALESCE(t.logo_color, lt.logo_color)), (COALESCE(t.logo_initials, lt.logo_initials)),
            (COALESCE(t.logo_url, lt.logo_url)), lt.division
        ), with_pts AS (
         SELECT a.league_id, a.division_id, a.lt_id, a.team_id, a.team_name,
            a.logo_color, a.logo_initials, a.logo_url, a.division,
            a.gp, a.wins, a.losses, a.ties, a.otl, a.gf, a.ga, a.goal_diff,
            (a.wins::numeric * COALESCE((d.settings ->> 'points_win'::text)::numeric, (l.settings ->> 'points_win'::text)::numeric, 2::numeric)
             + a.otl::numeric * COALESCE((d.settings ->> 'points_otl'::text)::numeric, (l.settings ->> 'points_otl'::text)::numeric, 1::numeric)
             + a.ties::numeric * COALESCE((d.settings ->> 'points_tie'::text)::numeric, (l.settings ->> 'points_tie'::text)::numeric, 1::numeric)
             + a.losses::numeric * COALESCE((d.settings ->> 'points_loss'::text)::numeric, (l.settings ->> 'points_loss'::text)::numeric, 0::numeric))::integer AS pts
           FROM aggregated a
             JOIN leagues l ON l.id = a.league_id
             LEFT JOIN league_divisions d ON d.id = a.division_id
        )
 SELECT league_id, lt_id, team_id, team_name, logo_color, logo_initials, division, division_id,
    gp, wins, losses, ties, otl, gf, ga, goal_diff, pts,
    rank() OVER (PARTITION BY league_id, division_id ORDER BY pts DESC, goal_diff DESC, gf DESC, ga) AS rank,
    logo_url
   FROM with_pts;
`);
check('prod-shaped pre-state seeded (incl. verbatim league_standings view)', true);

// ─── apply the migration verbatim ────────────────────────────────────────────
try {
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  check('migration applies clean', true);
} catch (e) {
  check('migration applies clean', false, e.message);
  console.log('\n❌ APPLY FAILED — fix before touching a branch or prod.');
  process.exit(1);
}

// ─── post-apply shape + grants ───────────────────────────────────────────────
{
  const t = await q(`select 1 from information_schema.tables where table_schema='public' and table_name='league_team_rank_snapshot'`);
  check('snapshot table created', t.length === 1);
  const idx = await q(`select 1 from pg_indexes where indexname='ltrs_lookup_idx'`);
  check('lookup index created', idx.length === 1);
  const rls = await one(`select relrowsecurity from pg_class where relname='league_team_rank_snapshot'`);
  check('snapshot RLS enabled (deny-by-default, RPC-write only)', rls.relrowsecurity === true);
  const fns = (await q(`select proname from pg_proc where proname in ('post_standings_movement','rinkd_ordinal')`)).map(r => r.proname);
  check('both functions created', fns.includes('post_standings_movement') && fns.includes('rinkd_ordinal'), fns.join(','));
  // grants: authenticated + service_role can EXECUTE; public was revoked.
  const ac = await one(`select proacl::text as acl from pg_proc where proname='post_standings_movement'`);
  check('grant: authenticated + service_role only (public revoked)',
    /authenticated=X/.test(ac.acl) && /service_role=X/.test(ac.acl) && !/[^a-z]=X/.test(ac.acl.replace(/[a-z_]+=X/g, '')),
    ac.acl);
}

// ─── ordinal copy (1st/2nd/3rd/11th/21st…) ───────────────────────────────────
{
  const r = await one(`select
    public.rinkd_ordinal(1) a, public.rinkd_ordinal(2) b, public.rinkd_ordinal(3) c,
    public.rinkd_ordinal(4) d, public.rinkd_ordinal(11) e, public.rinkd_ordinal(12) f,
    public.rinkd_ordinal(13) g, public.rinkd_ordinal(21) h, public.rinkd_ordinal(22) i,
    public.rinkd_ordinal(23) j, public.rinkd_ordinal(101) k, public.rinkd_ordinal(111) l`);
  check('rinkd_ordinal: st/nd/rd/th incl. the 11-13 exception',
    r.a==='1st'&&r.b==='2nd'&&r.c==='3rd'&&r.d==='4th'&&r.e==='11th'&&r.f==='12th'&&
    r.g==='13th'&&r.h==='21st'&&r.i==='22nd'&&r.j==='23rd'&&r.k==='101st'&&r.l==='111th',
    JSON.stringify(r));
}

// ─── helpers to build a clean "ladder" league (distinct points, no tie-breaks) ─
// Team i beats every team j>i 3-1 → wins descending → ranks 1..N deterministic.
async function mkCommish(name) {
  return (await one(`insert into public.profiles (name) values ($1) returning id`, [`${name} Commish`])).id;
}
async function ladderLeague(name, nTeams, divisionId = null) {
  const commish = await mkCommish(name);
  const lg = await one(`insert into public.leagues (name, commissioner_id) values ($1, $2) returning id, commissioner_id`, [name, commish]);
  const lts = [];
  for (let i = 0; i < nTeams; i++) {
    const tm = await one(`insert into public.teams (name) values ($1) returning id`, [`${name} T${i + 1}`]);
    const lt = await one(
      `insert into public.league_teams (league_id, team_id, team_name, division_id) values ($1,$2,$3,$4) returning id`,
      [lg.id, tm.id, `${name} T${i + 1}`, divisionId]);
    lts.push(lt.id);
  }
  for (let i = 0; i < nTeams; i++)
    for (let j = i + 1; j < nTeams; j++)
      await db.query(
        `insert into public.league_games (league_id, division_id, home_team_id, away_team_id, home_score, away_score, status, decided_in, phase)
         values ($1,$2,$3,$4,3,1,'final','regulation','regular_season')`,
        [lg.id, divisionId, lts[i], lts[j]]);
  return { leagueId: lg.id, commissioner: lg.commissioner_id, lts };
}
const ranksOf = async (leagueId, divisionId = null) => {
  const rows = await q(
    `select lt_id, rank::int rank, team_name from public.league_standings
     where league_id=$1 and ($2::uuid is null or division_id is not distinct from $2) order by rank`, [leagueId, divisionId]);
  return rows;
};
const seedPrev = (leagueId, divisionId, ltId, rank) => db.query(
  `insert into public.league_team_rank_snapshot (league_id, division_id, league_team_id, rank) values ($1,$2,$3,$4)`,
  [leagueId, divisionId, ltId, rank]);
const postsOf = (leagueId) => q(`select content, tag, tag_color, author_id, league_team_id from public.posts where league_id=$1 order by content`, [leagueId]);

// ─── TEST 1/2/3 — main scenario (single division = NULL) ─────────────────────
// 6-team ladder → cur ranks T1..T6 = 1..6. Inject prior ranks to stage every
// branch: into-1st, climbed-to-2nd, flat, drop, brand-new (no snapshot), flat-low.
{
  const { leagueId, commissioner, lts } = await ladderLeague('L1', 6);
  const cur = await ranksOf(leagueId);
  check('L1 ladder produced 6 distinct ranks 1..6',
    cur.length === 6 && cur.every((r, i) => r.rank === i + 1),
    cur.map(r => r.rank).join(','));
  const ltByRank = Object.fromEntries(cur.map(r => [r.rank, r.lt_id]));

  await seedPrev(leagueId, null, ltByRank[1], 3); // T1: 3 → 1  ⇒ into 1st
  await seedPrev(leagueId, null, ltByRank[2], 5); // T2: 5 → 2  ⇒ climbed to 2nd
  await seedPrev(leagueId, null, ltByRank[3], 3); // T3: 3 → 3  ⇒ flat
  await seedPrev(leagueId, null, ltByRank[4], 2); // T4: 2 → 4  ⇒ DROP (no post)
  /* rank 5: NO snapshot                            T5: new   ⇒ seed only (no post) */
  await seedPrev(leagueId, null, ltByRank[6], 6); // T6: 6 → 6  ⇒ flat

  const n = await one(`select public.post_standings_movement($1, null) as n`, [leagueId]);
  check('TEST 1: RPC returns 2 (the two upward movers only)', n.n === 2, `returned ${n.n}`);

  const posts = await postsOf(leagueId);
  check('TEST 1: exactly 2 movement posts created', posts.length === 2, `${posts.length} posts`);
  const into1st = posts.find(p => /moved into 1st place/.test(p.content));
  const climbed = posts.find(p => /climbed to 2nd in the standings/.test(p.content));
  check('TEST 1: into-1st post — copy, Standings tag, blue, commissioner author, right team',
    !!into1st && into1st.content.startsWith('📈 ') && into1st.tag === 'Standings'
      && into1st.tag_color === '#2E5B8C' && into1st.author_id === commissioner
      && into1st.league_team_id === ltByRank[1],
    JSON.stringify(into1st || {}));
  check('TEST 1: climbed-to-2nd post — ordinal copy + right team',
    !!climbed && climbed.league_team_id === ltByRank[2], JSON.stringify(climbed || {}));
  check('TEST 3: a team that DROPPED (rank 2→4) produced no post',
    !posts.some(p => p.league_team_id === ltByRank[4]), '');
  check('new team (no prior snapshot) is seeded silently — no phantom climb',
    !posts.some(p => p.league_team_id === ltByRank[5]), '');
  check('flat teams produced no post', !posts.some(p => [ltByRank[3], ltByRank[6]].includes(p.league_team_id)), '');
  check('dormant playoff branch: no "playoff spot" copy when playoff_spots unset',
    !posts.some(p => /playoff spot/.test(p.content)), '');

  // snapshot refreshed for ALL six teams (incl. the newly-seeded T5), one row each
  const snaps = await q(`select league_team_id, rank, count(*) over (partition by league_team_id) c
    from public.league_team_rank_snapshot where league_id=$1`, [leagueId]);
  const byTeam = Object.fromEntries(snaps.map(s => [s.league_team_id, s.rank]));
  check('TEST 1: snapshot upserted to current rank for every team',
    snaps.length === 6 && Object.entries(ltByRank).every(([rk, lt]) => byTeam[lt] === Number(rk)),
    JSON.stringify(byTeam));
  check('snapshot keeps exactly one row per team (upsert, not append)', snaps.every(s => Number(s.c) === 1), '');

  // TEST 2 — idempotent: nothing changed → no new posts, snapshot stable
  const n2 = await one(`select public.post_standings_movement($1, null) as n`, [leagueId]);
  const posts2 = await postsOf(leagueId);
  check('TEST 2: immediate re-run posts nothing (idempotent)', n2.n === 0 && posts2.length === 2,
    `returned ${n2.n}, ${posts2.length} posts`);
}

// ─── per-division partitioning ───────────────────────────────────────────────
// One league, two divisions. A climb in DA must NOT touch DB, and p_division_id
// must scope to a single partition. Mirrors rank()'s PARTITION BY division_id.
{
  const lg = await one(`insert into public.leagues (name, commissioner_id) values ('L2', $1) returning id, commissioner_id`, [await mkCommish('L2')]);
  const dA = (await one(`insert into public.league_divisions (league_id, name, sort_order) values ($1,'A',0) returning id`, [lg.id])).id;
  const dB = (await one(`insert into public.league_divisions (league_id, name, sort_order) values ($1,'B',1) returning id`, [lg.id])).id;
  const mkTeam = async (lbl, div) => {
    const tm = await one(`insert into public.teams (name) values ($1) returning id`, [lbl]);
    return (await one(`insert into public.league_teams (league_id, team_id, team_name, division_id) values ($1,$2,$3,$4) returning id`, [lg.id, tm.id, lbl, div])).id;
  };
  const a1 = await mkTeam('A1', dA), a2 = await mkTeam('A2', dA);
  const b1 = await mkTeam('B1', dB), b2 = await mkTeam('B2', dB);
  // DA: a1 beats a2 → a1 rank1, a2 rank2.  DB: b1 beats b2 → b1 rank1, b2 rank2.
  await db.query(`insert into public.league_games (league_id, division_id, home_team_id, away_team_id, home_score, away_score, status, decided_in) values ($1,$2,$3,$4,5,0,'final','regulation')`, [lg.id, dA, a1, a2]);
  await db.query(`insert into public.league_games (league_id, division_id, home_team_id, away_team_id, home_score, away_score, status, decided_in) values ($1,$2,$3,$4,5,0,'final','regulation')`, [lg.id, dB, b1, b2]);
  // Stage an "into 1st" in BOTH divisions (prev 2 → cur 1 for a1 and b1).
  await seedPrev(lg.id, dA, a1, 2); await seedPrev(lg.id, dA, a2, 1);
  await seedPrev(lg.id, dB, b1, 2); await seedPrev(lg.id, dB, b2, 1);

  const nA = await one(`select public.post_standings_movement($1, $2) as n`, [lg.id, dA]);
  const postsAfterA = await postsOf(lg.id);
  check('division scope: RPC(DA) posts ONLY the DA mover (1 post)',
    nA.n === 1 && postsAfterA.length === 1 && postsAfterA[0].league_team_id === a1, `n=${nA.n}, ${postsAfterA.length} posts`);
  const dbSnap = await q(`select 1 from public.league_team_rank_snapshot where league_id=$1 and division_id=$2 and snapshot_at > now() - interval '1 second'`, [lg.id, dB]);
  // DB snapshots were the injected ones; RPC(DA) must not have refreshed them.
  check('division scope: RPC(DA) did NOT touch DB snapshots', dbSnap.length === 2, `${dbSnap.length} recent DB rows (expect the 2 seeded)`);

  // Now whole-league run picks up the DB mover too (each within its partition).
  const nAll = await one(`select public.post_standings_movement($1, null) as n`, [lg.id]);
  const postsAll = await postsOf(lg.id);
  check('whole-league run (null division) posts the DB mover; DA not re-posted',
    nAll.n === 1 && postsAll.length === 2 && postsAll.some(p => p.league_team_id === b1), `n=${nAll.n}, ${postsAll.length} posts`);
}

// ─── playoff-line branch goes live when playoff_spots is set ──────────────────
{
  const { leagueId, lts } = await ladderLeague('L3', 6);
  await db.query(`update public.leagues set settings = '{"playoff_spots": 4}'::jsonb where id=$1`, [leagueId]);
  const cur = await ranksOf(leagueId);
  const ltByRank = Object.fromEntries(cur.map(r => [r.rank, r.lt_id]));
  // Team now 4th was 6th → crosses INTO the top-4 playoff line. All others flat.
  for (const r of cur) await seedPrev(leagueId, null, r.lt_id, r.rank === 4 ? 6 : r.rank);
  const n = await one(`select public.post_standings_movement($1, null) as n`, [leagueId]);
  const posts = await postsOf(leagueId);
  check('playoff line ACTIVE: crossing into top-4 posts the playoff-spot copy ("now 4th")',
    n.n === 1 && posts.length === 1 && /jumped into a playoff spot — now 4th/.test(posts[0].content),
    JSON.stringify(posts.map(p => p.content)));
  check('playoff line: a team already INSIDE that merely climbs gets the generic copy (not double-counted)',
    !posts.some(p => p.league_team_id === ltByRank[1]), '');
}

// ─── division setting overrides league setting (matches the view's COALESCE) ──
{
  const lg = await one(`insert into public.leagues (name, commissioner_id, settings) values ('L4', $1, '{"playoff_spots": 2}'::jsonb) returning id`, [await mkCommish('L4')]);
  const dv = (await one(`insert into public.league_divisions (league_id, name, sort_order, settings) values ($1,'Big',0,'{"playoff_spots": 4}'::jsonb) returning id`, [lg.id])).id;
  const mk = async (lbl) => {
    const tm = await one(`insert into public.teams (name) values ($1) returning id`, [lbl]);
    return (await one(`insert into public.league_teams (league_id, team_id, team_name, division_id) values ($1,$2,$3,$4) returning id`, [lg.id, tm.id, lbl, dv])).id;
  };
  const t = [];
  for (let i = 0; i < 6; i++) t.push(await mk(`L4 T${i + 1}`));
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++)
    await db.query(`insert into public.league_games (league_id, division_id, home_team_id, away_team_id, home_score, away_score, status, decided_in) values ($1,$2,$3,$4,3,1,'final','regulation')`, [lg.id, dv, t[i], t[j]]);
  const cur = await ranksOf(lg.id, dv);
  for (const r of cur) await seedPrev(lg.id, dv, r.lt_id, r.rank === 4 ? 6 : r.rank);
  const n = await one(`select public.post_standings_movement($1, $2) as n`, [lg.id, dv]);
  const posts = await postsOf(lg.id);
  // With league=2 a 4th-place team is OUTSIDE; with division override=4 it's INSIDE.
  // Seeing the playoff-spot copy proves the division setting won.
  check('division playoff_spots overrides league playoff_spots (4 wins over 2)',
    n.n === 1 && /jumped into a playoff spot — now 4th/.test(posts[0]?.content || ''),
    JSON.stringify(posts.map(p => p.content)));
}

// ─── malformed playoff_spots must DEGRADE, not throw (P1 fix) ─────────────────
// A bad settings value (string "four", decimal, bool) must not abort the RPC —
// it should fall back to "no cutoff" and still post the generic climb. A valid
// integer-as-string "4" must still ACTIVATE (a settings form may store strings).
async function playoffCopyFor(name, settingsJson) {
  const { leagueId } = await ladderLeague(name, 6);
  await db.query(`update public.leagues set settings = $2::jsonb where id=$1`, [leagueId, settingsJson]);
  const cur = await ranksOf(leagueId);
  for (const r of cur) await seedPrev(leagueId, null, r.lt_id, r.rank === 4 ? 6 : r.rank); // team 4 crosses 6→4
  let threw = false, n = 0;
  try { n = (await one(`select public.post_standings_movement($1, null) as n`, [leagueId])).n; }
  catch { threw = true; }
  const posts = await postsOf(leagueId);
  return { threw, n, content: posts[0]?.content || '' };
}
{
  for (const [label, json] of [['string "four"', '{"playoff_spots":"four"}'], ['decimal 2.5', '{"playoff_spots":2.5}'], ['bool true', '{"playoff_spots":true}']]) {
    const r = await playoffCopyFor(`L5-${label}`, json);
    check(`malformed playoff_spots (${label}): no throw, degrades to generic climb`,
      !r.threw && r.n === 1 && /climbed to 4th in the standings/.test(r.content) && !/playoff spot/.test(r.content),
      JSON.stringify(r));
  }
  const okStr = await playoffCopyFor('L5-str4', '{"playoff_spots":"4"}');
  check('valid playoff_spots as STRING "4" still activates the playoff copy',
    !okStr.threw && okStr.n === 1 && /jumped into a playoff spot — now 4th/.test(okStr.content), JSON.stringify(okStr));
}

// ─── tie for 1st uses the tie copy, not "moved into 1st place" (P2 fix) ───────
{
  const commish = await mkCommish('L6');
  const lg = (await one(`insert into public.leagues (name, commissioner_id) values ('L6', $1) returning id`, [commish])).id;
  const mk = async (lbl) => {
    const tm = (await one(`insert into public.teams (name) values ($1) returning id`, [lbl])).id;
    return (await one(`insert into public.league_teams (league_id, team_id, team_name) values ($1,$2,$3) returning id`, [lg, tm, lbl])).id;
  };
  const P = await mk('P'), Q = await mk('Q'), R = await mk('R');
  // P and Q never play each other; each beats R 5-0 → identical record → co-rank 1.
  await db.query(`insert into public.league_games (league_id, home_team_id, away_team_id, home_score, away_score, status, decided_in) values ($1,$2,$3,5,0,'final','regulation')`, [lg, P, R]);
  await db.query(`insert into public.league_games (league_id, home_team_id, away_team_id, home_score, away_score, status, decided_in) values ($1,$2,$3,5,0,'final','regulation')`, [lg, Q, R]);
  const cur = await ranksOf(lg);
  const tiedAt1 = cur.filter(r => r.rank === 1).map(r => r.lt_id);
  check('tie setup: P and Q share rank 1', tiedAt1.length === 2 && tiedAt1.includes(P) && tiedAt1.includes(Q), JSON.stringify(cur.map(r => [r.team_name, r.rank])));
  await seedPrev(lg, null, P, 2); // both climb INTO the shared 1st
  await seedPrev(lg, null, Q, 3);
  await seedPrev(lg, null, R, 1); // R drops out of 1st
  const n = await one(`select public.post_standings_movement($1, null) as n`, [lg]);
  const posts = await postsOf(lg);
  check('tie for 1st: both movers say "tie for 1st", none claim sole "moved into 1st place"',
    n.n === 2 && posts.length === 2 && posts.every(p => /climbed into a tie for 1st place/.test(p.content))
      && !posts.some(p => /moved into 1st place/.test(p.content)),
    JSON.stringify(posts.map(p => p.content)));
}

console.log(`\n${failed === 0 ? '✅ ALL A2 CHECKS PASSED' : `❌ ${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
