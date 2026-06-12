-- ============================================================================
-- LRS-1 Phase 1 / Migration H — line combos + resolved identity + minor gate
-- Branch: feature/lineup-roster-subs (stacks on GS-1 offline mode)
--
-- ⚠️  APPLY POST-PILOT, after REG Migrations A–G (runbook §4). Hard dependency:
--     REG Migration A (profiles.account_type) + E (is_minor_profile). The DO
--     block below fails the apply loudly if E is missing — better than a
--     trigger that breaks every lineup save at runtime.
--
-- Three additions, all additive (existing lineups render byte-identical):
--
-- 1. game_lineups.player_id — the RESOLVED identity (profiles.id) of the
--    person this lineup row is for. Distinct from user_id on purpose:
--    user_id = "identity known at save time" (and what RSVPs/legacy stats
--    key on); player_id = "identity attributed by the GS-5 resolver", which
--    may arrive later (jersey-matched ghosts) and must stay separately
--    reversible if a resolution turns out wrong. Stats read
--    coalesce(player_id, user_id).
--
-- 2. game_lineups.line — line combinations. Semantics by position group:
--    forwards: L1–L4 · defense: D-pair 1–3 · goalies: 1 = starter, 2 = backup.
--    NULL = dressed but unassigned (line-setting is optional).
--
-- 3. The minor-bind gate (the cluster's non-negotiable). Migration E gates
--    team_members so every minor ROSTER bind goes through a consented path —
--    but game_lineups rows accept any user_id/player_id without a
--    team_members row (that's how day-of subs work), so an ungated lineup
--    insert would be a minor-bind backdoor onto a public game sheet.
--    tg_block_minor_lineup_bind closes it: a minor profile may only be
--    referenced by a lineup row when that minor already holds a CONSENTED
--    roster spot (a team_members row, which Migration E guarantees was
--    consent-gated) on the game's backing team. game_source mapping:
--      'team'       → game_lineups.team_id IS teams.id
--      'league'     → league_teams(team_id) → teams.id
--      'tournament' → tournament_teams has no backing teams row → FAIL CLOSED
--                     for minors (adults unaffected). A future consented
--                     tournament-roster flow can opt out per-transaction with
--                     SET LOCAL rinkd.allow_minor_roster = 'on' (same GUC as
--                     Migration E's roster gate).
--    Day-of subs (Phase 3): a minor in a SUB POOL is anchored to the pool's
--    team, not the playing team — so pulling a minor sub into another team's
--    lineup is blocked by design until a consented sub path exists. Adult
--    subs are unaffected.
-- ============================================================================

-- 0 ── Loud dependency check ─────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.is_minor_profile(uuid)') is null then
    raise exception 'LRS-1 Migration H requires REG Migration E (public.is_minor_profile). Apply REG A-G first (runbook §4).';
  end if;
end $$;

-- 1 ── Columns ───────────────────────────────────────────────────────────────
alter table public.game_lineups
  add column if not exists player_id uuid references public.profiles(id) on delete set null,
  add column if not exists line smallint check (line between 1 and 4);

comment on column public.game_lineups.player_id is
  'Resolved identity (profiles.id) — set at save time from the roster, or later by resolve_lineup_players(). Stats read coalesce(player_id, user_id).';
comment on column public.game_lineups.line is
  'Line combination: forwards L1-L4, defense D-pair 1-3, goalies 1=starter/2=backup. NULL = dressed, no line assigned.';

create index if not exists game_lineups_player_id_idx
  on public.game_lineups (player_id) where player_id is not null;

-- 2 ── Backing-team mapping ──────────────────────────────────────────────────
-- game_lineups.team_id is a league_teams.id, tournament_teams.id, or teams.id
-- depending on game_source. Resolve it to the real teams.id (NULL when there
-- is none — tournament teams are nameplate-only, no backing roster).
create or replace function public.lineup_backing_team_id(p_game_source text, p_team_id uuid)
returns uuid language sql stable set search_path = public as $$
  select case
    when p_game_source = 'team'   then p_team_id
    when p_game_source = 'league' then (select lt.team_id from public.league_teams lt where lt.id = p_team_id)
    else null
  end;
$$;
revoke all on function public.lineup_backing_team_id(text, uuid) from public;
grant execute on function public.lineup_backing_team_id(text, uuid) to authenticated, service_role;

-- 3 ── Minor-bind gate ───────────────────────────────────────────────────────
-- SECURITY DEFINER like Migration E's roster gate: it must read team_members/
-- profiles regardless of the caller's RLS view. Fires on INSERT and on UPDATE
-- only when an identity column actually CHANGES onto a minor (editing
-- jersey/line on an existing legitimate minor row must keep working).
--
-- Two conditions, both required, for a minor row:
--   1. CONSENT — the minor holds a team_members row on the backing team.
--      No status filter on purpose: Migration E guarantees EVERY minor
--      team_members row (active, pending, or removed) originated from a
--      consented path, and consent-to-be-named doesn't expire when a roster
--      spot is deactivated. (The resolver below is stricter — active only —
--      because attribution accuracy is a different question than consent.)
--   2. PARTICIPATION — the backing team actually plays in new.game_id.
--      Without this, any authed caller could pick a (game_source, team_id)
--      pair the minor IS anchored to and attach them to an ARBITRARY game
--      (inflating their public GP and naming them on game sheets for games
--      their team never played).
create or replace function public.tg_block_minor_lineup_bind()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_backing   uuid;
  v_has_minor boolean := false;
begin
  if coalesce(current_setting('rinkd.allow_minor_roster', true), '') = 'on' then
    return new;
  end if;
  foreach v_id in array array_remove(array[
    case when new.user_id   is not null and (tg_op = 'INSERT' or new.user_id   is distinct from old.user_id)   then new.user_id   end,
    case when new.player_id is not null and (tg_op = 'INSERT' or new.player_id is distinct from old.player_id) then new.player_id end
  ], null)
  loop
    if public.is_minor_profile(v_id) then
      v_has_minor := true;
      v_backing := public.lineup_backing_team_id(new.game_source, new.team_id);
      if v_backing is null or not exists (
        select 1 from public.team_members tm
        where tm.team_id = v_backing and tm.user_id = v_id
      ) then
        raise exception 'a minor can only appear on a game lineup through a consented roster spot'
          using errcode = '42501';
      end if;
    end if;
  end loop;

  -- Participation: only checked when a minor is being bound (adult/ghost
  -- rows keep today's semantics untouched).
  if v_has_minor then
    if new.game_source = 'league' then
      if not exists (
        select 1 from public.league_games g
        where g.id = new.game_id and new.team_id in (g.home_team_id, g.away_team_id)
      ) then
        raise exception 'a minor can only be added to a game their team plays in'
          using errcode = '42501';
      end if;
    elsif new.game_source = 'team' then
      if not exists (
        select 1 from public.team_games tg
        where tg.id = new.game_id and tg.team_id = new.team_id
      ) then
        raise exception 'a minor can only be added to a game their team plays in'
          using errcode = '42501';
      end if;
    end if;
    -- 'tournament' is unreachable here: backing is NULL → already raised.
  end if;
  return new;
end;
$$;

drop trigger if exists tr_block_minor_lineup_bind on public.game_lineups;
create trigger tr_block_minor_lineup_bind
  before insert or update of user_id, player_id on public.game_lineups
  for each row execute function public.tg_block_minor_lineup_bind();

-- 4 ── Transactional lineup replace ──────────────────────────────────────────
-- The client's old save path was DELETE (commits) then bulk INSERT — any
-- insert failure (duplicate jerseys hitting the UNIQUE, or the minor gate)
-- left the lineup WIPED. One RPC = one transaction: a failed insert rolls the
-- delete back and the saved lineup survives. SECURITY INVOKER on purpose —
-- the caller's RLS (and the gate trigger) apply exactly as they would to
-- direct table writes; this changes atomicity, not authority.
create or replace function public.set_lineup(
  p_game_id uuid, p_game_source text, p_team_id uuid, p_players jsonb
) returns setof public.game_lineups
language plpgsql security invoker set search_path = public as $$
declare
  v_creator uuid;
begin
  if p_game_id is null or p_team_id is null
     or p_game_source is null or p_game_source not in ('league', 'tournament', 'team') then
    raise exception 'invalid lineup context';
  end if;
  v_creator := public.current_profile_id();
  if v_creator is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  delete from public.game_lineups
   where game_id = p_game_id and team_id = p_team_id;

  return query
  insert into public.game_lineups
    (game_id, game_source, team_id, user_id, player_id, invite_name, jersey_number,
     position, is_captain, is_alternate, is_goalie, is_starter, line, created_by)
  select
    p_game_id, p_game_source, p_team_id,
    nullif(p->>'user_id', '')::uuid,
    nullif(p->>'player_id', '')::uuid,
    nullif(p->>'invite_name', ''),
    (p->>'jersey_number')::int,
    nullif(p->>'position', ''),
    coalesce((p->>'is_captain')::boolean, false),
    coalesce((p->>'is_alternate')::boolean, false),
    coalesce((p->>'is_goalie')::boolean, false),
    coalesce((p->>'is_starter')::boolean, true),
    (p->>'line')::smallint,
    v_creator
  from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) as p
  returning *;
end;
$$;
revoke all on function public.set_lineup(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.set_lineup(uuid, text, uuid, jsonb) to authenticated, service_role;

-- 5 ── Resolver RPC (GS-5, re-pointed at the REG roster) ─────────────────────
-- Resolves one game's lineup rows to profiles:
--   (a) user_id known at save time → copy to player_id.
--   (b) ghost rows (user_id NULL) → jersey-match against the backing team's
--       ACTIVE roster; a jersey worn by more than one distinct rostered
--       identity is a COLLISION and stays unresolved (fail closed — never
--       guess who scored).
-- SECURITY INVOKER: runs under the caller's RLS (game_lineups update policy),
-- and the minor gate above still applies. The is_minor_profile predicate in
-- (a) mirrors the gate so an unanchored minor row is SKIPPED rather than
-- aborting the whole resolution.
create or replace function public.resolve_lineup_players(p_game_id uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_a integer := 0;
  v_b integer := 0;
begin
  update public.game_lineups gl
     set player_id = gl.user_id
   where gl.game_id = p_game_id
     and gl.player_id is null
     and gl.user_id is not null
     and (
       not public.is_minor_profile(gl.user_id)
       or exists (
         select 1 from public.team_members tm
         where tm.team_id = public.lineup_backing_team_id(gl.game_source, gl.team_id)
           and tm.user_id = gl.user_id
       )
     );
  get diagnostics v_a = row_count;

  with candidates as (
    select gl.id as gl_id, tm.user_id as resolved
    from public.game_lineups gl
    join public.team_members tm
      on tm.team_id = public.lineup_backing_team_id(gl.game_source, gl.team_id)
     and tm.jersey_number = gl.jersey_number
     and tm.user_id is not null
     and tm.status = 'active'
    where gl.game_id = p_game_id
      and gl.player_id is null
      and gl.user_id is null
      and gl.jersey_number is not null
  ),
  unambiguous as (
    select gl_id, min(resolved::text)::uuid as resolved
    from candidates
    group by gl_id
    having count(distinct resolved) = 1
  )
  update public.game_lineups gl
     set player_id = u.resolved
    from unambiguous u
   where gl.id = u.gl_id;
  get diagnostics v_b = row_count;

  return v_a + v_b;
end;
$$;
revoke all on function public.resolve_lineup_players(uuid) from public, anon;
grant execute on function public.resolve_lineup_players(uuid) to authenticated, service_role;

-- 6 ── One-time backfill ─────────────────────────────────────────────────────
-- Trusted migration context → bypass the gate for the duration of this
-- transaction (set_config(..., true) is txn-local). (a) is safe: existing
-- user_id values predate this gate and minors among them (Henry, migrated by
-- REG Migration D) hold consented roster spots. (b) only resolves FROM
-- team_members, so the anchor exists by construction.
do $$
begin
  perform set_config('rinkd.allow_minor_roster', 'on', true);

  update public.game_lineups
     set player_id = user_id
   where player_id is null and user_id is not null;

  with candidates as (
    select gl.id as gl_id, tm.user_id as resolved
    from public.game_lineups gl
    join public.team_members tm
      on tm.team_id = public.lineup_backing_team_id(gl.game_source, gl.team_id)
     and tm.jersey_number = gl.jersey_number
     and tm.user_id is not null
     and tm.status = 'active'
    where gl.player_id is null
      and gl.user_id is null
      and gl.jersey_number is not null
  ),
  unambiguous as (
    select gl_id, min(resolved::text)::uuid as resolved
    from candidates
    group by gl_id
    having count(distinct resolved) = 1
  )
  update public.game_lineups gl
     set player_id = u.resolved
    from unambiguous u
   where gl.id = u.gl_id;
end $$;
