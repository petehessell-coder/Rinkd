import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno"

// REG-3 — individual (player) registration checkout. AUTH REQUIRED: the caller
// is a signed-in guardian (or the player themselves) registering a profile they
// manage into a league or tournament. Writes the SPINE directly:
// registrations (registrant_type='profile') + payment_plans +
// payment_installments + waiver_acceptances. The webhook (kind='player')
// completes the money trail on checkout.session.completed.
//
// The bar: a first-time parent registers a kid and pays, on a phone, first try.
//
// We never trust the body for fee/state — the event row is read server-side and
// the spine rows are inserted with the service role (no client INSERT policies).
// Manageability ("may I register this person?") is checked with the CALLER's
// JWT via the can_manage_profile RPC, so RLS-grade consent logic decides — not
// this function.
//
// Fee model (locked; mirrors stripe-checkout + public.reg_fee_breakdown):
//   total = round((base + 30) / 0.971); organizer nets base − 1%; Stripe
//   processing grossed up to the registrant; destination charge when the
//   organizer has Connect payouts enabled, plain platform charge otherwise.

// REG-4 secret split: registrations run on their own key (sandbox until paid
// launch); fallback keeps pre-split behavior until the secret is set.
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_REG_SECRET_KEY") ?? Deno.env.get("STRIPE_SECRET_KEY")
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

// Only allow our own origins as Stripe success/cancel redirect targets.
function safeBase(appUrl: unknown): string {
  const fallback = "https://rinkd.app"
  if (typeof appUrl !== "string") return fallback
  const ok = /^https?:\/\/(localhost(:\d+)?|([a-z0-9-]+\.)?rinkd\.app)(\/|$)/i.test(appUrl)
  return ok ? appUrl.replace(/\/+$/, "") : fallback
}

const KINDS: Record<string, any> = {
  league: {
    parentTable: "leagues", ownerCol: "commissioner_id",
    path: (id: string) => `/league/${id}/register-player`,
  },
  tournament: {
    parentTable: "tournaments", ownerCol: "director_id",
    path: (id: string) => `/tournament/${id}/register-player`,
  },
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  let createdRegId: string | null = null
  try {
    if (!STRIPE_SECRET_KEY) return json({ error: "stripe not configured" }, 500)

    // ── Caller identity (required) ──
    const authHeader = req.headers.get("Authorization") ?? ""
    const jwt = authHeader.replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ error: "sign in to register a player" }, 401)
    const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: { user }, error: userErr } = await asCaller.auth.getUser()
    if (userErr || !user) return json({ error: "invalid session" }, 401)

    const body = await req.json()
    const kind = body.kind === "tournament" ? "tournament" : "league"
    const cfg = KINDS[kind]
    const parentId = body.targetId
    const profileId = body.profileId
    const waiverAccepted = body.waiverAccepted === true
    const waiverVersionSeen = Number.isInteger(body.waiverVersion) ? body.waiverVersion : null
    const appUrl = body.appUrl
    if (!parentId || !profileId) return json({ error: "missing required fields" }, 400)

    // ── Caller's own profile (real users keep profiles.id === auth uid) ──
    const { data: callerProfile } = await svc
      .from("profiles").select("id, email, name").eq("auth_user_id", user.id).maybeSingle()
    if (!callerProfile) return json({ error: "profile not found" }, 401)

    // ── Consent: may the CALLER act for this registrant? Decided by the
    //    RLS-grade helper under the caller's own JWT. ──
    const { data: mayManage, error: mErr } = await asCaller.rpc("can_manage_profile", {
      p_profile_id: profileId,
    })
    if (mErr || mayManage !== true) {
      return json({ error: "you can only register yourself or a family member you manage" }, 403)
    }

    const { data: registrant } = await svc
      .from("profiles").select("id, name, account_type").eq("id", profileId).maybeSingle()
    if (!registrant) return json({ error: "player profile not found" }, 404)
    // A minor can never self-register / self-consent. Unreachable today
    // (minors are login-less), but teen logins are a planned later add —
    // this assert keeps the consent model honest when they arrive.
    if (registrant.account_type === "minor" && profileId === callerProfile.id) {
      return json({ error: "a minor's registration must be completed by their guardian" }, 403)
    }

    // ── Event state (server-side truth) ──
    const { data: parent, error: pErr } = await svc
      .from(cfg.parentTable)
      .select(`id, name, ${cfg.ownerCol}, player_fee_cents, player_registration_open, player_installments_max`)
      .eq("id", parentId)
      .single()
    if (pErr || !parent) return json({ error: "event not found" }, 404)
    if (!parent.player_registration_open) return json({ error: "closed", reason: "closed" }, 409)

    // ── Installments (REG-4): N monthly payments when the organizer offers
    //    them. Each charge pays its own Stripe fee (per-installment gross-up);
    //    the first installment is due NOW and goes through this checkout, the
    //    rest are scheduled monthly (Auto-Pay or dunning reminders collect them).
    const maxN = Math.max(Number(parent.player_installments_max) || 1, 1)
    const askedN = Math.max(Number(body.installmentsCount) || 1, 1)
    const nInstallments = Math.min(askedN, maxN)

    // ── Waiver (LA-2): required waivers must be accepted, and the acceptance
    //    is recorded against the guardian who consented. The client sends the
    //    version it DISPLAYED — if the organizer edited the waiver in between,
    //    we 409 so the guardian re-reads rather than "accepting" unseen text. ──
    const { data: waiver } = await svc
      .from("waiver_templates")
      .select("id, version, required, title, body_md")
      .eq("owner_type", kind).eq("owner_id", parentId)
      .maybeSingle()
    if (waiver?.required && !waiverAccepted) {
      return json({ error: "waiver must be accepted", reason: "waiver" }, 409)
    }
    if (waiver && waiverAccepted && waiverVersionSeen !== null && waiverVersionSeen !== waiver.version) {
      return json({ error: "the waiver was updated — please review it again", reason: "waiver_changed" }, 409)
    }

    const feeCents = Math.max(Number(parent.player_fee_cents) || 0, 0)
    // Stripe's charge minimum is 50¢; the gross-up needs headroom on top.
    // A sub-$1 fee is a misconfiguration, not a price.
    if (feeCents > 0 && feeCents < 100) {
      return json({ error: "this event's player fee is set below $1 — ask the organizer to fix it", reason: "fee_too_small" }, 409)
    }
    const ownerId = parent[cfg.ownerCol]

    // Per-installment money: split the base into N parts (remainder on the
    // first), gross up EACH part (every charge pays its own Stripe fee).
    // Each part must stay ≥ $1 (the same floor as a one-time fee).
    const grossUp = (b: number) => Math.round((b + 30) / 0.971)
    const n = feeCents > 0 ? Math.min(nInstallments, Math.max(Math.floor(feeCents / 100), 1)) : 1
    const baseShare = feeCents > 0 ? Math.floor(feeCents / n) : 0
    const bases = feeCents > 0
      ? Array.from({ length: n }, (_, i) => baseShare + (i === 0 ? feeCents - baseShare * n : 0))
      : []
    const amounts = bases.map(grossUp)
    const total = amounts.reduce((s, a) => s + a, 0)
    // Recorded platform fee = base − round(base*0.99): the EXACT amount the
    // destination charges keep after the processing passthrough, so the
    // ledger equals Stripe to the cent.
    const platformFee = feeCents > 0 ? feeCents - Math.round(feeCents * 0.99) : 0

    // ── Duplicate guard / RESUME: one LIVE registration per (person, event).
    //    A pending one with an unpaid installment is a half-finished checkout
    //    (declined card, closed tab) — resume it with a fresh session instead
    //    of bricking the kid's registration. ──
    const { data: dup } = await svc
      .from("registrations")
      .select("id, status, amount_cents, plan:payment_plans(id, installments:payment_installments(id, status, due_date, amount_cents, base_cents, stripe_session_id))")
      .eq("registrant_type", "profile").eq("registrant_id", profileId)
      .eq("target_type", kind).eq("target_id", parentId)
      .in("status", ["pending", "active", "waitlisted"])
      .maybeSingle()
    let resumeRegId: string | null = null
    let resumeInstId: string | null = null
    let resumeAmount = 0
    let resumeBase = 0
    let resumeStaleSession: string | null = null
    if (dup) {
      // Resume the EARLIEST unpaid, uncancelled installment of a pending plan.
      const unpaid = (dup.plan?.installments || [])
        .filter((i: any) => !["paid", "refunded", "cancelled"].includes(i.status))
        .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)))
      const resumable = dup.status === "pending" && feeCents > 0 && unpaid.length > 0
      if (!resumable) {
        return json({ error: `${registrant.name} is already registered`, reason: "duplicate", registrationId: dup.id }, 409)
      }
      resumeRegId = dup.id
      resumeInstId = unpaid[0].id
      resumeAmount = unpaid[0].amount_cents
      resumeBase = unpaid[0].base_cents
      resumeStaleSession = unpaid[0].status === "processing" ? unpaid[0].stripe_session_id : null
    }

    // ── Household for the family roll-up: a household where the caller is a
    //    guardian and the registrant is a member (self-registration: the
    //    caller's own guardian household, if any). ──
    let householdId: string | null = null
    const { data: hhRows } = await svc
      .from("household_members")
      .select("household_id, profile_id, role, status")
      .in("profile_id", [callerProfile.id, profileId])
      .eq("status", "active")
    if (hhRows?.length) {
      const guardianOf = new Set(
        hhRows.filter((r: any) => r.profile_id === callerProfile.id && r.role === "guardian")
          .map((r: any) => r.household_id))
      const registrantIn = hhRows.filter((r: any) => r.profile_id === profileId)
        .map((r: any) => r.household_id)
      householdId = registrantIn.find((h: string) => guardianOf.has(h))
        || (profileId === callerProfile.id ? (guardianOf.values().next().value ?? null) : null)
    }

    // ── Spine rows (service role — the only write path in). Skipped when
    //    resuming a half-finished checkout: those rows already exist, incl.
    //    the waiver acceptance recorded on the first attempt. ──
    let regId: string
    let instId: string | null = null
    if (resumeRegId) {
      regId = resumeRegId
      instId = resumeInstId
    } else {
      const { data: reg, error: rErr } = await svc
        .from("registrations")
        .insert({
          registrant_type: "profile",
          registrant_id: profileId,
          target_type: kind,
          target_id: parentId,
          household_id: householdId,
          status: feeCents > 0 ? "pending" : "active",
          amount_cents: feeCents,
          created_by: callerProfile.id,
          source_kind: "native",
        })
        .select("id")
        .single()
      if (rErr) {
        // Unique-index race (double-tap / two tabs): the other request won —
        // surface the friendly duplicate instead of a generic 500.
        if ((rErr as any).code === "23505") {
          return json({ error: `${registrant.name} is already registered`, reason: "duplicate" }, 409)
        }
        return json({ error: "could not create registration" }, 500)
      }
      regId = reg.id
      createdRegId = reg.id

      if (waiver && (waiver.required || waiverAccepted)) {
        // Snapshot the exact text consented to — templates are editable in
        // place, so the acceptance row is the immutable legal record.
        const { error: wErr } = await svc.from("waiver_acceptances").insert({
          waiver_template_id: waiver.id,
          registration_id: regId,
          subject_profile_id: profileId,
          accepted_by: callerProfile.id,
          waiver_version: waiver.version,
          accepted_title: waiver.title,
          accepted_body_md: waiver.body_md,
          ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
          user_agent: req.headers.get("user-agent") || null,
        })
        if (wErr) throw new Error(`waiver record failed: ${wErr.message}`)
      }

      // ── Free event: active immediately, no money objects. ──
      if (feeCents <= 0) {
        return json({ free: true, registrationId: regId })
      }

      // ── Money objects: N installments, first due NOW (this checkout pays
      //    it), the rest scheduled monthly. n===1 is the one-time plan. ──
      const { data: plan, error: planErr } = await svc
        .from("payment_plans")
        .insert({
          registration_id: regId,
          total_cents: total,
          platform_fee_cents: platformFee,
          processing_fee_cents: total - feeCents,
          plan_type: n > 1 ? "installments" : "one_time",
          status: "active",
        })
        .select("id")
        .single()
      if (planErr || !plan) throw new Error("could not create payment plan")
      const today = new Date()
      const rows = bases.map((b, i) => {
        const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, today.getUTCDate()))
        return {
          payment_plan_id: plan.id,
          amount_cents: amounts[i],
          base_cents: b,
          status: "scheduled",
          due_date: due.toISOString().slice(0, 10),
        }
      })
      const { data: insts, error: instErr } = await svc
        .from("payment_installments")
        .insert(rows)
        .select("id, due_date")
      if (instErr || !insts || insts.length !== rows.length) throw new Error("could not create installments")
      instId = insts.sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)))[0].id
    }

    // ── Connect (optional, same as team-entry) ──
    let connectedAccountId: string | null = null
    if (ownerId) {
      const { data: acct } = await svc
        .from("stripe_connect_accounts")
        .select("stripe_account_id, charges_enabled")
        .eq("owner_profile_id", ownerId)
        .maybeSingle()
      if (acct?.stripe_account_id && acct.charges_enabled) connectedAccountId = acct.stripe_account_id
    }

    const base = safeBase(appUrl)
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2024-06-20",
    })

    // Resume with a still-open prior session: expire it first so there's only
    // ever ONE live checkout per installment (two open sessions = a manual
    // double-charge path).
    if (resumeStaleSession) {
      try { await stripe.checkout.sessions.expire(resumeStaleSession) }
      catch (_e) { /* already expired/completed — fine */ }
    }

    // This checkout charges exactly ONE installment: the first of a new plan,
    // or the earliest unpaid one when resuming. Later installments collect via
    // Auto-Pay / pay-installment.
    const chargeBase = resumeRegId ? resumeBase : bases[0]
    const chargeAmount = resumeRegId ? resumeAmount : amounts[0]
    const nLabel = !resumeRegId && n > 1 ? ` (1 of ${n})` : ""
    const lineItems: Record<string, any>[] = [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: chargeBase,
        product_data: {
          name: `${parent.name} — Player Registration${nLabel}`,
          description: registrant.name,
        },
      },
    }, {
      quantity: 1,
      price_data: { currency: "usd", unit_amount: chargeAmount - chargeBase, product_data: { name: "Processing fee" } },
    }]

    const sessionParams: Record<string, any> = {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: callerProfile.email || user.email,
      line_items: lineItems,
      metadata: { registration_id: regId, installment_id: instId, kind: "player" },
      success_url: `${base}${cfg.path(parentId)}?success=1`,
      cancel_url: `${base}${cfg.path(parentId)}?canceled=1`,
    }
    if (connectedAccountId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: chargeAmount - Math.round(chargeBase * 0.99),
        transfer_data: { destination: connectedAccountId },
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams)
    await svc.from("payment_installments")
      .update({ stripe_session_id: session.id, status: "processing" })
      .eq("id", instId)

    return json({ url: session.url, resumed: !!resumeRegId })
  } catch (err) {
    // Roll back the pending spine rows if we never handed off to Stripe
    // (CASCADE removes plan/installments/acceptances with the registration).
    if (createdRegId) {
      try { await svc.from("registrations").delete().eq("id", createdRegId) } catch (_e) { /* best effort */ }
    }
    console.error("[register-player] error", { error: err?.message })
    return json({ error: err?.message || "unexpected error" }, 500)
  }
})
