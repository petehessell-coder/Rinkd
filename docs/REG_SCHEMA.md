# REG Mega-Build — Combined Schema (Phases 1–4, designed once)

**Created:** Jun 10, 2026 · **Canonical design:** `rinkd_v4/REGISTRATION_PARITY.md` (signed off May 25) · **Execution brief:** `rinkd_v4/REG_MEGABUILD_FABLE5_BRIEF.md`
**Rule:** build with this full schema in view; ship Phases 1→4 as separate PRs. Nothing in a later phase forces a retrofit of an earlier one.

## Phase map

| Phase | Tables / surface | PR | Status |
|---|---|---|---|
| 1 | `profiles` decouple (`auth_user_id`, `account_type`) + `current_profile_id()` + full RLS migration; `households`, `household_members`, `household_invites`, `guardianship_claims`, `guardianship_audit`, `profile_credentials` stub; Henry #17 data migration | `feature/reg-1-identity-spine` | **this PR** |
| 2 | No new tables (migration E = RLS only). Switcher ("acting as"), per-person cards, claim/invite/consent UI, FAMILY-1 under-13 RSVP (RSVP writes act through `can_manage_profile`); roster-anchor hardening (managers can't bind a minor → `is_org_admin_for_minor` trustworthy) | `feature/reg-2-family-ux` | **built Jun 10** |
| 3 | `registrations`, `payment_plans`, `payment_installments` (one-time = single installment), `waiver_templates`, `waiver_acceptances`; player checkout (`register-player` fn); legacy team-entry mirrored into the spine via trigger + backfill; Stripe Connect (sandbox) | `feature/reg-3-checkout` | **built Jun 11** |
| 4 | `payment_methods`, `refunds` (append-only), `reg_reconciliation_runs`; installments at checkout (per-event `player_installments_max`, per-installment gross-up + `base_cents`); dunning (past-due cron + autopay worker + reminders); refund RPCs (locked: scale% of PAID base, cancel the rest, fees never refunded); `reg4_money_summary` AR/aging/by-month; nightly self-heal reconciliation; STRIPE_REG secret split | `feature/reg-4-ar-autopay` | **built Jun 11** |

## Phase 1 (shipped in this PR — see migrations 20260615000000–000300)

Locked decisions honored: under-13 = first-class `profiles` row, `auth_user_id NULL`, no login · co-parent = shared household · linking never unilateral (invite/claim/approve + audit) · `current_profile_id()` is the single RLS indirection · org roster is the anchor of truth · software never adjudicates custody.

Key invariants enforced in DB, not convention:
- `profiles_minor_no_login_chk`: `account_type='minor' ⇒ auth_user_id IS NULL`.
- `guardianship_audit` is append-only (REVOKE UPDATE/DELETE; no write policies; definer-fn writes only).
- Managed profiles are minted ONLY by `create_managed_profile()` (profiles INSERT policy requires `auth_user_id = auth.uid()`).
- Duplicate kid (name+DOB) → `guardianship_claims` row, never a twin profile.
- Claim approval: existing guardian OR `is_org_admin_for_minor()` (rostering team manager / league commissioner); claimant can never self-approve.

## Phase 3/4 DDL (designed now, shipped in Phase 3 PR)

```sql
CREATE TABLE registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_type text NOT NULL CHECK (registrant_type IN ('profile','team')),
  registrant_id   uuid NOT NULL,           -- profiles.id OR teams.id (polymorphic; no FK — guarded by trigger)
  target_type     text NOT NULL CHECK (target_type IN ('league','tournament','program')),
  target_id       uuid NOT NULL,
  household_id    uuid REFERENCES households(id) ON DELETE SET NULL,  -- family roll-up when registrant is a profile
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','cancelled','waitlisted')),
  amount_cents    int  NOT NULL CHECK (amount_cents >= 0),
  currency        text NOT NULL DEFAULT 'usd',
  created_by      uuid NOT NULL REFERENCES profiles(id),   -- who performed it (guardian for a minor)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id      uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  total_cents          int NOT NULL,
  platform_fee_cents   int NOT NULL,   -- Rinkd 1%
  processing_fee_cents int NOT NULL,   -- Stripe 2.9% + 30¢, passed through to registrant at cost
  plan_type            text NOT NULL CHECK (plan_type IN ('one_time','installments')),
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','complete','past_due','cancelled')),
  stripe_customer_id   text,
  autopay_payment_method_id uuid,      -- Phase 4 (FK added then)
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_installments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_plan_id          uuid NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  due_date                 date NOT NULL,        -- one-time = single row due today
  amount_cents             int NOT NULL,
  status                   text NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled','processing','paid','past_due','refunded','partially_refunded')),
  stripe_payment_intent_id text,
  paid_at                  timestamptz,
  refunded_cents           int NOT NULL DEFAULT 0,   -- Phase 4 sliding-scale refunds
  dunning_attempts         int NOT NULL DEFAULT 0,   -- Phase 4
  last_dunning_at          timestamptz,              -- Phase 4
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- LA-2: waivers + guardian consent at registration
CREATE TABLE waiver_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('league','tournament')),
  owner_id uuid NOT NULL,
  title text NOT NULL, body_md text NOT NULL, version int NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE waiver_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiver_template_id uuid NOT NULL REFERENCES waiver_templates(id),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  subject_profile_id uuid REFERENCES profiles(id),  -- whom the waiver covers (the minor)
  accepted_by uuid NOT NULL REFERENCES profiles(id),-- who consented (guardian for minors)
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text, user_agent text,
  UNIQUE (waiver_template_id, registration_id, subject_profile_id)
);
```

Notes locked now so Phase 3 starts clean:
- **AR aging / family invoices read the same rows**: org view aggregates `payment_installments` by `due_date`+`status`; family view filters `registrations.household_id`. No parallel schema.
- **Fee math** (per `docs/Rinkd_Pricing_Guide.docx`): registrant pays `total = base + processing_fee`; organizer receives `base − platform_fee(1%)` via Connect destination charge with `application_fee_amount = platform_fee + processing_fee`.
- **Refund sliding scale** (100% >14d / 50% 7–14d / 0% <7d; tech fee non-refundable once event runs) lands in `refunded_cents` + a Phase-4 `refunds` ledger keyed to `stripe_refund_id`. Refund × partially-paid-installments proration = open question #3 in REGISTRATION_PARITY §6 — decide before Phase 4 ships.
- **Team registrant reference** (open question #2 — RESOLVED at Phase 3 kickoff, Jun 11): `registrant_id` points at the **event-scoped team row** (`league_teams`/`tournament_teams` id) and is **NULL until the webhook creates it** — nameplate league teams often have no global `teams` row at registration time, so the global-id plan was unimplementable. Enforced by CHECK: profile registrants must have a registrant_id; team registrants may be NULL.
- **Spine = ledger (locked Jun 11)**: the team-entry flow stays untouched; `tr_mirror_league_registration` / `tr_mirror_tournament_registration` mirror legacy rows into the spine (idempotent on `source_kind`/`source_id`); `reg3_backfill_legacy()` re-syncs at will. Phase 4 reads ONLY the spine.
- **Assign-to-roster is league-only in v1** — `tournament_teams` has no global `team_id`, so tournament rosters stay manual. `assign_registrant_to_team` uses migration E's consented `rinkd.allow_minor_roster` gate; a paid guardian-created registration is the consent.
- **RLS sketch**: registrant self-read (`can_manage_profile(registrant_id)` for profile-type, `is_team_manager` for team-type), household roll-up read (`is_household_guardian(household_id, current_profile_id())`), org read/manage (`is_league_commissioner` / `is_tournament_director` on target), writes via checkout RPCs + Stripe webhook (service role).

## PostgREST embed discipline (P0 footgun — Jun 2 outage)
`household_members`, `guardianship_claims`, `guardianship_audit`, `registrations`, `waiver_acceptances` all carry ≥2 FKs to `profiles`. **Every client embed of profiles from these tables MUST be FK-qualified** (e.g. `profiles!household_members_profile_id_fkey(...)`) — never bare `profiles(...)`. Verify via live REST embed after each phase's migrations.
