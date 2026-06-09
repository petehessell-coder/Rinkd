-- LEAGUE-MGR-1 — league-level "manager" role (operational, non-destructive) + magic-link invites.
--
-- Closes the gap where onboarding a league director required a manual
-- league_roles role='commissioner' INSERT (which grants delete-the-league power).
-- A manager runs the league day-to-day (teams, schedule, divisions, playoffs,
-- feed/gallery moderation, join-requests) but CANNOT change settings/branding/
-- billing, (de)activate, delete the league, or manage staff (no escalation).
--
-- SAFETY: additive + permission-broadening ONLY. is_league_manager() ⊇
-- is_league_commissioner(), and no 'manager' rows exist on apply, so no existing
-- user's access changes. The BLPA pilot is a tournament — untouched. Mirrors the
-- shipped team-manager invite pattern (create/accept_team_manager_invite).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Allow the 'manager' role
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.league_roles DROP CONSTRAINT league_roles_role_check;
ALTER TABLE public.league_roles ADD CONSTRAINT league_roles_role_check
  CHECK (role = ANY (ARRAY['commissioner'::text, 'manager'::text, 'scorer'::text, 'viewer'::text]));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. is_league_manager = "manager-or-above" (founder / commissioner / manager).
--    Operational policies call THIS; sensitive ones keep calling is_league_commissioner.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_league_manager(p_league_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
  select public.is_league_commissioner(p_league_id, p_user_id)
      or exists (
        select 1 from public.league_roles lr
        where lr.league_id = p_league_id and lr.user_id = p_user_id and lr.role = 'manager'
      );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Repoint OPERATIONAL RLS policies: is_league_commissioner -> is_league_manager.
--    (commissioner stays covered because is_league_manager includes it.)
-- ───────────────────────────────────────────────────────────────────────────

-- league_divisions (ALL)
DROP POLICY IF EXISTS league_divisions_write ON public.league_divisions;
CREATE POLICY league_divisions_write ON public.league_divisions FOR ALL TO authenticated
  USING (public.is_league_manager(league_id, (select auth.uid())))
  WITH CHECK (public.is_league_manager(league_id, (select auth.uid())));

-- league_teams (UPDATE, DELETE)
DROP POLICY IF EXISTS league_teams_update ON public.league_teams;
CREATE POLICY league_teams_update ON public.league_teams FOR UPDATE TO authenticated
  USING (public.is_league_manager(league_id, (select auth.uid())))
  WITH CHECK (public.is_league_manager(league_id, (select auth.uid())));

DROP POLICY IF EXISTS league_teams_delete ON public.league_teams;
CREATE POLICY league_teams_delete ON public.league_teams FOR DELETE TO authenticated
  USING (public.is_league_manager(league_id, (select auth.uid())));

-- league_games (INSERT, DELETE, UPDATE) — UPDATE preserves the scorer/scorekeeper
-- branches and the is_activated gate; only the commissioner check widens to manager.
DROP POLICY IF EXISTS league_games_insert ON public.league_games;
CREATE POLICY league_games_insert ON public.league_games FOR INSERT
  WITH CHECK (public.is_league_manager(league_id, (select auth.uid())));

DROP POLICY IF EXISTS league_games_delete ON public.league_games;
CREATE POLICY league_games_delete ON public.league_games FOR DELETE
  USING (public.is_league_manager(league_id, (select auth.uid())));

DROP POLICY IF EXISTS league_games_update ON public.league_games;
CREATE POLICY league_games_update ON public.league_games FOR UPDATE
  USING (
    (public.is_league_manager(league_id, (select auth.uid()))
     OR (scorekeeper_id IS NOT NULL AND scorekeeper_id = (select auth.uid()))
     OR EXISTS (select 1 from public.league_roles lr
                where lr.league_id = league_games.league_id and lr.user_id = (select auth.uid()) and lr.role = 'scorer'))
    AND EXISTS (select 1 from public.leagues l where l.id = league_games.league_id and l.is_activated = true)
  )
  WITH CHECK (
    (public.is_league_manager(league_id, (select auth.uid()))
     OR (scorekeeper_id IS NOT NULL AND scorekeeper_id = (select auth.uid()))
     OR EXISTS (select 1 from public.league_roles lr
                where lr.league_id = league_games.league_id and lr.user_id = (select auth.uid()) and lr.role = 'scorer'))
    AND EXISTS (select 1 from public.leagues l where l.id = league_games.league_id and l.is_activated = true)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 4. "League authority over a team" now includes managers (powers team_join_requests
--    read/update + approve_join_request roster-claim). Additive — only grants.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_league_commissioner_of_team(p_team_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
  select exists (
    select 1
    from public.league_teams lt
    join public.leagues l on l.id = lt.league_id
    where lt.team_id = p_team_id
      and (
        l.commissioner_id = p_user_id
        or exists (
          select 1 from public.league_roles lr
          where lr.league_id = l.id and lr.user_id = p_user_id
            and lr.role in ('commissioner', 'manager')
        )
      )
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Feed / gallery / comment moderation: league managers can hide in their league.
--    (Only the league branch widens to is_league_manager; rest unchanged.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_post_hidden(p_post_id uuid, p_hidden boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament uuid; v_league uuid; v_team uuid;
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode = '28000'; END IF;

  SELECT tournament_id, league_id, team_id INTO v_tournament, v_league, v_team
  FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    v_allowed := true;
  ELSIF v_tournament IS NOT NULL AND public.is_tournament_director(v_tournament, v_uid) THEN
    v_allowed := true;
  ELSIF v_league IS NOT NULL AND public.is_league_manager(v_league, v_uid) THEN
    v_allowed := true;
  ELSIF v_team IS NOT NULL AND public.is_team_manager(v_team, v_uid) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;

  UPDATE public.posts
  SET is_hidden = p_hidden,
      hidden_by = CASE WHEN p_hidden THEN v_uid ELSE NULL END,
      hidden_at = CASE WHEN p_hidden THEN now() ELSE NULL END
  WHERE id = p_post_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_comment_hidden(p_comment_id uuid, p_hidden boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tournament uuid; v_league uuid; v_team uuid;
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode = '28000'; END IF;

  SELECT p.tournament_id, p.league_id, p.team_id INTO v_tournament, v_league, v_team
  FROM public.comments c JOIN public.posts p ON p.id = c.post_id
  WHERE c.id = p_comment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'comment_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
    v_allowed := true;
  ELSIF v_tournament IS NOT NULL AND public.is_tournament_director(v_tournament, v_uid) THEN
    v_allowed := true;
  ELSIF v_league IS NOT NULL AND public.is_league_manager(v_league, v_uid) THEN
    v_allowed := true;
  ELSIF v_team IS NOT NULL AND public.is_team_manager(v_team, v_uid) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;

  UPDATE public.comments SET is_hidden = p_hidden WHERE id = p_comment_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Direct assign / remove (commissioner-gated; never touches a commissioner row)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_league_manager(p_league_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
begin
  if not public.is_league_commissioner(p_league_id, (select auth.uid())) then
    raise exception 'only league commissioners can add managers' using errcode = '42501';
  end if;
  -- Upsert to 'manager' but never DOWNGRADE an existing commissioner row.
  insert into public.league_roles (league_id, user_id, role)
  values (p_league_id, p_user_id, 'manager')
  on conflict (league_id, user_id) do update set role = 'manager'
    where league_roles.role <> 'commissioner';
end;
$$;

CREATE OR REPLACE FUNCTION public.remove_league_manager(p_league_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
begin
  if not public.is_league_commissioner(p_league_id, (select auth.uid())) then
    raise exception 'only league commissioners can remove managers' using errcode = '42501';
  end if;
  -- Only ever removes a 'manager' row — a commissioner cannot be demoted via this.
  delete from public.league_roles
  where league_id = p_league_id and user_id = p_user_id and role = 'manager';
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Magic-link invites (mirror team_manager_invites: RLS-on, RPC-only access)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.league_manager_invites (
  id                  uuid primary key default gen_random_uuid(),
  league_id           uuid not null references public.leagues(id) on delete cascade,
  email               text not null,
  token               text not null unique,
  invited_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '14 days'),
  consumed_at         timestamptz,
  consumed_by_user_id uuid references auth.users(id) on delete set null
);
CREATE INDEX idx_league_manager_invites_pending ON public.league_manager_invites (league_id) WHERE consumed_at IS NULL;
CREATE INDEX idx_league_manager_invites_token ON public.league_manager_invites (token);
ALTER TABLE public.league_manager_invites ENABLE ROW LEVEL SECURITY;
-- No direct policies — all access flows through the SECURITY DEFINER RPCs below.

CREATE OR REPLACE FUNCTION public.create_league_manager_invite(p_league_id uuid, p_email text)
RETURNS TABLE(id uuid, token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare v_id uuid; v_token text; v_email text;
begin
  if not public.is_league_commissioner(p_league_id, (select auth.uid())) then
    raise exception 'only league commissioners can invite managers' using errcode = '42501';
  end if;
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid email required' using errcode = '22023';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.league_manager_invites (league_id, email, token, invited_by)
  values (p_league_id, v_email, v_token, (select auth.uid()))
  returning league_manager_invites.id into v_id;
  return query select v_id, v_token;
end;
$$;

CREATE OR REPLACE FUNCTION public.accept_league_manager_invite(p_token text)
RETURNS TABLE(league_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare v_invite record; v_uid uuid; v_email text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'sign in to accept the invite' using errcode = '42501'; end if;

  select * into v_invite from public.league_manager_invites where token = p_token limit 1;
  if v_invite.id is null then raise exception 'invite not found' using errcode = '42704'; end if;
  if v_invite.consumed_at is not null then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_invite.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;

  -- Require the email match (auth.users.email; profiles.email may lag for new signups).
  select lower(coalesce(u.email, '')) into v_email from auth.users u where u.id = v_uid;
  if v_email <> v_invite.email then
    raise exception 'invite was sent to %, you''re signed in as %', v_invite.email, v_email using errcode = '42501';
  end if;

  -- Consume first so a concurrent retry can't double-grant.
  update public.league_manager_invites set consumed_at = now(), consumed_by_user_id = v_uid
  where id = v_invite.id and consumed_at is null;
  if not found then raise exception 'invite was just used' using errcode = '22023'; end if;

  -- Grant manager inline (the accepter isn't a commissioner, so bypass that gate);
  -- never downgrade a commissioner.
  insert into public.league_roles (league_id, user_id, role)
  values (v_invite.league_id, v_uid, 'manager')
  on conflict (league_id, user_id) do update set role = 'manager'
    where league_roles.role <> 'commissioner';

  return query select v_invite.league_id;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Staff listing + invite revoke for the commissioner Staff UI
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_league_staff(p_league_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare result jsonb;
begin
  if not public.is_league_commissioner(p_league_id, (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', lr.user_id, 'name', p.name, 'handle', p.handle,
               'avatar_color', p.avatar_color, 'avatar_initials', p.avatar_initials) order by p.name)
      from public.league_roles lr join public.profiles p on p.id = lr.user_id
      where lr.league_id = p_league_id and lr.role = 'manager'), '[]'::jsonb),
    'pending_invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at desc)
      from public.league_manager_invites i
      where i.league_id = p_league_id and i.consumed_at is null and i.expires_at > now()), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

CREATE OR REPLACE FUNCTION public.revoke_league_manager_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare v_league uuid;
begin
  select league_id into v_league from public.league_manager_invites where id = p_invite_id;
  if v_league is null then raise exception 'invite not found' using errcode = '42704'; end if;
  if not public.is_league_commissioner(v_league, (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.league_manager_invites where id = p_invite_id and consumed_at is null;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. Grants
-- ───────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.is_league_manager(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_league_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_league_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_league_manager_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_league_manager_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_league_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_league_manager_invite(uuid) TO authenticated;
