-- ============================================================================
-- LRS-1 Phase 2 / Migration J — GS-2 suspensions + GS-5 eligibility cross-ref
-- Branch: feature/lineup-roster-subs (stacks on Migrations H + I).
--
-- ⚠️  APPLY POST-PILOT, after REG A–G and LRS H + I (runbook order). No hard
--     SQL dependency on H/I, but the client code that writes here ships with
--     the same build as the H/I client changes.
--
-- GS-2 (GameSheet parity Gap 2): when a scorekeeper logs a Game Misconduct or
-- Match Penalty, ScorerView files a game_suspensions row (through GS-1's
-- offline queue — the filing happens rink-side). A DB trigger fans the alert
-- out to the tournament directors via the send-suspension-alert edge fn, so
-- the alert fires no matter which transport the insert arrived on (direct
-- client write OR sync-scorekeeper-queue replay — a client-side fn call would
-- silently drop the alert for every offline filing). Directors manage the
-- lifecycle from a TournamentManage Suspensions tab via two fail-closed RPCs;
-- the public standings surface gets TEAM-LEVEL flags only.
--
-- GS-5 Phase 2/3: a pre-game roster check cross-references the game's lineups
-- against pending suspensions; verify_game_rosters() is the server-side
-- arbiter — when a suspended jersey appears on the lineup, only a DIRECTOR
-- may acknowledge-and-verify. games gains rosters_verified_at/by for the
-- public "✓ Rosters verified" badge.
--
-- Counting model (the adversarial-review surface):
--   * games_remaining counts games still to SIT OUT. suspension_1/2/3 start
--     at 1/2/3; 'indefinite' uses 0 as "not games-counted" (a CHECK pins
--     that); game_misconduct/match_penalty are accepted for forward-compat
--     but ScorerView always files the length-picked values.
--   * status='pending' is the ONLY active state. serve_suspension decrements
--     atomically and flips to 'served' exactly when the count hits 0 — one
--     UPDATE statement, so concurrent double-taps are serialized by the row
--     lock and each consumes a real game (never below 0, never serving a
--     resolved row). 'indefinite' cannot be served, only overturned.
--   * overturn_suspension works from pending OR served (record correction);
--     overturned rows never count anywhere.
--   * CHECKs make the invariants table-level (they bind service-role writers
--     too): pending ⟺ resolved_at null; served ⇒ games_remaining 0;
--     finite pending ⇒ games_remaining > 0.
--
-- Privacy (non-negotiable from the cluster brief): rows carry player_name +
-- jersey, so raw-table SELECT is restricted to tournament staff (directors,
-- tournament_roles holders, assigned scorekeepers). The ONLY public surface
-- is get_tournament_suspension_flags() — team_id + pending count, no names,
-- no jerseys. Migration I's anon minor shielding is untouched.
-- ============================================================================

-- 1 ── Table ─────────────────────────────────────────────────────────────────
-- ⚠️  PROD COLLISION (apply-blocker found Jun 11): prod already has a
-- game_suspensions table — an abandoned division-aware stub (division_id,
-- player_user_id, player_jersey, reason, source_game_id, served_game_id,
-- status default 'active') with 0 rows, 0 inbound FKs, no code references
-- (audited Jun 11: nothing in src/ or supabase/functions/ reads or writes
-- the old columns; the only policies on it are stale stubs). A CREATE IF NOT
-- EXISTS would silently keep the old shape and the index/RPC statements
-- below would fail mid-migration. Since the stub is provably orphaned, drop
-- it outright; CASCADE clears its two stale policies. The create below is
-- deliberately NOT "if not exists" so a future shape conflict fails LOUDLY
-- at apply time instead of skipping.
drop table if exists public.game_suspensions cascade;

create table public.game_suspensions (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  game_id         uuid not null references public.games(id) on delete cascade,
  team_id         uuid not null references public.tournament_teams(id) on delete cascade,
  player_name     text not null,
  -- integer (not the brief's text) to match game_penalties.player_number and
  -- game_lineups.jersey_number — the eligibility cross-ref joins on it.
  jersey_number   integer,
  penalty_id      uuid references public.game_penalties(id) on delete set null,
  suspension_type text not null check (suspension_type in
                    ('game_misconduct','match_penalty','suspension_1',
                     'suspension_2','suspension_3','indefinite')),
  games_remaining integer not null default 1 check (games_remaining between 0 and 99),
  notes           text,
  status          text not null default 'pending'
                    check (status in ('pending','served','overturned')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  -- claimed by send-suspension-alert so a re-POST can't re-push directors
  alerted_at      timestamptz,
  constraint game_suspensions_pending_unresolved
    check ((status = 'pending') = (resolved_at is null)),
  constraint game_suspensions_indefinite_zero
    check (suspension_type <> 'indefinite' or games_remaining = 0),
  constraint game_suspensions_pending_has_games
    check (status <> 'pending' or suspension_type = 'indefinite' or games_remaining > 0),
  constraint game_suspensions_served_zero
    check (status <> 'served' or games_remaining = 0)
);

comment on table public.game_suspensions is
  'GS-2: suspensions filed from ScorerView on game misconduct / match penalty. status=pending is the only active state; lifecycle via serve_suspension/overturn_suspension. Public surface is team-level only (get_tournament_suspension_flags).';

-- "who is currently suspended in this tournament" (Gap 2) + FK indexes
-- (pilot-audit convention: every FK gets one).
create index if not exists game_suspensions_tournament_active_idx
  on public.game_suspensions (tournament_id, status) where status = 'pending';
create index if not exists game_suspensions_team_id_idx
  on public.game_suspensions (team_id);
create index if not exists game_suspensions_game_id_idx
  on public.game_suspensions (game_id);
create index if not exists game_suspensions_penalty_id_idx
  on public.game_suspensions (penalty_id) where penalty_id is not null;

-- One ACTIVE suspension per triggering penalty (adversarial review): two
-- devices filing the same misconduct — or a direct insert racing its own
-- queued replay under a different client id — must not double-count. Partial
-- on pending/served so an OVERTURNED filing can be re-filed at a corrected
-- length. Both write paths catch 23505 on this index and report "already
-- filed" instead of erroring (ScorerView + sync-scorekeeper-queue).
create unique index if not exists game_suspensions_penalty_active_unique
  on public.game_suspensions (penalty_id)
  where penalty_id is not null and status in ('pending', 'served');
create index if not exists game_suspensions_created_by_idx
  on public.game_suspensions (created_by) where created_by is not null;

-- 2 ── RLS ───────────────────────────────────────────────────────────────────
alter table public.game_suspensions enable row level security;

-- Read: tournament staff only (directors incl. tournament_roles directors,
-- any tournament_roles holder, and the assigned scorekeeper of any of the
-- tournament's games — they run the pre-game check in ScorerView). The
-- public/anon surface is the flags RPC below, never the raw rows.
drop policy if exists game_suspensions_staff_select on public.game_suspensions;
create policy game_suspensions_staff_select on public.game_suspensions
  for select using (
    (select auth.uid()) is not null and (
      public.is_tournament_director(tournament_id, (select auth.uid()))
      or exists (
        select 1 from public.tournament_roles tr
        where tr.tournament_id = game_suspensions.tournament_id
          and tr.user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.games g
        where g.tournament_id = game_suspensions.tournament_id
          and g.scorekeeper_id = (select auth.uid())
      )
    )
  );

-- Insert: the rink-side filing path. Mirrors sync-scorekeeper-queue's
-- authorization exactly (director / tournament_roles / assigned scorekeeper
-- OF THE GAME BEING FILED), pins the row to a real (game, team) pair in an
-- ACTIVATED tournament, and only ever creates fresh pending rows — status
-- transitions are RPC-only (no UPDATE/DELETE policies exist on purpose:
-- counting correctness lives in serve/overturn, nowhere else).
drop policy if exists game_suspensions_scorer_insert on public.game_suspensions;
create policy game_suspensions_scorer_insert on public.game_suspensions
  for insert with check (
    (select auth.uid()) is not null
    and status = 'pending'
    and resolved_at is null
    and alerted_at is null
    -- penalty link integrity: the triggering penalty (when linked) must
    -- belong to the game being filed — mirrors the replay path's check in
    -- sync-scorekeeper-queue so neither transport is looser than the other.
    and (
      penalty_id is null
      or exists (
        select 1 from public.game_penalties p
        where p.id = game_suspensions.penalty_id
          and p.game_id = game_suspensions.game_id
      )
    )
    and exists (
      select 1
      from public.games g
      join public.tournaments t on t.id = g.tournament_id
      where g.id = game_suspensions.game_id
        and g.tournament_id = game_suspensions.tournament_id
        and t.is_activated = true
        and game_suspensions.team_id in (g.home_team_id, g.away_team_id)
        and (
          g.scorekeeper_id = (select auth.uid())
          or public.is_tournament_director(t.id, (select auth.uid()))
          -- role='scorer' only: directors are covered by the RPC above, and
          -- this matches sync-scorekeeper-queue's replay authorization
          -- exactly — a future non-scoring role must not inherit filing.
          or exists (
            select 1 from public.tournament_roles tr
            where tr.tournament_id = t.id
              and tr.user_id = (select auth.uid())
              and tr.role = 'scorer'
          )
        )
    )
  );

-- 3 ── Director alert fan-out ────────────────────────────────────────────────
-- AFTER INSERT → pg_net → send-suspension-alert (the enqueue_notification_push
-- pattern; the bearer is the public anon key — the edge fn takes only an id
-- and looks everything up itself). Exception-wrapped: the alert is
-- best-effort, the FILING is the record — a pg_net hiccup (or a dev branch
-- without the extension) must never fail the insert.
create or replace function public.tg_enqueue_suspension_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url     := 'https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-suspension-alert',
      body    := jsonb_build_object('suspension_id', new.id),
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicG9vcHN5aGZ1cWNidWdyamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjkxMjQsImV4cCI6MjA5MzE0NTEyNH0.0gcGgxkyqmgjGwctCrLBBW18O1LfqFkzKBqJkvCDVpo'
      )
    );
  exception when others then
    raise warning '[game_suspensions] alert enqueue failed: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_enqueue_suspension_alert() from public;

drop trigger if exists tr_enqueue_suspension_alert on public.game_suspensions;
create trigger tr_enqueue_suspension_alert
  after insert on public.game_suspensions
  for each row when (new.status = 'pending')
  execute function public.tg_enqueue_suspension_alert();

-- 4 ── Lifecycle RPCs (the ONLY status-transition paths) ─────────────────────
-- serve_suspension: director marks one game sat out. Single atomic UPDATE:
-- decrement + conditional flip to 'served' in the same statement, guarded on
-- (pending, finite, > 0) — the row lock serializes concurrent calls, each
-- call consumes exactly one game, and the guards make over-serving or
-- reviving a resolved row impossible rather than merely unlikely.
create or replace function public.serve_suspension(p_suspension_id uuid)
returns public.game_suspensions
language plpgsql security definer set search_path = public as $$
declare
  v_tournament uuid;
  v_row public.game_suspensions;
begin
  select tournament_id into v_tournament
  from public.game_suspensions where id = p_suspension_id;
  if v_tournament is null then
    raise exception 'suspension not found';
  end if;
  if not public.is_tournament_director(v_tournament, (select auth.uid())) then
    raise exception 'only a tournament director can update suspensions'
      using errcode = '42501';
  end if;

  update public.game_suspensions
     set games_remaining = games_remaining - 1,
         status      = case when games_remaining <= 1 then 'served' else 'pending' end,
         resolved_at = case when games_remaining <= 1 then now() else null end
   where id = p_suspension_id
     and status = 'pending'
     and suspension_type <> 'indefinite'
     and games_remaining > 0
  returning * into v_row;

  if v_row.id is null then
    raise exception 'suspension cannot be served (already resolved, or indefinite — use overturn)';
  end if;
  return v_row;
end $$;
revoke all on function public.serve_suspension(uuid) from public, anon;
grant execute on function public.serve_suspension(uuid) to authenticated, service_role;

-- overturn_suspension: director voids the record. Allowed from pending OR
-- served (a mis-tapped "Mark Served" is recoverable by overturning — there is
-- deliberately no un-serve, which would reopen the counting surface).
create or replace function public.overturn_suspension(p_suspension_id uuid, p_note text default null)
returns public.game_suspensions
language plpgsql security definer set search_path = public as $$
declare
  v_tournament uuid;
  v_row public.game_suspensions;
begin
  select tournament_id into v_tournament
  from public.game_suspensions where id = p_suspension_id;
  if v_tournament is null then
    raise exception 'suspension not found';
  end if;
  if not public.is_tournament_director(v_tournament, (select auth.uid())) then
    raise exception 'only a tournament director can update suspensions'
      using errcode = '42501';
  end if;

  update public.game_suspensions
     set status = 'overturned',
         resolved_at = now(),
         notes = case
           when p_note is not null and length(trim(p_note)) > 0
             then coalesce(notes || E'\n', '') || 'Overturned: ' || trim(p_note)
           else notes
         end
   where id = p_suspension_id
     and status in ('pending', 'served')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'suspension is already overturned';
  end if;
  return v_row;
end $$;
revoke all on function public.overturn_suspension(uuid, text) from public, anon;
grant execute on function public.overturn_suspension(uuid, text) to authenticated, service_role;

-- 5 ── Public team-level flags (the standings badge) ─────────────────────────
-- SECURITY DEFINER on purpose: it reads a staff-only table but returns ONLY
-- (team_id, pending count) — no names, no jerseys, nothing that could name a
-- minor. This is the entire anon surface for suspensions.
create or replace function public.get_tournament_suspension_flags(p_tournament_id uuid)
returns table(team_id uuid, pending_count integer)
language sql stable security definer set search_path = public as $$
  select s.team_id, count(*)::int as pending_count
  from public.game_suspensions s
  where s.tournament_id = p_tournament_id and s.status = 'pending'
  group by s.team_id;
$$;
revoke all on function public.get_tournament_suspension_flags(uuid) from public;
grant execute on function public.get_tournament_suspension_flags(uuid)
  to anon, authenticated, service_role;

-- 6 ── GS-5: pre-game roster verification ────────────────────────────────────
alter table public.games
  add column if not exists rosters_verified_at timestamptz,
  add column if not exists rosters_verified_by uuid references public.profiles(id) on delete set null;

comment on column public.games.rosters_verified_at is
  'GS-5 pre-game roster check attestation (verify_game_rosters). Drives the public "Rosters verified" badge. NULL = never verified.';

create index if not exists games_rosters_verified_by_idx
  on public.games (rosters_verified_by) where rosters_verified_by is not null;

-- Adversarial review: the existing games_scorer_update RLS policy lets the
-- assigned scorekeeper update ANY games column — including a direct PostgREST
-- stamp of rosters_verified_at that skips the director-only-on-conflict rule.
-- This guard makes verify_game_rosters() the only stamping path (same
-- txn-local GUC escape pattern as Migrations E/H). UPDATE OF keeps it off the
-- hot scoring path: score/status patches never list these columns.
create or replace function public.tg_protect_rosters_verified()
returns trigger language plpgsql as $$
begin
  if (new.rosters_verified_at is distinct from old.rosters_verified_at
      or new.rosters_verified_by is distinct from old.rosters_verified_by)
     and coalesce(current_setting('rinkd.allow_rosters_verified', true), '') <> 'on' then
    raise exception 'roster verification can only be set through verify_game_rosters()'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_protect_rosters_verified() from public;

drop trigger if exists tr_protect_rosters_verified on public.games;
create trigger tr_protect_rosters_verified
  before update of rosters_verified_at, rosters_verified_by on public.games
  for each row execute function public.tg_protect_rosters_verified();

-- The server-side arbiter for the check. Conflicts are computed HERE (pending
-- suspension whose team+jersey appears on this game's lineup), never trusted
-- from the client: a clean verify by the scorer races a lineup edit that
-- dresses a suspended jersey → this recount catches it.
--   * no conflicts → director, tournament_roles holder, or the assigned
--     scorekeeper may verify (the routine "I checked the bench" attestation).
--   * conflicts    → DIRECTOR ONLY (the brief's "director must acknowledge
--     before start"). The error tells the scorer exactly that.
-- A suspension with a NULL jersey can't be jersey-matched and therefore never
-- hard-blocks; it still shows on the ScorerView card for human judgment.
create or replace function public.verify_game_rosters(p_game_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_game record;
  v_is_director boolean;
  v_is_staff boolean;
  v_conflicts integer;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select g.id, g.tournament_id, g.home_team_id, g.away_team_id,
         g.scorekeeper_id, t.is_activated
    into v_game
  from public.games g
  join public.tournaments t on t.id = g.tournament_id
  where g.id = p_game_id;
  if v_game.id is null then
    raise exception 'game not found';
  end if;
  if v_game.is_activated = false then
    raise exception 'tournament is not activated' using errcode = '42501';
  end if;

  v_is_director := public.is_tournament_director(v_game.tournament_id, v_uid);
  -- role='scorer' only (directors come via the RPC) — same authorization set
  -- as suspension filing and the sync-queue replay.
  v_is_staff := v_is_director
    or v_game.scorekeeper_id = v_uid
    or exists (
      select 1 from public.tournament_roles tr
      where tr.tournament_id = v_game.tournament_id
        and tr.user_id = v_uid
        and tr.role = 'scorer'
    );
  if not v_is_staff then
    raise exception 'only tournament staff can verify rosters' using errcode = '42501';
  end if;

  select count(*) into v_conflicts
  from public.game_suspensions s
  join public.game_lineups gl
    on gl.game_id = p_game_id
   and gl.game_source = 'tournament'
   and gl.team_id = s.team_id
   and gl.jersey_number = s.jersey_number
  where s.tournament_id = v_game.tournament_id
    and s.status = 'pending'
    and s.team_id in (v_game.home_team_id, v_game.away_team_id);

  if v_conflicts > 0 and not v_is_director then
    raise exception 'suspended players are on this lineup — a tournament director must acknowledge before the game starts'
      using errcode = '42501';
  end if;

  -- txn-local escape through tr_protect_rosters_verified (this function is
  -- the one legitimate stamping path).
  perform set_config('rinkd.allow_rosters_verified', 'on', true);
  update public.games
     set rosters_verified_at = now(), rosters_verified_by = v_uid
   where id = p_game_id;

  return jsonb_build_object('verified', true, 'conflicts', v_conflicts);
end $$;
revoke all on function public.verify_game_rosters(uuid) from public, anon;
grant execute on function public.verify_game_rosters(uuid) to authenticated, service_role;
