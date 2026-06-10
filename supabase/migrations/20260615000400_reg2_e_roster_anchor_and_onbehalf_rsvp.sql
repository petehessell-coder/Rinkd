-- ============================================================================
-- REG-2 Phase 2 / Migration E — trustworthy org-roster anchor + on-behalf RSVP
-- Branch: feature/reg-2-family-ux
-- Depends on: Phase 1 migrations A–C (current_profile_id, can_manage_profile,
-- account_type, household model).
--
-- ⚠️  APPLY POST-PILOT, after Phase 1 A–D.
--
-- Two changes, both small and verified non-breaking against the live client:
--
-- 1. ROSTER-ANCHOR HARDENING (closes the Phase-1 adversarial-review P0 tail).
--    is_org_admin_for_minor() trusts a team_members row (tm.user_id = minor)
--    as evidence the org rosters that child — but the manager INSERT/UPDATE
--    policies never constrained user_id, so a manager could bind ANY existing
--    profile (incl. a minor) to a team they control and forge that anchor.
--    Fix: a manager may no longer bind a MINOR profile through the open RLS
--    policies. Verified non-breaking:
--      • TeamManage "add by email" only ever resolves a user_id by matching
--        profiles.email — minors have email IS NULL, so it never binds a minor.
--      • Ghost slots (RosterUpload: user_id NULL + invite_name) are unaffected.
--      • Founder self-insert (teams.js: user_id = self, an adult) is unaffected.
--      • Real-person rostering that SHOULD bind a minor (a guardian rostering
--        their own kid) will arrive in Phase 3 as a consented SECURITY DEFINER
--        RPC, which bypasses these policies by design.
--    Net: every minor that appears on a roster got there through a consented
--    path, so is_org_admin_for_minor() is now a trustworthy claim-approval
--    authority (re-enabling the orphan-claim branch deferred from Phase 1).
--
-- 2. ON-BEHALF RSVP (FAMILY-1). A guardian acting as a managed minor RSVPs with
--    user_id = the minor's profile id. The existing team_game_rsvps policies
--    pin user_id = current_profile_id(), which blocks that. Widen to
--    can_manage_profile(user_id) — true for me OR a minor I guard.
-- ============================================================================

-- 1 ── Roster-anchor hardening ───────────────────────────────────────────────
-- A reusable guard: TRUE unless the target user_id is a minor profile.
CREATE OR REPLACE FUNCTION public.is_minor_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_profile_id AND p.account_type = 'minor'
  );
$$;
REVOKE ALL ON FUNCTION public.is_minor_profile(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_minor_profile(uuid) TO anon, authenticated, service_role;

-- INSERT: the open manager policy may never bind a minor. WITH CHECK is exact
-- here — an INSERT has no "old" row, so binding a minor is always a new bind.
-- (A consented Phase-3 minor-roster RPC will be SECURITY DEFINER and bypass
-- RLS entirely, so this guard doesn't fence it out.)
DROP POLICY team_members_insert_by_manager ON public.team_members;
CREATE POLICY team_members_insert_by_manager ON public.team_members
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid))
      OR is_league_commissioner_of_team(team_id, ( SELECT public.current_profile_id() AS uid)))
    AND (user_id IS NULL OR NOT public.is_minor_profile(user_id))
  );

-- UPDATE: the policy stays as it was (no minor term). A WITH CHECK can't see
-- the OLD row, so a "user_id is not a minor" term there would wrongly block a
-- manager from editing an existing legitimate minor roster row (e.g. Henry #17:
-- changing jersey/position keeps user_id = a minor → would fail). The
-- minor-BINDING rule — blocking only a *change* of user_id onto a minor, which
-- is the actual forge-via-update vector — moves to the trigger below, which
-- CAN compare OLD vs NEW.
DROP POLICY team_members_manager_update ON public.team_members;
CREATE POLICY team_members_manager_update ON public.team_members
  AS PERMISSIVE FOR UPDATE TO public
  USING (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)))
  WITH CHECK (is_team_manager(team_id, ( SELECT public.current_profile_id() AS uid)));

-- Closes the repoint-a-ghost-slot-onto-a-minor variant the UPDATE policy can no
-- longer express. Fires for everyone (incl. definer RPCs), but no current path
-- legitimately UPDATEs user_id onto a minor (approve_join_request / invite
-- accepts bind logged-in adults; consented minor rostering will INSERT via a
-- definer RPC, not UPDATE). A future flow that genuinely must can opt out for
-- its transaction with: SET LOCAL rinkd.allow_minor_roster = 'on'.
CREATE OR REPLACE FUNCTION public.tg_block_minor_roster_bind()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('rinkd.allow_minor_roster', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS NOT NULL
     AND NEW.user_id IS DISTINCT FROM OLD.user_id
     AND public.is_minor_profile(NEW.user_id) THEN
    RAISE EXCEPTION 'a minor can only be rostered through a consented flow'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_block_minor_roster_bind ON public.team_members;
CREATE TRIGGER tr_block_minor_roster_bind
  BEFORE UPDATE OF user_id ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_minor_roster_bind();

-- 2 ── On-behalf RSVP ────────────────────────────────────────────────────────
DROP POLICY rsvp_user_insert ON public.team_game_rsvps;
CREATE POLICY rsvp_user_insert ON public.team_game_rsvps
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (public.can_manage_profile(user_id));

DROP POLICY rsvp_user_update ON public.team_game_rsvps;
CREATE POLICY rsvp_user_update ON public.team_game_rsvps
  AS PERMISSIVE FOR UPDATE TO public
  USING (public.can_manage_profile(user_id))
  WITH CHECK (public.can_manage_profile(user_id));

DROP POLICY rsvp_user_delete ON public.team_game_rsvps;
CREATE POLICY rsvp_user_delete ON public.team_game_rsvps
  AS PERMISSIVE FOR DELETE TO public
  USING (public.can_manage_profile(user_id));
