import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Creates a Stripe Checkout session for a public league-registration submission.
// PUBLIC endpoint: a team contact who has the registration link (and may not have
// a Rinkd account) calls this via supabase.functions.invoke — the anon JWT passes
// the gateway. We NEVER trust the body for the fee or league state: the league is
// read server-side with the service role, and the registration row is INSERTED
// here (service role) after validating open/deadline/capacity. There is no public
// INSERT policy on league_registrations, so this is the only write path in.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
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

// Only allow our own origins as Stripe success/cancel redirect targets.
function safeBase(appUrl: unknown): string {
  const fallback = "https://rinkd.app"
  if (typeof appUrl !== "string") return fallback
  const ok = /^https?:\/\/(localhost(:\d+)?|([a-z0-9-]+\.)?rinkd\.app)(\/|$)/i.test(appUrl)
  return ok ? appUrl.replace(/\/+$/, "") : fallback
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  // If we INSERT a pending row but then fail before handing the user to Stripe
  // (e.g. a bad key or Stripe outage), roll it back — a failed checkout must never
  // leave an orphan "pending / unpaid" registration cluttering the commissioner's list.
  let createdRegId: string | null = null
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: "stripe not configured" }, 500)

    const { leagueId, teamName, contactName, contactEmail, appUrl } = await req.json()
    const team = (teamName || "").trim()
    const name = (contactName || "").trim()
    const email = (contactEmail || "").trim()
    if (!leagueId || !team || !name || !email) {
      return json({ error: "missing required fields" }, 400)
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "invalid email" }, 400)
    }

    const { data: league, error: lErr } = await svc
      .from("leagues")
      .select("id, name, commissioner_id, registration_open, registration_fee_cents, registration_deadline, max_teams")
      .eq("id", leagueId)
      .single()
    if (lErr || !league) return json({ error: "league not found" }, 404)

    // Gate: registration must be open and within the deadline.
    if (!league.registration_open) return json({ error: "closed", reason: "closed" }, 409)
    if (league.registration_deadline && new Date(league.registration_deadline).getTime() < Date.now()) {
      return json({ error: "closed", reason: "deadline_passed" }, 409)
    }

    // Capacity: count real teams already in the league against max_teams.
    if (league.max_teams != null) {
      const { count } = await svc
        .from("league_teams")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
      if ((count || 0) >= league.max_teams) {
        return json({ error: "full", reason: "full" }, 409)
      }
    }

    const feeCents = Number(league.registration_fee_cents) || 0

    // Paid league: the organizer (founding commissioner) must have a Connect
    // account that can accept charges BEFORE we take any money or create a row.
    // Free leagues skip this — there's nothing to route. Checked pre-insert so a
    // not-yet-connected league never leaves an orphan pending row.
    let connectedAccountId: string | null = null
    if (feeCents > 0) {
      const { data: acct } = await svc
        .from("stripe_connect_accounts")
        .select("stripe_account_id, charges_enabled")
        .eq("owner_profile_id", league.commissioner_id)
        .maybeSingle()
      if (!acct?.stripe_account_id || !acct.charges_enabled) {
        return json({ error: "payouts_not_connected", reason: "payouts_not_connected" }, 409)
      }
      connectedAccountId = acct.stripe_account_id
    }

    // Insert the pending registration (service role — the only write path).
    const { data: reg, error: rErr } = await svc
      .from("league_registrations")
      .insert({
        league_id: leagueId,
        team_name: team,
        contact_name: name,
        contact_email: email,
        fee_cents: feeCents,
        status: "pending",
      })
      .select("id")
      .single()
    if (rErr || !reg) return json({ error: "could not create registration" }, 500)
    createdRegId = reg.id

    // Free league (no fee): nothing to charge — the commissioner approves manually.
    if (feeCents <= 0) {
      return json({ free: true, registrationId: reg.id })
    }

    const base = safeBase(appUrl)
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // Fee model (per the locked pricing guide): organizer keeps 99% of the entry
    // fee, Rinkd takes 1%, and Stripe's processing (2.9% + $0.30) is passed through
    // to the registrant via a gross-up — so neither organizer nor Rinkd eats it.
    //   total T   = round((F + 30) / 0.971)      ← registrant pays this
    //   processing = T - F                        ← shown as a separate line item
    //   app fee    = T - round(0.99 * F)          ← Rinkd's slice (nets ~1% of F after Stripe)
    //   organizer  = T - app_fee = round(0.99*F)  ← via transfer_data.destination
    // e.g. F=$100 → T=$103.30, processing=$3.30, app fee=$4.30, organizer=$99.00, Rinkd≈$1.00.
    const total = Math.round((feeCents + 30) / 0.971)
    const processingCents = total - feeCents
    const applicationFeeCents = total - Math.round(feeCents * 0.99)

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: feeCents,
            product_data: {
              name: `${league.name} — Team Registration`,
              description: `${team} · ${name}`,
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: processingCents,
            product_data: { name: "Processing fee" },
          },
        },
      ],
      // Destination charge: 99% routes to the organizer's connected account; Rinkd
      // keeps the 1% application fee. Platform is liable for refunds/disputes (v1).
      payment_intent_data: {
        application_fee_amount: applicationFeeCents,
        transfer_data: { destination: connectedAccountId! },
      },
      // metadata is the durable link back to our row — the webhook reads it.
      metadata: { registration_id: reg.id, league_id: leagueId },
      success_url: `${base}/league/${leagueId}/register?success=1`,
      cancel_url: `${base}/league/${leagueId}/register?canceled=1`,
    })

    await svc.from("league_registrations")
      .update({ stripe_session_id: session.id })
      .eq("id", reg.id)

    return json({ url: session.url })
  } catch (err) {
    // Roll back the pending row if one was created but checkout never started, so a
    // failed attempt (bad key, Stripe down) doesn't orphan a "pending / unpaid" row.
    if (createdRegId) {
      try { await svc.from("league_registrations").delete().eq("id", createdRegId) } catch (_e) { /* best-effort cleanup */ }
    }
    console.error("[stripe-checkout] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
