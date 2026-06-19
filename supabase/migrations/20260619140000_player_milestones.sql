-- ENGAGE-1 — player milestones (the recognition layer).
--
-- Detects earned career moments at game-finalize: first goal, every 100th
-- point, and point-streak thresholds. Mirrors the goal→user attribution used by
-- get_player_*_stats (game_lineups.user_id ↔ game_goals by team+jersey, FINAL
-- games, shootout goals excluded), unioned across tournament + league so a
-- milestone is career-wide.
--
-- Recognition stays scarce + earned (manifesto: gold is for milestones only).
-- The fan Game Puck remains the separate Player-of-the-Game award.
--
-- Validated against a prod-shaped PGlite Postgres
-- (scripts/engage-smoke/milestones.mjs): applies + first-goal/100th-point/
-- streak/notify/idempotency/reset all pass. RLS verified on apply.

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.player_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('first_goal','points_100','point_streak')),
  value       integer not null default 0,         -- 1 | the hundred (100,200…) | streak length (3,5,10…)
  label       text,                               -- display string, e.g. "100th career point"
  game_id     uuid,                               -- the game that earned it (polymorphic)
  game_source text check (game_source in ('tournament','league')),
  achieved_at timestamptz not null default now(),
  -- one row per (player, kind, value): first_goal once ever; each 100-point tier
  -- once; each streak threshold once. Makes detection idempotent.
  unique (user_id, kind, value)
);
create index if not exists idx_player_milestones_user on public.player_milestones(user_id, achieved_at desc);

-- Public read — milestones are display-safe achievements (no PII), same posture
-- as the stat leaderboards. Writes happen ONLY through the definer function
-- below, so there are deliberately no insert/update/delete policies.
alter table public.player_milestones enable row level security;
drop policy if exists pm_select_all on public.player_milestones;
create policy pm_select_all on public.player_milestones for select using (true);

-- ── read RPC (invoker) ───────────────────────────────────────────────────────
create or replace function public.get_player_milestones(p_user_id uuid)
returns setof public.player_milestones
language sql stable security invoker set search_path to 'public'
as $$
  select * from public.player_milestones where user_id = p_user_id order by achieved_at desc;
$$;

-- ── detection + notify (definer) ─────────────────────────────────────────────
-- Idempotent: re-running on the same final game inserts nothing new and notifies
-- no one. Returns the count of newly-awarded milestones.
create or replace function public.award_milestones_for_game(p_game_id uuid, p_source text)
returns integer
language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_new integer := 0;
  r record;
  v_was boolean;
begin
  -- Per-appearance points for every player who appeared in THIS game, across
  -- all their FINAL-game appearances (career), both sources. Points = goals +
  -- assists attributed by (game, team, jersey); shootout goals excluded.
  create temp table _appts on commit drop as
  with players as (
    select distinct gl.user_id
    from game_lineups gl
    where gl.game_id = p_game_id and gl.game_source = p_source
      and gl.user_id is not null and gl.jersey_number is not null
  ),
  appearances as (
    select gl.user_id, gl.game_id, gl.team_id, gl.jersey_number as jersey,
           'tournament'::text as src, g.start_time
    from game_lineups gl
    join players p on p.user_id = gl.user_id
    join games g on g.id = gl.game_id
    where gl.game_source = 'tournament' and gl.jersey_number is not null and g.status = 'final'
    union all
    select gl.user_id, gl.game_id, gl.team_id, gl.jersey_number,
           'league', lg.start_time
    from game_lineups gl
    join players p on p.user_id = gl.user_id
    join league_games lg on lg.id = gl.game_id
    where gl.game_source = 'league' and gl.jersey_number is not null and lg.status = 'final'
  )
  select a.user_id, a.game_id, a.src, a.start_time,
    (select count(*) from game_goals gg
       where gg.game_id = a.game_id and gg.team_id = a.team_id
         and coalesce(gg.is_shootout,false) = false and gg.scorer_number = a.jersey)::int as goals,
    (select count(*) from game_goals gg
       where gg.game_id = a.game_id and gg.team_id = a.team_id
         and coalesce(gg.is_shootout,false) = false
         and (gg.assist1_number = a.jersey or gg.assist2_number = a.jersey))::int as assists
  from appearances a;

  -- Per-player career totals + this-game contribution + current point streak.
  for r in
    with agg as (
      select user_id,
             sum(goals) as career_goals,
             sum(goals + assists) as career_points,
             sum((goals + assists)) filter (where game_id = p_game_id) as this_pts,
             sum(goals) filter (where game_id = p_game_id) as this_goals
      from _appts group by user_id
    ),
    ranked as (   -- most-recent-first; flag the trailing run of point games
      select user_id, (goals + assists) as pts,
             sum(case when (goals + assists) = 0 then 1 else 0 end)
               over (partition by user_id order by start_time desc, game_id desc
                     rows unbounded preceding) as zeros_before_incl
      from _appts
    ),
    streaks as (
      select user_id, count(*) filter (where zeros_before_incl = 0) as streak
      from ranked group by user_id
    )
    select a.user_id, a.career_goals, a.career_points,
           coalesce(a.this_pts,0) as this_pts, coalesce(a.this_goals,0) as this_goals,
           coalesce(s.streak,0) as streak
    from agg a left join streaks s on s.user_id = a.user_id
  loop
    -- first goal: career goals all came starting with this game.
    if r.this_goals > 0 and (r.career_goals - r.this_goals) = 0 then
      v_was := _award_milestone(r.user_id, 'first_goal', 1, 'First career goal', p_game_id, p_source);
      if v_was then v_new := v_new + 1; end if;
    end if;

    -- every 100th point: award the highest hundred crossed in THIS game.
    if r.this_pts > 0 and floor(r.career_points / 100.0) > floor((r.career_points - r.this_pts) / 100.0) then
      v_was := _award_milestone(r.user_id, 'points_100', (floor(r.career_points/100.0)*100)::int,
        (floor(r.career_points/100.0)*100)::int || 'th career point', p_game_id, p_source);
      if v_was then v_new := v_new + 1; end if;
    end if;

    -- point-streak thresholds (only when this game has a point, so the streak is current).
    if r.this_pts > 0 then
      v_new := v_new + _award_streak(r.user_id, r.streak::int, p_game_id, p_source);
    end if;
  end loop;

  return v_new;
end;
$$;

-- Insert one milestone + notify the player and their teammates-in-this-game.
-- `found` (set by the INSERT) tells the caller whether it was new.
create or replace function public._award_milestone(
  p_user uuid, p_kind text, p_value int, p_label text, p_game uuid, p_source text)
returns boolean
language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_id uuid; v_name text;
begin
  insert into public.player_milestones(user_id, kind, value, label, game_id, game_source)
  values (p_user, p_kind, p_value, p_label, p_game, p_source)
  on conflict (user_id, kind, value) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;  -- already had it → no re-notify

  select name into v_name from public.profiles where id = p_user;
  -- the player
  insert into public.notifications(recipient_id, actor_id, kind, body, game_id, metadata)
  values (p_user, p_user, 'milestone', 'Milestone unlocked — ' || p_label || '.', p_game,
          jsonb_build_object('milestone_kind', p_kind, 'value', p_value));
  -- their teammates in this game (works for both sources; no team_members hop)
  insert into public.notifications(recipient_id, actor_id, kind, body, game_id, metadata)
  select distinct gl.user_id, p_user, 'milestone',
         coalesce(v_name,'A teammate') || ' hit a milestone — ' || p_label || '.', p_game,
         jsonb_build_object('milestone_kind', p_kind, 'value', p_value)
  from game_lineups gl
  where gl.game_id = p_game and gl.game_source = p_source
    and gl.user_id is not null and gl.user_id <> p_user;
  return true;
end;
$$;

-- Award each newly-reached streak threshold (3,5,10,15,20) at or below the
-- current streak. Idempotent via the unique constraint; returns # newly awarded.
create or replace function public._award_streak(p_user uuid, p_streak int, p_game uuid, p_source text)
returns integer
language plpgsql volatile security definer set search_path to 'public'
as $$
declare t int; v_n int := 0;
begin
  foreach t in array array[3,5,10,15,20] loop
    if p_streak >= t then
      if _award_milestone(p_user, 'point_streak', t, t || '-game point streak', p_game, p_source) then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;

grant execute on function public.get_player_milestones(uuid) to anon, authenticated;
-- award_* are definer + called server-side (ScorerView finalize / future trigger);
-- granting authenticated execute is safe (it only writes earned, idempotent rows).
grant execute on function public.award_milestones_for_game(uuid, text) to authenticated;
