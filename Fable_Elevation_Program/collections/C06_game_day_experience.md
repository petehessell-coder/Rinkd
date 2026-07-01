# COLLECTION C06 — Game Day Experience (end to end)

**Objective:** Own the entire game-day surface — live scoring, broadcast-grade
viewing, photo galleries, streams, notifications. Extends S06 + S08 into one
integrated ritual. Winning bar: fan → today's game → live score → stream in <10s;
scorekeeper records a goal in <5s.

**Real surfaces & files:** `ScorerView.js` + league-scorer route, `Scoresheet.js`,
`EditGameModal.js`, `lib/gameday.js`, `lib/gameRealtime.js`, `lib/goalMoment.js`;
`GameDetail.js`, `PublicGame.js`; Game Puck (`GamePuckCard.js`, `GamePuckReveal.js`,
`SeasonGamePucks.js`, `lib/gamePucks.js`); recaps (`RecapCard.js`,
`lib/recapCard.js`); galleries (`Gallery.js`, `lib/image.js`, `imageModeration.js`);
streams (`lib/streamUrl.js`, `livebarn.js`); lineups (`LineupCTA.js`,
`LineupModal.js`, `lib/lineups.js`); RSVP (`RsvpBlock.js`, `lib/rsvp.js`); offline
(`lib/offlineCache.js`, `syncQueue.js`, `OfflineBanner.js`, `useWakeLock.js`).

**Scope:**
- **Scorekeeper flow** (the <5s goal): count taps in `ScorerView.js`, size targets,
  ensure mis-tap recovery/undo, keep the screen awake (`useWakeLock`), work offline
  and sync (`syncQueue`) — a rink Wi-Fi dead zone must not lose a goal.
- **Live viewing** (broadcast feel per S08) → **one-tap to stream.**
- **After the buzzer:** recap + Game Puck reveal + shareable stat cards + gallery, as
  a satisfying close to the ritual.
- **Realtime everywhere** (no polling); holds under many concurrent live games.

**Deliverable:** `audits/C06_game_day.md` — the full arc mapped with tap counts,
offline behavior, and Realtime/scale check + PRs for the scorekeeper and stream-jump
wins. **Guardrail:** offline-first on the scorer; no minor PII in public galleries.
