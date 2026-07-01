# Pilot Scorecard — Denominators (DRAFT, needs Pete sign-off)

> The Pilot Analytics spec's own guardrail: *"Lock the denominators for activation
> and retention in writing before pilots, or the %s are meaningless."* This is that
> lock. **Nothing here is final until Pete signs off the numbers + definitions.**

The instrumentation + rollup views are live (deployed 2026-07-01). They compute the
numerators automatically. What must be decided by a human is **what each percentage
is divided by** — the denominator — because that's a judgment call, not a query.

---

## The two pilot archetypes (denominators differ by archetype)

**A. FULL-PLATFORM pilot** — Rinkd runs the whole event (Little Caesars, Oakland).
We know the roster, so denominators are **relational** (derived from the event's
league/tournament membership), which is cleaner and more honest than link-clicks.

**B. LAYER-ON-TOP pilot** — Rinkd is the fan layer on an event that lives on another
platform. We don't have the roster, so denominators fall back to the **`?ref=`
attribution cohort** (who arrived via the pilot's link/QR).

---

## Proposed denominators (per metric)

### Activation — target ≥ 40%
"A rostered person + their family signed up and connected to their team."
- **Full-platform denominator (proposed):** the count of **invited participants +
  expected family accounts** for the event. Recommended concrete definition:
  `# of players on the event roster × an agreed household factor` (propose **1.5**
  accounts/player = the player if adult + ~1 parent for youth), OR simply the
  **explicit invite list** if the operator gives us one. ⬜ *Pete: pick roster×factor
  or invite-list, and set the factor.*
- **Numerator:** distinct users who signed up AND took a connect action (joined/
  followed their team or league).
- **Layer-on-top denominator:** distinct `?ref=` visitors who reached a signup-
  eligible surface. (Weaker; use only when there's no roster.)

### Engagement — target: 3+ sessions/active user on game days + ≥ 50% take an action
- **Denominator:** **active users in the pilot cohort during the event window.**
  For full-platform = users tied to the event roster/league; for layer-on-top = the
  `?ref=` signup cohort. ⬜ *Pete: confirm "game-day window" = the event's actual
  game dates (recommended) vs a fixed calendar range.*
- **Numerators (already computed):** `avg_sessions_per_user`, `users_3plus_sessions`,
  and `action_rate_pct` (distinct users with ≥1 social action ÷ active users), from
  `analytics_pilot_engagement`.

### Retention — target ≥ 30%
"Came back for a second event / the following week."
- **Denominator:** the **activated cohort from the pilot** (not all signups — the
  people who actually activated). ⬜ *Pete: confirm retention is measured against
  activated users (recommended) vs all signups.*
- **Window:** ⬜ *Pete: "return the following week" (what the view computes today) vs
  "return for the next event." For a single-weekend pilot, next-event may be more
  meaningful — say which.*

---

## What's already built to serve this
- `analytics_pilot_activation` · `_engagement` · `_retention` · `_actions`
  (commissioner-gated), sliced by `ref`.
- For the **relational** (full-platform) denominators, the numerators can be joined
  to the event's roster/league membership instead of `ref` — a small follow-up query
  once the roster source per pilot is confirmed.

## Open decisions for Pete (the sign-off checklist)
1. ⬜ Activation denominator: **roster × household factor** (set factor) **or**
   operator invite list?
2. ⬜ Game-day window definition (event dates vs fixed range)?
3. ⬜ Retention measured vs **activated users** or all signups?
4. ⬜ Retention window: **following week** or **next event**?
5. ⬜ Per-pilot `ref` slugs to hand out (e.g. `little-caesars`, `oakland`)?

Once these five are answered, every scorecard number is reportable per pilot with a
denominator that means something.
