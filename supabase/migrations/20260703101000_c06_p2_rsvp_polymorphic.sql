-- =============================================================================
-- C06 PR-2 · Ritual correctness — RSVP schema repair (D-C06-2, the C12 two-FK
-- pattern). Fixes BUG-1: `team_game_rsvps.game_id` FKs ONLY to team_games.id,
-- so HypeCard / RsvpBlock writing a league_games or games (tournament) id into
-- it caused an FK violation → the optimistic UI silently rolled back. Prod has
-- had exactly ONE RSVP row, ever — the "I'm in" loop the game-day ritual is
-- built on has never worked on real (league/tournament) games.
--
-- Shape today (audited live on prod 2026-07-02):
--   game_id  uuid  NOT NULL  FK team_games(id) ON DELETE CASCADE
--   UNIQUE (game_id, user_id)                      -- one row per (game, user)
--   user_id  uuid  NOT NULL  FK profiles(id)  ON DELETE CASCADE
--   status   text  NOT NULL  CHECK in ('in','out','maybe')
--   indexes: pkey(id), unique(game_id,user_id), (user_id)
--   RLS: rsvp_read SELECT  → can_view_team( team of team_games where id=game_id )
--        rsvp_user_insert / _update / _delete → can_manage_profile(user_id)
--
-- Fix: make game_id NULLABLE (keep its FK), add two nullable sibling FK columns
-- (league_game_id → league_games, tournament_game_id → games), enforce exactly
-- one of the three id columns is set (num_nonnulls = 1), and replace the single
-- UNIQUE(game_id,user_id) with THREE partial unique indexes — one per source —
-- so a user still gets exactly one RSVP row per game per source. The old upsert
-- onConflict target (game_id,user_id) is superseded by the team partial index of
-- the same key columns; lib/rsvp.js selects the matching conflict target by
-- source.
--
-- EMBED-FOOTGUN NOTE (postgrest_embed_ambiguity): these are the FIRST foreign
-- keys FROM team_game_rsvps TO league_games and TO games. Verified 2026-07-02:
-- (a) no existing FK from this table to either target, and (b) NO code embeds
-- team_game_rsvps with a bare PostgREST relationship onto league_games/games —
-- the only embed on this table is
-- `profiles!team_game_rsvps_user_id_fkey(...)` (already FK-qualified), so no
-- pre-existing bare embed pair silently gains a second relationship. Any FUTURE
-- embed of a game table through this row MUST name the FK.
--
-- C08 LESSON (unindexed FKs): both new FK columns get a covering index.
--
-- Idempotent (safe to re-run): all adds/creates guard on IF NOT EXISTS or a
-- DO-block existence check.
-- =============================================================================

-- 1. game_id becomes nullable (its FK stays; legacy team_games rows unaffected).
alter table public.team_game_rsvps
  alter column game_id drop not null;

-- 2. Two new nullable sibling FK columns.
alter table public.team_game_rsvps
  add column if not exists league_game_id uuid
    references public.league_games(id) on delete cascade;

alter table public.team_game_rsvps
  add column if not exists tournament_game_id uuid
    references public.games(id) on delete cascade;

-- 3. Exactly one of the three id columns is populated (num_nonnulls = 1).
--    Named constraint so re-runs are idempotent (drop-then-add).
alter table public.team_game_rsvps
  drop constraint if exists team_game_rsvps_one_target_chk;
alter table public.team_game_rsvps
  add constraint team_game_rsvps_one_target_chk
  check (num_nonnulls(game_id, league_game_id, tournament_game_id) = 1);

-- 4. Uniqueness per (user × game) PER SOURCE. Replace the single composite
--    UNIQUE(game_id,user_id) — which cannot express the two new nullable
--    columns — with three partial unique indexes. Each still guarantees a user
--    holds at most one RSVP row per game within a source. The team index reuses
--    the exact key columns of the dropped constraint, so lib/rsvp.js can keep
--    `onConflict: 'game_id,user_id'` for the team path.
alter table public.team_game_rsvps
  drop constraint if exists team_game_rsvps_game_id_user_id_key;

create unique index if not exists team_game_rsvps_team_user_uidx
  on public.team_game_rsvps (game_id, user_id)
  where game_id is not null;

create unique index if not exists team_game_rsvps_league_user_uidx
  on public.team_game_rsvps (league_game_id, user_id)
  where league_game_id is not null;

create unique index if not exists team_game_rsvps_tournament_user_uidx
  on public.team_game_rsvps (tournament_game_id, user_id)
  where tournament_game_id is not null;

-- 5. Covering indexes on the two new FK columns (C08: no unindexed FK).
create index if not exists team_game_rsvps_league_game_id_idx
  on public.team_game_rsvps (league_game_id)
  where league_game_id is not null;

create index if not exists team_game_rsvps_tournament_game_id_idx
  on public.team_game_rsvps (tournament_game_id)
  where tournament_game_id is not null;

-- 6. RLS read policy: the existing `rsvp_read` gated visibility on
--    can_view_team( team of the team_games row identified by game_id ). That
--    subselect returns NULL for a league/tournament RSVP row (game_id IS NULL),
--    and can_view_team(NULL) is false → the new rows would be unreadable and
--    RsvpBlock's count/attendee list would come back empty even to eligible
--    viewers. Extend it to cover all three sources. The write policies
--    (rsvp_user_insert/_update/_delete) gate only on can_manage_profile(user_id)
--    — they never referenced game_id, so they survive the change untouched.
--
--    League/tournament visibility mirrors how those events are read elsewhere:
--    a league game's RSVPs are visible to anyone who can see either participating
--    league_team's underlying team (can_view_team); a tournament game's RSVPs are
--    visible to anyone who can see the tournament (public tournaments are open).
drop policy if exists rsvp_read on public.team_game_rsvps;
create policy rsvp_read on public.team_game_rsvps for select to public
using (
  case
    when game_id is not null then
      public.can_view_team((select tg.team_id from public.team_games tg where tg.id = team_game_rsvps.game_id))
    when league_game_id is not null then
      exists (
        select 1
        from public.league_games lg
        left join public.league_teams hlt on hlt.id = lg.home_team_id
        left join public.league_teams alt on alt.id = lg.away_team_id
        where lg.id = team_game_rsvps.league_game_id
          and (public.can_view_team(hlt.team_id) or public.can_view_team(alt.team_id))
      )
    when tournament_game_id is not null then
      exists (
        select 1
        from public.games g
        join public.tournaments t on t.id = g.tournament_id
        where g.id = team_game_rsvps.tournament_game_id
          and coalesce(t.is_youth, true) = false
      )
    else false
  end
);
