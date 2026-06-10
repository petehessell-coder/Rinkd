-- ============================================================================
-- REG-1 Phase 1 / Migration B — full RLS migration: auth.uid() → current_profile_id()
-- Branch: feature/reg-1-identity-spine
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.1 ("RLS migration" — the
-- heaviest, highest-risk part of the build; runs as its OWN migration).
--
-- ⚠️  APPLY POST-PILOT, after Migration A (current_profile_id() must exist).
--
-- Strategy (drift-safe by design):
--   Other branches (e.g. feature/multi-division) may merge before this applies.
--   A frozen dump of today's 138 policies / 28 functions would silently clobber
--   anything that changed in between. Instead this migration:
--     1. HAND-rewrites the six cases a blanket transform would get wrong
--        (listed below, each with the reason).
--     2. Mechanically transforms every remaining public-schema policy and
--        function AT APPLY TIME via the two DO-blocks in §4/§5 — the transform
--        is the thing under review, not 1,100 generated lines.
--     3. ASSERTS the end state: zero auth.uid() references left in public
--        schema outside the explicit allowlist; anything unexpected aborts the
--        whole migration (it runs in one transaction).
--   A full preview of the generated DDL as of Jun 10 is committed alongside
--   this PR at docs/reg1_rls_rewrite_preview.sql for line-by-line review.
--
-- Replacement rules (preserve the initplan optimization from 20260605130000):
--   "( SELECT auth.uid() AS uid)"  →  "( SELECT public.current_profile_id() AS uid)"
--   bare "auth.uid()" in policies  →  "( SELECT public.current_profile_id() )"
--   bare "auth.uid()" in fn bodies →  "public.current_profile_id()"
--
-- Deliberately NOT touched:
--   • storage-schema policies — storage.objects.owner IS an auth uid (set by
--     the Storage API), so auth.uid() remains correct there.
--   • auth/realtime schemas.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 ── HAND-REWRITE: profiles' own policies (the signup bootstrap)
-- current_profile_id() is NULL until the profile row exists, so the INSERT
-- policy would deadlock signup if it routed through the helper. Profiles
-- policies key on auth_user_id = auth.uid() instead — the one place in public
-- schema where the raw auth uid is the right-hand side.
-- ────────────────────────────────────────────────────────────────────────────

-- SELECT stays world-readable (PII is column-grant-protected since 20260605131000).

DROP POLICY "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (( SELECT auth.uid() ) = auth_user_id);

DROP POLICY "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  AS PERMISSIVE FOR UPDATE TO public
  USING (( SELECT auth.uid() ) = auth_user_id)
  WITH CHECK (( SELECT auth.uid() ) = auth_user_id);
-- (Explicit WITH CHECK: a user can never re-home their row to another auth
--  identity or orphan it to NULL. Minor profiles — auth_user_id IS NULL — are
--  not updatable by anyone through this policy; guardian editing arrives as an
--  additional policy in Migration C.)

-- ────────────────────────────────────────────────────────────────────────────
-- 2 ── HAND-REWRITE: the two invite-accept RPCs (they mix BOTH id types)
-- auth.uid() is used (a) to look up the signer's email in auth.users — that is
-- genuinely an AUTH uid and must stay — and (b) to write team_members /
-- league_roles / consumed_by_user_id — those are PROFILE ids. A blanket
-- replace would silently break (a) the day a profile id diverges from its
-- auth uid. Split into v_auth_uid / v_profile_id.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accept_team_manager_invite(p_token text)
 RETURNS TABLE(league_id uuid, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_invite     record;
  v_auth_uid   uuid;
  v_profile_id uuid;
  v_email      text;
begin
  v_auth_uid   := (select auth.uid());
  v_profile_id := (select public.current_profile_id());
  if v_auth_uid is null or v_profile_id is null then
    raise exception 'sign in to accept the invite' using errcode = '42501';
  end if;

  select * into v_invite
  from public.team_manager_invites
  where token = p_token
  limit 1;
  if v_invite.id is null then
    raise exception 'invite not found' using errcode = '42704';
  end if;
  if v_invite.consumed_at is not null then
    raise exception 'invite already used' using errcode = '22023';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;

  -- Require the email match — magic links don't auto-grant cross-account.
  -- Pulls from auth.users.email since profiles.email may not be present
  -- for very-new signups before profile creation completes.
  select lower(coalesce(u.email, '')) into v_email
  from auth.users u where u.id = v_auth_uid;
  if v_email <> v_invite.email then
    raise exception 'invite was sent to %, you''re signed in as %', v_invite.email, v_email using errcode = '42501';
  end if;

  -- Mark consumed first so a concurrent retry can't double-grant.
  update public.team_manager_invites
  set consumed_at = now(), consumed_by_user_id = v_profile_id
  where id = v_invite.id and consumed_at is null;
  if not found then
    raise exception 'invite was just used' using errcode = '22023';
  end if;

  -- Grant management directly (bypass is_league_commissioner gate that
  -- assign_league_team_manager has — the user accepting an invite isn't
  -- a commissioner). Mirror that function's body inline.
  insert into public.team_members (team_id, user_id, role)
  values (v_invite.team_id, v_profile_id, 'manager')
  on conflict (team_id, user_id) do update set role = 'manager';

  update public.teams
  set manager_id = v_profile_id
  where id = v_invite.team_id and manager_id is null;

  return query select v_invite.league_id, v_invite.team_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_league_manager_invite(p_token text)
 RETURNS TABLE(league_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
declare v_invite record; v_auth_uid uuid; v_profile_id uuid; v_email text;
begin
  v_auth_uid   := (select auth.uid());
  v_profile_id := (select public.current_profile_id());
  if v_auth_uid is null or v_profile_id is null then raise exception 'sign in to accept the invite' using errcode = '42501'; end if;
  select * into v_invite from public.league_manager_invites where token = p_token limit 1;
  if v_invite.id is null then raise exception 'invite not found' using errcode = '42704'; end if;
  if v_invite.consumed_at is not null then raise exception 'invite already used' using errcode = '22023'; end if;
  if v_invite.expires_at < now() then raise exception 'invite expired' using errcode = '22023'; end if;
  select lower(coalesce(u.email, '')) into v_email from auth.users u where u.id = v_auth_uid;
  if v_email <> v_invite.email then
    raise exception 'invite was sent to %, you''re signed in as %', v_invite.email, v_email using errcode = '42501';
  end if;
  update public.league_manager_invites set consumed_at = now(), consumed_by_user_id = v_profile_id
  where id = v_invite.id and consumed_at is null;
  if not found then raise exception 'invite was just used' using errcode = '22023'; end if;
  insert into public.league_roles (league_id, user_id, role)
  values (v_invite.league_id, v_profile_id, 'manager')
  on conflict (league_id, user_id) do update set role = 'manager'
    where league_roles.role <> 'commissioner';
  return query select v_invite.league_id;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3 ── HAND-REWRITE: privileged-columns guard — now also freezes the identity
-- columns. Without this a non-admin could UPDATE their own row and flip
-- account_type (e.g. adult → managed_adult); auth_user_id is already pinned by
-- the UPDATE policy but freezing it here too is defense in depth.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if (select auth.uid()) is null then return new; end if;  -- service role / migrations
  if coalesce((select p.is_admin from public.profiles p
               where p.id = (select public.current_profile_id())), false) then
    return new;                                            -- admins may change anything
  end if;
  -- non-admin: freeze (don't error — normal name/bio/handle edits still pass)
  new.is_admin           := old.is_admin;
  new.is_premium         := old.is_premium;
  new.premium_until      := old.premium_until;
  new.stripe_customer_id := old.stripe_customer_id;
  new.points             := old.points;
  new.account_type       := old.account_type;   -- REG-1: identity class is not self-service
  new.auth_user_id       := old.auth_user_id;   -- REG-1: re-homing a profile is admin/RPC-only
  -- DOB lock-after-first-set: only freeze if a value already exists.
  -- First-time set (NULL -> date) at signup is allowed; later edits frozen.
  if old.date_of_birth is not null then
    new.date_of_birth := old.date_of_birth;
  end if;
  return new;
end $function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4 ── MECHANICAL TRANSFORM: every other public-schema policy using auth.uid()
-- (138 policies as of Jun 10 — full preview in docs/reg1_rls_rewrite_preview.sql)
-- ────────────────────────────────────────────────────────────────────────────

DO $rls$
DECLARE
  pol record;
  v_using text;
  v_check text;
  n int := 0;
BEGIN
  FOR pol IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename <> 'profiles'   -- §1 hand-rewrote these
      AND (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
  LOOP
    -- wrapped form first (preserves the initplan alias), then bare form
    v_using := regexp_replace(pol.qual,
      '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)',
      '( SELECT public.current_profile_id() AS uid)', 'gi');
    v_using := regexp_replace(v_using, 'auth\.uid\(\)',
      '( SELECT public.current_profile_id() )', 'g');

    v_check := regexp_replace(pol.with_check,
      '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)',
      '( SELECT public.current_profile_id() AS uid)', 'gi');
    v_check := regexp_replace(v_check, 'auth\.uid\(\)',
      '( SELECT public.current_profile_id() )', 'g');

    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s %s %s',
      pol.policyname, pol.tablename,
      pol.permissive, pol.cmd,
      array_to_string(pol.roles, ', '),
      COALESCE('USING (' || v_using || ')', ''),
      COALESCE('WITH CHECK (' || v_check || ')', ''));
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'reg1_b: rewrote % policies', n;
END
$rls$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5 ── MECHANICAL TRANSFORM: every other public-schema function using auth.uid()
-- (28 functions as of Jun 10). All of them compare auth.uid() exclusively to
-- profile-id-typed columns or pass it into the is_* role helpers — verified
-- per-function on Jun 10; the only mixed-type functions are the two invite
-- accepts hand-rewritten in §2.
-- ────────────────────────────────────────────────────────────────────────────

DO $fns$
DECLARE
  fn record;
  src text;
  n int := 0;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prosrc ILIKE '%auth.uid()%'
      AND p.proname NOT IN (
        'current_profile_id',            -- IS the auth→profile bridge
        'accept_team_manager_invite',    -- hand-rewritten in §2 (mixed id types)
        'accept_league_manager_invite',  -- hand-rewritten in §2 (mixed id types)
        'guard_profile_privileged_columns' -- hand-rewritten in §3
      )
  LOOP
    src := pg_get_functiondef(fn.oid);
    src := regexp_replace(src, 'auth\.uid\(\)', 'public.current_profile_id()', 'g');
    EXECUTE src;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'reg1_b: rewrote % functions', n;
END
$fns$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6 ── Invite auto-link moves to profile creation (decoupled-correct home)
-- The old AFTER INSERT ON auth.users trigger ran BEFORE the profiles row
-- existed (profile creation is client-side), so its team_members UPDATE could
-- only succeed because failures were swallowed. Linking belongs to the moment
-- the IDENTITY appears: AFTER INSERT ON public.profiles.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.link_invited_player();

CREATE OR REPLACE FUNCTION public.link_invited_player_on_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    UPDATE team_members
    SET user_id = NEW.id, status = 'active'
    WHERE LOWER(invite_email) = LOWER(NEW.email)
      AND user_id IS NULL
      AND status = 'pending';
  EXCEPTION WHEN OTHERS THEN
    -- Never let invite-linking break profile creation.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER tr_link_invited_player_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL)
  EXECUTE FUNCTION public.link_invited_player_on_profile();

-- ────────────────────────────────────────────────────────────────────────────
-- 7 ── Auto-follow seed accounts: skip login-less profiles
-- A minor has no feed to follow from; seed-follow rows would only pollute
-- follower counts.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_follow_seed_accounts_on_profile_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  seed_emails text[] := array['pete@rinkd.app', 'nick@blpa.com', 'howard@cemented.ca'];
  e text;
  target_id uuid;
begin
  if new.auth_user_id is null then return new; end if;  -- REG-1: minors/managed have no login → no feed
  foreach e in array seed_emails loop
    select id into target_id from public.profiles where lower(email) = lower(e) limit 1;
    if target_id is not null and target_id <> new.id then
      insert into public.follows (follower_id, following_id)
      values (new.id, target_id)
      on conflict do nothing;
    end if;
  end loop;
  return new;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8 ── ASSERT the end state (aborts the whole transaction on any miss)
-- ────────────────────────────────────────────────────────────────────────────

DO $assert$
DECLARE bad text;
BEGIN
  -- (a) No public-schema policy outside profiles still references auth.uid().
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename <> 'profiles'
    AND (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'reg1_b assert failed — policies still on auth.uid(): %', bad;
  END IF;

  -- (b) No public-schema function outside the allowlist still references auth.uid().
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.prosrc ILIKE '%auth.uid()%'
    AND p.proname NOT IN ('current_profile_id',
                          'accept_team_manager_invite',
                          'accept_league_manager_invite',
                          'guard_profile_privileged_columns');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'reg1_b assert failed — functions still on auth.uid(): %', bad;
  END IF;

  -- (c) The bridge works: backfilled profiles resolve through auth_user_id.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id IS NULL AND account_type = 'adult') THEN
    RAISE EXCEPTION 'reg1_b assert failed — adult profile without auth_user_id (backfill incomplete?)';
  END IF;
END
$assert$;
