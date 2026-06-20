-- =============================================================================
-- perf(scale) — Broadcast from Database for live-game fan-out  [PENDING — DO NOT
-- BULK-APPLY]
--
-- This file lives in supabase/migrations-pending/ — NOT supabase/migrations/ —
-- on purpose: it touches the live-scoring path and must be reviewed, completed
-- where flagged, and verified on a real device before it is moved into the
-- applied migrations dir and run. The client already ships the consuming code
-- behind REACT_APP_GAME_BROADCAST (default off → today's postgres_changes path),
-- so applying this changes nothing until that flag is flipped to '1'.
--
-- WHY: PublicGame/GameDetail/Gameday have every spectator open their own
-- `postgres_changes` subscription on the game. 10k fans on one hot game = 10k
-- server subs, and Postgres re-evaluates RLS per-changed-row × per-subscriber on
-- every goal — O(viewers). Broadcast-from-DB emits ONE message per write to a
-- per-game topic; spectators subscribe to that single topic → O(games).
--
-- VERIFY BEFORE APPLYING (project-specifics this template can't confirm blind):
--   1. `realtime.send(jsonb, text, text, boolean)` exists on this project's
--      Realtime version (Supabase added it 2024; older projects use
--      `realtime.broadcast_changes`). Adjust the call if needed.
--   2. game_goals.game_id FK target — in this schema goals are written for both
--      tournament `games` and `league_games` id-spaces. The kind below is
--      derived per-row; confirm the column + that ids don't collide across
--      spaces (they're uuids, so a topic per (kind,id) is unambiguous as long as
--      the writer's kind is known). If goals can't be attributed to a kind from
--      the row alone, broadcast to BOTH topics (cheap) or add a kind column.
--   3. RLS on realtime.messages for anon read of public game topics (PublicGame
--      is anonymous). Tighten the topic LIKE if any game should be private.
-- =============================================================================

-- 1) One function, bound to every table whose change means "this game updated".
create or replace function public.broadcast_game_update()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_kind text;
  v_id   text;
begin
  if tg_table_name = 'league_games' then
    v_kind := 'league';     v_id := coalesce(new.id, old.id)::text;
  elsif tg_table_name = 'team_games' then
    v_kind := 'team';       v_id := coalesce(new.id, old.id)::text;
  elsif tg_table_name = 'games' then
    v_kind := 'tournament'; v_id := coalesce(new.id, old.id)::text;
  elsif tg_table_name = 'game_goals' then
    -- goals belong to a games/league_games row; the client subscribes per kind,
    -- so emit to both kinds' topics for this game_id (uuids don't collide).
    v_id := coalesce(new.game_id, old.game_id)::text;
    perform realtime.send(jsonb_build_object('id', v_id, 'at', now()), 'update', 'game:tournament:' || v_id, false);
    perform realtime.send(jsonb_build_object('id', v_id, 'at', now()), 'update', 'game:league:' || v_id, false);
    return null;
  else
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object('id', v_id, 'at', now()),  -- lightweight ping; client re-fetches the snapshot
    'update',                                     -- event the client listens for
    'game:' || v_kind || ':' || v_id,             -- per-game topic
    false                                         -- public broadcast (anon spectators)
  );
  return null;  -- AFTER trigger
exception when others then
  -- A broadcast failure must NEVER roll back a score write.
  return null;
end;
$$;

-- 2) AFTER triggers (insert/update/delete) — statement-light, one send per row.
drop trigger if exists trg_broadcast_games        on public.games;
drop trigger if exists trg_broadcast_league_games on public.league_games;
drop trigger if exists trg_broadcast_team_games   on public.team_games;
drop trigger if exists trg_broadcast_game_goals   on public.game_goals;

create trigger trg_broadcast_games        after insert or update or delete on public.games        for each row execute function public.broadcast_game_update();
create trigger trg_broadcast_league_games after insert or update or delete on public.league_games for each row execute function public.broadcast_game_update();
create trigger trg_broadcast_team_games   after insert or update or delete on public.team_games   for each row execute function public.broadcast_game_update();
create trigger trg_broadcast_game_goals   after insert or update or delete on public.game_goals   for each row execute function public.broadcast_game_update();

-- 3) Let anyone (incl. anon) SUBSCRIBE to a public game topic. Realtime checks
--    SELECT on realtime.messages for the topic at subscribe time.
alter table realtime.messages enable row level security;  -- no-op if already on
drop policy if exists "read public game topics" on realtime.messages;
create policy "read public game topics"
  on realtime.messages
  for select
  to anon, authenticated
  using ( topic like 'game:%' );

-- ROLLBACK:
--   drop trigger trg_broadcast_games on public.games; (… and the other three)
--   drop function public.broadcast_game_update();
--   drop policy "read public game topics" on realtime.messages;
-- Then set REACT_APP_GAME_BROADCAST back to unset and redeploy.
