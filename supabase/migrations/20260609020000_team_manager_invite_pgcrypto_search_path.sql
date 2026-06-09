-- Fix: create_team_manager_invite couldn't find gen_random_bytes.
--
-- The function calls encode(gen_random_bytes(32), 'hex') to mint a magic-link
-- token, but its search_path is 'public','auth' and pgcrypto is installed in the
-- `extensions` schema — so the bare call fails at runtime:
--   ERROR: 42883: function gen_random_bytes(integer) does not exist
--
-- Effect: the team-manager MAGIC-LINK invite path (inviteTeamManagerByEmail ->
-- create_team_manager_invite) was broken whenever the invitee had no Rinkd
-- account yet. The "assign existing account" path (assign_league_team_manager)
-- was unaffected. Surfaced while building LEAGUE-MGR-1, whose twin function
-- (create_league_manager_invite) carries the same fix.
--
-- Fix = schema-qualify the call as extensions.gen_random_bytes(32). Body is
-- otherwise identical. A full DB sweep found no other SECURITY DEFINER function
-- with a bare pgcrypto call (gen_random_bytes/digest/crypt/gen_salt/hmac/pgp_*)
-- under a search_path lacking `extensions`.
--
-- Verified on prod (rolled back): create_team_manager_invite as a real
-- commissioner now returns a valid id + 64-char hex token, no error.

CREATE OR REPLACE FUNCTION public.create_team_manager_invite(p_league_id uuid, p_team_id uuid, p_email text)
RETURNS TABLE(id uuid, token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $function$
declare
  v_id    uuid;
  v_token text;
  v_email text;
  v_team_in_league boolean;
begin
  if not public.is_league_commissioner(p_league_id, (select auth.uid())) then
    raise exception 'only league commissioners can invite team managers' using errcode = '42501';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid email required' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.league_teams
    where league_id = p_league_id and team_id = p_team_id
  ) into v_team_in_league;
  if not v_team_in_league then
    raise exception 'team is not in this league' using errcode = '23503';
  end if;

  -- pgcrypto's gen_random_bytes lives in the extensions schema, which is NOT in
  -- this function's search_path, so it MUST be schema-qualified.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.team_manager_invites (league_id, team_id, email, token, invited_by)
  values (p_league_id, p_team_id, v_email, v_token, (select auth.uid()))
  returning team_manager_invites.id into v_id;

  return query select v_id, v_token;
end;
$function$;
