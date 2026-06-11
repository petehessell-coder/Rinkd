import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// REG-4 — dunning worker. Cron-invoked (daily, after reg4_mark_past_due):
//   • Auto-Pay plans: off-session destination charge on the saved card; on
//     success the money trail completes through the SAME transactional RPC the
//     webhook uses (reg3_mark_installment_paid). On failure: attempt counted,
//     family notified with a pay link.
//   • Non-Auto-Pay: a 'payment_due' nudge (max 4, ≥3 days apart — cadence
//     enforced by reg4_dunning_queue).
// Auth: cron bearer key, deny-if-unset (mirrors send-game-reminders).
// Registrations use STRIPE_REG_SECRET_KEY — never the merch store's live key.

const STRIPE_KEY = Deno.env.get("STRIPE_REG_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const CRON_KEY = Deno.env.get("CRON_KEY") ?? ""

serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? ""
  if (!CRON_KEY || auth !== `Bearer ${CRON_KEY}`) {
    return new Response("forbidden", { status: 403 })
  }
  if (!STRIPE_KEY) return new Response("stripe not configured", { status: 500 })

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const stripe = new Stripe(STRIPE_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2024-06-20",
  })

  // Overdue marking is also cron'd in SQL; running it here too makes the
  // worker self-sufficient if the SQL cron is ever unscheduled.
  await svc.rpc("reg4_mark_past_due")

  const { data: queue, error: qErr } = await svc.rpc("reg4_dunning_queue")
  if (qErr) {
    console.error("[process-dunning] queue failed", qErr.message)
    return new Response("queue failed", { status: 500 })
  }

  let charged = 0, failed = 0, reminded = 0
  for (const item of (queue || [])) {
    try {
      if (item.autopay_customer && item.autopay_payment_method) {
        // Destination charge when the organizer has Connect payouts (same fee
        // split as checkout); plain platform charge otherwise.
        let connected: string | null = null
        if (item.organizer_profile_id) {
          const { data: acct } = await svc.from("stripe_connect_accounts")
            .select("stripe_account_id, charges_enabled")
            .eq("owner_profile_id", item.organizer_profile_id).maybeSingle()
          if (acct?.stripe_account_id && acct.charges_enabled) connected = acct.stripe_account_id
        }
        const base = item.base_cents
        const intent = await stripe.paymentIntents.create({
          amount: item.amount_cents,
          currency: "usd",
          customer: item.autopay_customer,
          payment_method: item.autopay_payment_method,
          off_session: true,
          confirm: true,
          metadata: { kind: "player", installment_id: item.installment_id, registration_id: item.registration_id, dunning: "1" },
          ...(connected ? {
            application_fee_amount: item.amount_cents - Math.round(base * 0.99),
            transfer_data: { destination: connected },
          } : {}),
        })
        if (intent.status === "succeeded") {
          const { error: payErr } = await svc.rpc("reg3_mark_installment_paid", {
            p_installment_id: item.installment_id, p_session_id: null, p_payment_intent: intent.id,
          })
          if (payErr) {
            // Charged but ledger failed — webhook redelivery can't save us here
            // (no checkout session). Flag loudly; the recon run + Stripe
            // dashboard make it findable. Do NOT count an attempt (no re-charge:
            // mark-paid is idempotent and a manual rerun fixes the ledger).
            console.error("[process-dunning] CHARGED BUT LEDGER FAILED", { installment: item.installment_id, intent: intent.id, error: payErr.message })
          } else {
            charged++
            await notify(svc, item, `Auto-Pay charged $${(item.amount_cents / 100).toFixed(2)} for ${item.registrant_name || "your registration"}. You're all set.`)
          }
          continue
        }
        throw new Error(`intent status ${intent.status}`)
      } else {
        // No saved card — nudge.
        await svc.rpc("reg4_record_dunning_attempt", { p_installment_id: item.installment_id, p_ok: false })
        await notify(svc, item, `Payment of $${(item.amount_cents / 100).toFixed(2)} for ${item.registrant_name || "a registration"} is past due. Tap to pay.`)
        reminded++
      }
    } catch (e) {
      failed++
      await svc.rpc("reg4_record_dunning_attempt", { p_installment_id: item.installment_id, p_ok: false })
      await notify(svc, item, `Auto-Pay couldn't charge your card for ${item.registrant_name || "a registration"} ($${(item.amount_cents / 100).toFixed(2)}). Tap to update payment.`)
      console.warn("[process-dunning] charge failed", { installment: item.installment_id, error: (e as Error)?.message })
    }
  }

  console.log("[process-dunning] done", { queued: (queue || []).length, charged, failed, reminded })
  return new Response(JSON.stringify({ queued: (queue || []).length, charged, failed, reminded }), {
    status: 200, headers: { "Content-Type": "application/json" },
  })
})

async function notify(svc: any, item: any, body: string) {
  if (!item.owner_profile_id) return
  try {
    await svc.from("notifications").insert({
      recipient_id: item.owner_profile_id,
      kind: "payment_due",
      body,
      url: "/family",
    })
  } catch (_e) { /* never let a notification kill the run */ }
}
