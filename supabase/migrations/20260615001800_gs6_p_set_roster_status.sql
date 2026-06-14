-- ============================================================================
-- GS-6 Migration P — set_lineup_roster_status(): flip a player present/scratched
-- Branch: feature/gs-6-compliance (follows Migration O)
--
-- Lets the pre-game COACH sign-off screen mark a dressed player as scratched
-- (the last-minute "didn't show / sick" case, incl. one of two goalies) right
-- before signing — no trip to the Set Lineup screen. Writes game_lineups
-- .roster_status (added in Migration O); scratched players then print
-- struck-through on the compliant scoresheet (USAH "absent crossed out") and,
-- for goalies, a scratched goalie leaves the other as the sole dressed
-- goalie so the GOALIE-1 in-net timeline resolves automatically.
--
-- Additive: one new SECURITY DEFINER function, staff-authorized exactly like
-- record_game_signoff (the scorer's device operator). No schema change.
-- ============================================================================

create or replace function public.set_lineup_roster_status(
  p_lineup_id uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_src text;
  v_gid uuid;
  v_is_staff boolean := false;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_status not in ('dressed','scratched','injured','suspended') then
    raise exception 'invalid roster status';
  end if;

  select gl.game_source, gl.game_id into v_src, v_gid
  from public.game_lineups gl where gl.id = p_lineup_id;
  if v_gid is null then
    raise exception 'lineup row not found';
  end if;

  if v_src = 'tournament' then
    select (public.is_tournament_director(g.tournament_id, v_uid)
            or g.scorekeeper_id = v_uid
            or exists (select 1 from public.tournament_roles tr
                       where tr.tournament_id = g.tournament_id
                         and tr.user_id = v_uid and tr.role = 'scorer'))
      into v_is_staff
    from public.games g where g.id = v_gid;
  elsif v_src = 'league' then
    select (public.is_league_commissioner(lg.league_id, v_uid)
            or public.is_league_manager(lg.league_id, v_uid)
            or lg.scorekeeper_id = v_uid)
      into v_is_staff
    from public.league_games lg where lg.id = v_gid;
  else
    raise exception 'unsupported game_source';
  end if;

  if not coalesce(v_is_staff, false) then
    raise exception 'only game staff can change the roster' using errcode = '42501';
  end if;

  update public.game_lineups set roster_status = p_status where id = p_lineup_id;
end $$;

revoke all on function public.set_lineup_roster_status(uuid, text) from public, anon;
grant execute on function public.set_lineup_roster_status(uuid, text) to authenticated, service_role;
