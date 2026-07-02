# S06 — Fan Obsession: The Six-Month Narrative + Ranked Moments

*July 1, 2026. Three parallel stage audits (before / during / after) narrated as a
hockey parent + a remote grandparent. Verdict up front: the emotional
infrastructure is largely BUILT (goal moment, reveal, share cards, recap plates,
haptics/sound) — the gap is that it isn't plugged into the surfaces a logged-in
parent actually lives on, and the data the moments need (H2H, today-ness,
GWG) is computed but never surfaced.*

## The narrative in one paragraph
Saturday 8am: my kid's 11am game is a gray calendar row — the rink isn't
tappable, RSVP is two screens away, and "TODAY" looks identical to "IN 9 DAYS."
During the game, the anonymous share link celebrates a goal harder than the app
I signed up for (GameDetail has NO goal moment), the app blasts the same horn
when the OTHER team scores, and a tie/lead-change/final pass unmarked. After:
the recap plate is genuinely broadcast-grade but stays emotionally neutral about
the WIN, my kid's game-winner is an undifferentiated box-score line, the recap
isn't shareable from where I see it, her first-career-goal milestone fires into
a void (no push), and the Game Puck reveal — the product's emotional peak —
dead-ends at "Done."

## ⚠️ P0 — youth-privacy leaks found in passing (ship regardless of sprint)
| # | Leak | Evidence |
|---|---|---|
| P1 | **Game Puck reveal + settled card show a minor's REAL NAME on-screen** — `get_game_puck_result` returns `winner_name` with no youth check; the share-card path suppresses it but the display path doesn't | GamePuckCard.js:246 → GamePuckReveal.js:312; settle migration RPC |
| P2 | **Home LiveHeroCard "LAST GOAL" prints the scorer's name with no youth gate** (public page shields it; this in-app tile doesn't) | lib/home.js:197 (getLiveHeroExtras) → Home.js:450 |

## Bundle D — game-day + post-game delight (cheap, high-impact)
| # | Moment | Change |
|---|---|---|
| D1 | **GAME DAY row** — the screenshot-test winner | Home.js NextGameRow: when rel==='TODAY', red/gold accent + "GAME DAY" + "Puck drops [time]" (today it's a muted gray chip identical to next week) |
| D2 | Directions in one tap | Home.js:715 — wrap `g.location` in the existing MapLink |
| D3 | Season-series line | getHeadToHead in lib/gameday.js is FULLY WRITTEN and rendered nowhere; "Season series 2–2" under the matchup (the hype push already promises H2H the app never shows) |
| D4 | RSVP warmth | RsvpBlock: haptics.success() on "I'm in" + "You + 12 in" copy |
| D5 | **Name the win** | RecapCard.js:135 — "FINAL SCORE" → "[TEAM] WIN" / "FINAL · TIE" (loss handling stays restrained — verified correct today) |
| D6 | Mark the goal that mattered | RecapCard goals: ⚡GWG tag on the winning goal + ×2/×3 on multi-goal games (pure derivation) |
| D7 | **Share the recap where it's seen** | RecapCard has NO share button — the #1 shareable artifact needs navigation to share. Compact ShareButton on the card. Biggest share-rate lift found |
| D8 | Reveal onward path | GamePuckReveal "Done" → "See [name]'s season →" (profile deep link; jersey-only label on youth) |

## Bundle L — live moments (the couch feels the game)
| # | Moment | Change |
|---|---|---|
| L1 | **GameDetail gets the shipped goal-moment stack** (~4 lines) — today the authenticated live page celebrates a goal LESS than the anon share link | useGoalMoment + GoalSweep + SoundToggle into GameDetail's score box |
| L2 | **Us-vs-them** + "TIED IT / LEAD CHANGE / GOAL!" | goalMoment.js takes a `mine` hint (opponent = no horn, soft haptic, dim sweep) + derived label on the flare |
| L3 | State line + final whistle | "TIED 2–2 / FINAL · [Team] wins" under the score (real data only) + one haptics.success() on live→final |
| L4 | Period-change pulse | 3rd period of a one-goal game earns a single heartbeat (haptic + 900ms border pulse) |

## Bundle N — notification honesty
| # | Change | Class |
|---|---|---|
| N1 | Hype-push audience: prefer rostered-team members over ALL event followers (today a league follower gets a push per game — a 20-push Saturday) + drop the "head-to-head" copy promise unless D3 ships | spam-prevention fix |
| N2 | Add `milestone` to the push allowlist — a kid's first career goal currently notifies nobody; scarce by construction, the push a parent thanks you for | 1-line + verify |
| N3 | `game_final` opt-in push kind ("🏁 Final: Sharks 4, Wolves 3") — the one push the couch is waiting for | DEFERRED — new kind + edge-fn work; propose as its own follow-up |

## Already great (leave alone — the audits were explicit)
The peel-the-tape reveal + confetti; useGoalMoment's change-only discipline;
the opt-in horn's gesture unlock; show-only-when-present holding firm (no
fabricated clocks/shots); loss handling (restrained, no shame); winner-only
Game Puck push; share-card composition (stands alone in a group chat);
NextGameRow's broadcast date block; HomeSkeleton.

## Guardrail notes for the build
Every motion reduced-motion gated; no fake urgency (all moments derive from
real data); youth events celebrate by jersey/team only; stress data applies
(14–0, 60-char names, no image).
