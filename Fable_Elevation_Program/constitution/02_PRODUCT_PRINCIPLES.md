# 02 — PRODUCT & DESIGN PRINCIPLES

> IMPORTANT: The design bible and engineering standards already exist in the repo.
> This document does NOT replace them — it points to them and adds the product-level
> principles that sit above any single screen. Read the source files first.

## Where the real law already lives (read these — do not duplicate them)
- **Design system / North Stars / visual language:** `DESIGN_MANIFESTO.md`
- **Engineering + architecture + quality standards:** `CLAUDE.md`
- **Design tokens (colors, type, spacing, radii, shadows, motion):** `src/lib/tokens.js`
- **Component library:** `src/components/ui/*`

## The 5 North Stars (from DESIGN_MANIFESTO.md — memorize, do not re-derive)
1. **Stupid-Proof Simple** — works first try, no tutorial, one primary action per
   screen, labels beat icons, big tap targets, error states say what to do next.
2. **Intuitively Familiar** — match patterns every smartphone user already knows.
   Pull-to-refresh refreshes. Swipe-back navigates back. Tapping a card opens it.
3. **Social-First Flow** — the mental model is Instagram/TikTok, not a stats
   website. Content is the product. Actions happen in place.
4. **Engaging** — worth opening when there's no game on. Stats are a story, not a
   table. Every empty state is an invitation.
5. **Shareable & Sticky** — if it can't be screenshotted into a group chat, it
   isn't designed right.

## Product principles (how we decide WHAT to build)
- We solve hockey problems. We don't invent features.
- Every feature must make hockey easier. Every click should save time. Every
  interaction should increase community.
- Never build because a competitor has it. Build because hockey needs it.
- Reduce friction before adding capability. When "more features" and "better
  experience" conflict, choose better experience.
- Adult-first where a legal/consent gate exists (youth privacy). Ship the clean
  path now; gate the minor-PII path behind consent.
- Preserve the architecture and navigation. Elevate execution, not identity.

## Design principles (how we decide HOW it looks/feels)
- Premium. Simple. Confident. Never cluttered. Always obvious.
- One primary action per screen. One-hand mobile usage.
- Fast over flashy. Emotion over raw information. Broadcast quality.
- Every animation communicates meaning — no motion for decoration. Use the timing
  and easing already defined in `tokens.js` (`motion.duration`, `motion.easing`).
- Color has intent: **red = action/urgency/live ONLY**, **gold = milestones/awards
  ONLY** (scarce by design), blue = the rink light / elevated accents, navy =
  ground. Never repurpose these.
- Priority of users: **Parents first. Volunteers second. Admins third.** (But the
  operator on-ramp still has to be obvious, because operators are how we scale.)

## Component discipline (the current, real gap)
The design system is built but under-adopted. New/edited screens MUST import from
`src/lib/tokens.js` and use `src/components/ui/*` (`SectionHeader`, `EmptyState`,
`ErrorState`, `Button`, `StatNumber`, `Skeleton`, …). Do not hand-roll a section
header, an empty state, or a color again.
