-- ============================================================================
-- REG-1 Phase 1 / Migration C — households, consent & anti-fraud spine
-- Branch: feature/reg-1-identity-spine
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.2 + §4.3 (REQUIRED —
-- "so people don't sign up for other people's kids"; software never
-- adjudicates custody).
--
-- ⚠️  APPLY POST-PILOT, after Migrations A + B.
--
-- Consent model implemented here (locked May 25 — linking is NEVER unilateral):
--   • adult ↔ adult  → household_invites magic link (mirrors team_manager_invites:
--     same token shape, expiry, email-match-on-accept, consume-before-grant).
--   • adult → minor  → creator of a minor is its owning guardian; ANY further
--     link (claiming an existing kid) is a guardianship_claim that an existing
--     guardian OR the org admin who rosters the child must approve. Existing
--     guardians are notified on every claim attempt.
--   • duplicate guard → creating a kid matching an existing minor (name + DOB)
--     routes to a claim request, never a silent duplicate.
--   • org roster anchor → minors join teams only through the existing
--     manager-only team_members policies; a fabricated child can't roster itself.
--   • guardianship_audit → append-only (no UPDATE/DELETE path at all).
--
-- All writes to these tables flow through SECURITY DEFINER RPCs — there are
-- deliberately NO INSERT/UPDATE/DELETE policies on them.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 ── Tables
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.households (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  -- created_by is informational; SET NULL (not RESTRICT) so deleting the
  -- creator's account never wedges on the household FK. The household and its
  -- other members survive a creator's departure.
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.household_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('guardian','adult','minor')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','invited')),
  added_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, profile_id)
);
CREATE INDEX household_members_profile_idx ON public.household_members (profile_id);
-- A minor may belong to MORE THAN ONE household (divorced co-guardians who do
-- not share a household) — the UNIQUE is per (household, profile), by design.

CREATE TABLE public.household_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  email                text NOT NULL,
  token                text NOT NULL UNIQUE,
  invited_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  consumed_at          timestamptz,
  consumed_by_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX household_invites_household_idx ON public.household_invites (household_id);

CREATE TABLE public.guardianship_claims (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  claimant_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  household_id         uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','denied','cancelled')),
  note                 text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at           timestamptz
);
CREATE INDEX guardianship_claims_minor_idx ON public.guardianship_claims (minor_profile_id);
-- one open claim per (minor, claimant)
CREATE UNIQUE INDEX guardianship_claims_open_uniq
  ON public.guardianship_claims (minor_profile_id, claimant_profile_id)
  WHERE status = 'pending';

CREATE TABLE public.guardianship_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action              text NOT NULL,
  actor_profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  household_id        uuid,
  claim_id            uuid,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardianship_audit_subject_idx ON public.guardianship_audit (subject_profile_id);

-- Credentials stub (USAH# / SafeSport) — schema decision now, surfaced only
-- when a registration needs one (Phase 3). No UI in Phase 1.
CREATE TABLE public.profile_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('usa_hockey','safesport','other')),
  value        text NOT NULL,
  verified_at  timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, kind)
);

-- Append-only is structural, not just policy: nothing can rewrite history.
REVOKE UPDATE, DELETE ON public.guardianship_audit FROM anon, authenticated;

ALTER TABLE public.households          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardianship_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardianship_audit  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_credentials ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────
-- 2 ── Role helpers (SECURITY DEFINER — they also break RLS self-recursion on
--      household_members; mirrors the is_team_manager() convention)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id AND profile_id = p_profile_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_household_guardian(p_household_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id AND profile_id = p_profile_id
      AND role = 'guardian' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_guardian_of(p_minor_profile_id uuid, p_guardian_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members g
    JOIN public.household_members m ON m.household_id = g.household_id
    WHERE g.profile_id = p_guardian_profile_id AND g.role = 'guardian' AND g.status = 'active'
      AND m.profile_id = p_minor_profile_id   AND m.role = 'minor'    AND m.status = 'active'
  );
$$;

-- "May I act for this profile?" — me, or a managed profile I guard.
CREATE OR REPLACE FUNCTION public.can_manage_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_profile_id = public.current_profile_id()
      OR public.is_guardian_of(p_profile_id, public.current_profile_id());
$$;

-- Org-roster anchor: the team manager / league commissioner who rosters a
-- minor may approve guardianship claims for them (REGISTRATION_PARITY §4.3b).
CREATE OR REPLACE FUNCTION public.is_org_admin_for_minor(p_minor_profile_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = p_minor_profile_id
      AND (public.is_team_manager(tm.team_id, p_profile_id)
        OR public.is_league_commissioner_of_team(tm.team_id, p_profile_id))
  );
$$;

REVOKE ALL ON FUNCTION public.is_household_member(uuid,uuid),
              public.is_household_guardian(uuid,uuid),
              public.is_guardian_of(uuid,uuid),
              public.can_manage_profile(uuid),
              public.is_org_admin_for_minor(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid,uuid),
              public.is_household_guardian(uuid,uuid),
              public.is_guardian_of(uuid,uuid),
              public.can_manage_profile(uuid),
              public.is_org_admin_for_minor(uuid,uuid) TO anon, authenticated, service_role;

-- Internal audit writer (not granted to clients).
CREATE OR REPLACE FUNCTION public.log_guardianship_event(
  p_action text, p_actor uuid, p_subject uuid, p_household uuid, p_claim uuid, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.guardianship_audit (action, actor_profile_id, subject_profile_id, household_id, claim_id, details)
  VALUES (p_action, p_actor, p_subject, p_household, p_claim, p_details);
$$;
REVOKE ALL ON FUNCTION public.log_guardianship_event(text,uuid,uuid,uuid,uuid,jsonb) FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3 ── RLS (read-side; ALL writes go through the §4 RPCs)
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY households_member_read ON public.households
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_household_member(id, ( SELECT public.current_profile_id() )));

CREATE POLICY households_guardian_update ON public.households
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_household_guardian(id, ( SELECT public.current_profile_id() )))
  WITH CHECK (is_household_guardian(id, ( SELECT public.current_profile_id() )));

CREATE POLICY household_members_member_read ON public.household_members
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_household_member(household_id, ( SELECT public.current_profile_id() )));

CREATE POLICY household_invites_guardian_read ON public.household_invites
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_household_guardian(household_id, ( SELECT public.current_profile_id() )));

CREATE POLICY guardianship_claims_involved_read ON public.guardianship_claims
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    claimant_profile_id = ( SELECT public.current_profile_id() )
    OR is_guardian_of(minor_profile_id, ( SELECT public.current_profile_id() ))
    OR is_org_admin_for_minor(minor_profile_id, ( SELECT public.current_profile_id() ))
  );

CREATE POLICY guardianship_audit_read ON public.guardianship_audit
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    is_guardian_of(subject_profile_id, ( SELECT public.current_profile_id() ))
    OR actor_profile_id = ( SELECT public.current_profile_id() )
    OR EXISTS (SELECT 1 FROM public.profiles p
               WHERE p.id = ( SELECT public.current_profile_id() ) AND p.is_admin = true)
  );

CREATE POLICY profile_credentials_managed ON public.profile_credentials
  AS PERMISSIVE FOR ALL TO authenticated
  USING (can_manage_profile(profile_id))
  WITH CHECK (can_manage_profile(profile_id));

-- Guardians may edit the login-less profiles they manage (privileged columns
-- stay frozen by guard_profile_privileged_columns; DOB stays lock-after-set).
CREATE POLICY "Guardians can update managed profiles" ON public.profiles
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth_user_id IS NULL AND is_guardian_of(id, ( SELECT public.current_profile_id() )))
  WITH CHECK (auth_user_id IS NULL);

-- ────────────────────────────────────────────────────────────────────────────
-- 4 ── Consent RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- 4.1 Create a household; caller becomes its first guardian.
CREATE OR REPLACE FUNCTION public.create_household(p_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_id uuid;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'sign in to create a household' USING errcode = '42501';
  END IF;
  INSERT INTO public.households (name, created_by) VALUES (nullif(trim(p_name), ''), v_me)
  RETURNING id INTO v_id;
  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (v_id, v_me, 'guardian', 'active', v_me, v_me);
  PERFORM public.log_guardianship_event('household_created', v_me, v_me, v_id, NULL);
  RETURN v_id;
END $$;

-- 4.2 Create a managed (login-less) profile — the ONLY way minors are minted.
-- Duplicate guard: a (name, DOB) match against an existing minor routes to a
-- claim request instead of creating a twin (divorced-parents-both-add-Henry).
CREATE OR REPLACE FUNCTION public.create_managed_profile(
  p_household_id uuid, p_name text, p_date_of_birth date, p_account_type text DEFAULT 'minor')
RETURNS TABLE (profile_id uuid, claim_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid; v_existing uuid; v_profile uuid; v_claim uuid;
  v_name text; v_handle text; v_initials text;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING errcode = '42501';
  END IF;
  IF NOT public.is_household_guardian(p_household_id, v_me) THEN
    RAISE EXCEPTION 'only a guardian of this household can add family members' USING errcode = '42501';
  END IF;
  IF p_account_type NOT IN ('minor','managed_adult') THEN
    RAISE EXCEPTION 'account_type must be minor or managed_adult' USING errcode = '22023';
  END IF;
  v_name := trim(coalesce(p_name, ''));
  IF v_name = '' OR p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'name and date of birth are required' USING errcode = '22023';
  END IF;

  -- Duplicate guard: match an existing login-less MINOR by normalized name
  -- (case-insensitive, internal whitespace collapsed) + DOB. NULL DOBs match
  -- each other so a no-DOB kid (e.g. the migrated Henry) still routes to a
  -- claim instead of a silent twin. Scoped to account_type='minor' so a
  -- managed_adult is never swept into a minor claim (see request_guardianship).
  SELECT p.id INTO v_existing
  FROM public.profiles p
  WHERE p.auth_user_id IS NULL
    AND p.account_type = 'minor'
    AND lower(regexp_replace(p.name, '\s+', ' ', 'g')) = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
    AND p.date_of_birth IS NOT DISTINCT FROM p_date_of_birth
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    IF public.is_guardian_of(v_existing, v_me) THEN
      RAISE EXCEPTION 'this person is already in your family' USING errcode = '23505';
    END IF;
    v_claim := public.request_guardianship_internal(v_existing, v_me, p_household_id,
                 'duplicate guard: attempted to create matching name+DOB');
    RETURN QUERY SELECT v_existing, v_claim, 'claim_requested'::text;
    RETURN;
  END IF;

  v_initials := upper(left(v_name, 1) || coalesce(left(split_part(v_name, ' ', 2), 1), ''));
  v_handle := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
              || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  INSERT INTO public.profiles (name, handle, avatar_initials, date_of_birth, account_type, auth_user_id, email)
  VALUES (v_name, v_handle, v_initials, p_date_of_birth, p_account_type, NULL, NULL)
  RETURNING id INTO v_profile;

  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (p_household_id, v_profile,
          CASE WHEN p_account_type = 'minor' THEN 'minor' ELSE 'adult' END,
          'active', v_me, v_me);

  PERFORM public.log_guardianship_event('managed_profile_created', v_me, v_profile, p_household_id, NULL,
            jsonb_build_object('account_type', p_account_type));
  RETURN QUERY SELECT v_profile, NULL::uuid, 'created'::text;
END $$;

-- 4.3 Adult ↔ adult: invite a co-guardian (magic link; mutual consent).
CREATE OR REPLACE FUNCTION public.create_household_invite(p_household_id uuid, p_email text)
RETURNS TABLE (id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_id uuid; v_token text; v_email text;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL OR NOT public.is_household_guardian(p_household_id, v_me) THEN
    RAISE EXCEPTION 'only a guardian can invite to the household' USING errcode = '42501';
  END IF;
  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'valid email required' USING errcode = '22023';
  END IF;
  -- pgcrypto's gen_random_bytes lives in the extensions schema (not on this
  -- function's search_path) — MUST stay schema-qualified.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.household_invites (household_id, email, token, invited_by)
  VALUES (p_household_id, v_email, v_token, v_me)
  RETURNING household_invites.id INTO v_id;
  PERFORM public.log_guardianship_event('guardian_invite_created', v_me, NULL, p_household_id, NULL,
            jsonb_build_object('email', v_email));
  RETURN QUERY SELECT v_id, v_token;
END $$;

-- 4.4 Accept a co-guardian invite (mirrors accept_team_manager_invite:
-- email match against auth.users, consume-before-grant).
CREATE OR REPLACE FUNCTION public.accept_household_invite(p_token text)
RETURNS TABLE (household_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
-- household_id OUT-param would otherwise collide with the ON CONFLICT column
-- reference below (mirrors accept_league_manager_invite's directive)
#variable_conflict use_column
DECLARE v_invite record; v_auth_uid uuid; v_me uuid; v_email text;
BEGIN
  v_auth_uid := (select auth.uid());
  v_me := public.current_profile_id();
  IF v_auth_uid IS NULL OR v_me IS NULL THEN
    RAISE EXCEPTION 'sign in to accept the invite' USING errcode = '42501';
  END IF;
  SELECT * INTO v_invite FROM public.household_invites WHERE token = p_token LIMIT 1;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'invite not found' USING errcode = '42704'; END IF;
  IF v_invite.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'invite already used' USING errcode = '22023'; END IF;
  IF v_invite.expires_at < now() THEN RAISE EXCEPTION 'invite expired' USING errcode = '22023'; END IF;
  SELECT lower(coalesce(u.email, '')) INTO v_email FROM auth.users u WHERE u.id = v_auth_uid;
  IF v_email <> v_invite.email THEN
    RAISE EXCEPTION 'invite was sent to %, you''re signed in as %', v_invite.email, v_email USING errcode = '42501';
  END IF;
  UPDATE public.household_invites SET consumed_at = now(), consumed_by_user_id = v_me
  WHERE id = v_invite.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite was just used' USING errcode = '22023'; END IF;
  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (v_invite.household_id, v_me, 'guardian', 'active', v_invite.invited_by, v_invite.invited_by)
  ON CONFLICT (household_id, profile_id)
  DO UPDATE SET role = 'guardian', status = 'active', approved_by = v_invite.invited_by;
  PERFORM public.log_guardianship_event('guardian_joined', v_me, v_me, v_invite.household_id, NULL,
            jsonb_build_object('invited_by', v_invite.invited_by));
  RETURN QUERY SELECT v_invite.household_id;
END $$;

-- 4.5 Adult → minor: claim an existing kid (internal core + public wrapper).
CREATE OR REPLACE FUNCTION public.request_guardianship_internal(
  p_minor uuid, p_claimant uuid, p_household uuid, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim uuid; g record;
BEGIN
  INSERT INTO public.guardianship_claims (minor_profile_id, claimant_profile_id, household_id, note)
  VALUES (p_minor, p_claimant, p_household, nullif(trim(p_note), ''))
  ON CONFLICT (minor_profile_id, claimant_profile_id) WHERE status = 'pending'
  DO UPDATE SET note = EXCLUDED.note
  RETURNING id INTO v_claim;

  -- Existing guardians are notified on EVERY claim attempt (consent model §4.3).
  FOR g IN
    SELECT DISTINCT gm.profile_id
    FROM public.household_members gm
    JOIN public.household_members mm ON mm.household_id = gm.household_id
    WHERE mm.profile_id = p_minor AND mm.role = 'minor' AND mm.status = 'active'
      AND gm.role = 'guardian' AND gm.status = 'active'
  LOOP
    INSERT INTO public.notifications (recipient_id, actor_id, kind, body, url, metadata)
    VALUES (g.profile_id, p_claimant, 'guardianship_claim',
            'Someone asked to manage a family member''s profile. Review the request.',
            '/family',
            jsonb_build_object('claim_id', v_claim, 'minor_profile_id', p_minor));
  END LOOP;

  PERFORM public.log_guardianship_event('guardianship_claim_requested', p_claimant, p_minor, p_household, v_claim);
  RETURN v_claim;
END $$;
REVOKE ALL ON FUNCTION public.request_guardianship_internal(uuid,uuid,uuid,text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_guardianship(p_minor_profile_id uuid, p_household_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL OR NOT public.is_household_guardian(p_household_id, v_me) THEN
    RAISE EXCEPTION 'create your household first' USING errcode = '42501';
  END IF;
  -- Guardianship claims are for MINORS only. A login-less managed_adult is not
  -- a dependent and must never be reclassified into a household as a minor.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = p_minor_profile_id AND p.auth_user_id IS NULL
                   AND p.account_type = 'minor') THEN
    RAISE EXCEPTION 'profile is not a managed minor profile' USING errcode = '22023';
  END IF;
  IF public.is_guardian_of(p_minor_profile_id, v_me) THEN
    RAISE EXCEPTION 'you already manage this profile' USING errcode = '23505';
  END IF;
  RETURN public.request_guardianship_internal(p_minor_profile_id, v_me, p_household_id, p_note);
END $$;

-- 4.6 Decide a claim: existing guardian OR the org admin who rosters the child.
CREATE OR REPLACE FUNCTION public.decide_guardianship_claim(p_claim_id uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_claim record; v_has_guardian boolean;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'sign in first' USING errcode = '42501'; END IF;
  SELECT * INTO v_claim FROM public.guardianship_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'claim not found' USING errcode = '42704'; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'claim already decided' USING errcode = '22023'; END IF;

  v_has_guardian := EXISTS (
    SELECT 1 FROM public.household_members mm
    JOIN public.household_members gm ON gm.household_id = mm.household_id
    WHERE mm.profile_id = v_claim.minor_profile_id AND mm.role = 'minor' AND mm.status = 'active'
      AND gm.role = 'guardian' AND gm.status = 'active');

  -- Authority is scoped by whether the minor ALREADY has a guardian:
  --   • has a guardian  → adding ANY further guardian needs an EXISTING
  --     guardian's approval. An org admin (even a legitimate one) may NOT
  --     override the parents already on file. This is what stops a forged or
  --     opportunistic roster link from being escalated into guardianship over
  --     a kid who already has a family (the headline takeover vector).
  --   • no guardian yet → orphaned managed profile (e.g. a club-rostered kid
  --     awaiting a parent claim); the rostering org admin is the only
  --     authority. NOTE: the org-roster anchor (team_members.user_id) is not
  --     yet write-hardened, so this branch has NO live surface in Phase 1
  --     (every minor minted here is created with its guardian). Org-roster
  --     onboarding + roster-write hardening land together in Phase 2 before
  --     this branch is relied upon.
  -- A claimant can never decide their own claim, either way.
  IF v_has_guardian THEN
    IF NOT public.is_guardian_of(v_claim.minor_profile_id, v_me) THEN
      RAISE EXCEPTION 'only an existing guardian can approve an additional guardian' USING errcode = '42501';
    END IF;
  ELSE
    IF NOT public.is_org_admin_for_minor(v_claim.minor_profile_id, v_me) THEN
      RAISE EXCEPTION 'only the rostering org admin can decide a claim on an unclaimed profile' USING errcode = '42501';
    END IF;
  END IF;
  IF v_me = v_claim.claimant_profile_id THEN
    RAISE EXCEPTION 'you cannot decide your own claim' USING errcode = '42501';
  END IF;

  IF p_approve THEN
    UPDATE public.guardianship_claims
    SET status = 'approved', decided_by = v_me, decided_at = now() WHERE id = p_claim_id;
    -- The minor joins the claimant's household (a minor may span households).
    INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
    VALUES (v_claim.household_id, v_claim.minor_profile_id, 'minor', 'active',
            v_claim.claimant_profile_id, v_me)
    ON CONFLICT (household_id, profile_id) DO UPDATE SET status = 'active', approved_by = v_me;
    PERFORM public.log_guardianship_event('guardianship_claim_approved', v_me,
              v_claim.minor_profile_id, v_claim.household_id, p_claim_id,
              jsonb_build_object('claimant', v_claim.claimant_profile_id));
  ELSE
    UPDATE public.guardianship_claims
    SET status = 'denied', decided_by = v_me, decided_at = now() WHERE id = p_claim_id;
    PERFORM public.log_guardianship_event('guardianship_claim_denied', v_me,
              v_claim.minor_profile_id, v_claim.household_id, p_claim_id,
              jsonb_build_object('claimant', v_claim.claimant_profile_id));
  END IF;
END $$;

-- 4.6b Withdraw a pending claim (claimant only) — frees the unique partial
-- index so they can re-file later.
CREATE OR REPLACE FUNCTION public.cancel_guardianship_claim(p_claim_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_claim record;
BEGIN
  v_me := public.current_profile_id();
  SELECT * INTO v_claim FROM public.guardianship_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'claim not found' USING errcode = '42704'; END IF;
  IF v_claim.claimant_profile_id <> v_me THEN
    RAISE EXCEPTION 'only the claimant can withdraw their claim' USING errcode = '42501';
  END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'claim already decided' USING errcode = '22023'; END IF;
  UPDATE public.guardianship_claims
  SET status = 'cancelled', decided_by = v_me, decided_at = now() WHERE id = p_claim_id;
  PERFORM public.log_guardianship_event('guardianship_claim_cancelled', v_me,
            v_claim.minor_profile_id, v_claim.household_id, p_claim_id);
END $$;

-- 4.7 Remove a member (guardian-managed; never the last guardian of minors).
CREATE OR REPLACE FUNCTION public.remove_household_member(p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_row record; v_other_guardians int; v_minors int;
BEGIN
  v_me := public.current_profile_id();
  SELECT * INTO v_row FROM public.household_members WHERE id = p_member_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'member not found' USING errcode = '42704'; END IF;
  IF v_me IS NULL OR NOT public.is_household_guardian(v_row.household_id, v_me) THEN
    RAISE EXCEPTION 'only a guardian can remove household members' USING errcode = '42501';
  END IF;
  IF v_row.role = 'guardian' THEN
    -- Removing a guardian is itself a custody action and must not be unilateral
    -- (mirrors the never-unilateral LINK rule). A guardian may step down
    -- (remove themselves) but cannot evict a co-guardian; that escalates to
    -- the co-guardian leaving or to support. Software never adjudicates custody.
    IF v_row.profile_id <> v_me THEN
      RAISE EXCEPTION 'a guardian cannot remove a co-guardian; they must remove themselves' USING errcode = '42501';
    END IF;
    SELECT count(*) INTO v_other_guardians FROM public.household_members
    WHERE household_id = v_row.household_id AND role = 'guardian' AND status = 'active' AND id <> p_member_id;
    -- Count ALL login-less dependents (minors and managed_adults), since both
    -- need a guardian to manage them.
    SELECT count(*) INTO v_minors FROM public.household_members
    WHERE household_id = v_row.household_id AND role IN ('minor','adult') AND status = 'active'
      AND profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id IS NULL);
    IF v_other_guardians = 0 AND v_minors > 0 THEN
      RAISE EXCEPTION 'a household with dependents must keep at least one guardian' USING errcode = '22023';
    END IF;
  END IF;
  DELETE FROM public.household_members WHERE id = p_member_id;
  PERFORM public.log_guardianship_event('member_removed', v_me, v_row.profile_id, v_row.household_id, NULL,
            jsonb_build_object('removed_role', v_row.role));
END $$;

-- Client-callable surface.
GRANT EXECUTE ON FUNCTION
  public.create_household(text),
  public.create_managed_profile(uuid,text,date,text),
  public.create_household_invite(uuid,text),
  public.accept_household_invite(text),
  public.request_guardianship(uuid,uuid,text),
  public.decide_guardianship_claim(uuid,boolean),
  public.cancel_guardianship_claim(uuid),
  public.remove_household_member(uuid)
TO authenticated;
