# GameSheet data source (how `sync-gamesheet` reads scores)

_Last verified: 2026-06-16 against season `15073` (Cleveland BLPA Bash)._

## TL;DR

GameSheet retired their public JSON API. `gamesheetstats.com` is now **Next.js
(App Router) + Firebase/Firestore** (project `gamesheet-production`). A season's
games live in the Firestore subcollection **`seasons/{seasonId}/games`** and
**reads are public — no auth required.** The poller reads them straight off the
Firestore REST API and adapts each doc into the legacy scored-game shape it
already consumed. All of this lives in `gamesheet-source.ts`.

## What broke

The old route returns 404:

```
GET https://gamesheetstats.com/api/useScoredGames/getSeasonScores/{seasonId}  →  404
```

The server-rendered season HTML (`/seasons/{id}/games`) contains the game **table
structure** (teams, matchup, game #, type, date) but every score shows `0-0 LIVE`
— the real scores hydrate client-side from Firestore. So **SSR scraping does not
yield scores.** The data must come from Firestore.

## The working request

```
POST https://firestore.googleapis.com/v1/projects/gamesheet-production/databases/(default)/documents/seasons/{seasonId}:runQuery?key={WEB_API_KEY}
Content-Type: application/json

{ "structuredQuery": { "from": [ { "collectionId": "games" } ] } }
```

- `WEB_API_KEY = AIzaSyCk5pKBFxvCMuwPchzXgvvz4XmmscJTvs8` — the Firebase **web**
  API key. **Non-secret:** it's embedded in their public JS bundle
  (`initializeApp({apiKey:"AIza…", projectId:"gamesheet-production", …})`) and only
  scopes the request to the project. Access is governed by Firestore security
  rules, which currently **allow unauthenticated reads** of `games`.
- No `Authorization` header needed. (Anonymous Identity-Toolkit sign-in
  — `accounts:signUp?key=…` → `idToken` → `Authorization: Bearer` — works if they
  ever tighten rules, but is not required today.)
- Response is a streamed JSON array; each element is `{ document: {...} }` plus one
  trailing `{ readTime }` frame (skipped). No pagination needed for season sizes
  we've seen; a `games` collection query without `limit` returns all docs.

### What did NOT work (for the record)
- Top-level `games` collection filtered by `seasonId`/`season` → readable but the
  field doesn't exist there (returns 0). Season games are **only** in the
  `seasons/{id}/games` subcollection.
- `:listCollectionIds` → 403 (rules don't grant collection enumeration).
- Subcollections `divisions`/`teams`/`standings`/`players`/`goalies` under a
  season → readable but **empty**; everything we need is derivable from the game
  docs (see field map).

## Firestore game doc → contract field map

Each `seasons/{id}/games/{gameId}` doc (decode the Firestore typed values first):

| Contract field (`game.…`)         | Firestore path                                  |
|-----------------------------------|-------------------------------------------------|
| `gameId`                          | `data.game.id` (fallback: doc id)               |
| `type`                            | `data.game.type` (`tournament`/`regular_season`)|
| `number`                          | `data.game.number`                              |
| `date`                            | `data.game.scheduledStartTime` ?? `startTime`   |
| `finalScore.homeGoals`            | `computed.scoreboard.total.home`                |
| `finalScore.visitorGoals`         | `computed.scoreboard.total.visitor`             |
| `homeTeam.name`                   | `data.home.details.title`                       |
| `homeTeam.division`               | `data.home.division.title`                      |
| `homeTeam.recap[].events[].playerName` | `data.home.lineup.players[]` where `stats.g > 0` (one event per goal) |
| `visitorTeam.*`                   | `data.visitor.*` (same as home)                 |

Season id is also confirmable via `data.organizations[]` (entry with `type:"season"`).

## "Is this game final?" — the one judgment call

GameSheet status values seen: a played game is `"unofficial"` (scoresheet
submitted) and gets a non-null `data.game.endTime` when the scorekeeper taps
**end game**. Some operators never do that, leaving a finished game stuck
`"in progress"` with a full scoreboard — and **GameSheet's own standings still
count it**.

So `isGameFinal()` treats a game as final when it **has a scoreboard** AND either:
1. `endTime` is set (cleanly ended), **or**
2. its scheduled window is **> 6h in the past** (the "forgot to end" fallback).

This (a) reproduces GameSheet's published standings exactly — season 15073:
**Venom 3-1, +16** across all 11 games, including the two stuck-`in progress`
ones — and (b) never finalizes a genuinely live game (whose window is current).
A live game's running score is therefore never written as FINAL. Tune
`FINAL_STALE_MS` if needed.

## Validation (2026-06-16)

`_validate.ts` (run with `node _validate.ts`) calls the real `fetchSeasonScores`:

- **15073** → 11 games, 11 final, 6 teams (Venom, Slot Machines, Hat Trick
  Swayzes, STT, Free Agents 2, Pucks No Pancakes); computed standings match
  `gamesheetstats.com/seasons/15073/standings` (Venom 3-1 +16). Scorer recaps
  populate from lineup goal stats. **PASS.**
- **8553** (2025 Greenville) → 2 final games, 4 teams (older season, fewer docs;
  no lineup scorer data). Works.
- **1543** (2022 Columbus) → 0 docs. **Old archived seasons are not present in the
  new Firestore backend.** Not a blocker — the poller targets current/live events.
