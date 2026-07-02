# S05 "Association Experience" — Adversarial QA (Stage 3)

**Date:** 2026-07-01 · **Branch:** `feature/s05-association` (5 commits vs main) · **Auditor:** independent QA agent (did not write this code)

## VERDICT: FIX-FIRST

One P0 (Bundle B's headline safety fix doesn't actually work server-side) and two P1s. Everything else in the contract verified clean. All 9 touched files parse; diff discipline is clean.

---

## P0 — `deleteGoalieChange` never actually deletes (both online and offline paths)

`src/pages/ScorerView.js` `deleteGoalieChange` is a byte-faithful mirror of `deletePenalty` on the client — but the server contract behind it is missing on both paths:

1. **Online path (RLS):** `game_goalie_changes` has **no DELETE policy** — verified live on prod `pg_policies`: only `goalie_changes_scorer_insert` (INSERT) and `goalie_changes_public_read` (SELECT). Compare `game_penalties`, which has `penalties_scorer_delete`. Under PostgREST, a DELETE with no policy **deletes 0 rows and returns no error** → `queuedWrite` reports success → the UI removes the row → the row silently comes back on reload/realtime. Scorer believes it's deleted; the DB disagrees.
2. **Offline/queued path (edge fn):** `supabase/functions/sync-scorekeeper-queue/index.ts` allowlist has `game_goalie_changes: { ops: ["insert"] }` (line ~66-67). A queued delete is rejected `"table/operation not allowed"` → dead-letter. Retry re-rejects forever. (The order guard means this path triggers whenever ANY write for the game is queued, not only when fully offline.)

**Impact:** silent wrong data in live scoring — undeletable goalie changes corrupt GOALIE-1 in-net attribution (goals charged to the wrong goalie). This is exactly the correctness-over-convenience class Pete rejects, in the most correctness-critical surface in the app.

**Fix (3 pieces, all required):**
- Migration: `CREATE POLICY goalie_changes_scorer_delete ON game_goalie_changes FOR DELETE ...` mirroring `penalties_scorer_delete`'s USING clause.
- Edge fn: `game_goalie_changes.ops → ["insert", "delete"]`; redeploy `sync-scorekeeper-queue`.
- No client change needed — the client code is correct once the server contract exists.

---

## P1-1 — Playoff generate double-tap window survives the new guard (LeagueManage.js `handleGenerate`, ~line 1252)

The `byRound[targetLabel]` guard is correct in construction (byRound keys come from `g.round`; `bulkInsertLeagueGames` preserves `round: label` verbatim; all labels lowercase `quarterfinal/semifinal/final/bronze` — no case mismatch). But:

```js
setBusy(false);                      // ← busy released here
if (insertErr) { ...; return; }
await onPublished?.();               // ← games reload happens AFTER
```

Between insert success and `load()` completing, `busy` is false and `byRound`/`hasRound1` are stale → a fast second tap re-inserts the round. This is the exact hazard the guard exists for, narrowed to the reload window instead of closed.

**Fix:** hold `busy` through the reload — `setBusy(true); ...insert...; if (err) { setBusy(false); return; } await onPublished?.(); setBusy(false);`
**Also:** round-1 calls `handleGenerate(round1Preview.rows)` with **no targetLabel** — it relies solely on the stale `hasRound1`. Pass `round1Preview.label` for the same guard.

## P1-2 — `promoteToTeam` is not idempotent across reloads (TournamentManage.js, ~line 1428)

"Add as team" never writes the created team's id back to `tournament_registrations.tournament_team_id`. The disable state is `promotedIds[r.id] || r.tournament_team_id`; `promotedIds` is session state and `tournament_team_id` is only set by the webhook/`approveTournamentRegistration` paths. So: promote → reload (or tab switch remounts the tab) → button re-enables → click → **silent duplicate `tournament_teams` row**. The code comment acknowledges the gap; the fix is one call.

**Fix:** after `createTeam` succeeds, `update tournament_registrations set tournament_team_id = team.id where id = reg.id` (director UPDATE RLS already exists — `updateTournamentRegistrationStatus` uses it). This makes the guard durable and matches the approve path's linkage.

---

## P2 / notes (no gate)

- **ScheduleBuilderModal:** `handleGenerate` (re-generate proposal) doesn't reset `confirmExisting` — a carried-over confirm applies to the NEW proposal. Not a bypass (the amber banner + "Publish anyway" label still render), but reset it on regenerate for cleanliness. Publish-error also leaves `confirmExisting=true` (acceptable — already confirmed). Modal unmounts on close (`{showScheduleBuilder && ...}`) so the confirm fully resets on reopen. ✅
- **`existingGamesCount`** = `scopedGamesList.length` — correctly division-scoped, matches the insert's `divisionId` scope. It includes playoff games (slightly over-warns; conservative, fine).
- **Tournament approve-all progress counter:** `Approving ${done + 1}/${total}` — `done` only increments on success, so the counter stalls on failures. Cosmetic.
- **Contract discrepancy:** the contract sanctions "two removed eslint-disable comments" — the diff contains **zero** eslint changes. Nothing wrong in code; contract text is stale.
- **sessionStorage draft:** stores team name + contact name + email only (mild PII; per-tab sessionStorage, cleared on `?success=1` and free-path completion). Acceptable — noted per contract. Draft persists if checkout-create throws (harmless — user is still on the form).
- **`approvingAll` label reuse:** fine; failures re-surface as still-pending rows after `loadRegs()`, plus a flash listing team names. League side identical and `approveRegistration`/`approveTournamentRegistration` **throw** on error, so the try/catch failure counting is real (not a swallowed `{error}`). Both are idempotent via `league_team_id`/`tournament_team_id` guards → re-run safe. ✅

## Verified clean (per contract, priority order)

1. **A1:** two-tap confirm resets on close/reopen (unmount); Cancel-during-confirm de-escalates instead of closing; count division-scoped. ✅
2. **A2:** `byRound` built from the same `scopedGamesList` the insert targets; labels consistent lowercase end-to-end; bronze+final insert is a single statement (no partial-round hole). ✅ (modulo P1-1 race)
3. **A3:** `phase !== 'playoffs'` counts NULL-phase rows as regular season (correct — NULL !== 'playoffs' is true); no 'canceled' status exists (edge fn ALLOWED_STATUS = scheduled/live/final). Non-blocking as specced. ✅
4. **LeagueCreate bonus:** wizard trims + dedupes division names (`addDivision`); removing a division resets affected teams to `''`; `divisionIdByName[''] → undefined → || null` — safe. `leagues` delete **cascades `league_divisions`** (verified `confdeltype='c'` on prod), and `league_teams.division_id → league_divisions` is also CASCADE — cleanup path fully cascades. Insert order (divisions before teams) correct. ✅
5. **ScorerView B:** client `deleteGoalieChange` matches `deletePenalty` exactly (isLocked guard, errorMsg, optimistic filter, identical `queuedWrite` shape) — server gap is the P0. `emphasizeSave`/`footerHint` passed ONLY to the goal modal (penalty line 1885 / goalie line 1937 unchanged); no auto-save. Shots − button: style-only change, handler untouched. 85vh sheet + pinned footer: body scrolls, Save reachable at 568px. Jersey `flexShrink: 0`, name ellipsis. **Zero changes to saveGoal/dedup/realtime/finalize in the diff.** ✅
6. **Scorers section:** `src/lib/leagueScorers.js` pre-exists on main (privacy-rerouted); statuses added/already/invited/needs_email/error all handled; `runUndoable` optimistic remove mirrors managers. ✅
7. **Register pages:** `isSuccess`/`isCanceled` off URL params; draft saved pre-redirect, rehydrated on `?canceled=1`, cleared on `?success=1` and free-path; EMAIL_RE allows `+tags`/subdomains, rejects only obviously-broken input. ✅
8. **Diff discipline:** only the 8 contract src files + `Fable_Elevation_Program/audits/S05_association.md` + decision log. No token/C01 regressions (no `const C` redeclares; LOCAL palette is component-local as before). ✅
9. **Parse:** all 9 files (8 touched + leagueScorers) parse clean via @babel/parser. ✅

## Gate condition

Ship after: (1) goalie-change DELETE policy migration + edge fn allowlist + redeploy, (2) busy-through-reload + round-1 label in `handleGenerate`, (3) `tournament_team_id` write-back in `promoteToTeam`.
