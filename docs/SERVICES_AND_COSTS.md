# Rinkd — Services, Costs & Tier Limits

**Created:** May 25, 2026. **Owner:** Pete. Keep current as the stack scales.
**TL;DR:** Everything is on **free tiers today.** The one that matters: **Supabase is Free** — which means *no backups* and *auto-pause after 7 days idle*. Fine for build/test; **not** for a live event or a real customer. Budget **~$45/mo (Supabase Pro $25 + Vercel Pro $20)** to cover the pilot + KOHA, ~$65/mo if KOHA's email volume needs Resend Pro.

> ⚠️ Verify the live plan/limits before committing money: I can confirm Supabase = Free (via MCP), but **could not see the Vercel or Resend plans** — check those dashboards. Specific tier numbers shift; sanity-check each vendor's pricing page.

---

## The stack

| Service | Role | Plan (May 25) | Cost | Free-tier limits that bite |
|---|---|---|---|---|
| **Supabase** | DB · auth · storage · edge functions · realtime (the backbone) | **Free** *(confirmed via MCP)* | $0 | 500MB DB · 1GB storage · ~5GB egress/mo · ~200 concurrent realtime · 500K edge invocations/mo · **NO backups** · **auto-pauses after 7 days idle** · 1-day log retention |
| **Vercel** | Hosting / CI / deploys | **likely Hobby** *(verify)* | $0 | ~100GB bandwidth/mo · **Hobby ToS prohibits commercial use** · no team seats |
| **Resend** | Transactional email — team/manager invites, scoresheet PDFs, onboarding | Free *(verify)* | $0 | **3,000 emails/mo · 100/day** · 1 verified sending domain |
| **Cloudflare Turnstile** | Bot protection on signup/login/forgot | Free | $0 | ~1M challenges/mo — effectively unlimited at our scale |
| **Web Push (VAPID + FCM/APNs)** | Recap push notifications | Free | $0 | None — browser push services are free + unlimited |
| **Sentry** | Client error monitoring | Free (Developer) | $0 | ~5K errors/mo · 1 seat · 30-day retention |
| **GitHub** | Code repository | Free | $0 | Fine — unlimited private repos |
| **Domain (rinkd.app)** | Domain registration | registrar | ~$15–30/yr | renewal only |
| **AvantLink** | Affiliate feed (Pure Hockey) | — | $0 | **DENIED / inactive** — not in use |
| **Stripe** | Payments / registration | **scaffolded — live-mode account active** (acct Rinkd LLC; `stripe-checkout`/`stripe-webhook`/`stripe-connect` edge fns deployed + ACTIVE as of Jun 10 2026). Connect platform enable + full REG build (TOURN-REG-1/LA-1) still post-pilot. | per-txn (2.9% + $0.30) once live registration ships | Verify which key the edge fns use (Supabase secret `STRIPE_SECRET_KEY` live vs test) before taking customer money. |
| jsPDF / jspdf-autotable | Client-side scoresheet PDF | npm lib | $0 | not a service |
| LiveBarn | Stream link-out / venue IDs (partnership) | partnership | $0 to Rinkd | not a billable Rinkd service |

---

## 🏒 BLPA tournament (Jun 13–14) — what you'll WANT
A one-weekend, 8-team event can technically run on Free, but two cheap upgrades are smart insurance:
- **Supabase Pro — $25/mo (WANT, strong).** Removes the **auto-pause** risk on game day, adds **daily backups**, more realtime/egress headroom for spectators on live standings. $25 to de-risk the pilot is a no-brainer.
- **Vercel Pro — $20/mo (WANT).** The pilot is arguably commercial; Hobby's terms don't allow that. Low urgency for one weekend.
- Resend / Turnstile / Sentry / Push: **Free is fine** (scoresheet emails ≈ 40 total, well under the 100/day cap).

## 🥅 KOHA (first real external league) — what you'll NEED
A real/paying customer running a full season turns "fine on Free" into "not responsible":
- **Supabase Pro — $25/mo (NEED).** No backups on Free is a non-starter for a customer's season of data; the auto-pause risk is unacceptable for an always-on league; egress/realtime accumulate over a season. **The real one.**
- **Vercel Pro — $20/mo (NEED).** A real customer = unambiguously commercial → Hobby ToS violation.
- **Resend — likely NEED Pro ($20/mo → 50K emails), or monitor closely.** League-wide invites + game reminders + scoresheets across a season will blow past 3,000/mo and the **100/day** cap on busy days.
- Turnstile / Web Push / Sentry / GitHub: **Free still fine** (watch Sentry's 5K errors/mo if volume grows).

---

## Recommendation
**Upgrade Supabase + Vercel to Pro before the pilot.** Both BLPA and KOHA are imminent, it's ~$45/mo, and it removes the two scariest free-tier risks (project pause + no backups) for trivial money. Add Resend Pro when KOHA's email volume climbs (~$65/mo all-in). Revisit when Stripe/registration ships (adds per-transaction cost, no monthly tier).
