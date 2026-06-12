# Stripe Connect — dashboard settings for Pete (apply at Phase 3, not before)

**Account:** Rinkd LLC (`acct_1TVe5DRtBvaT2fQY`) · **Created:** Jun 10, 2026
**Rule (REG brief §6):** don't pre-configure Connect. Apply these when the Phase 3 PR is in review so the dashboard and the code agree. **All development/testing happens in a SANDBOX — the account is live-mode active; never point the build at live keys.** Live flip is a paid-registration launch step.

## 1. Create the sandbox (do this first)
1. Dashboard top-right → environment switcher → **Sandboxes** → **Create sandbox** → name it `rinkd-reg-dev`.
2. Inside the sandbox: **Developers → API keys** → copy the sandbox **secret key** (`sk_test_…`) and **publishable key** (`pk_test_…`).
3. Set Supabase edge-function secrets (sandbox values only):
   - `STRIPE_SECRET_KEY` = sandbox secret key
   - `STRIPE_WEBHOOK_SECRET` = created in step 4 below
   (The deployed `stripe-connect` / `stripe-checkout` / `stripe-webhook` functions read these — we extend those functions, not rebuild.)
4. Sandbox → **Developers → Webhooks → Add endpoint**:
   - URL: `https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`, `payout.failed`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.

## 2. Connect platform profile (inside the sandbox)
**Connect → Get started** (first time) — the questionnaire:
| Question | Answer |
|---|---|
| What are you building? | **A platform** (NOT a marketplace) |
| Who will use it? | Businesses/organizations (leagues, tournament operators) |
| How will connected accounts be onboarded? | **Stripe-hosted onboarding (Express)** |
| Who handles disputes/refunds liability? | **The connected account** (organizer) — matches destination charges with `on_behalf_of` |
| Account types | **Express** |

**Connect → Settings:**
- **Branding:** name `Rinkd`, icon + brand color (navy `#2E5B8C`) — this is what organizers see during Express onboarding.
- **Payouts:** payout schedule **Daily — automatic** (default; organizers can change their own).
- **Platform controls:** leave Stripe-managed risk/compliance ON (Express default).

## 3. Charge configuration (matches the Phase 3 code — for review, not dashboard entry)
- **Charge type:** destination charges on the platform account, `transfer_data[destination] = {organizer acct}`, `on_behalf_of = {organizer acct}`.
- **Application fee:** `application_fee_amount = platform_fee (1%) + processing_fee passthrough`. (Coach product uses 5% — COACH-1..4 is out of scope for this build; the rate lives per-product in code, not dashboard.)
- **Registrant pays:** base + processing fee (2.9% + 30¢) — passed through at cost; organizer nets base − 1%.
- **Stripe Tax:** OFF for registrations v1 (youth-sports registration fees; revisit with counsel). The merch checkout's Stripe Tax config is separate — don't touch it.

## 4. What NOT to do
- ❌ No changes in **live mode** — the merch store (`store-checkout`) runs there.
- ❌ Don't onboard any real organizer Express account before launch sign-off (0 connected accounts exist today; first real one is a launch event).
- ❌ Don't enable Connect "marketplace" OAuth (Standard) flows — Express only.

## 5. Launch-day flip (later, separate checklist)
Repeat §1.4 webhook + §2 platform profile in **live mode**, swap Supabase secrets to live keys, onboard the first organizer, run one $1 end-to-end registration, refund it, verify the 1% fee landed.
