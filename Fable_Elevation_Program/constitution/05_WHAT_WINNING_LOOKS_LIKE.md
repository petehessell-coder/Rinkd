# 05 — WHAT WINNING LOOKS LIKE

> Outcomes, not features. Every design review, sprint, and engineering decision is
> judged against these. If a change doesn't move one of these outcomes, question it.

## The user-outcome bars (the product must make these effortless)
1. **A first-time hockey parent registers a child for a tournament in under 3
   minutes, without asking for help.**
2. **A scorekeeper records a goal in under 5 seconds while standing at the scorer's
   table** (one-handed, gloves-off-optional, no mis-taps).
3. **A fan finds today's game, checks the live score, and jumps into the stream in
   under 10 seconds** from cold open.
4. **A league commissioner publishes a full season schedule in minutes, not hours.**
5. **A player instantly recognizes Rinkd as their hockey identity**, regardless of
   which league or tournament they're in.
6. **Partners (SportsEngine, Crossbar, GameSheet) see Rinkd as a complementary
   engagement layer that increases their value** — never as a replacement threat.

## The quality bars (how it must feel)
- **"This feels expensive"** before the user has done anything — on first open,
  from loading states, motion, hierarchy, typography, and imagery alone.
- **Every screen is A+ against `DESIGN_MANIFESTO.md`.** A/B/C/D is not shippable.
- **The Saturday Night Test passes:** instant at 10,000 concurrent users. No
  polling, no full-list fetches, no cold-start on hot paths.
- **The Grandparent Test passes:** a volunteer scorekeeper, a hockey grandparent,
  and a teenager each succeed on the first try, one-handed, no tutorial.
- **Every game-day moment is screenshot-worthy** — a stat card, recap, or Game Puck
  a parent actually wants to post to the family group chat.

## The business bars (why we're building it)
- **Operator pull is the north-star signal:** an operator asks to put more of their
  events on Rinkd after a pilot. (An evaluator landing cold should immediately see a
  live, legitimate, premium product — hence Featured-hero-at-top.)
- **Pilot scorecard (target bars, per pilot):**
  - Activation ≥ **40%** of invited users complete first meaningful action.
  - Engagement: **3+ sessions** per active user + **50%** perform a core action
    (Game Puck vote, reaction, follow, comment).
  - Retention ≥ **30%** return the following week.
  *(These require the Pilot Analytics instrumentation — a P0 gating item before the
  Oakland pilot; the elevation program runs after that ships.)*

## The one sentence that summarizes winning
> Rinkd becomes the default place every hockey participant checks before, during,
> and after every game — and the layer every operator wants on top of their stack.
