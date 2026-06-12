# REG-3 apply-day runbook (post-pilot, after Phases 1–2)

**Branch:** `feature/reg-3-checkout` · **Created:** Jun 11, 2026
**Hard rule:** sandbox only until paid-registration launch. The Stripe account is live-mode active for the merch store — `STRIPE_SECRET_KEY` must be flipped to the **sandbox** key for the registration test window (the merch store shares the secret: don't run a merch purchase during the sandbox window, or split the secrets first — see §4).

## 0. Pre-apply gate (run FIRST, the morning of apply day)
```
node scripts/reg-smoke/pglite-migrations.mjs
```
Applies A→G **verbatim to a real Postgres (PGlite) seeded with prod-shaped
pre-state** — the exact policy/constraint/function names the migrations DROP
or REPLACE, profiles' current FK shape, and Migration D's real Henry/Pete rows
(so D runs its REAL path, not the off-prod no-op) — then runs 27 shape +
behavior checks (decouple, mechanical sweeps, household spine, minor gate,
legacy mirror, fee math, refund scale). **ALL PASS required before step 1.**

Why: LRS-1 Migration J was an apply-blocker because prod carried an abandoned
same-name table that an empty-DB harness couldn't see. A–G were audited
against live prod **Jun 12, 2026 — zero collisions** (all 14 new tables / 13
indexes / 4 triggers / new columns are unclaimed; the 5 functions B replaces
match prod signatures exactly; all 7 plain `DROP POLICY` and 11 plain
`DROP CONSTRAINT` names exist verbatim; D's hardcoded rows re-verified). The
harness seed encodes that audited state — if a hotfix renames any of those
objects between now and apply day, this gate fails the way prod would.
Also re-check live drift for the exact-name DROPs:
```sql
select conname from pg_constraint where conname in
 ('profiles_id_fkey','league_manager_invites_invited_by_fkey','league_manager_invites_consumed_by_user_id_fkey',
  'team_manager_invites_invited_by_fkey','team_manager_invites_consumed_by_user_id_fkey','league_roles_user_id_fkey',
  'league_subscriptions_user_id_fkey','tournament_subscriptions_user_id_fkey','nav_pins_user_id_fkey',
  'volunteer_slots_assigned_user_id_fkey','volunteer_slots_created_by_fkey');   -- expect 11 rows
select policyname from pg_policies where (tablename,policyname) in
 (('profiles','Users can insert their own profile'),('profiles','Users can update their own profile'),
  ('team_members','team_members_insert_by_manager'),('team_members','team_members_manager_update'),
  ('team_game_rsvps','rsvp_user_insert'),('team_game_rsvps','rsvp_user_update'),('team_game_rsvps','rsvp_user_delete'));  -- expect 7 rows
```

## 1. Order of operations
1. Merge PR #1 → apply migrations **A → B → C → D** (MCP `apply_migration`).
2. Merge PR #2 → apply **E**.
3. Merge PR #3 → apply **F** (`20260615000500`). F runs the legacy backfill itself; verify with
   `SELECT count(*) FROM registrations;` (≥ legacy row count) and zero `reg3 mirror failed` warnings in logs.
4. Deploy edge functions: `register-player` (new), `stripe-webhook` (updated — player branch), `delete-account` (updated in PR #1). `stripe-checkout` / `stripe-connect` unchanged.
5. Deploy the client (Vercel).
6. Run `scripts/reg-smoke/run.js` (Phase-1 suite) against prod with real keys.

## 2. Stripe sandbox setup (Pete, dashboard — see docs/STRIPE_CONNECT_SETUP.md)
1. Create sandbox `rinkd-reg-dev`; copy `sk_test_…`.
2. `supabase secrets set STRIPE_SECRET_KEY=sk_test_…` (window-scoped; restore live key after).
3. Sandbox webhook endpoint → `/functions/v1/stripe-webhook`; `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…`.
4. Connect platform profile in the sandbox per STRIPE_CONNECT_SETUP.md §2 (Express, platform, destination charges).

## 3. Sandbox end-to-end script (≈10 min, on a phone)
1. As a commissioner: league manage → Player registration → set fee $10, add a waiver, toggle open, copy link. Connect payouts via the sandbox Express onboarding (test data).
2. Open the link signed-out → sign up → "Add a child" inline → accept waiver → Pay → Stripe test card `4242 4242 4242 4242`.
3. Verify: success screen; `registrations.status='active'`; installment `paid` with `stripe_payment_intent_id`; waiver_acceptance row (subject=kid, accepted_by=parent); kid's PersonCard shows "✓ Paid".
4. In the sandbox Stripe dashboard: payment shows app fee = 1% of base + processing passthrough; organizer's Express account received base − 1%.
5. Org side: Players list shows the kid ✓ Paid → Assign to team → kid appears on the roster (guardianship_audit has `registrant_rostered`).
6. Duplicate check: registering the same kid again → friendly "already registered".
7. Team-entry mirror: run one legacy team registration (register page) → confirm a spine row appears with matching installment.
8. **Restore the live `STRIPE_SECRET_KEY`** and re-run one merch-store load to confirm the store is unaffected.

## 4. Phase 4 additions (apply with migration G, `20260615000600`)

### 4a. Secret split (SHIPPED in Phase 4 — set these instead of touching STRIPE_SECRET_KEY)
Registrations and the merch store no longer share a key. Set:
- `STRIPE_REG_SECRET_KEY` = the **sandbox** secret key (`sk_test_…`)
- `STRIPE_REG_WEBHOOK_SECRET` = the sandbox webhook signing secret
- `CRON_KEY` already exists (shared cron bearer)

The store's `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` stay LIVE and untouched — **§2's "flip the secret" step is superseded**; never flip it. The webhook verifies signatures against both secrets and uses the matching environment's API key. All registration fns (`register-player`, `stripe-checkout`, `stripe-connect`, `pay-installment`, `setup-autopay`, `registration-admin`, `process-dunning`) read `STRIPE_REG_SECRET_KEY ?? STRIPE_SECRET_KEY`.

### 4b. Deploy + cron
1. Deploy new fns: `registration-admin`, `process-dunning`, `pay-installment`, `setup-autopay` (+ redeploy `stripe-webhook`, `register-player`, `stripe-checkout`, `stripe-connect`).
2. Migration G self-schedules the two SQL crons (`rinkd-reg4-mark-past-due` 07:05 UTC, `rinkd-reg4-reconcile-nightly` 07:10 UTC). Schedule the Stripe-touching dunning worker manually (same pattern as the other fn crons, with the real cron token):
```sql
SELECT cron.schedule('rinkd-reg4-dunning-daily', '20 7 * * *', $$
  select net.http_post(
    url := 'https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/process-dunning',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <CRON_KEY>'),
    body := '{}'::jsonb, timeout_milliseconds := 120000) as request_id;
$$);
```
3. Add Stripe webhook events in the SANDBOX endpoint: `checkout.session.expired` (resume path) and `payment_intent.succeeded` (off-session dunning recovery — its ONLY webhook). Setup-mode sessions already arrive via `checkout.session.completed`.

### 4c. Phase 4 sandbox end-to-end (≈10 min, after §3)
1. Set the league's player fee to $30 with **Max installments 3**; register a kid choosing "3 payments" → pay 1 of 3 ($10.33 test card). Verify: registration `active`, installments 1 paid / 2 scheduled (monthly), PersonCard shows it, **Feed shows "You owe $10.33 for <kid>"**.
2. `/family` → Pay now on installment 2 → test card → receipt appears; **Set up Auto-Pay** on the plan → hosted card entry → `payment_methods` row + plan bound.
3. Backdate installment 3's `due_date` to yesterday; run `SELECT reg4_mark_past_due();` then invoke `process-dunning` with the cron token → installment charged off-session via the saved card → paid; plan `complete`.
4. Org money view: tiles/aging/by-month reflect the above. **Refund** the registration → confirm 50%-window math (or override), Stripe refund visible in sandbox, unpaid rows `cancelled`, kid removed from roster.
5. `SELECT reg4_reconcile();` → run row `ok`; check `/admin` notification path by inserting a bogus orphan spine row and re-running (then delete it).
