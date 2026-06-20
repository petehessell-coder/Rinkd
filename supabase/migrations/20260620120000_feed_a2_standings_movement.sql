-- Feed A2 — standings-movement posts. The last open feed generator.
--
-- When a finalized league result moves a team UP in its division standings,
-- auto-post a short, positive feed event ("📈 climbed to 2nd", "into 1st"). The
-- live `league_standings` view carries a current `rank` but no history, so we
-- keep a tiny per-team rank snapshot and diff it on each finalize.
--
-- Sibling of A1 (recap — src/lib/posts.js createGameRecapPost) and A3
-- (milestones — award_milestones_for_game). Leagues only; tournaments later.
--
-- ── IMPORTANT: rank is per-DIVISION ───────────────────────────────────────
-- league_standings computes
--   rank() OVER (PARTITION BY league_id, division_id ORDER BY pts DESC, ...)
-- so every comparison is scoped to (league_id, division_id). For a
-- single-division league all teams share one division (often NULL), so this
-- collapses to a league-wide rank automatically. division_id is nullable, so
-- every snapshot match uses IS NOT DISTINCT FROM (treats NULL = NULL).
--
-- ── A note on the "playoff line" trigger ──────────────────────────────────
-- The build spec asked to also post when a team "crosses the playoff line,
-- using the standings UI's playoff-cutoff logic." That logic does not exist:
-- the standings UI has no cutoff, and a league's playoff size is chosen ad-hoc
-- (2/4/8) by the commissioner at bracket-generation time — it is NOT stored.
-- Hardcoding a cutoff (e.g. "top 4") would fire WRONG posts for any league with
-- a different bracket, which violates correctness-over-convenience. So the
-- playoff branch below fires ONLY when a commissioner has explicitly set
-- `playoff_spots` on the division or league settings (division overrides
-- league, mirroring how the view reads points). No UI sets it today, so the
-- branch is dormant — but it can never produce a wrong post, and it lights up
-- for free the moment a real cutoff setting ships.

-- ── Snapshot table ────────────────────────────────────────────────────────
create table if not exists public.league_team_rank_snapshot (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  division_id uuid references public.league_divisions(id) on delete cascade,
  league_team_id uuid not null,            -- == league_standings.lt_id (league_teams.id)
  rank int not null,
  snapshot_at timestamptz not null default now()
);

-- Covers the "latest rank per team" lookup (leading league_id/division_id, then
-- the team, newest first). We keep exactly ONE current row per
-- (league_id, division_id, league_team_id) — the RPC upserts in place — but the
-- snapshot_at DESC ordering keeps the read correct even if a stray row appears.
create index if not exists ltrs_lookup_idx
  on public.league_team_rank_snapshot (league_id, division_id, league_team_id, snapshot_at desc);

comment on table public.league_team_rank_snapshot is
  'Feed A2: last-known per-division standings rank per league team. Diffed on '
  'finalize to auto-post positive movement events. One current row per '
  '(league_id, division_id, league_team_id); RPC-write only.';

-- No RLS policies needed: the table is written exclusively by the SECURITY
-- DEFINER RPC below (which bypasses RLS as owner) and is never read by clients.
-- Enable RLS with no policies so a stray client read/write is denied by default.
alter table public.league_team_rank_snapshot enable row level security;

-- ── Ordinal helper (1st / 2nd / 3rd / 11th …) ─────────────────────────────
-- Pure string math, no schema objects → empty search_path silences the
-- function_search_path_mutable advisor.
create or replace function public.rinkd_ordinal(n int)
returns text
language sql
immutable
set search_path = ''
as $$
  select n::text || case
    when (n % 100) between 11 and 13 then 'th'
    when n % 10 = 1 then 'st'
    when n % 10 = 2 then 'nd'
    when n % 10 = 3 then 'rd'
    else 'th'
  end;
$$;

-- ── The RPC both callers (native scorer + GameSheet poller) invoke ─────────
create or replace function public.post_standings_movement(
  p_league_id uuid,
  p_division_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commissioner uuid;
  v_posts int := 0;
begin
  if p_league_id is null then
    return 0;
  end if;

  -- Author every movement post as the league commissioner. posts.author_id is
  -- NOT NULL; mirror the poller's recap path (no author → skip; the standings
  -- themselves are unaffected, this only governs the celebratory post).
  select commissioner_id into v_commissioner from public.leagues where id = p_league_id;
  if v_commissioner is null then
    return 0;
  end if;

  -- Serialize per league so two near-simultaneous finalizes (e.g. the native
  -- scorer AND the poller, or two scorers) can't both read the same prior rank
  -- and double-post the same climb. Auto-released at txn end.
  perform pg_advisory_xact_lock(hashtext('std_move:' || p_league_id::text));

  -- 1) Post POSITIVE moves only, diffed against the PRIOR snapshot. INNER JOIN
  --    to the snapshot means a team with no prior baseline (first run / newly
  --    added team) is seeded silently below and never posts a phantom "climb".
  --
  --    Known v1 semantics (accepted, rank-only diff): we compare the integer
  --    rank only. So (a) taking SOLE possession of a rank a team was tied for
  --    does not post (rank number is unchanged), and (b) a rank that improves
  --    purely because another team's games were voided would post — but the RPC
  --    only runs on a real finalize, so that needs a void + a finalize between
  --    two snapshots. Both are fine for "the standings moved"; richer detection
  --    would need a tiebreaker signature in the snapshot (future).
  with ins as (
    insert into public.posts (author_id, content, tag, tag_color, league_id, league_team_id)
    select
      v_commissioner,
      case
        -- rank() ties share a rank, so don't claim sole 1st when it's shared.
        when c.cur_rank = 1 and c.tied_at_rank > 1
          then '📈 ' || c.team_name || ' climbed into a tie for 1st place!'
        when c.cur_rank = 1
          then '📈 ' || c.team_name || ' moved into 1st place in the standings!'
        when ps.spots is not null and ps.spots > 0
             and p.prev_rank > ps.spots and c.cur_rank <= ps.spots
          then '🎟️ ' || c.team_name || ' jumped into a playoff spot — now '
               || public.rinkd_ordinal(c.cur_rank) || '!'
        else '📈 ' || c.team_name || ' climbed to '
             || public.rinkd_ordinal(c.cur_rank) || ' in the standings!'
      end,
      'Standings', '#2E5B8C', p_league_id, c.lt_id
    from (
      select s.lt_id, s.division_id, s.rank::int as cur_rank, s.team_name,
             -- how many teams share this rank in the partition (tie detection)
             count(*) over (partition by s.league_id, s.division_id, s.rank) as tied_at_rank
      from public.league_standings s
      where s.league_id = p_league_id
        and (p_division_id is null or s.division_id is not distinct from p_division_id)
    ) c
    join (
      select distinct on (snap.league_team_id, snap.division_id)
             snap.league_team_id, snap.division_id, snap.rank as prev_rank
      from public.league_team_rank_snapshot snap
      where snap.league_id = p_league_id
        and (p_division_id is null or snap.division_id is not distinct from p_division_id)
      order by snap.league_team_id, snap.division_id, snap.snapshot_at desc
    ) p
      on p.league_team_id = c.lt_id
     and p.division_id is not distinct from c.division_id
    left join lateral (
      -- Defensive parse: a settings form could write playoff_spots as a JSON
      -- string, a decimal, a bool, etc. A bare ::int on a non-integer text would
      -- THROW and abort the whole RPC (killing every movement post for the
      -- league, silently — the callers swallow it). The live view dodges this
      -- with ::numeric; we guard with an integer-only regex so a bad value
      -- degrades to "no cutoff" (NULL) instead. Division overrides league.
      select coalesce(
        (select case when (d.settings ->> 'playoff_spots') ~ '^\s*\d+\s*$'
                     then (trim(d.settings ->> 'playoff_spots'))::int end
           from public.league_divisions d where d.id = c.division_id),
        (select case when (l.settings ->> 'playoff_spots') ~ '^\s*\d+\s*$'
                     then (trim(l.settings ->> 'playoff_spots'))::int end
           from public.leagues l where l.id = p_league_id)
      ) as spots
    ) ps on true
    where c.cur_rank < p.prev_rank          -- improved (lower number = better)
    returning 1
  )
  select count(*) into v_posts from ins;

  -- 2) Refresh the baseline to the CURRENT rank for EVERY team (up / down /
  --    flat) so the next finalize diffs against the true latest state and the
  --    same move never re-fires. Update-in-place keeps one current row per team;
  --    the standings view never reads this table, so these writes can't feed
  --    back into step 1 (Halloween-safe).
  update public.league_team_rank_snapshot t
     set rank = c.cur_rank, snapshot_at = now()
  from (
    select s.lt_id, s.division_id, s.rank::int as cur_rank
    from public.league_standings s
    where s.league_id = p_league_id
      and (p_division_id is null or s.division_id is not distinct from p_division_id)
  ) c
  where t.league_id = p_league_id
    and t.league_team_id = c.lt_id
    and t.division_id is not distinct from c.division_id;

  insert into public.league_team_rank_snapshot (league_id, division_id, league_team_id, rank)
  select p_league_id, c.division_id, c.lt_id, c.cur_rank
  from (
    select s.lt_id, s.division_id, s.rank::int as cur_rank
    from public.league_standings s
    where s.league_id = p_league_id
      and (p_division_id is null or s.division_id is not distinct from p_division_id)
  ) c
  where not exists (
    select 1 from public.league_team_rank_snapshot t
    where t.league_id = p_league_id
      and t.league_team_id = c.lt_id
      and t.division_id is not distinct from c.division_id
  );

  return v_posts;
end;
$$;

-- SECURITY DEFINER + authenticated is intentional: the native scorer may hold a
-- 'scorer' role (not commissioner), so it must be callable by any authenticated
-- finalizer. It is safe because the content is fully templated from the LIVE
-- standings (no caller input reaches the post body), it only ever posts POSITIVE
-- real movement, and the snapshot diff throttles it — a malicious caller can at
-- most surface a pending climb a few seconds early, then every further call
-- no-ops. service_role covers the poller's server-side calls.
revoke all on function public.post_standings_movement(uuid, uuid) from public;
grant execute on function public.post_standings_movement(uuid, uuid) to authenticated, service_role;
