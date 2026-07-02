# S08 — ESPN Prompt: Broadcast-Treatment Delta Plan

*July 2, 2026. S06 already shipped the goal-moment core (celebration stack on
GameDetail, us-vs-them, TIED IT/LEAD CHANGE, state line, final beat, period
pulse) — this sprint is the REMAINING delta. Reference standard: PublicGame's
live treatment, which a prior audit called the gold standard. All presentation;
data/scoring logic untouched.*

## Why GameDetail reads "app" while PublicGame reads "broadcast"
- Score: 56px vs the 72px broadcast bug (the number doesn't dominate)
- Live state: a static `● LIVE` pill vs a red lower-third slab + ring-expand
  pulse (manifesto: "you feel it before you read it")
- Team names: body-font sentence case vs condensed-900-italic uppercase
- No `shadows.live` — a live game and a scheduled game have identical depth
  (in fact NEITHER page uses the token; Home hand-rolls its own)

## The broken winning bar (top finding)
**GameDetail has NO reachable stream.** It imports only the LiveBarn helper —
whose venue IDs are all placeholders, so its button never renders — and its
league query doesn't even select `youtube_url`. A live XRHL/KOHA game with a
real YouTube stream shows no watch affordance on the authenticated page, while
the anonymous share link has a proper platform-colored button. The <10-second
fan bar is unreachable, not slow.

## The plan (Gate 1)
| # | Upgrade | Files |
|---|---|---|
| 1 | **Wire the real stream into GameDetail** — select youtube_url (+rink fallback), render PublicGame's watch-button block high on the page; LiveBarn stub stays behind it (still gated until the partnership) | GameDetail.js |
| 2 | 72px score (keep BounceNumber + tabular-nums) + `shadows.live` on the live box | GameDetail.js |
| 3 | **Shared `LiveLowerThird`** — extract PublicGame's red slab + ring-expand pulse into one component both pages use (also fixes PublicGame's tabular-nums gap and kills the duplicated pgScorePop keyframe values) | new components/LiveLowerThird.js, both pages |
| 4 | Puck-drop countdown on scheduled state ("PUCK DROPS IN 2H 14M" — client math on start_time, no fetch, no poll) | both pages |
| 5 | "Season series X–Y" line via the existing getHeadToHead (lazy, bounded, reserved-height — mirrors Home's game-day row) | GameDetail.js (+PublicGame) |

## Verified clean / no action
Realtime hygiene on both pages (one debounced channel per game, unsubscribed on
unmount, no polling — Saturday-safe); team records already at parity; red-only-
for-live discipline holds; BounceNumber correctly uses motion tokens.

## Deferred
Standings implications ("winner takes 2nd") — requires standings projection
math, not cheap with existing libs; records + season series carry the stakes.

## Guardrails for the build
Reduced-motion: ring/pop already no-op; countdown is text. Youth-safe: streams
are URLs, H2H is team-level. Nothing polls. Data and scoring logic untouched.
