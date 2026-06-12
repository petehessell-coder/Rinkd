-- ============================================================================
-- REG-1 Phase 1 / Migration D — migrate Henry #17 to a first-class minor profile
-- Branch: feature/reg-1-identity-spine
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.2 ("Migrate Henry #17:
-- his team_members.invite_name row becomes a real profiles row, added to
-- Pete's household as minor, and team_members.user_id repointed to it.")
--
-- ⚠️  APPLY POST-PILOT, after Migrations A + B + C.
--
-- Ground truth (prod, verified Jun 10, 2026):
--   team_members.id  489491f3-5b79-4ab3-80db-b8593a9099ba
--     → team "Shaker Heights Squirt 1" (d18e023c-354f-4d3b-b5a0-82574f05377d),
--       invite_name 'Henry Hessell', jersey 17, user_id NULL, status 'active'
--   Pete's profile   fc0018c2-0a7d-4eda-9d91-4077f2f138a4 (team manager)
--
-- Properties: idempotent (safe to re-run), and a clean NO-OP on any database
-- that lacks these exact rows (e.g. a fresh dev branch). Stats continuity is
-- automatic — leaderboards/goals are jersey+team-keyed and untouched; the only
-- write to team_members is filling user_id on the same row.
--
-- date_of_birth is left NULL deliberately (not public data we hold today);
-- account_type='minor' is the access decision per the locked design, and the
-- DOB lock-after-first-set guard applies whenever Pete fills it in.
-- ============================================================================

DO $henry$
DECLARE
  c_team_member uuid := '489491f3-5b79-4ab3-80db-b8593a9099ba';
  c_pete        uuid := 'fc0018c2-0a7d-4eda-9d91-4077f2f138a4';
  c_henry       uuid := 'b3c1a7e2-9f4d-4c6b-8a2e-5d7f0c3e9a11'; -- fixed id → idempotent
  v_household   uuid;
  v_tm          record;
BEGIN
  -- Guard: only act when the exact prod rows exist (no-op elsewhere).
  SELECT * INTO v_tm FROM public.team_members
  WHERE id = c_team_member AND invite_name = 'Henry Hessell';
  IF v_tm.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = c_pete) THEN
    RAISE NOTICE 'reg1_d: Henry/Pete rows not present — skipping (expected on non-prod)';
    RETURN;
  END IF;
  IF v_tm.user_id IS NOT NULL AND v_tm.user_id <> c_henry THEN
    RAISE EXCEPTION 'reg1_d: team_members % already linked to unexpected profile %', c_team_member, v_tm.user_id;
  END IF;

  -- 1. Pete's household (reuse his existing one if a guardian row exists).
  SELECT hm.household_id INTO v_household
  FROM public.household_members hm
  WHERE hm.profile_id = c_pete AND hm.role = 'guardian' AND hm.status = 'active'
  LIMIT 1;
  IF v_household IS NULL THEN
    INSERT INTO public.households (name, created_by) VALUES ('Hessel Household', c_pete)
    RETURNING id INTO v_household;
    INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
    VALUES (v_household, c_pete, 'guardian', 'active', c_pete, c_pete);
    PERFORM public.log_guardianship_event('household_created', c_pete, c_pete, v_household, NULL,
              jsonb_build_object('migration', 'reg1_d'));
  END IF;

  -- 2. Henry's first-class minor profile (followable, stat-bearing, no login).
  INSERT INTO public.profiles (id, name, handle, avatar_initials, account_type, auth_user_id, email)
  VALUES (c_henry, 'Henry Hessell', 'henry-hessell-17', 'HH', 'minor', NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- 3. Household membership (Pete = creator ⇒ owning guardian).
  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (v_household, c_henry, 'minor', 'active', c_pete, c_pete)
  ON CONFLICT (household_id, profile_id) DO NOTHING;

  -- 4. Repoint the roster row to the new identity (jersey/stats untouched).
  UPDATE public.team_members
  SET user_id = c_henry
  WHERE id = c_team_member AND (user_id IS NULL OR user_id = c_henry);

  PERFORM public.log_guardianship_event('managed_profile_created', c_pete, c_henry, v_household, NULL,
            jsonb_build_object('migration', 'reg1_d', 'team_member_id', c_team_member,
                               'note', 'Henry #17 invite_name row promoted to minor profile'));

  -- 5. Verify within the transaction.
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.id = c_team_member AND p.account_type = 'minor' AND p.auth_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'reg1_d: post-migration check failed — Henry not linked as minor profile';
  END IF;
  IF NOT public.is_guardian_of(c_henry, c_pete) THEN
    RAISE EXCEPTION 'reg1_d: post-migration check failed — Pete is not Henry''s guardian';
  END IF;

  RAISE NOTICE 'reg1_d: Henry #17 migrated (profile %, household %)', c_henry, v_household;
END
$henry$;
