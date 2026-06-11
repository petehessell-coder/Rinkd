-- ============================================================================
-- REG-4 Phase 4 / Migration G — installments lifecycle, dunning, refunds,
-- AR aging, Auto-Pay, reconciliation (CROSSBAR-1 data layer)
-- Branch: feature/reg-4-ar-autopay
-- Canonical design: rinkd_v4/REGISTRATION_PARITY.md §4.4/§4.5 + docs/REG_SCHEMA.md
--
-- ⚠️  APPLY POST-PILOT, after Phase-1/2/3 migrations A–F.
--
-- Reads/writes ONLY the Phase-3 money spine. Locked decisions (Pete, Jun 11):
--   • REFUND = scale% (100% >14d / 50% 7–14d / 0% <7d before event start) of
--     the BASE portion of installments the family actually PAID; all unpaid
--     installments cancel — a cancelling family never owes another cent.
--     Rinkd 1% + Stripe processing are never refunded (tech fee non-refundable).
--   • RECONCILIATION = nightly self-heal: re-run the idempotent legacy
--     backfill, compare legacy↔spine, log every run, notify admins only when a
--     mismatch SURVIVES the heal.
--
-- Division of labor: everything Stripe-free lives here as SQL (cron-scheduled
-- directly); anything touching Stripe (autopay charges, refund execution,
-- pay-now sessions, autopay setup) lives in edge fns that call the
-- prepare/record RPCs below. Org-admin authority is checked in SQL
-- (can_admin_registration) — edge fns pass the CALLER's identity, never trust
-- the body.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 ── Schema: installment base + cancelled state, autopay, refunds ledger,
--      per-event installment offer, reconciliation log
-- ────────────────────────────────────────────────────────────────────────────

-- Each installment is grossed up individually (every charge pays its own
-- Stripe fee), so the refundable BASE must be stored, not derived.
ALTER TABLE public.payment_installments
  ADD COLUMN base_cents int NOT NULL DEFAULT 0 CHECK (base_cents >= 0);
-- Backfill from Phase-3 rows: when the plan grossed up (processing>0), the
-- base inverts the gross-up; otherwise the charge WAS the base.
UPDATE public.payment_installments pi
SET base_cents = CASE WHEN pp.processing_fee_cents > 0
                      THEN greatest(round(pi.amount_cents * 0.971)::int - 30, 0)
                      ELSE pi.amount_cents END
FROM public.payment_plans pp WHERE pp.id = pi.payment_plan_id;

-- 'cancelled' joins the installment lifecycle (refund cancels unpaid rows).
ALTER TABLE public.payment_installments DROP CONSTRAINT payment_installments_status_check;
ALTER TABLE public.payment_installments ADD CONSTRAINT payment_installments_status_check
  CHECK (status IN ('scheduled','processing','paid','past_due','refunded','partially_refunded','cancelled'));

-- Saved card for Auto-Pay (Stripe customer + payment method on the PLATFORM
-- account — destination charges originate there). One row per stored card.
CREATE TABLE public.payment_methods (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id       text NOT NULL,
  stripe_payment_method_id text NOT NULL UNIQUE,
  brand                    text,
  last4                    text,
  exp_month                int,
  exp_year                 int,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_methods_owner_idx ON public.payment_methods (owner_profile_id);

ALTER TABLE public.payment_plans
  ADD COLUMN autopay_payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- Organizer offer: allow paying a player registration in N monthly installments.
ALTER TABLE public.leagues
  ADD COLUMN player_installments_max int NOT NULL DEFAULT 1 CHECK (player_installments_max BETWEEN 1 AND 12);
ALTER TABLE public.tournaments
  ADD COLUMN player_installments_max int NOT NULL DEFAULT 1 CHECK (player_installments_max BETWEEN 1 AND 12);

-- Append-only refunds ledger (every Stripe refund recorded against its installment).
CREATE TABLE public.refunds (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id         uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  payment_installment_id  uuid NOT NULL REFERENCES public.payment_installments(id) ON DELETE CASCADE,
  stripe_refund_id        text,
  amount_cents            int NOT NULL CHECK (amount_cents > 0),
  policy_pct              int NOT NULL CHECK (policy_pct IN (0,50,100)),
  initiated_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason                  text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
REVOKE UPDATE, DELETE ON public.refunds FROM anon, authenticated;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_involved_read ON public.refunds
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_registration(registration_id));

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_methods_owner_read ON public.payment_methods
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (owner_profile_id = ( SELECT public.current_profile_id() ));
CREATE POLICY payment_methods_owner_delete ON public.payment_methods
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (owner_profile_id = ( SELECT public.current_profile_id() ));
-- (INSERT happens server-side from the autopay-setup webhook; UPDATE never.)

-- Reconciliation audit (one row per nightly run).
CREATE TABLE public.reg_reconciliation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at        timestamptz NOT NULL DEFAULT now(),
  healed_rows   int NOT NULL DEFAULT 0,
  legacy_count  int NOT NULL,
  spine_count   int NOT NULL,
  legacy_paid_cents bigint NOT NULL,
  spine_paid_cents  bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','healed','mismatch'))
);
ALTER TABLE public.reg_reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY recon_admin_read ON public.reg_reconciliation_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = ( SELECT public.current_profile_id() ) AND p.is_admin = true));

-- ────────────────────────────────────────────────────────────────────────────
-- 2 ── Authority helper: who may administer a registration's money
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_admin_registration(p_registration_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.id = p_registration_id
      AND ((r.target_type = 'league'
              AND public.is_league_commissioner(r.target_id, public.current_profile_id()))
        OR (r.target_type = 'tournament'
              AND public.is_tournament_director(r.target_id, public.current_profile_id())))
  );
$$;
REVOKE ALL ON FUNCTION public.can_admin_registration(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_admin_registration(uuid) TO authenticated, service_role;

-- FAMILY-side money authority: who may pay an installment or enroll the plan
-- in Auto-Pay. Deliberately EXCLUDES the org-admin branch of
-- can_view_registration — a commissioner must never end up with their own
-- card bound to (and dunned for) a family's plan.
CREATE OR REPLACE FUNCTION public.can_manage_registration_money(p_registration_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.id = p_registration_id
      AND (
        (r.created_by IS NOT NULL AND r.created_by = public.current_profile_id())
        OR (r.registrant_type = 'profile' AND public.can_manage_profile(r.registrant_id))
        OR (r.household_id IS NOT NULL
            AND public.is_household_guardian(r.household_id, public.current_profile_id()))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_registration_money(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_manage_registration_money(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3 ── Refund (locked policy). Two halves:
--      prepare → validates + computes per-installment refunds (NO side effects)
--      record  → applies ledger changes after Stripe accepted the refund(s)
--      The registration-admin edge fn drives: prepare → stripe.refunds.create
--      per item → record. Caller identity comes from the fn via p_actor.
-- ────────────────────────────────────────────────────────────────────────────

-- Sliding scale from days-until-event-start. p_event_start NULL → caller must
-- pass an explicit pct (org override); the fn never guesses.
CREATE OR REPLACE FUNCTION public.reg4_refund_pct(p_event_start date)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_event_start IS NULL THEN NULL
    WHEN p_event_start - CURRENT_DATE > 14 THEN 100
    WHEN p_event_start - CURRENT_DATE >= 7 THEN 50
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.reg4_prepare_refund(
  p_registration_id uuid,
  p_actor uuid,                 -- caller profile id (edge fn passes verified identity)
  p_override_pct int DEFAULT NULL
) RETURNS TABLE (installment_id uuid, payment_intent text, refund_cents int, pct int,
                 prior_refunded_cents int)
-- VOLATILE: takes a registration row lock so two concurrent refund calls
-- serialize at prepare. The lock alone can't span the edge fn's multi-call
-- flow, so the real double-spend guards are (a) the Stripe idempotency key in
-- registration-admin and (b) reg4_record_refund's compare-and-set on
-- prior_refunded_cents — together a concurrent duplicate refunds Stripe ONCE
-- and records ONCE.
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reg record; v_pct int; v_start date;
BEGIN
  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id FOR UPDATE;
  IF v_reg.id IS NULL THEN RAISE EXCEPTION 'registration not found' USING errcode = '42704'; END IF;
  IF v_reg.status = 'cancelled' THEN RAISE EXCEPTION 'already cancelled' USING errcode = '22023'; END IF;

  IF v_reg.target_type = 'league' THEN
    SELECT start_date INTO v_start FROM public.leagues WHERE id = v_reg.target_id;
  ELSIF v_reg.target_type = 'tournament' THEN
    SELECT start_date INTO v_start FROM public.tournaments WHERE id = v_reg.target_id;
  END IF;
  v_pct := coalesce(p_override_pct, public.reg4_refund_pct(v_start));
  IF v_pct IS NULL THEN
    RAISE EXCEPTION 'event has no start date — pass an explicit refund percentage' USING errcode = '22023';
  END IF;
  IF v_pct NOT IN (0, 50, 100) THEN
    RAISE EXCEPTION 'refund percentage must be 0, 50 or 100' USING errcode = '22023';
  END IF;

  -- pct of the PAID base, per installment; processing + platform never refund.
  RETURN QUERY
  SELECT pi.id, pi.stripe_payment_intent_id,
         (pi.base_cents * v_pct / 100)::int - pi.refunded_cents,
         v_pct,
         pi.refunded_cents
  FROM public.payment_installments pi
  JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
  WHERE pp.registration_id = p_registration_id
    AND pi.status IN ('paid','partially_refunded')
    AND (pi.base_cents * v_pct / 100) - pi.refunded_cents > 0;
END $$;
REVOKE ALL ON FUNCTION public.reg4_prepare_refund(uuid,uuid,int) FROM public, anon, authenticated;

-- Compare-and-set on prior_refunded_cents: a concurrent duplicate (both calls
-- prepared the same refund; Stripe deduped via idempotency key) records ONCE —
-- the loser sees refunded_cents already advanced and returns 'stale'.
CREATE OR REPLACE FUNCTION public.reg4_record_refund(
  p_registration_id uuid,
  p_installment_id uuid,
  p_stripe_refund_id text,
  p_amount_cents int,
  p_pct int,
  p_actor uuid,
  p_prior_refunded_cents int,
  p_reason text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.payment_installments
  SET refunded_cents = refunded_cents + p_amount_cents,
      status = CASE WHEN refunded_cents + p_amount_cents >= base_cents
                    THEN 'refunded' ELSE 'partially_refunded' END
  WHERE id = p_installment_id
    AND refunded_cents = p_prior_refunded_cents;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN 'stale'; END IF;
  INSERT INTO public.refunds (registration_id, payment_installment_id, stripe_refund_id,
                              amount_cents, policy_pct, initiated_by, reason)
  VALUES (p_registration_id, p_installment_id, p_stripe_refund_id, p_amount_cents,
          p_pct, p_actor, p_reason);
  RETURN 'recorded';
END $$;
REVOKE ALL ON FUNCTION public.reg4_record_refund(uuid,uuid,text,int,int,uuid,int,text) FROM public, anon, authenticated;

-- Finalize: cancel everything still owed + the registration itself. Runs even
-- for a 0% refund (cancel without money movement). Also reverses the roster
-- assignment if one was made — the family is gone.
CREATE OR REPLACE FUNCTION public.reg4_finalize_cancellation(p_registration_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reg record;
BEGIN
  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id FOR UPDATE;
  UPDATE public.payment_installments pi
  SET status = 'cancelled'
  FROM public.payment_plans pp
  WHERE pp.id = pi.payment_plan_id AND pp.registration_id = p_registration_id
    AND pi.status IN ('scheduled','processing','past_due');
  UPDATE public.payment_plans SET status = 'cancelled'
  WHERE registration_id = p_registration_id AND status <> 'complete';
  UPDATE public.registrations SET status = 'cancelled' WHERE id = p_registration_id;
  IF v_reg.rostered_team_id IS NOT NULL AND v_reg.registrant_type = 'profile' THEN
    DELETE FROM public.team_members
    WHERE team_id = v_reg.rostered_team_id AND user_id = v_reg.registrant_id;
  END IF;
  PERFORM public.log_guardianship_event('registration_cancelled', p_actor,
            CASE WHEN v_reg.registrant_type = 'profile' THEN v_reg.registrant_id ELSE NULL END,
            v_reg.household_id, NULL,
            jsonb_build_object('registration_id', p_registration_id));
END $$;
REVOKE ALL ON FUNCTION public.reg4_finalize_cancellation(uuid,uuid) FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4 ── Dunning (SQL half): overdue marking + the autopay/reminder work queue
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reg4_mark_past_due()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.payment_installments
  SET status = 'past_due'
  WHERE status = 'scheduled' AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.payment_plans pp SET status = 'past_due'
  WHERE pp.status = 'active'
    AND EXISTS (SELECT 1 FROM public.payment_installments pi
                WHERE pi.payment_plan_id = pp.id AND pi.status = 'past_due');
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.reg4_mark_past_due() FROM public, anon, authenticated;

-- The dunning edge fn's work list: due/past-due installments on live plans,
-- with autopay details + who to notify. Retry cadence: ≥3 days between
-- attempts, max 4 attempts; after that it just sits past_due in AR.
CREATE OR REPLACE FUNCTION public.reg4_dunning_queue()
RETURNS TABLE (
  installment_id uuid, plan_id uuid, registration_id uuid, amount_cents int,
  base_cents int, due_date date, dunning_attempts int,
  autopay_customer text, autopay_payment_method text,
  owner_profile_id uuid, registrant_name text,
  target_type text, target_id uuid, organizer_profile_id uuid
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pi.id, pp.id, r.id, pi.amount_cents, pi.base_cents, pi.due_date, pi.dunning_attempts,
         pm.stripe_customer_id, pm.stripe_payment_method_id,
         coalesce(r.created_by, pm.owner_profile_id),
         p.name,
         r.target_type, r.target_id,
         CASE WHEN r.target_type = 'league' THEN (SELECT commissioner_id FROM public.leagues WHERE id = r.target_id)
              ELSE (SELECT director_id FROM public.tournaments WHERE id = r.target_id) END
  FROM public.payment_installments pi
  JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
  JOIN public.registrations r ON r.id = pp.registration_id
  LEFT JOIN public.payment_methods pm ON pm.id = pp.autopay_payment_method_id
  LEFT JOIN public.profiles p ON p.id = r.registrant_id AND r.registrant_type = 'profile'
  WHERE pi.status IN ('past_due')
    AND r.status IN ('pending','active')
    AND r.registrant_type = 'profile'   -- native player plans only; legacy
                                        -- team-entry mirror rows have nobody
                                        -- to notify and no autopay
    AND pi.dunning_attempts < 4
    AND (pi.last_dunning_at IS NULL OR pi.last_dunning_at < now() - interval '3 days');
$$;
REVOKE ALL ON FUNCTION public.reg4_dunning_queue() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reg4_record_dunning_attempt(
  p_installment_id uuid, p_ok boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.payment_installments
  SET dunning_attempts = dunning_attempts + CASE WHEN p_ok THEN 0 ELSE 1 END,
      last_dunning_at = now()
  WHERE id = p_installment_id;
END $$;
REVOKE ALL ON FUNCTION public.reg4_record_dunning_attempt(uuid,boolean,text) FROM public, anon, authenticated;

SELECT cron.schedule('rinkd-reg4-mark-past-due', '5 7 * * *',
  $$ SELECT public.reg4_mark_past_due(); $$);

-- ────────────────────────────────────────────────────────────────────────────
-- 5 ── AR aging + revenue (CROSSBAR-1 data). Org-admin gated inside.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reg4_money_summary(p_kind text, p_target uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean; v_out jsonb;
BEGIN
  IF p_kind = 'league' THEN v_ok := public.is_league_commissioner(p_target, public.current_profile_id());
  ELSIF p_kind = 'tournament' THEN v_ok := public.is_tournament_director(p_target, public.current_profile_id());
  ELSE RAISE EXCEPTION 'bad kind' USING errcode = '22023'; END IF;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'only the organizer can view money' USING errcode = '42501';
  END IF;

  WITH inst AS (
    SELECT pi.*, r.status AS reg_status
    FROM public.payment_installments pi
    JOIN public.payment_plans pp ON pp.id = pi.payment_plan_id
    JOIN public.registrations r ON r.id = pp.registration_id
    WHERE r.target_type = p_kind AND r.target_id = p_target
  )
  SELECT jsonb_build_object(
    'collected_today',     coalesce(sum(amount_cents - refunded_cents) FILTER (WHERE status IN ('paid','partially_refunded') AND paid_at::date = CURRENT_DATE), 0),
    'collected_yesterday', coalesce(sum(amount_cents - refunded_cents) FILTER (WHERE status IN ('paid','partially_refunded') AND paid_at::date = CURRENT_DATE - 1), 0),
    'collected_total',     coalesce(sum(amount_cents - refunded_cents) FILTER (WHERE status IN ('paid','partially_refunded','refunded')), 0),
    'refunded_total',      coalesce(sum(refunded_cents), 0),
    'outstanding',         coalesce(sum(amount_cents) FILTER (WHERE status IN ('scheduled','processing','past_due') AND reg_status <> 'cancelled'), 0),
    'past_due',            coalesce(sum(amount_cents) FILTER (WHERE status = 'past_due' AND reg_status <> 'cancelled'), 0),
    'aging', jsonb_build_object(
      'd1_30',  coalesce(sum(amount_cents) FILTER (WHERE status = 'past_due' AND CURRENT_DATE - due_date BETWEEN 1 AND 30), 0),
      'd31_60', coalesce(sum(amount_cents) FILTER (WHERE status = 'past_due' AND CURRENT_DATE - due_date BETWEEN 31 AND 60), 0),
      'd61_up', coalesce(sum(amount_cents) FILTER (WHERE status = 'past_due' AND CURRENT_DATE - due_date > 60), 0)),
    'by_month', (
      SELECT coalesce(jsonb_agg(m ORDER BY m->>'month'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'month', to_char(coalesce(paid_at::date, due_date), 'YYYY-MM'),
          'paid',     sum(amount_cents - refunded_cents) FILTER (WHERE status IN ('paid','partially_refunded')),
          'pending',  sum(amount_cents) FILTER (WHERE status IN ('scheduled','processing') AND reg_status <> 'cancelled'),
          'past_due', sum(amount_cents) FILTER (WHERE status = 'past_due' AND reg_status <> 'cancelled')
        ) AS m
        FROM inst
        WHERE status <> 'cancelled'   -- a lone cancelled row must not emit an all-null month
        GROUP BY to_char(coalesce(paid_at::date, due_date), 'YYYY-MM')
      ) months)
  ) INTO v_out FROM inst;
  RETURN coalesce(v_out, '{}'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.reg4_money_summary(text, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6 ── Reconciliation: nightly self-heal + alert on residue (locked design)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reg4_reconcile()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_healed int; v_lc int; v_sc int; v_lp bigint; v_sp bigint; v_status text; a record;
  v_before int; v_before_paid bigint;
BEGIN
  -- snapshot before the heal so "healed" is detectable (new/changed rows)
  SELECT count(*),
         coalesce(sum(pi.amount_cents) FILTER (WHERE pi.status IN ('paid','partially_refunded','refunded')), 0)
    INTO v_before, v_before_paid
  FROM public.registrations r
  LEFT JOIN public.payment_plans pp ON pp.registration_id = r.id
  LEFT JOIN public.payment_installments pi ON pi.payment_plan_id = pp.id
  WHERE r.source_kind <> 'native';

  -- 1. self-heal: idempotent re-sync of every legacy row into the spine
  PERFORM public.reg3_backfill_legacy();

  -- 2. compare: row counts + paid sums (legacy paid amount_total preferred,
  --    falling back to fee for pre-stamp rows — matching the mirror's rules)
  SELECT count(*),
         coalesce(sum(CASE WHEN paid_at IS NOT NULL THEN coalesce(amount_total_cents, fee_cents, 0) ELSE 0 END), 0)
    INTO v_lc, v_lp
  FROM (SELECT paid_at, amount_total_cents, fee_cents FROM public.league_registrations
        UNION ALL
        SELECT paid_at, amount_total_cents, fee_cents FROM public.tournament_registrations) l;
  SELECT count(*),
         coalesce(sum(pi.amount_cents) FILTER (WHERE pi.status IN ('paid','partially_refunded','refunded')), 0)
    INTO v_sc, v_sp
  FROM public.registrations r
  LEFT JOIN public.payment_plans pp ON pp.registration_id = r.id
  LEFT JOIN public.payment_installments pi ON pi.payment_plan_id = pp.id
  WHERE r.source_kind <> 'native';

  v_healed := greatest(v_sc - v_before, 0) + CASE WHEN v_sp <> v_before_paid THEN 1 ELSE 0 END;
  v_status := CASE WHEN v_lc <> v_sc OR v_lp <> v_sp THEN 'mismatch'
                   WHEN v_healed > 0 THEN 'healed'
                   ELSE 'ok' END;
  INSERT INTO public.reg_reconciliation_runs
    (healed_rows, legacy_count, spine_count, legacy_paid_cents, spine_paid_cents, status)
  VALUES (v_healed, v_lc, v_sc, v_lp, v_sp, v_status);

  -- 3. residue after the heal → notify every admin (in-app bell; rides the
  --    existing notifications pipeline)
  IF v_status = 'mismatch' THEN
    FOR a IN SELECT id FROM public.profiles WHERE is_admin = true LOOP
      INSERT INTO public.notifications (recipient_id, kind, body, url)
      VALUES (a.id, 'admin_alert',
              format('Registration ledger mismatch survived reconciliation: legacy %s rows/$%s vs spine %s rows/$%s.',
                     v_lc, round(v_lp / 100.0, 2), v_sc, round(v_sp / 100.0, 2)),
              '/admin');
    END LOOP;
  END IF;
  RETURN v_status;
END $$;
REVOKE ALL ON FUNCTION public.reg4_reconcile() FROM public, anon, authenticated;

SELECT cron.schedule('rinkd-reg4-reconcile-nightly', '10 7 * * *',
  $$ SELECT public.reg4_reconcile(); $$);
-- (07:10 UTC = 3:10am ET. The autopay-dunning cron — the Stripe half — is an
--  apply-day step with the shared cron bearer token; see REG3_APPLY_RUNBOOK.)
