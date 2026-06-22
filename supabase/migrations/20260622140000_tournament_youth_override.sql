-- YOUTH-PRIVACY follow-up: director/admin override for a mis-derived
-- tournaments.is_youth classification, with a child-safety guard.
--
-- tournaments.is_youth auto-derives from division text on INSERT (12U/Squirt/...)
-- via trg_tournaments_derive_is_youth; there was no way to CORRECT a mis-derived
-- event from the UI (a manual DB flip was required). This adds:
--   • set_tournament_youth(uuid, boolean)        — the guarded RPC the UI calls.
--   • tournament_has_minor_participants(uuid)     — shared minor-detection helper.
--   • trg_tournaments_guard_youth_to_adult        — BEFORE UPDATE backstop so the
--     youth->adult guard can NEVER be bypassed by a direct table UPDATE.
-- The auto-derive-on-insert DEFAULT is unchanged; this is purely a correction tool.
--
-- The guard: relaxing youth->adult loosens tournament-level gating + discovery, so
-- it is rejected when the event has any MINOR participant (a linked profile with
-- account_type='minor', in a tournament lineup or a tournament_player_link).
-- Setting youth (more restrictive) is always allowed. The per-minor
-- is_minor_profile shield in the leaderboard RPCs still applies regardless of this
-- flag — that is the individual backstop; this flag governs EVENT-level
-- classification (discovery, default gating, leaderboard name display).
-- NOTE: invite_name "ghost" lineup rows have no profile, so their age is unknown
-- and they cannot be detected here — the is_youth flag is their only shield, so a
-- director setting a youth-signal'd event to Adult is asserting it is truly adult.

-- Shared minor-detection. Internal helper: only the SECURITY DEFINER RPC + trigger
-- call it (they run as the owner), so it is not exposed to client roles — knowing
-- whether an arbitrary event has minors is itself minor-privacy-adjacent.
create or replace function public.tournament_has_minor_participants(p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from public.game_lineups gl
    join public.games g on g.id = gl.game_id
    where g.tournament_id = p_tournament_id
      and gl.game_source = 'tournament'
      and public.is_minor_profile(coalesce(gl.player_id, gl.user_id))
  ) or exists (
    select 1 from public.tournament_player_links tpl
    where tpl.tournament_id = p_tournament_id
      and public.is_minor_profile(tpl.user_id)
  );
$$;
revoke all on function public.tournament_has_minor_participants(uuid) from public, anon, authenticated;

-- Guarded override RPC — the UI's only path. Authorization mirrors can_view_lineup:
-- the tournament director (incl. extra directors via tournament_roles) or a
-- platform admin. Keys off auth.uid() via current_profile_id().
create or replace function public.set_tournament_youth(p_tournament_id uuid, p_is_youth boolean)
returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_pid uuid := public.current_profile_id();
begin
  if v_pid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if p_is_youth is null then
    raise exception 'Audience is required.' using errcode = '22004';
  end if;
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if not (public.is_tournament_director(p_tournament_id, v_pid) or public.current_user_is_admin()) then
    raise exception 'Only the tournament director or an admin can change a tournament''s audience.'
      using errcode = '42501';
  end if;
  -- child-safety guard: never expose minors by relaxing to Adult (trigger backstops this).
  if p_is_youth = false and public.tournament_has_minor_participants(p_tournament_id) then
    raise exception 'This event has minor participants and can''t be set to Adult.'
      using errcode = 'P0001', hint = 'has_minor_participants';
  end if;
  update public.tournaments set is_youth = p_is_youth where id = p_tournament_id;
  -- Audit trail: no dedicated audit table exists; this is durable in Postgres logs.
  raise log 'set_tournament_youth: tournament=% is_youth=% by_profile=% at=%',
    p_tournament_id, p_is_youth, v_pid, now();
  return p_is_youth;
end;
$$;
revoke all on function public.set_tournament_youth(uuid, boolean) from public, anon;
grant execute on function public.set_tournament_youth(uuid, boolean) to authenticated;

-- Hard backstop: block youth->adult on ANY path (direct UPDATE, future code, admin
-- tool) when the event has minor participants, so the RPC guard cannot be bypassed.
-- Fires only when is_youth actually changes (the WHEN clause), so normal tournament
-- edits (name/dates/settings) that leave is_youth untouched are never affected.
create or replace function public.tg_tournaments_guard_youth_to_adult()
returns trigger
language plpgsql set search_path to 'public'
as $$
begin
  if coalesce(old.is_youth, false) and not coalesce(new.is_youth, false)
     and public.tournament_has_minor_participants(new.id) then
    raise exception 'This event has minor participants and can''t be set to Adult.'
      using errcode = 'P0001', hint = 'has_minor_participants';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tournaments_guard_youth_to_adult on public.tournaments;
create trigger trg_tournaments_guard_youth_to_adult
  before update on public.tournaments
  for each row
  when (coalesce(old.is_youth, false) is distinct from coalesce(new.is_youth, false))
  execute function public.tg_tournaments_guard_youth_to_adult();
