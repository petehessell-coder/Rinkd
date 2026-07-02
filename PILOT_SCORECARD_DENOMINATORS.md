# Pilot Scorecard — Denominators (SIGNED OFF · Pete · July 2, 2026)

> The Pilot Analytics spec's guardrail: *"Lock the denominators for activation
> and retention in writing before pilots, or the %s are meaningless."* This is
> that lock — all five decisions are now final.

## The five decisions

### 1. Activation denominator — **roster × 1.5**
`# of players on the event roster × 1.5` (the player if adult + ~1 parent for
youth). Computable the day the roster lands; no operator dependency. If an
operator hands us an explicit invite list, we may report BOTH numbers but the
roster×1.5 figure is the scorecard number.
- **Numerator (automated):** distinct users who signed up AND took a connect
  action (followed/joined their team, league, or event).
- Layer-on-top pilots (no roster): fall back to the `?ref=` visitor cohort.

### 2. Game-day window — **the event's actual game dates**
Engagement (3+ sessions/active user, action rate) is measured on days with ≥1
scheduled game for the event, derived from the schedule. No fixed calendar
padding.

### 3. Retention basis — **activated users** (not all signups)
People who never connected aren't "lost." The `analytics_pilot_retention` view
was updated accordingly (migration `20260702150000`, live on prod).

### 4. Retention window — **return the following week** (week-2)
Computable immediately for every pilot; the view computes it. "Returned for
the next event" may be reported as a supplementary narrative metric when a
next event exists, but week-2 is the scorecard number.

### 5. Per-pilot ref slugs — **`little-caesars`** and **`oakland`**
Hand out links/QRs as `rinkd.app/?ref=little-caesars` and
`rinkd.app/?ref=oakland`. First-touch attribution + the dashboard slice are
already live; scorecards populate the moment traffic lands.

## What serves this (all live)
- `analytics_pilot_actions` / `_activation` / `_engagement` / `_retention`
  (commissioner-gated, sliced by ref) + the AdminAnalytics "Pilot scorecards"
  section.
- For full-platform pilots, activation/retention can ALSO be derived
  relationally from the event roster; the roster×1.5 denominator is applied at
  reporting time against the automated numerators.

**Every scorecard number is now reportable per pilot with a denominator that
means something.**
