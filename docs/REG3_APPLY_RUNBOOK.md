# REG-3 apply-day runbook (post-pilot, after Phases 1–2)

**Branch:** `feature/reg-3-checkout` · **Created:** Jun 11, 2026
**Hard rule:** sandbox only until paid-registration launch. The Stripe account is live-mode active for the merch store — `STRIPE_SECRET_KEY` must be flipped to the **sandbox** key for the registration test window (the merch store shares the secret: don't run a merch purchase during the sandbox window, or split the secrets first — see §4).

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

## 4. Recommended follow-up (Phase 4): split secrets
Give registrations their own `STRIPE_REG_SECRET_KEY` so the merch store (live) and registrations (sandbox until launch) never share a key. One-line change in `register-player`/`stripe-checkout`/`stripe-webhook` once Phase 4 lands.
