# SPRINT S08 — The ESPN Prompt (broadcast-grade live game)

> Prereq: master prompt + S02 audit. Change PRESENTATION, not data. Every live game
> should feel like a television broadcast.

---

Study ESPN, Formula 1, Apple Sports, the NHL app, and The Athletic — for
*presentation* only. Do not change the underlying data or scoring logic. Make every
score update create anticipation, every goal feel exciting, every stat feel
important.

### Real live-game surfaces & files
- **Live viewing:** `src/pages/GameDetail.js`, `src/pages/PublicGame.js`,
  public/league game routes (`/g/:gameId`, `/game/:gameId`, `/league-game/:gameId`).
- **Scoring input:** `src/pages/ScorerView.js` + league-scorer route,
  `src/components/Scoresheet.js`, `EditGameModal.js`, `lib/gameday.js`,
  `lib/gameRealtime.js` (Realtime — no polling), `lib/goalMoment.js`.
- **Score/number motion:** `src/components/ui/BounceNumber.js`,
  `src/components/GamePuckCard.js`, and the `motion.duration.score` (200ms) +
  `motion.easing.puck` ("hard hit, slight overshoot") already in `tokens.js`.
- **Live status treatment:** `shadows.live` + red (`colors.red`) — red is for LIVE
  and urgency ONLY.

### Elevate (presentation only)
- **The goal moment:** when a goal lands, the score should *hit* — use
  `BounceNumber` with `motion.easing.puck`, optional haptic (`lib/haptics.js`) and
  sound (`lib/sound.js`, user-toggleable via `SoundToggle.js`), and a brief,
  meaningful animation. Honor `prefers-reduced-motion`.
- **Live hierarchy:** period/clock/score/status as a broadcast lower-third using
  `type.sectionHead` (uppercase, italic, condensed) and `type.stat` (tabular figures
  so columns don't jitter).
- **Anticipation:** live pulse ring (`motion.duration.pulse`, infinite) on live
  tiles; a clear LIVE badge; countdown before puck drop.
- **Context:** surface the story around the number — streaks, head-to-head,
  standings implications — sourced from existing `lib/stats.js` / `standings.js`,
  not new data.
- **The stream:** getting from a live score to the stream must be one obvious tap
  (`lib/streamUrl.js`, `livebarn.js`) — the <10-second Winning bar.

### Guardrails
- Realtime subscriptions only; unsubscribe on unmount; must hold under many
  simultaneous live games (Saturday Night Test).
- All motion communicates meaning; nothing decorative; reduced-motion safe.
- Data and scoring logic untouched — this is a presentation sprint.

### Deliverable
`Fable_Elevation_Program/audits/S08_live_game.md` (broadcast-treatment plan per
surface) + a scoped PR for the goal-moment and live-hierarchy polish.
