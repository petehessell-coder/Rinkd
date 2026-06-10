-- ============================================================================
-- REG-1 Phase 1 — SQL smoke suite (RLS + consent surface)
--
-- Runs INSIDE a transaction that already applied migrations A–D, with
-- everything rolled back at the end (the dry-run harness wraps this file in
-- BEGIN … ROLLBACK). Simulates PostgREST exactly: SET LOCAL ROLE
-- anon/authenticated + request.jwt.claims. Every failed expectation RAISEs,
-- aborting the transaction — a clean finish IS the green result.
--
-- The JS twin (scripts/reg-smoke/run.js) covers the same surface through real
-- GoTrue JWTs; run it against prod right after the migrations apply for real.
-- ============================================================================

-- ── seed four auth users (postgres role) ────────────────────────────────────
RESET ROLE;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, extensions.crypt('reg1-smoke', extensions.gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, 'parenta@reg1smoke.test'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'parentb@reg1smoke.test'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'stranger@reg1smoke.test'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'orgadmin@reg1smoke.test')
) AS u(id, email);

-- helper to impersonate a user the way PostgREST does
CREATE OR REPLACE FUNCTION pg_temp.impersonate(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

-- ── S1: signup bootstrap — profiles INSERT policy keyed on auth_user_id ─────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  INSERT INTO public.profiles (id, auth_user_id, account_type, email, name, handle, avatar_initials)
  VALUES ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','adult',
          'parenta@reg1smoke.test','Parent A','smoke-parenta','PA');
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  INSERT INTO public.profiles (id, auth_user_id, account_type, email, name, handle, avatar_initials)
  VALUES ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','adult',
          'parentb@reg1smoke.test','Parent B','smoke-parentb','PB');
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  INSERT INTO public.profiles (id, auth_user_id, account_type, email, name, handle, avatar_initials)
  VALUES ('33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','adult',
          'stranger@reg1smoke.test','Stranger','smoke-stranger','ST');
  PERFORM pg_temp.impersonate('44444444-4444-4444-8444-444444444444');
  INSERT INTO public.profiles (id, auth_user_id, account_type, email, name, handle, avatar_initials)
  VALUES ('44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444','adult',
          'orgadmin@reg1smoke.test','Org Admin','smoke-orgadmin','OA');
  RAISE NOTICE 'S1 ok — signup bootstrap';
END $$;

-- S1b: cannot insert a profile bound to someone ELSE's auth identity
DO $$ BEGIN
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  BEGIN
    INSERT INTO public.profiles (id, auth_user_id, account_type, name, handle)
    VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'adult', 'Evil', 'smoke-evil');
    RAISE EXCEPTION 'S1b FAILED — cross-identity profile insert allowed';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'S1b ok — cross-identity profile insert blocked (%)', SQLSTATE;
  END;
END $$;

-- ── S2: identity bridge ──────────────────────────────────────────────────────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  IF public.current_profile_id() <> '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'S2 FAILED — current_profile_id() = %', public.current_profile_id();
  END IF;
  RAISE NOTICE 'S2 ok — current_profile_id bridge';
END $$;

-- ── S3/S4: household + minor minting ────────────────────────────────────────
DO $$
DECLARE v_house uuid; v_kid record; v_follows int;
BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  v_house := public.create_household('Smoke House A');
  SELECT * INTO v_kid FROM public.create_managed_profile(v_house, 'Smoke Kid', '2016-03-04');
  IF v_kid.outcome <> 'created' THEN RAISE EXCEPTION 'S4 FAILED — outcome %', v_kid.outcome; END IF;
  PERFORM set_config('smoke.house_a', v_house::text, true);
  PERFORM set_config('smoke.kid', v_kid.profile_id::text, true);
  RESET ROLE;
  PERFORM 1 FROM public.profiles
   WHERE id = v_kid.profile_id AND account_type = 'minor' AND auth_user_id IS NULL AND email IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'S4 FAILED — minor invariants'; END IF;
  SELECT count(*) INTO v_follows FROM public.follows WHERE follower_id = v_kid.profile_id;
  IF v_follows <> 0 THEN RAISE EXCEPTION 'S4 FAILED — auto-follow fired for minor'; END IF;
  RAISE NOTICE 'S3/S4 ok — household + login-less minor (no auto-follow)';
END $$;

-- ── S5: stranger cannot mint into someone else's household ──────────────────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  BEGIN
    PERFORM public.create_managed_profile(current_setting('smoke.house_a')::uuid, 'Fake Kid', '2015-01-01');
    RAISE EXCEPTION 'S5 FAILED — stranger minted a kid';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'S5 ok — guardian-only minting';
  END;
END $$;

-- ── S6: unilateral linking impossible (no write policies) ───────────────────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  BEGIN
    INSERT INTO public.household_members (household_id, profile_id, role, status, added_by)
    VALUES (current_setting('smoke.house_a')::uuid, '22222222-2222-4222-8222-222222222222',
            'guardian', 'active', '22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'S6 FAILED — direct household_members insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'S6 ok — linking is never unilateral';
  END;
END $$;

-- ── S7: duplicate guard (name+DOB, case-insensitive) → claim + notification ─
DO $$
DECLARE v_house_b uuid; v_dup record; v_twins int; v_notif int;
BEGIN
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  v_house_b := public.create_household('Smoke House B');
  SELECT * INTO v_dup FROM public.create_managed_profile(v_house_b, 'smoke kid', '2016-03-04');
  IF v_dup.outcome <> 'claim_requested' OR v_dup.profile_id <> current_setting('smoke.kid')::uuid THEN
    RAISE EXCEPTION 'S7 FAILED — outcome % profile %', v_dup.outcome, v_dup.profile_id;
  END IF;
  PERFORM set_config('smoke.claim', v_dup.claim_id::text, true);
  RESET ROLE;
  SELECT count(*) INTO v_twins FROM public.profiles WHERE lower(name) = 'smoke kid';
  IF v_twins <> 1 THEN RAISE EXCEPTION 'S7 FAILED — % twins', v_twins; END IF;
  SELECT count(*) INTO v_notif FROM public.notifications
   WHERE recipient_id = '11111111-1111-4111-8111-111111111111' AND kind = 'guardianship_claim';
  IF v_notif < 1 THEN RAISE EXCEPTION 'S7 FAILED — guardian not notified'; END IF;
  RAISE NOTICE 'S7 ok — duplicate routed to claim + guardian notified';
END $$;

-- ── S8a: TAKEOVER BLOCKED — an org admin who rosters the kid CANNOT approve a
-- claim while the kid already has a guardian (the headline attack: a forged or
-- opportunistic roster link must not escalate into guardianship over a child
-- who already has a family). orgadmin self-rosters the kid, files a claim, then
-- tries to approve it via a second account; both paths are denied. ───────────
DO $$
DECLARE v_team uuid; v_scl uuid;
BEGIN
  RESET ROLE;
  INSERT INTO public.teams (name, manager_id)
  VALUES ('Forged Roster', '33333333-3333-4333-8333-333333333333') RETURNING id INTO v_team;
  INSERT INTO public.team_members (team_id, user_id, role, status)
  VALUES (v_team, current_setting('smoke.kid')::uuid, 'player', 'active');
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  v_scl := public.request_guardianship(current_setting('smoke.kid')::uuid,
             public.create_household('Stranger House'), 'takeover attempt');
  -- stranger (claimant + forged org admin) cannot self-approve
  BEGIN
    PERFORM public.decide_guardianship_claim(v_scl, true);
    RAISE EXCEPTION 'S8a FAILED — claimant self-approved a takeover';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- a DIFFERENT org admin who also rosters the kid still cannot approve while a guardian exists
  RESET ROLE;
  INSERT INTO public.teams (name, manager_id)
  VALUES ('OA Roster', '44444444-4444-4444-8444-444444444444') RETURNING id INTO v_team;
  INSERT INTO public.team_members (team_id, user_id, role, status)
  VALUES (v_team, current_setting('smoke.kid')::uuid, 'player', 'active');
  PERFORM pg_temp.impersonate('44444444-4444-4444-8444-444444444444');
  BEGIN
    PERFORM public.decide_guardianship_claim(v_scl, true);
    RAISE EXCEPTION 'S8a FAILED — org admin overrode an existing guardian';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'S8a ok — takeover blocked (org admin cannot approve while a guardian exists)';
END $$;

-- ── S8b: claim decisions — no self-approval, guardian approval works ─────────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  BEGIN
    PERFORM public.decide_guardianship_claim(current_setting('smoke.claim')::uuid, true);
    RAISE EXCEPTION 'S8b FAILED — claimant approved own claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  PERFORM public.decide_guardianship_claim(current_setting('smoke.claim')::uuid, true);  -- existing guardian
  RESET ROLE;
  IF NOT public.is_guardian_of(current_setting('smoke.kid')::uuid, '22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'S8b FAILED — approval did not grant guardianship';
  END IF;
  RAISE NOTICE 'S8b ok — existing-guardian approval grants co-guardianship; minor spans households';
END $$;

-- ── S8c: managed_adult cannot be claimed as a minor ─────────────────────────
DO $$
DECLARE v_ma record;
BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  SELECT * INTO v_ma FROM public.create_managed_profile(
    current_setting('smoke.house_a')::uuid, 'Adult Dependent', '1990-01-01', 'managed_adult');
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  BEGIN
    PERFORM public.request_guardianship(v_ma.profile_id,
      (SELECT household_id FROM public.household_members
       WHERE profile_id = '22222222-2222-4222-8222-222222222222' AND role = 'guardian' LIMIT 1), 'x');
    RAISE EXCEPTION 'S8c FAILED — guardianship claim allowed on a managed_adult';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%S8c FAILED%' THEN RAISE; END IF; END;
  RAISE NOTICE 'S8c ok — managed_adult is not claimable as a minor';
END $$;

-- ── S8d: co-guardian cannot be evicted; self-removal allowed ────────────────
DO $$
DECLARE v_pa uuid; v_pb uuid;
BEGIN
  RESET ROLE;  -- add parentB as co-guardian of house A (definer path; UI uses the invite flow)
  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (current_setting('smoke.house_a')::uuid, '22222222-2222-4222-8222-222222222222',
          'guardian', 'active', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')
  ON CONFLICT (household_id, profile_id) DO UPDATE SET role = 'guardian', status = 'active';
  SELECT id INTO v_pa FROM public.household_members
   WHERE household_id = current_setting('smoke.house_a')::uuid AND profile_id = '11111111-1111-4111-8111-111111111111';
  SELECT id INTO v_pb FROM public.household_members
   WHERE household_id = current_setting('smoke.house_a')::uuid AND profile_id = '22222222-2222-4222-8222-222222222222';
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  BEGIN
    PERFORM public.remove_household_member(v_pb);   -- evicting a co-guardian
    RAISE EXCEPTION 'S8d FAILED — co-guardian eviction allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.remove_household_member(v_pa);     -- stepping down (other guardian remains)
  RESET ROLE;
  IF public.is_household_guardian(current_setting('smoke.house_a')::uuid, '11111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'S8d FAILED — guardian still present after self-removal';
  END IF;
  -- Restore parentA's guardian membership so later blocks (S13 invite) still
  -- see parentA as a guardian of house A.
  INSERT INTO public.household_members (household_id, profile_id, role, status, added_by, approved_by)
  VALUES (current_setting('smoke.house_a')::uuid, '11111111-1111-4111-8111-111111111111',
          'guardian', 'active', '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')
  ON CONFLICT (household_id, profile_id) DO UPDATE SET role = 'guardian', status = 'active';
  RAISE NOTICE 'S8d ok — no co-guardian eviction; self-removal works';
END $$;

-- ── S9: audit is append-only ─────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.guardianship_audit;
  IF v_n < 4 THEN RAISE EXCEPTION 'S9 FAILED — only % audit rows', v_n; END IF;
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  BEGIN
    UPDATE public.guardianship_audit SET action = 'tampered';
    RAISE EXCEPTION 'S9 FAILED — audit UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.guardianship_audit;
    RAISE EXCEPTION 'S9 FAILED — audit DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'S9 ok — append-only audit (% rows)', v_n;
END $$;

-- ── S10: profile edit rights — own ✓, guardian→minor ✓, cross-user ✗ ─────────
DO $$
DECLARE v_bio text;
BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  UPDATE public.profiles SET bio = 'own-edit' WHERE id = '11111111-1111-4111-8111-111111111111';
  UPDATE public.profiles SET bio = 'guardian-edit' WHERE id = current_setting('smoke.kid')::uuid;
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  UPDATE public.profiles SET bio = 'hacked' WHERE id = '11111111-1111-4111-8111-111111111111';
  UPDATE public.profiles SET bio = 'hacked' WHERE id = current_setting('smoke.kid')::uuid;
  RESET ROLE;
  SELECT bio INTO v_bio FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';
  IF v_bio <> 'own-edit' THEN RAISE EXCEPTION 'S10 FAILED — own/cross edit (bio=%)', v_bio; END IF;
  SELECT bio INTO v_bio FROM public.profiles WHERE id = current_setting('smoke.kid')::uuid;
  IF v_bio <> 'guardian-edit' THEN RAISE EXCEPTION 'S10 FAILED — guardian/stranger edit (bio=%)', v_bio; END IF;
  RAISE NOTICE 'S10 ok — profile edit boundaries';
END $$;

-- ── S11: privileged columns frozen (is_admin / account_type / auth_user_id) ─
DO $$
DECLARE r record;
BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  UPDATE public.profiles SET is_admin = true, account_type = 'managed_adult'
  WHERE id = '11111111-1111-4111-8111-111111111111';
  RESET ROLE;
  SELECT is_admin, account_type INTO r FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF r.is_admin OR r.account_type <> 'adult' THEN
    RAISE EXCEPTION 'S11 FAILED — privileged columns mutable (%, %)', r.is_admin, r.account_type;
  END IF;
  RAISE NOTICE 'S11 ok — privileged-column freeze';
END $$;

-- ── S12: minor-with-login CHECK holds even for service paths ────────────────
DO $$ BEGIN
  RESET ROLE;
  BEGIN
    INSERT INTO public.profiles (name, handle, account_type, auth_user_id)
    VALUES ('Bad Minor', 'smoke-bad-minor', 'minor', '44444444-4444-4444-8444-444444444444');
    RAISE EXCEPTION 'S12 FAILED — minor with login accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'S12 ok — profiles_minor_no_login_chk';
  END;
END $$;

-- ── S13: co-guardian magic link — wrong email rejected, right email joins ────
DO $$
DECLARE v_inv record;
BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  SELECT * INTO v_inv FROM public.create_household_invite(
    current_setting('smoke.house_a')::uuid, 'parentb@reg1smoke.test');
  PERFORM pg_temp.impersonate('33333333-3333-4333-8333-333333333333');
  BEGIN
    PERFORM public.accept_household_invite(v_inv.token);
    RAISE EXCEPTION 'S13 FAILED — wrong-email accept succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  PERFORM public.accept_household_invite(v_inv.token);
  RESET ROLE;
  IF NOT public.is_household_guardian(current_setting('smoke.house_a')::uuid,
                                      '22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'S13 FAILED — accept did not grant guardian';
  END IF;
  RAISE NOTICE 'S13 ok — mutual-consent co-guardian invite';
END $$;

-- ── S14: rewritten social policies — post as self ✓, impersonation ✗ ─────────
DO $$ BEGIN
  PERFORM pg_temp.impersonate('11111111-1111-4111-8111-111111111111');
  INSERT INTO public.posts (author_id, content)
  VALUES ('11111111-1111-4111-8111-111111111111', 'reg1 smoke post');
  PERFORM pg_temp.impersonate('22222222-2222-4222-8222-222222222222');
  BEGIN
    INSERT INTO public.posts (author_id, content)
    VALUES ('11111111-1111-4111-8111-111111111111', 'impersonated');
    RAISE EXCEPTION 'S14 FAILED — impersonated post allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'S14 ok — rewritten posts policies';
END $$;

-- ── S15: invite-email auto-link now fires on profile creation ────────────────
DO $$
DECLARE v_team uuid; v_tm record;
BEGIN
  RESET ROLE;
  INSERT INTO public.teams (name, manager_id)
  VALUES ('Smoke Linkers', '44444444-4444-4444-8444-444444444444') RETURNING id INTO v_team;
  INSERT INTO public.team_members (team_id, invite_name, invite_email, status, role)
  VALUES (v_team, 'Link Me', 'linkme@reg1smoke.test', 'pending', 'player');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  VALUES ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'linkme@reg1smoke.test',
          extensions.crypt('reg1-smoke', extensions.gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
  PERFORM pg_temp.impersonate('55555555-5555-4555-8555-555555555555');
  INSERT INTO public.profiles (id, auth_user_id, account_type, email, name, handle)
  VALUES ('55555555-5555-4555-8555-555555555555','55555555-5555-4555-8555-555555555555',
          'adult','linkme@reg1smoke.test','Link Me','smoke-linkme');
  RESET ROLE;
  SELECT user_id, status INTO v_tm FROM public.team_members
  WHERE team_id = v_team AND lower(invite_email) = 'linkme@reg1smoke.test';
  IF v_tm.user_id IS DISTINCT FROM '55555555-5555-4555-8555-555555555555' OR v_tm.status <> 'active' THEN
    RAISE EXCEPTION 'S15 FAILED — link trigger (user_id=%, status=%)', v_tm.user_id, v_tm.status;
  END IF;
  RAISE NOTICE 'S15 ok — auto-link on profile creation';
END $$;

-- ── S16: anon column grants — PII stays dark ─────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO v FROM public.profiles;  -- public columns fine via RLS
  BEGIN
    PERFORM email FROM public.profiles LIMIT 1;
    RAISE EXCEPTION 'S16 FAILED — anon read email';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM date_of_birth FROM public.profiles LIMIT 1;
    RAISE EXCEPTION 'S16 FAILED — anon read date_of_birth';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM auth_user_id FROM public.profiles LIMIT 1;
    RAISE EXCEPTION 'S16 FAILED — anon read auth_user_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'S16 ok — anon PII lockdown intact (% profiles visible)', v;
END $$;

-- ── S17: Henry #17 (only meaningful where the prod rows exist) ───────────────
DO $$
DECLARE v record;
BEGIN
  RESET ROLE;
  SELECT tm.user_id, tm.jersey_number, p.account_type, p.auth_user_id
  INTO v
  FROM public.team_members tm LEFT JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.id = '489491f3-5b79-4ab3-80db-b8593a9099ba';
  IF v IS NULL THEN
    RAISE NOTICE 'S17 skipped — Henry row not present (non-prod database)';
  ELSIF v.user_id IS NULL OR v.account_type <> 'minor' OR v.auth_user_id IS NOT NULL
        OR v.jersey_number <> 17 THEN
    RAISE EXCEPTION 'S17 FAILED — Henry: %', v;
  ELSIF NOT public.is_guardian_of(v.user_id, 'fc0018c2-0a7d-4eda-9d91-4077f2f138a4') THEN
    RAISE EXCEPTION 'S17 FAILED — Pete is not Henry''s guardian';
  ELSE
    RAISE NOTICE 'S17 ok — Henry #17: minor profile, jersey intact, Pete guardian';
  END IF;
END $$;

RESET ROLE;
SELECT 'REG-1 SMOKE SUITE: ALL GREEN' AS verdict;
