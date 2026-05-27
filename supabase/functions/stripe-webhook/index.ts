import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Stripe → Rinkd webhook. Stripe POSTs here server-to-server, so it CANNOT send a
// Supabase JWT — this function MUST be deployed with verify_jwt=false. Auth comes
// from the Stripe signature instead (constructEventAsync + STRIPE_WEBHOOK_SECRET).
//
// On checkout.session.completed we mark the registration paid + approved and create
// the league_teams row. The handler is IDEMPOTENT: Stripe may deliver an event more
// than once, so we skip if paid_at OR league_team_id is already set — neither a
// retry nor a race can double-insert the team.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

// Initials fallback for the team's nameplate (matches addLeagueTeam's logo fields).
function initials(teamName: string): string {
  const words = (teamName || "").split(/\s+/).filter(Boolean)
  const ini = words.slice(0, 2).map((w) => w[0]).join("") || (teamName || "").slice(0, 2)
  return ini.toUpperCase().slice(0, 3)
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 })
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return new Response("stripe not configured", { status: 500 })
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) return new Response("missing signature", { status: 400 })

  const body = await req.text() // raw body required for signature verification
  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2024-06-20",
  })

  let event
  try {
    // Async + SubtleCrypto provider: the sync verifier doesn't work on Deno.
    event = await stripe.webhooks.constructEventAsync(
      body, sig, STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider(),
    )
  } catch (err) {
    console.error("[stripe-webhook] signature verify failed", { error: err?.message })
    return new Response(`signature verification failed: ${err?.message}`, { status: 400 })
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Record<string, any>
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

      // Prefer the durable metadata link; fall back to the session id.
      const regId = session?.metadata?.registration_id || null
      let q = svc.from("league_registrations")
        .select("id, league_id, team_name, paid_at, league_team_id, status")
      q = regId ? q.eq("id", regId) : q.eq("stripe_session_id", session.id)
      const { data: reg } = await q.maybeSingle()

      // Unknown registration — ack so Stripe stops retrying.
      if (!reg) {
        console.warn("[stripe-webhook] no registration for session", { session_id: session.id, regId })
        return new Response(JSON.stringify({ received: true, matched: false }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // Idempotent: already processed (Stripe retry or double delivery).
      if (reg.paid_at || reg.league_team_id) {
        return new Response(JSON.stringify({ received: true, alreadyProcessed: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // 1) mark paid + approved
      await svc.from("league_registrations")
        .update({ paid_at: new Date().toISOString(), status: "approved" })
        .eq("id", reg.id)

      // 2) create the league_teams row (nameplate; team_id linked later if claimed)
      const { data: lt, error: ltErr } = await svc.from("league_teams")
        .insert({
          league_id: reg.league_id,
          team_name: reg.team_name,
          logo_color: "#2E5B8C",
          logo_initials: initials(reg.team_name),
          division: "",
        })
        .select("id")
        .single()
      if (ltErr) {
        console.error("[stripe-webhook] league_teams insert failed", { reg_id: reg.id, error: ltErr.message })
        // paid_at is set; a retry will skip (idempotent) and the commissioner can
        // approve manually if needed. Return 500 so Stripe retries the team insert.
        return new Response("team insert failed", { status: 500 })
      }

      // 3) stamp the idempotency link
      await svc.from("league_registrations")
        .update({ league_team_id: lt.id })
        .eq("id", reg.id)

      console.log("[stripe-webhook] registration approved + team created", { reg_id: reg.id, league_team_id: lt.id })
    } else if (event.type === "account.updated") {
      // Connect (Express) onboarding progress — flip the organizer's readiness
      // flags so league_payouts_ready() + the checkout gate see them as live.
      const account = event.data.object as Record<string, any>
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await svc.from("stripe_connect_accounts")
        .update({
          charges_enabled: !!account.charges_enabled,
          payouts_enabled: !!account.payouts_enabled,
          details_submitted: !!account.details_submitted,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_account_id", account.id)
      console.log("[stripe-webhook] connect account.updated", { account_id: account.id, charges_enabled: !!account.charges_enabled })
    }

    // Ack all other event types.
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[stripe-webhook] handler error", { error: err?.message })
    return new Response(`handler error: ${err?.message}`, { status: 500 })
  }
})
