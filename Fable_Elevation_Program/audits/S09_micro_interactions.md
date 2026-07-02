# S09 — Micro-interactions: Inventory + Punch List

*July 2, 2026. Two parallel audits (primitives/global · content/feedback) against
the tokens.js motion vocabulary. No new tokens proposed anywhere. Full inventory
tables live in the audit transcripts; this doc keeps the actionable synthesis.*

## Verdict up front
The primitives are genuinely correct — Button (4 states + press physics),
BounceNumber (score/puck), RouteTransition, ToastHost, MoreDrawer/Onboarding
(S03/S04 work), PullToRefresh, and the whole S06/S07 shipped set verified in
place. The gaps: **six modals still jump-cut into existence, the tab strips
never got their manifesto slide, press feedback is Home-only, DMs are the last
non-optimistic send in the app, and two upload paths freeze or lie.**

## Bundle M1 — sheets & modals enter properly (copy MoreDrawer's gated pattern)
| Surface | Today | Token |
|---|---|---|
| EditGameModal | instant | entrance 250 + out |
| LineupModal | instant | entrance 250 + out |
| ScheduleBuilderModal | instant | entrance 250 + out |
| HelpButton sheet (every page!) | instant | sheet 350 + sheet (already flex-end) |
| PostActionMenu menu + ReportModal | instant | entrance 250 + out (+ haptic tick on menu open) |
| SubscribeCalendarSheet | hardcoded 0.15s | entrance 250 + out |

## Bundle M2 — the tab-strip slide (manifesto: indicator SLIDES, tab 200 inOut)
League + Tournament strips render per-button border swaps — the underline
teleports. Fix: one shared sliding indicator element (transform-based,
offsetLeft/width measured on change), `tab 200 + inOut`, reduced-motion → jump.

## Bundle M3 — press consistency (the app should thump everywhere)
- `.rinkd-pressable` 110ms → `press` 100 (drift, one char, app-wide tap feel)
- Layout nav: `transition:'all 0.15s'` → enumerated color/background on tokens;
  nav `<Link>`s get the pressable treatment (the CSS `button:active` rule can't
  reach an `<a>`)
- Promote Home's `.home-tap` press to a shared class → Discover cards, Teams
  rows, League/Tournament schedule rows, DM inbox rows, notification rows
- Tag.js onClick gets press feedback (currently a dead tap)

## Bundle M4 — content feedback honesty
| # | Fix | Token |
|---|---|---|
| M4a | **DM optimistic send** — the last non-optimistic send in the app (tap Send → nothing for 1–2s on rink wifi). Mirror CommentThread's `__pending` pattern exactly (temp id, opacity 0.55, "sending…", rollback + toast) | entrance 250 on bubble |
| M4b | Notification dismiss: rows vanish instantly → exit fade+translateY before removal | exit 200 + in |
| M4c | Notification mark-read: transition the red border (most visible state change on the row, currently abrupt) | tab 200 |
| M4d | Upload honesty: Feed's progress bar FAKES 30→80% steps (freezes at 80 during the real transfer); Gallery (which accepts VIDEO — the heaviest files) has no bar at all. Both → an honest indeterminate shimmer (pulse 1500) + keep pending labels | pulse 1500 |

## Flagged for Pete — D-S09-1: hover-lift on tappable cards
`shadows.hover` is defined in tokens and used by exactly ONE component (toasts).
The manifesto's card vocabulary says active/hover = lift. Applying it app-wide
to tappable cards is the vocabulary's intent but a broad visual change.
Options: apply with M3's shared pressable class (one place) or leave for S10.

## Noted, no action
- `numberChange` 400 token is defined and used nowhere (dead vocabulary — a
  future count-up wants it; don't force it)
- Like bounce runs 300ms (pulseStep) vs the goal vocabulary's score 200 —
  intentional-feeling, shipped in S07, leave
- MotionProvider animates layout props (time-boxed, willChange-hinted) — acceptable
- Bare-disabled buttons in hand-rolled modals (LineupModal/HelpButton/
  ScheduleBuilder) — fold into S10's component-adoption pass (Button primitive
  has disabledReason support already)

## Already correct (verified, leave alone)
Button 4-states · BounceNumber · RouteTransition · ToastHost in/out ·
MoreDrawer + Onboarding motion · PullToRefresh (haptic + gating) · comment
pending · RSVP optimistic+haptic · like/reaction physics · post-delete Undo ·
Home tile press + gate.
