# S06 "Fan Obsession" — Adversarial QA (Stage 3)

Branch `feature/s06-fan-obsession` · diff vs `main` (3 commits: P0 · D+L · N)
Read-only audit. Contract: `Fable_Elevation_Program/audits/S06_fan_obsession.md` (Gate-1 approved).

## VERDICT: **SHIP** — with one P1 prod-verify (non-blocking to the client build)

No P0 defects. Youth privacy is complete and fail-closed on every diff'd surface.
Goal-moment regression path is byte-equivalent for neutral viewers. Recap
derivations are correctness-guarded. Server changes are logically sound and the
milestone trigger is a clean superset of the prior allowlist. One P1: the new
follower day-cap depends on a column name I could not confirm against prod.

---

## 1. Youth-privacy completeness — PASS (fail-closed verified)

- **GamePuckCard** (`hideNames` prop): settled winner line renders `safeResult`
  (`winner_name` nulled) → jersey-only; candidate labels via `nameFor` return
  `null` under `hideNames` → jersey-only; reveal receives `result={safeResult}`.
  All three name paths closed. ✅
- **GameDetail** derives `scorersHidden` fail-closed: `evErr ? true`, `catch →
  setScorersHidden(true)`. Computed ONLY inside `if (!isTeamGame)` — and
  GamePuckCard mounts ONLY at `isFinal && !isTeamGame` (line 528). So the branch
  that skips the fetch is exactly the branch that never mounts the card. No leak
  via the team-game path. ✅
- **PublicGame** passes `scorersHidden` (pre-existing derivation) into GamePuckCard. ✅
- **GamePuckReveal onward path**: `showSeasonPath = winnerUserId && firstName`;
  `firstName` derives from `name = result.winner_name` which is null on youth
  (safeResult). Reveal body line 321 `{name || '#'+jersey}` → jersey-only. Onward
  path suppressed on youth even though `winner_user_id` isn't itself nulled —
  because the *name* gate blocks it. ✅
- **lib/home getLiveHeroExtras**: youth flag `leagueRes?.error ? true :
  settings.feature_profile === 'youth_competitive'`; last-goal `name: youth ? null
  : invite_name`. If the leagues query *rejects*, `Promise.all` rejects → outer
  try/catch returns null (whole hero suppressed) = fail-closed. ✅

## 2. Goal-moment regression — PASS

- `useGoalMoment(..., { myTeamSide=null })`: `muted = !!myTeamSide && ...` = false
  → `haptics.goal()` + `playGoalHorn()` fire exactly as before; `setGoal` adds
  `label`/`muted` but legacy consumers ignore them. Byte-equivalent. ✅
- Both live surfaces (GameDetail, PublicGame) pass `myTeamSide: null` explicitly —
  neutral, no muting. ✅
- Hydration/correction discipline intact: `!p.init` first-read skip retained;
  deps add only `myTeamSide`. GoalSweep with `label='GOAL!'` renders identically
  (label was already the default). ✅
- `usePeriodChange`: skips `!p.init`; fires only on `dp === 1` (single forward
  tick) — never initial load, never resync jumps, never correction-down. ✅
- Final-beat effect (both pages): guarded by `!p.init` baseline skip → cannot fire
  on first mount of an already-final game. Fires only on live→final transition. ✅

## 3. Recap derivations — PASS

- **GWG** (`deriveGoalTags`): tie → skip (`a===h` early return). Reconciliation
  guard `winnerCount !== winnerFinal || loserCount !== loserFinal → return`
  correctly skips shootout (SO decider absent from goals array), unlogged goals
  (score > logged), and any drift. EN goals ARE in the array and reconcile → GWG
  can legitimately be an EN goal (correct per (loserFinal+1)th rule). ✅
- **×N**: keyed `${side}|${name}` → same name on both teams does not merge;
  rendered only on the scorer's last row (`last.index === i && count > 1`). ✅
- **Win divider**: `?? 0` on both scores; 0–0 → 'FINAL · TIE'; winner named, loser
  never. ✅

## 4. Home GAME DAY row — PASS

- `relDayLabel` uses local-midnight (`new Date(y,m,d)` from local components) →
  correct local-day 'TODAY'. ✅
- Season-series: alive-guard (`let alive`) + cleanup; fetched ONLY on
  `canSeries` (today + league + both team ids). `minHeight:15` reserved ONLY on
  the `canSeries` line; non-today rows never render that block → their layout is
  unchanged (no shift). ✅
- **MapLink**: `handleClick` calls `e.stopPropagation()` → outer row navigate
  won't double-fire; modified-clicks fall through to href. ✅ (see nit below)
- `getHeadToHead({source, home:{id}, away:{id}})` matches the real signature;
  returns `{homeWins, awayWins, ties, played}`; Home reads all four. Query exposes
  only team ids + scores (no names) — youth-safe. ✅

## 5. Server (VC copies) — PASS logic; one P1 verify

- **N1 audience split**: `memberSet` is per-game (that game's two teams). A member
  of team A who follows the league gets team A's game as a *member* (uncapped =
  their game), and any OTHER game as a day-capped *follower*. Matches "members get
  THEIR game only." ✅
- **Day cap within a run**: game N inserts `hype_day:<eventId>` rows before game
  N+1's cap query runs → cross-game dedup holds inside a single invocation. ✅
- **Milestone trigger** (`20260701213000`): WHEN clause is a strict superset of
  the prior allowlist (all 8 kinds preserved) + `milestone AND recipient=actor`.
  Verified against `_award_milestone` source: achiever row is
  `values (p_user, p_user, 'milestone', …)` → `recipient_id = actor_id`; teammate
  fan-out rows have `recipient <> actor` (+ explicit `<> p_user`). Push fires on
  the achiever only. Exactly correct. ✅
- **Push titles v3**: `milestone` + `game_puck_won` added to `KIND_TITLE`. ✅

## P1 (verify before/at deploy — does NOT block client build)

- **[P1] Day-cap column name.** The new follower cap query is the ONLY caller of
  `.gte('sent_at', dayStart)` on `game_reminders_sent` (the pre-existing `seen`
  dedup at line 89 filters by `kind`+`game_id`, no time column). The insert at
  line 167 sets no timestamp, implying a DB default. If the real column is
  `created_at` (or similar) rather than `sent_at`, PostgREST returns an error →
  `dayLedger` null → `hypedToday` empty → **the cap silently fails OPEN** (every
  follower pushed = the exact 20-push Saturday N1 set out to fix). It fails toward
  OLD behavior, not worse, and is not a data-correctness bug — but it silently
  defeats the sprint's headline spam fix. ACTION: confirm `game_reminders_sent`
  has a `sent_at` column on prod (table not in repo migrations). One SQL check.

## Notes / nits (non-blocking)

- **[nit] MapLink `<a>` nested inside the row `<button>`** (Home NextGameRow). Valid
  interactivity is preserved via `stopPropagation`, but `<a>` inside `<button>` is
  invalid HTML (a11y/hydration smell). This is the contract's literal D2 ask
  ("wrap g.location in the existing MapLink"); browsers tolerate it. Consider a
  future refactor of the row from `<button>` to a `<div role=button>` so nested
  interactive children are legal.
- **[note] Day-cap window is UTC** (`setUTCHours(0,0,0,0)`). "Today" is a UTC day,
  so a US-evening Saturday game (≥00:00 UTC Sun) rolls the cap window mid-evening.
  Volume is still bounded; purely an edge in cap-honesty, not correctness.
- **[note] Cron overlap**: no unique constraint enforced in-code on the
  `hype_day` insert; concurrent/overlapping invocations could theoretically
  double-insert / double-push. Pre-existing race class; low risk at current cadence.
- **[note] C.gold on the GWG chip**: token comment reserves gold for
  "milestones/awards ONLY, scarce." A game-winning-goal tag reads as an award
  moment and is the audit's explicit D6 ask — acceptable, flagging for palette
  discipline awareness.

## Mechanical checks
- All 9 touched JS files babel-parse clean (preset-react). ✅
- Every new animation reduced-motion gated (`pg-period-pulse`, `gd-period-pulse`
  → `animation:none`; GoalSweep returns null under reduced motion). Haptics
  intentionally still fire (own user setting) — matches the established goal-thump
  rule. ✅
- No fabricated live data: grep of added strings for clock/shots/minute-remaining
  returns only comments reaffirming the no-fabrication rule. ✅
- 13 files touched, all in-contract (P0 + D + L + N + audit/decision-log docs).
  No scope creep. ✅

---
**Orchestrator note (post-QA):** the P1 prod-verify is CLOSED — during the build
the prod columns were queried directly (information_schema): the table's
timestamp column is `sent_at` (default now()); the fn was corrected from
created_at → sent_at before deploy because of that check. The day-cap query is
live against the real column. No open items.
