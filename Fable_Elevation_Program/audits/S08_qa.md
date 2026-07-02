# S08 — Adversarial QA (ESPN / Live Game broadcast delta)

**Branch:** `feature/s08-live-game` (1 commit `104ee6cb`) vs `main`
**Scope reviewed:** `src/components/LiveLowerThird.js` (new), `src/pages/GameDetail.js`, `src/pages/PublicGame.js`
**Date:** 2026-07-02

## VERDICT: SHIP

Presentation-only contract met. Zero data/scoring/realtime logic touched, no
polling, reduced-motion gated, no fabricated data, S06 hooks + youth gates
intact. All three files babel-parse clean. No P0/P1. Minor notes only.

---

## 1. Guardrail sweep — PASS
- **Realtime/subscription/load blocks byte-identical.** Diff of added lines
  touching `channel|subscribe|removeChannel|.on(|useGoalMoment|usePeriodChange|
  areScorersHidden|is_youth` returns **nothing** except the two countdown
  `setInterval(...,60000)` (client clock, not a data poll). Removed lines are
  purely the old inline LIVE pill + inline slab markup being re-expressed — no
  subscription or fetch removed.
- **Nothing new is WRITTEN anywhere.** No inserts/updates/RPCs added. All new
  reads are one lazy `getHeadToHead` SELECT (bounded `.limit(50)`).
- **`youtube_url` on the rink embed does NOT widen a youth surface.** The league
  select adds `youtube_url` to the `rinks(...)` embed only. Rink stream URL is
  event infrastructure (a venue/league broadcast link), carries no PII, and is
  not minor-scoped. Youth gate (`areScorersHidden` / `is_youth`, fail-closed)
  is unchanged and still runs before render.
- **S06 markers intact.** `useGoalMoment`, `usePeriodChange`, `GoalSweep`,
  `finalBeat`, period-pulse, `scorersHidden` all present and unmodified;
  `periodLabel` still consumed by the GameDetail goal/penalty timeline
  (703/727/766) — not dead.

## 2. Countdown correctness — PASS
- **Interval cleanup:** `useEffect` returns `() => clearInterval(t)`; only armed
  when `active` true. Verified.
- **null/invalid `start_time`:** `!startTime` short-circuits → returns null
  before any `Date` parse. Garbage string → `getTime()` = NaN → `NaN > 0` false
  → null → static SCHEDULED/UPCOMING pill. Robust.
- **scheduled→live mid-view:** hook is called unconditionally above early
  returns (no conditional-hook violation). When realtime flips `status` to
  `live`, `active` goes false → cleanup fires `clearInterval`, hook stays
  mounted. Clean, no unmount-during-render.
- **Timezone:** display-only client-local math on `Date(startTime) - Date.now()`
  (both epoch ms). No UTC string slicing / no manual offset — no parse bug.
- **Past-due scheduled:** `ms > 0` guard → null → falls back to the static pill,
  exactly as the contract specifies.
- NOTE (accepted): the 60s `setNow` re-renders the whole page component, but
  only while a game is *scheduled + future* (interval never arms for live/final).
  Cadence is 60s and does no I/O — negligible.

## 3. Season series (getHeadToHead) — PASS (the load-bearing verification)
The engineer's tournament claim **holds**. Verified against the helper's actual
query (`src/lib/gameday.js:100`):
- Helper: `table = source==='league' ? 'league_games' : 'games'`; filters
  `home_team_id`/`away_team_id` with an `.or(and(...))` on the passed ids,
  `status='final'`, `.limit(50)`.
- GameDetail tournament branch loads from `games` with
  `home_team:tournament_teams!home_team_id` — so `game.home_team_id` **is a
  `tournament_teams` id**, and the helper queries `games.home_team_id` (the same
  FK column → same table). Column-correct; NOT `played=0`, NOT wrong data.
- Natural event-scoping: `tournament_teams` ids are per-tournament-unique, so two
  team ids only co-occur in one tournament's finals → the cross-table `games`
  scan is implicitly single-tournament. Matches the helper's documented intent.
- League branch: `home_team_id` = `league_teams` id, helper hits `league_games`.
  Correct.
- **Perspective correct:** helper returns `homeWins` keyed to `h` (= passed
  `home_team_id`); page renders `Season series {homeWins}–{awayWins}` and derives
  `homeTeam` from the same `home_team_id`. Home listed first, consistent.
- **Height reserved only in flight:** `showSeriesLine = canSeries && (seriesLoading
  || seriesLabel)`; renders `minHeight:15` line during fetch, collapses entirely
  when `played===0`. No layout shift, no empty box left behind. Alive-guarded
  (`alive` flag), catch → null. Correct.

## 4. LiveLowerThird parity — PASS
- **PublicGame parity is byte-exact.** Extracted component reuses the identical
  wrapper (`margin:'-22px -18px 18px'`, `padding:'7px 8px 7px 18px'`,
  `background:C.navy`, `borderLeft:4px solid C.red`), same 17px Barlow-Condensed
  700 italic uppercase text, same 10px ring dot. PublicGame card padding is
  `22px 18px` → the -22/-18 negative margins exactly cancel it → flush bleed,
  unchanged from the old inline block. No regression.
- **Clock suffix never fabricated.** `label` is built with `${clock ? ` · ${clock}` :
  ''}` (PublicGame) / `${liveClock ? ...}` (GameDetail); `liveClock =
  game.clock_display || null`. Shows only when a real clock value exists.
- **Reduced-motion no-op present.** Keyframes injected once (`rinkd-llt-anim`)
  with `@media (prefers-reduced-motion: reduce){.llt-live-ring{animation:none}}`.
- **Old `pgLiveRing`/`pg-live-ring` NOT dead code.** Still used by the
  watching-count dot inside PublicGame's `accent` slot (line 376). The new
  component injects its own independent `lltLiveRing` keyframes. Two ring
  keyframe blocks now coexist — both live, both reduced-motion-gated. Acceptable
  (minor duplication, not a defect).
- NOTE (cosmetic, accepted): GameDetail score box padding is `24px 16px 0` while
  the slab bleeds `-18px` horizontally → the slab's L/R edges sit ~2px outside
  the 16px padding box. Clipped cleanly by the box's `overflow:hidden`; no
  escape/overflow. Visual is flush-to-edge as intended.

## 5. Stream button — PASS
- **Precedence identical to PublicGame:** both call `resolveStreamUrl(game)` →
  game `youtube_url` first, `rink.youtube_url` fallback (`streamUrl.js:39`).
- **team_games skipped:** GameDetail button IIFE returns null when `isTeamGame`;
  team_games select carries no `youtube_url`/rink embed anyway.
- **Security attrs match:** `target="_blank" rel="noopener noreferrer"` — same as
  PublicGame.
- Platform-color map + `streamButtonLabel` fallback (`'Watch live'`) match.
- LiveBarn block below is untouched (still gated behind placeholder venue ids).

## 6. Parse + diff discipline — PASS
- Exactly 3 source files changed (+ 2 docs). babel-parse: all 3 OK.
- 72px + tabular-nums: GameDetail scores now `fontSize:72` + `tabular-nums`;
  `shadows.live` applied only when `isLive`; PublicGame TeamSide 72px span gains
  `fontVariantNumeric:'tabular-nums'`. Confirmed.
- Build claim sane (no new imports beyond existing libs: `shadows`, `streamUrl`,
  `LiveLowerThird`, `getHeadToHead` — all verified to exist and export the used
  symbols).

---

### Fix list
None required. Two accepted cosmetic notes (duplicate ring keyframes; 2px slab
clip on GameDetail) — optional cleanup, not blockers.
