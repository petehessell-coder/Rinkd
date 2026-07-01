# SPRINT S06 — Fan Obsession (the game-day ritual)

> Prereq: master prompt + S02 audit. Engagement sprint — respect users, never
> manipulate. Goal: parents open Rinkd **before, during, and after** every game.

---

Become a hockey parent using the app every weekend for six months. Narrate every
emotional high and low across a game-day arc, then elevate the moments that deserve
celebration and warm up the moments that feel cold.

### The game-day arc (map each stage to real surfaces)
- **Before:** `src/pages/Home.js` (Home Ice) — is today's game the first thing I
  see? Countdown, location/map (`MapLink.js`), roster/lineup (`LineupCTA.js`,
  `LineupModal.js`), RSVP (`RsvpBlock.js`), stream link ready.
- **During:** live tiles on Home, `GameDetail.js` / `PublicGame.js`, live score,
  Game Puck voting (`GamePuckCard.js`, `SeasonGamePucks.js`, `lib/gamePucks.js`),
  reactions (`PostReactions.js`), the stream (`lib/streamUrl.js`, `livebarn.js`).
- **After:** recap cards (`RecapCard.js`, `lib/recapCard.js`), POTG / Game Puck
  reveal (`GamePuckReveal.js`), milestones (`lib/milestones.js`), shareable stat
  cards (`ShareButton.js`, `lib/shareCard.js`, `recapShareV2.js`), photo galleries
  (`Gallery.js`).

### For each stage answer
- What moment here deserves **celebration**? Where should excitement visibly happen?
- What currently feels **cold** or transactional?
- Where can we create **delight** without adding a feature (motion, copy, timing,
  sound via `SoundToggle.js`/`lib/sound.js`, haptics via `lib/haptics.js`)?
- What would make a parent **screenshot and share** this to the family group chat?
- What notification (`lib/notifications.js`, `PushPrompt.js`) would legitimately
  bring them back — a Game Puck result, a milestone, a recap — without spamming?

### Guardrails
- Engagement must be authentic. No fake urgency, no manufactured streaks, no
  autoplay. (See Never-Do.)
- Every celebratory moment still passes the stress data and `prefers-reduced-motion`.
- Youth events: celebrate the team and the moment without exposing minor PII.

### Deliverable
`Fable_Elevation_Program/audits/S06_fan_obsession.md` — the six-month narrative with
a ranked list of "make this a moment" opportunities, each mapped to a real file and
a specific, buildable change. Ship the cheap high-delight wins as scoped PRs.
