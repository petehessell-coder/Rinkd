import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Stripe Connect (Express) onboarding for an organizer (a league commissioner /
// tournament director). verify_jwt=true — the CALLER is the account owner; we
// identify them from their Supabase JWT and onboard THEIR own connected account.
// One Connect account per profile, reused across all their events. Registration
// checkouts route 99% here as a destination charge + Rinkd's 1% application fee.
//
// Returns { url } — a Stripe-hosted onboarding link the client redirects to. The
// account.updated webhook flips charges_enabled when KYC completes.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

// Only allow our own origins as Stripe return/refresh redirect targets.
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
    if (!STRIPE_SECRET_KEY) return json({ error: "stripe not configured" }, 500)

    // Identify the caller (the connected-account owner) from their JWT.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
    if (!token) return json({ error: "unauthorized" }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: uErr } = await userClient.auth.getUser(token)
    if (uErr || !user) return json({ error: "unauthorized" }, 401)

    const { appUrl, returnPath } = await req.json().catch(() => ({}))
    const base = safeBase(appUrl)
    const ret = `${base}${typeof returnPath === "string" && returnPath.startsWith("/") ? returnPath : "/leagues"}`

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // Reuse the owner's existing Connect account, or create a new Express one.
    const { data: existing } = await svc
      .from("stripe_connect_accounts")
      .select("stripe_account_id")
      .eq("owner_profile_id", user.id)
      .maybeSingle()

    let accountId = existing?.stripe_account_id as string | undefined
    if (!accountId) {
      // Destination charges only need the `transfers` capability on the connected
      // account (the platform creates the charge; funds are transferred here).
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: "Hockey league / tournament registration via Rinkd" },
        metadata: { profile_id: user.id },
      })
      accountId = account.id
      const { error: insErr } = await svc.from("stripe_connect_accounts").insert({
        owner_profile_id: user.id,
        stripe_account_id: accountId,
        charges_enabled: account.charges_enabled ?? false,
        payouts_enabled: account.payouts_enabled ?? false,
        details_submitted: account.details_submitted ?? false,
      })
      if (insErr) {
        // Rare double-tap race — another request inserted first; reuse that row.
        const { data: re } = await svc
          .from("stripe_connect_accounts")
          .select("stripe_account_id")
          .eq("owner_profile_id", user.id)
          .maybeSingle()
        if (re?.stripe_account_id) accountId = re.stripe_account_id
      }
    }

    // Account links are single-use + short-lived — always mint a fresh one.
    const link = await stripe.accountLinks.create({
      account: accountId!,
      refresh_url: `${ret}?connect=refresh`,
      return_url: `${ret}?connect=done`,
      type: "account_onboarding",
    })

    return json({ url: link.url })
  } catch (err) {
    console.error("[stripe-connect] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
