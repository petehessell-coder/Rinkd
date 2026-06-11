-- ============================================================================
-- REG-1 Phase 1 / Migration A — decouple profiles from auth.users
-- Branch: feature/reg-1-identity-spine
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.1 (signed off May 25, 2026)
--
-- ⚠️  APPLY POST-PILOT (after Jun 14, 2026). Never before BLPA Cleveland.
-- ⚠️  Apply order: A → B → C → D (B's policies depend on current_profile_id()).
--
-- What this does:
--   1. Drops the schema-level 1:1 coupling (profiles_id_fkey → auth.users).
--   2. Adds auth_user_id / account_type; backfills auth_user_id = id for every
--      existing row (all 46 profiles are real auth-backed users — verified
--      zero auth.users without profiles, Jun 10).
--   3. Creates current_profile_id(), the single auth→profile indirection that
--      every RLS policy routes through from Migration B onward.
--   4. Repoints the 10 stragglers that FK'd auth.users directly → profiles(id)
--      so minor profiles (auth_user_id IS NULL) can hold roles/pins/subs later.
--      (Zero orphan rows in any of them — verified Jun 10.)
--
-- Deliberate consequences (reviewed):
--   • auth.users delete no longer CASCADEs the profile (was profiles_id_fkey
--     ON DELETE CASCADE; now auth_user_id ON DELETE SET NULL — a minor's
--     identity must not die with a guardian's login). The delete-account edge
--     function is updated in this same PR to delete the profiles row explicitly.
--   • New signups keep profiles.id == auth.uid() (ensureProfileForUser is
--     unchanged in id choice, now also writes auth_user_id). Only minors get
--     gen_random_uuid() ids. Client code comparing user.id to profile-id
--     columns therefore stays correct for every auth-backed user.
-- ============================================================================

-- 1 ── Decouple ---------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2 ── Identity columns (date_of_birth already exists) ------------------------
ALTER TABLE public.profiles
  ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN account_type text NOT NULL DEFAULT 'adult'
    CONSTRAINT profiles_account_type_chk CHECK (account_type IN ('adult','minor','managed_adult'));

-- A minor is a first-class identity with NO login (locked decision, May 25).
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_minor_no_login_chk CHECK (account_type <> 'minor' OR auth_user_id IS NULL);

-- 3 ── Backfill: every existing profile is a real user ------------------------
UPDATE public.profiles SET auth_user_id = id;

-- 4 ── The RLS indirection (mirrors the is_* SECURITY DEFINER helper pattern) --
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION public.current_profile_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO anon, authenticated, service_role;

-- 5 ── Repoint direct auth.users FKs → profiles(id), preserving delete rules --
-- (These columns all hold "user" ids that are profile ids for every real user;
--  pointing them at profiles makes one identity model everywhere and lets a
--  minor profile hold them in the future.)

-- league_manager_invites (SET NULL)
ALTER TABLE public.league_manager_invites
  DROP CONSTRAINT league_manager_invites_invited_by_fkey,
  ADD CONSTRAINT league_manager_invites_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT league_manager_invites_consumed_by_user_id_fkey,
  ADD CONSTRAINT league_manager_invites_consumed_by_user_id_fkey
    FOREIGN KEY (consumed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- team_manager_invites (SET NULL)
ALTER TABLE public.team_manager_invites
  DROP CONSTRAINT team_manager_invites_invited_by_fkey,
  ADD CONSTRAINT team_manager_invites_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  DROP CONSTRAINT team_manager_invites_consumed_by_user_id_fkey,
  ADD CONSTRAINT team_manager_invites_consumed_by_user_id_fkey
    FOREIGN KEY (consumed_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- league_roles (CASCADE)
ALTER TABLE public.league_roles
  DROP CONSTRAINT league_roles_user_id_fkey,
  ADD CONSTRAINT league_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- league_subscriptions (CASCADE)
ALTER TABLE public.league_subscriptions
  DROP CONSTRAINT league_subscriptions_user_id_fkey,
  ADD CONSTRAINT league_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- tournament_subscriptions (CASCADE)
ALTER TABLE public.tournament_subscriptions
  DROP CONSTRAINT tournament_subscriptions_user_id_fkey,
  ADD CONSTRAINT tournament_subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- nav_pins (CASCADE)
ALTER TABLE public.nav_pins
  DROP CONSTRAINT nav_pins_user_id_fkey,
  ADD CONSTRAINT nav_pins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- volunteer_slots: assigned_user_id carried TWO FKs (→profiles AND →auth.users);
-- drop the auth.users one, keep the profiles one. created_by repoints (SET NULL).
ALTER TABLE public.volunteer_slots
  DROP CONSTRAINT volunteer_slots_assigned_user_id_fkey,
  DROP CONSTRAINT volunteer_slots_created_by_fkey,
  ADD CONSTRAINT volunteer_slots_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 6 ── Column grants (parity with 20260605131000 pii_anon_lockdown) -----------
-- anon's profiles SELECT is an explicit column allowlist; expose the new
-- non-PII account_type, keep auth_user_id (and date_of_birth/email) hidden.
GRANT SELECT (account_type) ON public.profiles TO anon;
