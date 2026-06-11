import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Stripe → Rinkd webhook. Stripe POSTs here server-to-server, so it CANNOT send a
// Supabase JWT — this function MUST be deployed with verify_jwt=false. Auth comes
// from the Stripe signature (constructEventAsync).
//
// TWO Stripe environments share this endpoint (REG-4 secret split): the merch
// store runs LIVE (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET) while registrations
// run in the SANDBOX until paid-registration launch (STRIPE_REG_SECRET_KEY/
// STRIPE_REG_WEBHOOK_SECRET). Signature verification tries the store secret
// first, then the reg secret; whichever verifies decides which API key any
// follow-up Stripe calls use. Until the reg secrets are set, the fallbacks
// keep Phase-3 single-secret behavior byte-identical.
//
// checkout.session.completed: store orders → Printful; player registrations →
// the transactional spine RPC; team-entry → mark paid + create the team row.
// checkout.session.expired: release a player installment for resume.
// account.updated: refresh a connected organizer's readiness flags.

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")
const STRIPE_REG_SECRET_KEY = Deno.env.get("STRIPE_REG_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY")
const STRIPE_REG_WEBHOOK_SECRET = Deno.env.get("STRIPE_REG_WEBHOOK_SECRET") ?? Deno.env.get("STRIPE_WEBHOOK_SECRET")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY")
const PRINTFUL_STORE_ID = Deno.env.get("PRINTFUL_STORE_ID")

function pfHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${PRINTFUL_API_KEY}`,
    "Content-Type": "application/json",
  }
  if (PRINTFUL_STORE_ID) h["X-PF-Store-Id"] = PRINTFUL_STORE_ID
  return h
}

// Paid store order -> submit a confirmed fulfillment order to Printful. Returns
// the Printful order id. Throws on failure so the caller can flag the order for
// a manual retry (the buyer has already paid).
async function submitPrintfulOrder(order: any, items: any[]): Promise<number> {
  const res = await fetch("https://api.printful.com/orders?confirm=true", {
    method: "POST",
    headers: pfHeaders(),
    body: JSON.stringify({
      external_id: order.id, // our order id — reconciliation + Printful-side dedupe
      recipient: {
        name: order.ship_name,
        address1: order.ship_address1,
        address2: order.ship_address2 || undefined,
        city: order.ship_city,
        state_code: order.ship_state || undefined,
        country_code: order.ship_country,
        zip: order.ship_zip,
        email: order.email,
      },
      items: items.map((i: any) => ({
        sync_variant_id: i.printful_variant_id,
        quantity: i.quantity,
      })),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.result?.id) {
    throw new Error(`Printful order create ${res.status}: ${data?.error?.message || res.statusText}`)
  }
  return data.result.id as number
}

function initials(teamName: string): string {
  const words = (teamName || "").split(/\s+/).filter(Boolean)
  const ini = words.slice(0, 2).map((w) => w[0]).join("") || (teamName || "").slice(0, 2)
  return ini.toUpperCase().slice(0, 3)
}

// Per-kind wiring for the paid-registration → team step.
const KINDS: Record<string, any> = {
  league: {
    regTable: "league_registrations",
    selectCols: "id, league_id, team_name, paid_at, league_team_id, status",
    teamLinkCol: "league_team_id",
    teamsTable: "league_teams",
    teamRow: (reg: any) => ({
      league_id: reg.league_id,
      team_name: reg.team_name,
      logo_color: "#2E5B8C",
      logo_initials: initials(reg.team_name),
      division: "",
    }),
  },
  tournament: {
    regTable: "tournament_registrations",
    selectCols: "id, tournament_id, team_name, contact_email, paid_at, tournament_team_id, status",
    teamLinkCol: "tournament_team_id",
    teamsTable: "tournament_teams",
    teamRow: (reg: any) => ({
      tournament_id: reg.tournament_id,
      team_name: reg.team_name,
      contact_email: reg.contact_email || null,
    }),
  },
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 })
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return new Response("stripe not configured", { status: 500 })
  }

  const sig = req.headers.get("stripe-signature")
  if (!sig) return new Response("missing signature", { status: 400 })

  const body = await req.text() // raw body required for signature verification

  // Dual-environment verification: store (live) secret first, then reg
  // (sandbox) secret. The environment that verifies provides the API key for
  // any follow-up Stripe calls in this request.
  let event
  let stripe: Stripe
  const crypto = Stripe.createSubtleCryptoProvider()
  const storeStripe = new Stripe(STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20",
  })
  try {
    event = await storeStripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET, undefined, crypto)
    stripe = storeStripe
  } catch (_storeErr) {
    try {
      const regStripe = new Stripe(STRIPE_REG_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20",
      })
      event = await regStripe.webhooks.constructEventAsync(body, sig, STRIPE_REG_WEBHOOK_SECRET, undefined, crypto)
      stripe = regStripe
    } catch (err) {
      console.error("[stripe-webhook] signature verify failed (both secrets)", { error: err?.message })
      return new Response(`signature verification failed: ${err?.message}`, { status: 400 })
    }
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Record<string, any>
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

      // ---- Store (native merch) orders ----------------------------------
      if (session?.metadata?.kind === "store") {
        const orderId = session?.metadata?.order_id || null
        let oq = svc.from("orders").select("*")
        oq = orderId ? oq.eq("id", orderId) : oq.eq("stripe_session_id", session.id)
        const { data: order } = await oq.maybeSingle()

        if (!order) {
          console.warn("[stripe-webhook] no order for store session", { session_id: session.id, orderId })
          return new Response(JSON.stringify({ received: true, matched: false }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        }
        // Idempotent: already submitted to Printful.
        if (order.printful_order_id) {
          return new Response(JSON.stringify({ received: true, alreadyProcessed: true }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        }

        // Record payment totals (tax + final total come from Stripe).
        await svc.from("orders").update({
          status: "paid",
          paid_at: order.paid_at || new Date().toISOString(),
          stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
          tax_cents: session.total_details?.amount_tax ?? 0,
          total_cents: session.amount_total ?? order.total_cents,
        }).eq("id", order.id)

        const { data: items } = await svc
          .from("order_items").select("printful_variant_id, quantity").eq("order_id", order.id)

        try {
          const printfulOrderId = await submitPrintfulOrder(order, items || [])
          await svc.from("orders").update({
            status: "submitted",
            submitted_at: new Date().toISOString(),
            printful_order_id: printfulOrderId,
            fulfillment_error: null,
          }).eq("id", order.id)
          console.log("[stripe-webhook] store order submitted to Printful", { order_id: order.id, printful_order_id: printfulOrderId })
        } catch (subErr) {
          // Buyer already paid — keep status 'paid', flag the error for manual
          // retry. Ack (200) so Stripe doesn't redeliver and re-charge logic.
          await svc.from("orders").update({
            fulfillment_error: (subErr as Error)?.message?.slice(0, 500) || "submit failed",
          }).eq("id", order.id)
          console.error("[stripe-webhook] Printful submit failed", { order_id: order.id, error: (subErr as Error)?.message })
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // ---- Auto-Pay enrollment (REG-4, mode='setup') -----------------------
      // setup-autopay created this session; save the card + bind it to the plan.
      if (session?.mode === "setup" && session?.metadata?.kind === "autopay_setup") {
        const planId = session?.metadata?.plan_id || null
        const ownerProfileId = session?.metadata?.owner_profile_id || null
        const setupIntentId = typeof session.setup_intent === "string" ? session.setup_intent : null
        if (!planId || !ownerProfileId || !setupIntentId) {
          console.warn("[stripe-webhook] autopay_setup missing metadata", { session_id: session.id })
          return new Response(JSON.stringify({ received: true, matched: false }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        }
        const si = await stripe.setupIntents.retrieve(setupIntentId)
        const pmId = typeof si.payment_method === "string" ? si.payment_method : (si.payment_method as any)?.id
        if (!pmId) return new Response("setup intent has no payment method", { status: 500 })
        const pm = await stripe.paymentMethods.retrieve(pmId)

        // A payment method belongs to exactly one Customer (and so one
        // profile); an upsert must never flip ownership to someone else.
        const { data: existingPm } = await svc.from("payment_methods")
          .select("id, owner_profile_id").eq("stripe_payment_method_id", pmId).maybeSingle()
        if (existingPm && existingPm.owner_profile_id !== ownerProfileId) {
          console.error("[stripe-webhook] payment method ownership conflict", { pm: pmId, existing: existingPm.owner_profile_id, incoming: ownerProfileId })
          return new Response("payment method ownership conflict", { status: 500 })
        }

        // Upsert the saved card (idempotent on stripe_payment_method_id)…
        const { data: pmRow, error: pmErr } = await svc.from("payment_methods")
          .upsert({
            owner_profile_id: ownerProfileId,
            stripe_customer_id: typeof session.customer === "string" ? session.customer : si.customer,
            stripe_payment_method_id: pmId,
            brand: pm.card?.brand || null,
            last4: pm.card?.last4 || null,
            exp_month: pm.card?.exp_month || null,
            exp_year: pm.card?.exp_year || null,
          }, { onConflict: "stripe_payment_method_id" })
          .select("id").single()
        if (pmErr || !pmRow) {
          console.error("[stripe-webhook] payment_methods upsert failed", { error: pmErr?.message })
          return new Response("payment method save failed", { status: 500 })
        }
        // …and bind it to the plan (Auto-Pay = plan has a payment method).
        const { error: planErr } = await svc.from("payment_plans")
          .update({ autopay_payment_method_id: pmRow.id })
          .eq("id", planId)
        if (planErr) {
          console.error("[stripe-webhook] plan autopay bind failed", { plan_id: planId, error: planErr.message })
          return new Response("plan autopay bind failed", { status: 500 })
        }
        console.log("[stripe-webhook] autopay enrolled", { plan_id: planId, pm: pmId })
        return new Response(JSON.stringify({ received: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // ---- Player registrations (REG-3 spine) -----------------------------
      // Individual checkout created by the register-player edge fn. ONE
      // transactional RPC completes the money trail (installment → plan →
      // registration), resolves the registration THROUGH the installment's
      // plan (metadata.registration_id is just a log hint), is idempotent on
      // the registration (the last write), and any failure returns 500 so
      // Stripe redelivers.
      if (session?.metadata?.kind === "player") {
        // Async payment methods would deliver completed before paid — only
        // settle the ledger on an actually-paid session. (Card-only today.)
        if (session.payment_status && session.payment_status !== "paid") {
          console.warn("[stripe-webhook] player session completed but not paid", { session_id: session.id, payment_status: session.payment_status })
          return new Response(JSON.stringify({ received: true, deferred: true }), {
            status: 200, headers: { "Content-Type": "application/json" },
          })
        }
        const { data: outcome, error: payErr } = await svc.rpc("reg3_mark_installment_paid", {
          p_installment_id: session?.metadata?.installment_id || null,
          p_session_id: session.id,
          p_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
        })
        if (payErr) {
          console.error("[stripe-webhook] reg3_mark_installment_paid failed", { session_id: session.id, error: payErr.message })
          return new Response("player payment record failed", { status: 500 })
        }
        console.log("[stripe-webhook] player registration payment", { session_id: session.id, reg_hint: session?.metadata?.registration_id, outcome })
        return new Response(JSON.stringify({ received: true, outcome }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // ---- Registrations (league / tournament) --------------------------
      const kind = session?.metadata?.kind === "tournament" ? "tournament" : "league"
      const cfg = KINDS[kind]
      const regId = session?.metadata?.registration_id || null

      let q = svc.from(cfg.regTable).select(cfg.selectCols)
      q = regId ? q.eq("id", regId) : q.eq("stripe_session_id", session.id)
      const { data: reg } = await q.maybeSingle()

      // Unknown registration — ack so Stripe stops retrying.
      if (!reg) {
        console.warn("[stripe-webhook] no registration for session", { session_id: session.id, regId, kind })
        return new Response(JSON.stringify({ received: true, matched: false }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // Idempotent: already processed (Stripe retry or double delivery).
      if (reg.paid_at || reg[cfg.teamLinkCol]) {
        return new Response(JSON.stringify({ received: true, alreadyProcessed: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        })
      }

      // 1) mark paid + approved. amount_total_cents = what Stripe ACTUALLY
      // charged (the connected-organizer gross-up only happens sometimes) —
      // the REG-3 spine mirror prefers it over formula math for ledger truth.
      await svc.from(cfg.regTable)
        .update({
          paid_at: new Date().toISOString(),
          status: "approved",
          amount_total_cents: typeof session.amount_total === "number" ? session.amount_total : null,
        })
        .eq("id", reg.id)

      // 2) create the team row (nameplate)
      const { data: team, error: tErr } = await svc.from(cfg.teamsTable)
        .insert(cfg.teamRow(reg))
        .select("id")
        .single()
      if (tErr) {
        console.error("[stripe-webhook] team insert failed", { kind, reg_id: reg.id, error: tErr.message })
        // paid_at is set; a retry will skip (idempotent) and the organizer can
        // approve manually. Return 500 so Stripe retries the team insert.
        return new Response("team insert failed", { status: 500 })
      }

      // 3) stamp the idempotency link
      await svc.from(cfg.regTable)
        .update({ [cfg.teamLinkCol]: team.id })
        .eq("id", reg.id)

      console.log("[stripe-webhook] registration approved + team created", { kind, reg_id: reg.id, team_id: team.id })
    } else if (event.type === "payment_intent.succeeded") {
      // REG-4 recovery path for OFF-SESSION dunning charges (they have no
      // checkout session, so this is their only webhook). process-dunning sets
      // metadata.installment_id on the PaymentIntent; checkout-session flows
      // don't put metadata on the PI, so they fall through harmlessly. The
      // mark-paid RPC is idempotent — double delivery / already-recorded
      // charges are no-ops.
      const pi = event.data.object as Record<string, any>
      const instId = pi?.metadata?.installment_id || null
      if (instId && pi?.metadata?.kind === "player") {
        const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        const { data: outcome, error: payErr } = await svc.rpc("reg3_mark_installment_paid", {
          p_installment_id: instId, p_session_id: null, p_payment_intent: pi.id,
        })
        if (payErr) {
          console.error("[stripe-webhook] pi.succeeded ledger write failed", { intent: pi.id, error: payErr.message })
          return new Response("installment record failed", { status: 500 })
        }
        console.log("[stripe-webhook] off-session installment recorded", { intent: pi.id, outcome })
      }
    } else if (event.type === "checkout.session.expired") {
      // REG-3: an abandoned player checkout releases its installment
      // (processing → scheduled) so register-player can resume the SAME
      // pending registration with a fresh session instead of bricking on the
      // one-live-registration guard. No-op for store/team-entry sessions.
      const session = event.data.object as Record<string, any>
      if (session?.metadata?.kind === "player") {
        const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        const { data: outcome } = await svc.rpc("reg3_release_installment", { p_session_id: session.id })
        console.log("[stripe-webhook] player session expired", { session_id: session.id, outcome })
      }
    } else if (event.type === "account.updated") {
      // Connect (Express) onboarding progress. Stripe doesn't guarantee event
      // ordering — a stale delivery could flip readiness the wrong way — so we
      // fetch the CURRENT account state and persist that, using the event only
      // as the trigger.
      const account = event.data.object as Record<string, any>
      const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      let fresh = account
      try {
        fresh = await stripe.accounts.retrieve(account.id)
      } catch (e) {
        console.warn("[stripe-webhook] accounts.retrieve failed; using event payload", { account_id: account.id, error: (e as Error)?.message })
      }
      await svc.from("stripe_connect_accounts")
        .update({
          charges_enabled: !!fresh.charges_enabled,
          payouts_enabled: !!fresh.payouts_enabled,
          details_submitted: !!fresh.details_submitted,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_account_id", account.id)
      console.log("[stripe-webhook] connect account.updated", { account_id: account.id, charges_enabled: !!fresh.charges_enabled })
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
