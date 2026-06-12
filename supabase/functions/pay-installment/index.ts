import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// REG-4 — "Pay now" for a single scheduled/past-due installment (family side).
// AUTH REQUIRED; visibility decided by can_view_registration under the
// caller's JWT. Creates a Checkout session that completes through the SAME
// webhook path as first-time player checkout (kind='player' →
// reg3_mark_installment_paid). Registrations use STRIPE_REG_SECRET_KEY.

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
function safeBase(appUrl: unknown): string {
  const fallback = "https://rinkd.app"
  if (typeof appUrl !== "string") return fallback
  const ok = /^https?:\/\/(localhost(:\d+)?|([a-z0-9-]+\.)?rinkd\.app)(\/|$)/i.test(appUrl)
  return ok ? appUrl.replace(/\/+$/, "") : fallback
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

    const body = await req.json()
    const installmentId = body.installmentId
    if (!installmentId) return json({ error: "missing installmentId" }, 400)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: inst } = await svc
      .from("payment_installments")
      .select("id, amount_cents, base_cents, status, stripe_session_id, payment_plan_id, plan:payment_plans(registration_id)")
      .eq("id", installmentId).maybeSingle()
    if (!inst) return json({ error: "installment not found" }, 404)
    if (inst.status === "paid" || inst.status === "refunded") return json({ error: "already paid" }, 409)
    if (inst.status === "cancelled") return json({ error: "this payment was cancelled" }, 409)

    const registrationId = (inst.plan as any)?.registration_id
    // FAMILY-side authority only (creator / guardian) — the organizer's tool
    // for a delinquent registration is Refund, not paying it themselves.
    const { data: mayPay, error: vErr } = await asCaller.rpc("can_manage_registration_money", {
      p_registration_id: registrationId,
    })
    if (vErr || mayPay !== true) return json({ error: "only the family can pay this installment" }, 403)

    const { data: reg } = await svc
      .from("registrations")
      .select("id, status, target_type, target_id, registrant_id")
      .eq("id", registrationId).maybeSingle()
    if (!reg || reg.status === "cancelled") return json({ error: "registration is cancelled" }, 409)

    const parentTable = reg.target_type === "tournament" ? "tournaments" : "leagues"
    const ownerCol = reg.target_type === "tournament" ? "director_id" : "commissioner_id"
    const { data: parent } = await svc
      .from(parentTable).select(`id, name, ${ownerCol}`).eq("id", reg.target_id).maybeSingle()

    let connected: string | null = null
    if (parent?.[ownerCol]) {
      const { data: acct } = await svc.from("stripe_connect_accounts")
        .select("stripe_account_id, charges_enabled")
        .eq("owner_profile_id", parent[ownerCol]).maybeSingle()
      if (acct?.stripe_account_id && acct.charges_enabled) connected = acct.stripe_account_id
    }

    const stripe = new Stripe(STRIPE_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // One live session per installment: if a prior checkout is still open
    // (status 'processing' with a session), expire it before minting a new
    // one — two open sessions for the same installment = a manual
    // double-charge path (the second payment would record 'already_processed'
    // but the card was still hit twice).
    if (inst.status === "processing" && inst.stripe_session_id) {
      try { await stripe.checkout.sessions.expire(inst.stripe_session_id) }
      catch (_e) { /* already expired/completed — fine */ }
    }

    const base = safeBase(body.appUrl)
    const processing = inst.amount_cents - inst.base_cents
    const lineItems: Record<string, any>[] = [{
      quantity: 1,
      price_data: {
        currency: "usd", unit_amount: inst.base_cents,
        product_data: { name: `${parent?.name || "Registration"} — installment` },
      },
    }]
    if (processing > 0) {
      lineItems.push({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: processing, product_data: { name: "Processing fee" } },
      })
    }
    const sessionParams: Record<string, any> = {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      line_items: lineItems,
      metadata: { kind: "player", installment_id: inst.id, registration_id: registrationId },
      success_url: `${base}/family?paid=1`,
      cancel_url: `${base}/family?canceled=1`,
    }
    if (connected) {
      sessionParams.payment_intent_data = {
        application_fee_amount: inst.amount_cents - Math.round(inst.base_cents * 0.99),
        transfer_data: { destination: connected },
      }
    }
    const session = await stripe.checkout.sessions.create(sessionParams)
    await svc.from("payment_installments")
      .update({ stripe_session_id: session.id, status: "processing" })
      .eq("id", inst.id)
    return json({ url: session.url })
  } catch (err) {
    console.error("[pay-installment] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
