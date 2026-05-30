import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// Native Rinkd-merch checkout (source='rinkd_merch'). Distinct from registration
// checkout: a multi-item cart, real shipping via the Printful rate API, Stripe
// automatic_tax, and NO Connect — these are Rinkd's own products, so the charge
// lands in the platform account.
//
// Trust model: the client sends variant ids + quantities + a shipping address.
// We NEVER trust prices — variants are re-priced from the DB (service role).
// Login is required: the buyer is read from the JWT, not the body.
//
// Flow: validate -> re-price from DB -> Printful /shipping/rates -> create pending
// order + order_items -> Stripe Checkout session (line items + shipping option +
// automatic_tax, attached to a Stripe Customer carrying the address so tax is
// computed without re-collecting) -> return session url. The webhook finalizes
// (marks paid, records tax, submits the Printful fulfillment order).

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY")
const PRINTFUL_STORE_ID = Deno.env.get("PRINTFUL_STORE_ID")

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

function safeBase(appUrl: unknown): string {
  const fallback = "https://rinkd.app"
  if (typeof appUrl !== "string") return fallback
  const ok = /^https?:\/\/(localhost(:\d+)?|([a-z0-9-]+\.)?rinkd\.app)(\/|$)/i.test(appUrl)
  return ok ? appUrl.replace(/\/+$/, "") : fallback
}

function pfHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${PRINTFUL_API_KEY}`,
    "Content-Type": "application/json",
  }
  if (PRINTFUL_STORE_ID) h["X-PF-Store-Id"] = PRINTFUL_STORE_ID
  return h
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  let createdOrderId: string | null = null
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: "stripe not configured" }, 500)
    if (!PRINTFUL_API_KEY) return json({ error: "printful not configured" }, 500)

    // Require a logged-in buyer (read from the JWT, never the body).
    const authHeader = req.headers.get("Authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "")
    const { data: userData } = await svc.auth.getUser(token)
    const buyer = userData?.user
    if (!buyer) return json({ error: "login required" }, 401)

    const body = await req.json()
    const items: Array<{ variant_id: string; quantity: number }> = Array.isArray(body.items) ? body.items : []
    const ship = body.shipping || {}
    const email = (body.email || buyer.email || "").trim()
    const appUrl = body.appUrl

    if (items.length === 0) return json({ error: "cart is empty" }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400)
    for (const f of ["name", "address1", "city", "country", "zip"]) {
      if (!String(ship[f] || "").trim()) return json({ error: `missing shipping ${f}` }, 400)
    }

    // Collapse duplicate variant lines and sanitize quantities.
    const qtyByVariant = new Map<string, number>()
    for (const it of items) {
      const id = String(it.variant_id || "")
      const q = Math.max(1, Math.min(20, Math.floor(Number(it.quantity) || 0)))
      if (!id) continue
      qtyByVariant.set(id, (qtyByVariant.get(id) || 0) + q)
    }
    const variantIds = [...qtyByVariant.keys()]
    if (variantIds.length === 0) return json({ error: "cart is empty" }, 400)

    // Re-price from the DB (active variants only) — never trust client prices.
    const { data: variants, error: vErr } = await svc
      .from("product_variants")
      .select("id, printful_variant_id, printful_catalog_variant_id, name, price, currency, image_url, is_active, products!inner(name, is_active)")
      .in("id", variantIds)
      .eq("is_active", true)
    if (vErr) return json({ error: "could not load cart" }, 500)

    const live = (variants || []).filter((v: any) => v.products?.is_active)
    if (live.length !== variantIds.length) {
      return json({ error: "some items are no longer available", reason: "stale_cart" }, 409)
    }

    const currency = (live[0].currency || "USD").toLowerCase()
    let subtotalCents = 0
    const orderItems = live.map((v: any) => {
      const qty = qtyByVariant.get(v.id)!
      const unit = Math.round(Number(v.price) * 100)
      subtotalCents += unit * qty
      return {
        variant_id: v.id,
        printful_variant_id: v.printful_variant_id,
        catalog_variant_id: v.printful_catalog_variant_id,
        product_name: v.products?.name || "Rinkd merch",
        variant_name: v.name,
        image_url: v.image_url,
        quantity: qty,
        unit_price_cents: unit,
      }
    })
    if (subtotalCents <= 0) return json({ error: "invalid cart total" }, 400)

    // Printful real-time shipping rate. Uses CATALOG variant ids.
    const rateRes = await fetch("https://api.printful.com/shipping/rates", {
      method: "POST",
      headers: pfHeaders(),
      body: JSON.stringify({
        recipient: {
          address1: ship.address1,
          city: ship.city,
          country_code: ship.country,
          state_code: ship.state || undefined,
          zip: ship.zip,
        },
        items: orderItems
          .filter((i) => i.catalog_variant_id)
          .map((i) => ({ variant_id: i.catalog_variant_id, quantity: i.quantity })),
      }),
    })
    const rateData = await rateRes.json().catch(() => ({}))
    if (!rateRes.ok || !Array.isArray(rateData?.result) || rateData.result.length === 0) {
      console.error("[store-checkout] shipping rate failed", { status: rateRes.status, body: rateData })
      return json({ error: "could not calculate shipping to that address", reason: "shipping" }, 422)
    }
    // Printful returns rates cheapest-first; take the standard (first) option.
    const rate = rateData.result[0]
    const shippingCents = Math.round(Number(rate.rate) * 100)
    const shippingName = rate.name || "Shipping"

    // Create the pending order (+ items). Tax is added by Stripe and recorded by
    // the webhook, so total here is pre-tax; the webhook overwrites it.
    const { data: order, error: oErr } = await svc
      .from("orders")
      .insert({
        buyer_profile_id: buyer.id,
        email,
        status: "pending",
        subtotal_cents: subtotalCents,
        shipping_cents: shippingCents,
        total_cents: subtotalCents + shippingCents,
        currency,
        ship_name: ship.name,
        ship_address1: ship.address1,
        ship_address2: ship.address2 || null,
        ship_city: ship.city,
        ship_state: ship.state || null,
        ship_country: ship.country,
        ship_zip: ship.zip,
      })
      .select("id")
      .single()
    if (oErr || !order) return json({ error: "could not create order" }, 500)
    createdOrderId = order.id

    const { error: oiErr } = await svc.from("order_items").insert(
      orderItems.map((i) => ({
        order_id: order.id,
        variant_id: i.variant_id,
        printful_variant_id: i.printful_variant_id,
        product_name: i.product_name,
        variant_name: i.variant_name,
        image_url: i.image_url,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
      })),
    )
    if (oiErr) return json({ error: "could not create order items" }, 500)

    const base = safeBase(appUrl)
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // Attach the address to a Stripe Customer so automatic_tax can compute tax
    // without re-collecting the address in Checkout.
    const customer = await stripe.customers.create({
      email,
      name: ship.name,
      address: {
        line1: ship.address1,
        line2: ship.address2 || undefined,
        city: ship.city,
        state: ship.state || undefined,
        postal_code: ship.zip,
        country: ship.country,
      },
      shipping: {
        name: ship.name,
        address: {
          line1: ship.address1,
          line2: ship.address2 || undefined,
          city: ship.city,
          state: ship.state || undefined,
          postal_code: ship.zip,
          country: ship.country,
        },
      },
    })

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      automatic_tax: { enabled: true },
      line_items: orderItems.map((i) => ({
        quantity: i.quantity,
        price_data: {
          currency,
          unit_amount: i.unit_price_cents,
          product_data: { name: `${i.product_name}${i.variant_name ? ` — ${i.variant_name}` : ""}` },
          tax_behavior: "exclusive",
        },
      })),
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: shippingCents, currency },
          display_name: shippingName,
          tax_behavior: "exclusive",
        },
      }],
      metadata: { order_id: order.id, kind: "store" },
      payment_intent_data: { metadata: { order_id: order.id, kind: "store" } },
      success_url: `${base}/store?success=1`,
      cancel_url: `${base}/store?canceled=1`,
    })

    await svc.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id)

    return json({ url: session.url })
  } catch (err) {
    if (createdOrderId) {
      try { await svc.from("orders").delete().eq("id", createdOrderId) } catch (_e) { /* best-effort */ }
    }
    console.error("[store-checkout] error", { error: (err as Error)?.message })
    return json({ error: (err as Error)?.message || "unexpected error" }, 500)
  }
})
