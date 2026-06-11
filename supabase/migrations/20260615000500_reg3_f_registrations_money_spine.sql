-- ============================================================================
-- REG-3 Phase 3 / Migration F — the registrations money spine + waivers
-- Branch: feature/reg-3-checkout
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.4 + docs/REG_SCHEMA.md
--
-- ⚠️  APPLY POST-PILOT, after Phase-1/2 migrations A–E.
--
-- Locked decisions implemented here (Pete, Jun 11):
--   • SPINE = LEDGER, MIRROR VIA TRIGGER. The proven team-entry flow
--     (stripe-checkout / stripe-webhook / league_registrations /
--     tournament_registrations) stays byte-untouched; a trigger mirrors every
--     legacy row into the spine and a one-time backfill imports history. The
--     spine (registrations / payment_plans / payment_installments) is the ONE
--     money truth Phase-4 AR/dashboards and family views read.
--   • FULL v1 individual registration: per-player fee + waiver on the event,
--     guardian-consented waiver acceptance at checkout, org-side assign of a
--     paid registrant to a league roster via the consented minor path
--     (migration E's rinkd.allow_minor_roster bypass).
--
-- Design amendments vs REG_SCHEMA.md (recorded there too):
--   • registrations.registrant_id is NULLABLE for registrant_type='team' —
--     team-entry registrations exist before any team row does (the webhook
--     creates league_teams/tournament_teams on payment). It references the
--     EVENT-SCOPED team row (REGISTRATION_PARITY §6 Q2 resolved: nameplate
--     league teams often have no global teams row at registration time).
--     Profile registrants remain NOT NULL by CHECK.
--   • registrations.created_by is NULLABLE — the public team-entry flow has
--     no authenticated profile.
--   • registrations.source_kind/source_id tie spine rows to their origin
--     ('league_registration' | 'tournament_registration' | 'native') and make
--     the mirror + backfill idempotent (UNIQUE).
--   • payment_installments.stripe_session_id added — checkout-session flows
--     know the session before any payment_intent exists.
--   • Assign-to-roster v1 is LEAGUE-only: tournament_teams has no global
--     team_id, so tournament rosters stay manual this phase.
--
-- Fee model (mirrors supabase/functions/stripe-checkout exactly):
--   total_cents          = round((base + 30) / 0.971)   -- registrant pays base + Stripe 2.9%+30¢
--   platform_fee_cents   = round(base * 0.01)           -- Rinkd 1%
--   processing_fee_cents = total - base                 -- Stripe passthrough
--   organizer nets base − platform fee via Connect destination charge.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 ── Spine tables
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_type text NOT NULL CHECK (registrant_type IN ('profile','team')),
  registrant_id   uuid,                      -- profiles.id OR event-scoped team row id
  target_type     text NOT NULL CHECK (target_type IN ('league','tournament','program')),
  target_id       uuid NOT NULL,
  household_id    uuid REFERENCES public.households(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','cancelled','waitlisted')),
  amount_cents    int  NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency        text NOT NULL DEFAULT 'usd',
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_kind     text NOT NULL DEFAULT 'native'
                    CHECK (source_kind IN ('native','league_registration','tournament_registration')),
  source_id       uuid,                      -- legacy row id when mirrored
  rostered_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  rostered_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registrations_profile_has_registrant_chk
    CHECK (registrant_type <> 'profile' OR registrant_id IS NOT NULL)
);
-- mirror/backfill idempotency
CREATE UNIQUE INDEX registrations_source_uniq
  ON public.registrations (source_kind, source_id) WHERE source_id IS NOT NULL;
-- a person holds at most one live registration per target
CREATE UNIQUE INDEX registrations_profile_live_uniq
  ON public.registrations (registrant_id, target_type, target_id)
  WHERE registrant_type = 'profile' AND status IN ('pending','active','waitlisted');
CREATE INDEX registrations_target_idx ON public.registrations (target_type, target_id);
CREATE INDEX registrations_household_idx ON public.registrations (household_id);
CREATE INDEX registrations_registrant_idx ON public.registrations (registrant_id);

CREATE TABLE public.payment_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id      uuid NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
  total_cents          int NOT NULL CHECK (total_cents >= 0),
  platform_fee_cents   int NOT NULL DEFAULT 0,
  processing_fee_cents int NOT NULL DEFAULT 0,
  plan_type            text NOT NULL DEFAULT 'one_time' CHECK (plan_type IN ('one_time','installments')),
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','complete','past_due','cancelled')),
  stripe_customer_id   text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_installments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id          uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  due_date                 date NOT NULL DEFAULT CURRENT_DATE,   -- one-time = single row due now
  amount_cents             int NOT NULL CHECK (amount_cents >= 0),
  status                   text NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled','processing','paid','past_due','refunded','partially_refunded')),
  stripe_session_id        text,
  stripe_payment_intent_id text,
  paid_at                  timestamptz,
  refunded_cents           int NOT NULL DEFAULT 0,   -- Phase 4 sliding-scale refunds
  dunning_attempts         int NOT NULL DEFAULT 0,   -- Phase 4
  last_dunning_at          timestamptz,              -- Phase 4
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_installments_plan_idx ON public.payment_installments (payment_plan_id);
CREATE INDEX payment_installments_due_idx ON public.payment_installments (status, due_date);

-- LA-2: waivers + guardian consent
CREATE TABLE public.waiver_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  text NOT NULL CHECK (owner_type IN ('league','tournament')),
  owner_id    uuid NOT NULL,
  title       text NOT NULL DEFAULT 'Participation Waiver',
  body_md     text NOT NULL,
  version     int  NOT NULL DEFAULT 1,
  required    boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)            -- v1: one waiver per event
);

CREATE TABLE public.waiver_acceptances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiver_template_id uuid NOT NULL REFERENCES public.waiver_templates(id),
  registration_id    uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  subject_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- whom it covers
  accepted_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- who consented (guardian for minors)
  waiver_version     int NOT NULL DEFAULT 1,
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  ip                 text,
  user_agent         text,
  UNIQUE (waiver_template_id, registration_id, subject_profile_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2 ── Per-player pricing on events (team-entry fee fields already exist)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leagues
  ADD COLUMN player_fee_cents int NOT NULL DEFAULT 0 CHECK (player_fee_cents >= 0),
  ADD COLUMN player_registration_open boolean NOT NULL DEFAULT false;
ALTER TABLE public.tournaments
  ADD COLUMN player_fee_cents int NOT NULL DEFAULT 0 CHECK (player_fee_cents >= 0),
  ADD COLUMN player_registration_open boolean NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────────────────────
-- 3 ── Visibility helper + RLS (writes are definer/service-role only)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_view_registration(p_registration_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.id = p_registration_id
      AND (
        (r.registrant_type = 'profile' AND public.can_manage_profile(r.registrant_id))
        OR (r.household_id IS NOT NULL
            AND public.is_household_guardian(r.household_id, public.current_profile_id()))
        OR (r.created_by IS NOT NULL AND r.created_by = public.current_profile_id())
        OR (r.target_type = 'league'
            AND public.is_league_commissioner(r.target_id, public.current_profile_id()))
        OR (r.target_type = 'tournament'
            AND public.is_tournament_director(r.target_id, public.current_profile_id()))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_registration(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_registration(uuid) TO anon, authenticated, service_role;

ALTER TABLE public.registrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_acceptances   ENABLE ROW LEVEL SECURITY;

CREATE POLICY registrations_involved_read ON public.registrations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_registration(id));

CREATE POLICY payment_plans_involved_read ON public.payment_plans
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_registration(registration_id));

CREATE POLICY payment_installments_involved_read ON public.payment_installments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payment_plans pp
                 WHERE pp.id = payment_plan_id AND can_view_registration(pp.registration_id)));

-- Waiver text must be readable on public register pages (no PII in it).
CREATE POLICY waiver_templates_public_read ON public.waiver_templates
  AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY waiver_templates_org_write ON public.waiver_templates
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    (owner_type = 'league' AND is_league_commissioner(owner_id, ( SELECT public.current_profile_id() )))
    OR (owner_type = 'tournament' AND is_tournament_director(owner_id, ( SELECT public.current_profile_id() )))
  )
  WITH CHECK (
    (owner_type = 'league' AND is_league_commissioner(owner_id, ( SELECT public.current_profile_id() )))
    OR (owner_type = 'tournament' AND is_tournament_director(owner_id, ( SELECT public.current_profile_id() )))
  );

CREATE POLICY waiver_acceptances_involved_read ON public.waiver_acceptances
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    accepted_by = ( SELECT public.current_profile_id() )
    OR can_manage_profile(subject_profile_id)
    OR can_view_registration(registration_id)
  );
-- (no client write policies on acceptances — the register-player edge fn
--  records them with the service role at checkout time)

-- ────────────────────────────────────────────────────────────────────────────
-- 4 ── Fee math (single source of truth, mirrors stripe-checkout)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reg_fee_breakdown(p_base_cents int)
RETURNS TABLE (total_cents int, platform_fee_cents int, processing_fee_cents int)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_base_cents <= 0 THEN 0 ELSE round((p_base_cents + 30) / 0.971)::int END,
         CASE WHEN p_base_cents <= 0 THEN 0 ELSE round(p_base_cents * 0.01)::int END,
         CASE WHEN p_base_cents <= 0 THEN 0 ELSE round((p_base_cents + 30) / 0.971)::int - p_base_cents END;
$$;
GRANT EXECUTE ON FUNCTION public.reg_fee_breakdown(int) TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5 ── Legacy → spine mirror (trigger + reusable sync)
-- The sync is exact and idempotent. The TRIGGER wrapper swallows errors with a
-- WARNING — a ledger-mirror bug must never break the live checkout/webhook
-- path; gaps are recoverable by re-running reg3_backfill_legacy().
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reg3_sync_legacy_registration(
  p_kind text,            -- 'league' | 'tournament'
  p_source_id uuid,
  p_target_id uuid,
  p_fee_cents int,
  p_status text,
  p_paid_at timestamptz,
  p_event_team_id uuid,   -- league_team_id / tournament_team_id (nullable)
  p_session_id text,
  p_created_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reg uuid; v_plan uuid; v_fee int := greatest(coalesce(p_fee_cents, 0), 0);
  v_total int; v_platform int; v_processing int;
  v_status text;
  v_source_kind text := p_kind || '_registration';
BEGIN
  v_status := CASE p_status
    WHEN 'approved' THEN 'active'
    WHEN 'rejected' THEN 'cancelled'
    WHEN 'waitlisted' THEN 'waitlisted'
    ELSE 'pending' END;

  INSERT INTO public.registrations
    (registrant_type, registrant_id, target_type, target_id, status,
     amount_cents, source_kind, source_id, created_at)
  VALUES ('team', p_event_team_id, p_kind, p_target_id, v_status,
          v_fee, v_source_kind, p_source_id, coalesce(p_created_at, now()))
  ON CONFLICT (source_kind, source_id) WHERE source_id IS NOT NULL
  DO UPDATE SET status = EXCLUDED.status,
                amount_cents = EXCLUDED.amount_cents,
                registrant_id = coalesce(EXCLUDED.registrant_id, registrations.registrant_id)
  RETURNING id INTO v_reg;

  IF v_fee > 0 THEN
    SELECT total_cents, platform_fee_cents, processing_fee_cents
      INTO v_total, v_platform, v_processing FROM public.reg_fee_breakdown(v_fee);
    INSERT INTO public.payment_plans
      (registration_id, total_cents, platform_fee_cents, processing_fee_cents, plan_type, status)
    VALUES (v_reg, v_total, v_platform, v_processing, 'one_time',
            CASE WHEN p_paid_at IS NOT NULL THEN 'complete' ELSE 'active' END)
    ON CONFLICT (registration_id)
    DO UPDATE SET status = EXCLUDED.status
    RETURNING id INTO v_plan;

    -- one-time = exactly one installment
    IF NOT EXISTS (SELECT 1 FROM public.payment_installments WHERE payment_plan_id = v_plan) THEN
      INSERT INTO public.payment_installments
        (payment_plan_id, due_date, amount_cents, status, stripe_session_id, paid_at)
      VALUES (v_plan, coalesce(p_created_at, now())::date, v_total,
              CASE WHEN p_paid_at IS NOT NULL THEN 'paid' ELSE 'scheduled' END,
              p_session_id, p_paid_at);
    ELSE
      UPDATE public.payment_installments
      SET status = CASE WHEN p_paid_at IS NOT NULL THEN 'paid' ELSE status END,
          paid_at = coalesce(p_paid_at, paid_at),
          stripe_session_id = coalesce(p_session_id, stripe_session_id)
      WHERE payment_plan_id = v_plan;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.reg3_sync_legacy_registration(text,uuid,uuid,int,text,timestamptz,uuid,text,timestamptz)
  FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_mirror_legacy_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_ARGV[0] = 'league' THEN
      PERFORM public.reg3_sync_legacy_registration('league', NEW.id, NEW.league_id,
        NEW.fee_cents, NEW.status, NEW.paid_at, NEW.league_team_id, NEW.stripe_session_id, NEW.created_at);
    ELSE
      PERFORM public.reg3_sync_legacy_registration('tournament', NEW.id, NEW.tournament_id,
        NEW.fee_cents, NEW.status, NEW.paid_at, NEW.tournament_team_id, NEW.stripe_session_id, NEW.created_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The ledger mirror must never break a live payment write. Recover later
    -- with: SELECT public.reg3_backfill_legacy();
    RAISE WARNING 'reg3 mirror failed for % %: %', TG_ARGV[0], NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER tr_mirror_league_registration
  AFTER INSERT OR UPDATE ON public.league_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_legacy_registration('league');
CREATE TRIGGER tr_mirror_tournament_registration
  AFTER INSERT OR UPDATE ON public.tournament_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_legacy_registration('tournament');

-- Re-runnable backfill / repair (also runs once right here).
CREATE OR REPLACE FUNCTION public.reg3_backfill_legacy()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.league_registrations LOOP
    PERFORM public.reg3_sync_legacy_registration('league', r.id, r.league_id,
      r.fee_cents, r.status, r.paid_at, r.league_team_id, r.stripe_session_id, r.created_at);
    n := n + 1;
  END LOOP;
  FOR r IN SELECT * FROM public.tournament_registrations LOOP
    PERFORM public.reg3_sync_legacy_registration('tournament', r.id, r.tournament_id,
      r.fee_cents, r.status, r.paid_at, r.tournament_team_id, r.stripe_session_id, r.created_at);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reg3_backfill_legacy() FROM public, anon, authenticated;

DO $$
DECLARE n int;
BEGIN
  n := public.reg3_backfill_legacy();
  RAISE NOTICE 'reg3_f: backfilled % legacy registrations into the spine', n;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6 ── Org-side: assign a paid registrant to a league roster (consented path)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_registrant_to_team(p_registration_id uuid, p_team_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_reg record;
BEGIN
  v_me := public.current_profile_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'sign in first' USING errcode = '42501'; END IF;

  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id FOR UPDATE;
  IF v_reg.id IS NULL THEN RAISE EXCEPTION 'registration not found' USING errcode = '42704'; END IF;
  IF v_reg.registrant_type <> 'profile' THEN
    RAISE EXCEPTION 'only player registrations can be rostered' USING errcode = '22023';
  END IF;
  IF v_reg.status <> 'active' THEN
    RAISE EXCEPTION 'registration must be paid/active before rostering' USING errcode = '22023';
  END IF;
  IF v_reg.target_type <> 'league' THEN
    RAISE EXCEPTION 'assign-to-roster is league-only for now' USING errcode = '22023';
  END IF;
  IF NOT public.is_league_commissioner(v_reg.target_id, v_me) THEN
    RAISE EXCEPTION 'only the league commissioner can roster registrants' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_teams lt
                 WHERE lt.league_id = v_reg.target_id AND lt.team_id = p_team_id) THEN
    RAISE EXCEPTION 'team is not in this league' USING errcode = '23503';
  END IF;

  -- The PAID registration created by the guardian IS the consent that the
  -- migration-E roster guard asks for — open the gate for exactly this insert.
  PERFORM set_config('rinkd.allow_minor_roster', 'on', true);
  INSERT INTO public.team_members (team_id, user_id, role, status)
  VALUES (p_team_id, v_reg.registrant_id, 'player', 'active')
  ON CONFLICT (team_id, user_id) DO UPDATE SET status = 'active';
  PERFORM set_config('rinkd.allow_minor_roster', '', true);

  UPDATE public.registrations
  SET rostered_team_id = p_team_id, rostered_at = now()
  WHERE id = p_registration_id;

  PERFORM public.log_guardianship_event('registrant_rostered', v_me, v_reg.registrant_id,
            v_reg.household_id, NULL,
            jsonb_build_object('registration_id', p_registration_id, 'team_id', p_team_id,
                               'league_id', v_reg.target_id));
END $$;
GRANT EXECUTE ON FUNCTION public.assign_registrant_to_team(uuid, uuid) TO authenticated;
