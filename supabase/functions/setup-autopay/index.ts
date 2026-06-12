import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// REG-4 — Auto-Pay enrollment. AUTH REQUIRED. Uses Stripe Checkout in
// mode='setup' (hosted card entry — the repo has no client-side Stripe.js by
// design), so the card is saved to a platform-account Customer; the webhook
// (kind='autopay_setup') stores the payment method + binds it to the plan.
// Off-session dunning charges then run as destination charges from the
// platform Customer. Registrations use STRIPE_REG_SECRET_KEY.

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
    const planId = body.planId
    if (!planId) return json({ error: "missing planId" }, 400)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: callerProfile } = await svc
      .from("profiles").select("id, email, name").eq("auth_user_id", user.id).maybeSingle()
    if (!callerProfile) return json({ error: "profile not found" }, 401)

    const { data: plan } = await svc
      .from("payment_plans").select("id, registration_id, status").eq("id", planId).maybeSingle()
    if (!plan) return json({ error: "plan not found" }, 404)
    if (plan.status === "cancelled" || plan.status === "complete") {
      return json({ error: "this plan has no upcoming payments" }, 409)
    }
    // FAMILY-side authority only (creator / guardian of the registrant /
    // household guardian) — can_view_registration would also admit the org
    // admin, whose card must never end up bound to (and dunned for) a
    // family's plan.
    const { data: mayPay, error: vErr } = await asCaller.rpc("can_manage_registration_money", {
      p_registration_id: plan.registration_id,
    })
    if (vErr || mayPay !== true) return json({ error: "only the family can set up Auto-Pay for this plan" }, 403)

    const stripe = new Stripe(STRIPE_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // Reuse the caller's existing platform Customer (any saved card row), else
    // create one keyed to their profile.
    let customerId: string | null = null
    const { data: existingPm } = await svc
      .from("payment_methods").select("stripe_customer_id")
      .eq("owner_profile_id", callerProfile.id).limit(1).maybeSingle()
    if (existingPm?.stripe_customer_id) customerId = existingPm.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: callerProfile.email || user.email || undefined,
        name: callerProfile.name || undefined,
        metadata: { profile_id: callerProfile.id },
      })
      customerId = customer.id
    }

    const base = safeBase(body.appUrl)
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      metadata: {
        kind: "autopay_setup",
        plan_id: planId,
        owner_profile_id: callerProfile.id,
      },
      success_url: `${base}/family?autopay=1`,
      cancel_url: `${base}/family?autopay=0`,
    })
    return json({ url: session.url })
  } catch (err) {
    console.error("[setup-autopay] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
