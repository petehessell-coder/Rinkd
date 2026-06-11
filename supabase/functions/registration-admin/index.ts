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
      if (!it.payment_intent) {
        // Paid outside Stripe (manual mark-paid, future) — record ledger-only.
        await svc.rpc("reg4_record_refund", {
          p_registration_id: registrationId, p_installment_id: it.installment_id,
          p_stripe_refund_id: null, p_amount_cents: it.refund_cents, p_pct: it.pct,
          p_actor: callerProfile.id, p_reason: body.reason || null,
        })
        refundedCents += it.refund_cents
        continue
      }
      // Destination charges: reverse_transfer pulls the refund back from the
      // organizer proportionally to the charge; refund_application_fee stays
      // false (Rinkd's 1% is non-refundable by policy). Plain charges (org not
      // connected at payment time) take a plain refund — Stripe rejects the
      // transfer params on those, so detect from the intent.
      const intent = await stripe.paymentIntents.retrieve(it.payment_intent)
      const isDestination = !!(intent as any)?.transfer_data
      const refund = await stripe.refunds.create({
        payment_intent: it.payment_intent,
        amount: it.refund_cents,
        ...(isDestination ? { reverse_transfer: true, refund_application_fee: false } : {}),
      })
      const { error: recErr } = await svc.rpc("reg4_record_refund", {
        p_registration_id: registrationId, p_installment_id: it.installment_id,
        p_stripe_refund_id: refund.id, p_amount_cents: it.refund_cents, p_pct: it.pct,
        p_actor: callerProfile.id, p_reason: body.reason || null,
      })
      if (recErr) {
        // Stripe refunded but our ledger write failed — surface loudly; the
        // re-run is safe (prepare subtracts refunded_cents only after record,
        // so this installment would double-refund — STOP and flag instead).
        console.error("[registration-admin] LEDGER WRITE FAILED AFTER STRIPE REFUND", { refund: refund.id, error: recErr.message })
        return json({ error: `refund ${refund.id} succeeded at Stripe but ledger write failed — do NOT retry; fix the ledger row manually`, refundId: refund.id }, 500)
      }
      refundedCents += it.refund_cents
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
