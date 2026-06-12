import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// REG-4 — organizer money actions on a registration. v1 action: 'refund'
// (CROSSBAR-1 registration management). AUTH REQUIRED; the caller's authority
// is decided by can_admin_registration under THEIR JWT — this fn never trusts
// the body for identity or money.
//
// Refund (locked policy, Pete Jun 11): scale% (100/50/0 by days-to-event, org
// override when the event has no start date) of the BASE of installments the
// family actually PAID; every unpaid installment cancels; Rinkd 1% + Stripe
// processing never refund. Flow per installment: reg4_prepare_refund (pure
// computation) → stripe.refunds.create → reg4_record_refund; then
// reg4_finalize_cancellation cancels the remainder + the registration and
// un-rosters the player. A Stripe failure mid-list leaves recorded successes
// and returns 500 — re-running resumes exactly where it stopped (prepare
// subtracts refunded_cents).
//
// Registrations use STRIPE_REG_SECRET_KEY (sandbox until launch) and never
// the merch store's live key.

const STRIPE_KEY = Deno.env.get("STRIPE_REG_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)
  try {
    if (!STRIPE_KEY) return json({ error: "stripe not configured" }, 500)

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ error: "sign in" }, 401)
    const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: { user }, error: uErr } = await asCaller.auth.getUser()
    if (uErr || !user) return json({ error: "invalid session" }, 401)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: callerProfile } = await svc
      .from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle()
    if (!callerProfile) return json({ error: "profile not found" }, 401)

    const body = await req.json()
    if (body.action !== "refund") return json({ error: "unknown action" }, 400)
    const registrationId = body.registrationId
    if (!registrationId) return json({ error: "missing registrationId" }, 400)
    const overridePct = [0, 50, 100].includes(body.overridePct) ? body.overridePct : null

    // Authority — decided by RLS-grade SQL under the caller's JWT.
    const { data: mayAdmin, error: aErr } = await asCaller.rpc("can_admin_registration", {
      p_registration_id: registrationId,
    })
    if (aErr || mayAdmin !== true) {
      return json({ error: "only the organizer can refund a registration" }, 403)
    }

    // Compute the refund plan (no side effects).
    const { data: items, error: pErr } = await svc.rpc("reg4_prepare_refund", {
      p_registration_id: registrationId,
      p_actor: callerProfile.id,
      p_override_pct: overridePct,
    })
    if (pErr) {
      const msg = pErr.message || "could not prepare refund"
      const status = msg.includes("start date") || msg.includes("percentage") ? 409 : 500
      return json({ error: msg, reason: msg.includes("start date") ? "needs_pct" : undefined }, status)
    }

    const stripe = new Stripe(STRIPE_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    let refundedCents = 0
    for (const it of (items || [])) {
      // Double-spend protocol (see reg4_prepare_refund/record_refund):
      //  • the Stripe refund carries an idempotency key derived from the
      //    installment + its pre-refund state, so a concurrent duplicate or a
      //    retry returns the SAME refund object instead of refunding twice;
      //  • the ledger record is a compare-and-set on prior_refunded_cents —
      //    the duplicate's record comes back 'stale' and is skipped.
      const idemKey = `reg4-refund-${it.installment_id}-${it.prior_refunded_cents}-${it.refund_cents}`

      if (!it.payment_intent) {
        // Paid outside Stripe (manual mark-paid, future) — record ledger-only.
        const { data: rec } = await svc.rpc("reg4_record_refund", {
          p_registration_id: registrationId, p_installment_id: it.installment_id,
          p_stripe_refund_id: null, p_amount_cents: it.refund_cents, p_pct: it.pct,
          p_actor: callerProfile.id, p_prior_refunded_cents: it.prior_refunded_cents,
          p_reason: body.reason || null,
        })
        if (rec !== "stale") refundedCents += it.refund_cents
        continue
      }

      // The customer gets pct×base back. On destination charges that money is
      // sourced per the locked split: the organizer reverses their 99% pro-rata
      // share via an EXPLICIT transfer reversal (Stripe's reverse_transfer:true
      // is proportional to the grossed-up charge and would make Rinkd eat ~4%
      // of every refunded base — measured, rejected); Rinkd funds the
      // remaining 1% slice, i.e. gives back its platform fee on the refunded
      // portion. Processing fees are never refunded to anyone (Stripe keeps
      // its cut regardless).
      const intent = await stripe.paymentIntents.retrieve(it.payment_intent, {
        expand: ["latest_charge"],
      })
      const isDestination = !!(intent as any)?.transfer_data
      const refund = await stripe.refunds.create({
        payment_intent: it.payment_intent,
        amount: it.refund_cents,
      }, { idempotencyKey: idemKey })

      if (isDestination) {
        const transferId = (intent as any)?.latest_charge?.transfer
        if (transferId) {
          const reversal = Math.round(it.refund_cents * 0.99)
          try {
            await stripe.transfers.createReversal(transferId, { amount: reversal },
              { idempotencyKey: `${idemKey}-rev` })
          } catch (revErr) {
            // Refund went out but the organizer clawback failed (e.g. already
            // fully reversed). Record the refund anyway — the ledger must
            // reflect the customer's money — and flag for manual follow-up.
            console.error("[registration-admin] transfer reversal failed", { transfer: transferId, error: (revErr as Error)?.message })
          }
        }
      }

      const { data: rec, error: recErr } = await svc.rpc("reg4_record_refund", {
        p_registration_id: registrationId, p_installment_id: it.installment_id,
        p_stripe_refund_id: refund.id, p_amount_cents: it.refund_cents, p_pct: it.pct,
        p_actor: callerProfile.id, p_prior_refunded_cents: it.prior_refunded_cents,
        p_reason: body.reason || null,
      })
      if (recErr) {
        // Stripe refunded but the ledger write errored. SAFE TO RETRY: the
        // idempotency key returns the same refund and the compare-and-set
        // makes the record exactly-once.
        console.error("[registration-admin] ledger write failed after Stripe refund — retry is safe", { refund: refund.id, error: recErr.message })
        return json({ error: `refund ${refund.id} succeeded at Stripe but the ledger write failed — retry this refund (it is idempotent)`, refundId: refund.id, retryable: true }, 500)
      }
      if (rec !== "stale") refundedCents += it.refund_cents
    }

    // Cancel everything still owed + the registration (runs for 0% too).
    const { error: finErr } = await svc.rpc("reg4_finalize_cancellation", {
      p_registration_id: registrationId, p_actor: callerProfile.id,
    })
    if (finErr) return json({ error: `refunded but cancellation failed: ${finErr.message}` }, 500)

    return json({ ok: true, refundedCents, items: (items || []).length })
  } catch (err) {
    console.error("[registration-admin] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
