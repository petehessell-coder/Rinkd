-- approve_join_request(p_request_id, p_member_id): manager/commissioner approves
-- a join request, optionally BINDING the requester onto an existing unclaimed
-- (ghost/imported) roster slot instead of inserting a duplicate. Fail-closed:
-- hard auth guard (is_team_manager OR is_league_commissioner_of_team), dedups.
-- Lets imported HockeyShift rosters convert ghost slots -> real Rinkd users.
-- Already applied to prod via MCP on 2026-06-07.
create or replace function public.approve_join_request(p_request_id uuid, p_member_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  existing_id uuid;
begin
  select id, team_id, user_id, status into r
    from team_join_requests where id = p_request_id;
  if not found then raise exception 'join request not found'; end if;
  if r.status <> 'pending' then raise exception 'join request is not pending'; end if;

  if not (public.is_team_manager(r.team_id, auth.uid())
          or public.is_league_commissioner_of_team(r.team_id, auth.uid())) then
    raise exception 'not authorized to approve requests for this team';
  end if;

  -- Dedup: if this user already has a membership on the team, never create another.
  select id into existing_id from team_members
    where team_id = r.team_id and user_id = r.user_id limit 1;

  if existing_id is null then
    if p_member_id is not null then
      -- Bind the requester onto an existing unclaimed ghost roster slot.
      update team_members
        set user_id = r.user_id, status = 'active', joined_at = now()
        where id = p_member_id and team_id = r.team_id and user_id is null;
      if not found then
        raise exception 'roster slot is unavailable or already claimed';
      end if;
    else
      -- No slot chosen: create a fresh membership (legacy behaviour).
      insert into team_members (team_id, user_id, role, status, joined_at)
        values (r.team_id, r.user_id, 'player', 'active', now());
    end if;
  end if;

  update team_join_requests set status = 'approved' where id = p_request_id;
end;
$$;

grant execute on function public.approve_join_request(uuid, uuid) to authenticated;
