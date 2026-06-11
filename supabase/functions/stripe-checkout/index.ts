import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Stripe Checkout for a public registration submission — works for BOTH a league
// (kind='league', the default) and a tournament (kind='tournament'). PUBLIC: a team
// contact with the registration link calls this via functions.invoke (anon JWT
// passes the gateway). We NEVER trust the body for fee/state — the parent event is
// read server-side (service role) and the registration row is INSERTED here, the
// only write path (there's no public INSERT policy on the *_registrations tables).
//
// Connect is OPTIONAL: if the organizer (league commissioner / tournament director)
// has connected payouts, the charge is a destination charge — 99% to them, 1% to
// Rinkd, Stripe processing grossed up to the registrant. If not, the fee collects
// into the Rinkd platform account and is settled manually.

// REG-4 secret split: registrations run on their own key (sandbox until paid
// launch); fallback keeps pre-split behavior until the secret is set.
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_REG_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY")
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

// Per-kind wiring: which parent table / owner column / teams table / registrations
// table to read + write, and where to send the registrant back.
const KINDS: Record<string, any> = {
  league: {
    parentTable: "leagues", ownerCol: "commissioner_id",
    teamsTable: "league_teams", teamsFk: "league_id",
    regTable: "league_registrations", regParentCol: "league_id",
    path: (id: string) => `/league/${id}/register`,
  },
  tournament: {
    parentTable: "tournaments", ownerCol: "director_id",
    teamsTable: "tournament_teams", teamsFk: "tournament_id",
    regTable: "tournament_registrations", regParentCol: "tournament_id",
    path: (id: string) => `/tournament/${id}/register`,
  },
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  // Roll back a pending row if we created one but never handed off to Stripe.
  let createdRegId: string | null = null
  let createdRegTable = "league_registrations"
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: "stripe not configured" }, 500)

    const body = await req.json()
    // Back-compat: the league client sends { leagueId } with no `kind`.
    const kind = (body.kind === "tournament" || body.tournamentId) ? "tournament" : "league"
    const cfg = KINDS[kind]
    const parentId = kind === "tournament" ? body.tournamentId : body.leagueId
    const team = (body.teamName || "").trim()
    const name = (body.contactName || "").trim()
    const email = (body.contactEmail || "").trim()
    const appUrl = body.appUrl
    if (!parentId || !team || !name || !email) {
      return json({ error: "missing required fields" }, 400)
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "invalid email" }, 400)
    }

    const { data: parent, error: pErr } = await svc
      .from(cfg.parentTable)
      .select(`id, name, ${cfg.ownerCol}, registration_open, registration_fee_cents, registration_deadline, max_teams`)
      .eq("id", parentId)
      .single()
    if (pErr || !parent) return json({ error: "event not found" }, 404)

    // Gate: registration must be open and within the deadline.
    if (!parent.registration_open) return json({ error: "closed", reason: "closed" }, 409)
    if (parent.registration_deadline && new Date(parent.registration_deadline).getTime() < Date.now()) {
      return json({ error: "closed", reason: "deadline_passed" }, 409)
    }

    // Capacity: count teams already in the event against max_teams.
    if (parent.max_teams != null) {
      const { count } = await svc
        .from(cfg.teamsTable)
        .select("id", { count: "exact", head: true })
        .eq(cfg.teamsFk, parentId)
      if ((count || 0) >= parent.max_teams) {
        return json({ error: "full", reason: "full" }, 409)
      }
    }

    const feeCents = Number(parent.registration_fee_cents) || 0
    const ownerId = parent[cfg.ownerCol]

    // Connect is OPTIONAL — destination charge if the organizer is connected, else
    // a plain charge into the platform account. (Free events skip this.)
    let connectedAccountId: string | null = null
    if (feeCents > 0 && ownerId) {
      const { data: acct } = await svc
        .from("stripe_connect_accounts")
        .select("stripe_account_id, charges_enabled")
        .eq("owner_profile_id", ownerId)
        .maybeSingle()
      if (acct?.stripe_account_id && acct.charges_enabled) connectedAccountId = acct.stripe_account_id
    }

    // Insert the pending registration (service role — the only write path in).
    const { data: reg, error: rErr } = await svc
      .from(cfg.regTable)
      .insert({
        [cfg.regParentCol]: parentId,
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
    createdRegTable = cfg.regTable

    // Free event (no fee): nothing to charge — the organizer approves manually.
    if (feeCents <= 0) {
      return json({ free: true, registrationId: reg.id })
    }

    const base = safeBase(appUrl)
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    const lineItems: Record<string, any>[] = [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: feeCents,
        product_data: {
          name: `${parent.name} — Team Registration`,
          description: `${team} · ${name}`,
        },
      },
    }]

    const sessionParams: Record<string, any> = {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: lineItems,
      // metadata is the durable link back to our row — the webhook reads kind + id.
      metadata: { registration_id: reg.id, kind, parent_id: parentId },
      success_url: `${base}${cfg.path(parentId)}?success=1`,
      cancel_url: `${base}${cfg.path(parentId)}?canceled=1`,
    }

    if (connectedAccountId) {
      // Destination charge. Per the locked pricing guide: organizer keeps 99% of the
      // entry fee, Rinkd takes 1%, Stripe processing (2.9% + $0.30) passed through via
      // gross-up. e.g. F=$100 → registrant $103.30, org $99.00, Rinkd ≈$1.00.
      const total = Math.round((feeCents + 30) / 0.971)
      lineItems.push({
        quantity: 1,
        price_data: { currency: "usd", unit_amount: total - feeCents, product_data: { name: "Processing fee" } },
      })
      sessionParams.payment_intent_data = {
        application_fee_amount: total - Math.round(feeCents * 0.99),
        transfer_data: { destination: connectedAccountId },
      }
    }
    // Not connected → plain charge into the Rinkd platform account (settled manually).

    const session = await stripe.checkout.sessions.create(sessionParams)

    await svc.from(cfg.regTable)
      .update({ stripe_session_id: session.id })
      .eq("id", reg.id)

    return json({ url: session.url })
  } catch (err) {
    if (createdRegId) {
      try { await svc.from(createdRegTable).delete().eq("id", createdRegId) } catch (_e) { /* best-effort cleanup */ }
    }
    console.error("[stripe-checkout] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
