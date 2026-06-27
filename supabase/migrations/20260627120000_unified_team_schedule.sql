-- UNIFIED TEAM SCHEDULE — generalize team_games to carry games, practices, and events.
--
-- Design: do NOT build a separate practices system. A practice/event is just a
-- team_games row with event_type != 'game'. RSVP (team_game_rsvps.game_id),
-- the .ics export, and send-game-reminders all already hang off the team_games
-- row, so they come along for free.
--
-- Minor-safe: schedule + attendance only (no money, no new PII). The existing
-- youth-privacy RLS on team_games (can_view_team) applies unchanged to every
-- event_type, so youth-team practices stay private/insider-only automatically.

-- ── 1. New columns ──────────────────────────────────────────────────────────
alter table public.team_games
  add column if not exists event_type text not null default 'game'
    check (event_type in ('game','practice','event')),
  add column if not exists title text,          -- label for practice/event ("Practice", "Skills"); games use opponent
  add column if not exists end_time timestamptz, -- practices/events carry a duration; nullable for games
  add column if not exists series_id uuid;        -- groups recurring occurrences (edit/cancel a whole series)

-- ── 2. Relax opponent for non-game rows ─────────────────────────────────────
-- opponent is NOT NULL in prod (every row is a game today). Practices/events
-- have no opponent, so drop the NOT NULL. A CHECK keeps games honest: a 'game'
-- row must still name an opponent; practice/event rows must not be forced to.
alter table public.team_games alter column opponent drop not null;

alter table public.team_games drop constraint if exists team_games_opponent_required;
alter table public.team_games add constraint team_games_opponent_required
  check (event_type <> 'game' or opponent is not null);

-- ── 3. Indexes ──────────────────────────────────────────────────────────────
create index if not exists team_games_team_start_idx on public.team_games (team_id, start_time);
create index if not exists team_games_series_idx on public.team_games (series_id) where series_id is not null;

-- ── 4. Manager/coach UPDATE + DELETE policies ───────────────────────────────
-- Today team_games has only INSERT + SELECT policies, so managers can't edit or
-- cancel a row (or a whole practice series) from the client. Mirror the existing
-- INSERT policy (manager/coach of the team) for UPDATE and DELETE so series
-- edit/cancel and single-occurrence delete work under RLS — no service role,
-- no SECURITY DEFINER RPC needed. can_view_team / current_profile_id already
-- exist and are used by the existing policies.
drop policy if exists team_games_update on public.team_games;
create policy team_games_update on public.team_games
  for update
  using (exists (
    select 1 from public.team_members tm
    where tm.team_id = team_games.team_id
      and tm.user_id = (select current_profile_id())
      and tm.role = any (array['manager','coach'])
  ))
  with check (exists (
    select 1 from public.team_members tm
    where tm.team_id = team_games.team_id
      and tm.user_id = (select current_profile_id())
      and tm.role = any (array['manager','coach'])
  ));

drop policy if exists team_games_delete on public.team_games;
create policy team_games_delete on public.team_games
  for delete
  using (exists (
    select 1 from public.team_members tm
    where tm.team_id = team_games.team_id
      and tm.user_id = (select current_profile_id())
      and tm.role = any (array['manager','coach'])
  ));
