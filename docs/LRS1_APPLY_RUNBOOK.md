# LRS-1 Phases 1+2 apply runbook — lines/player_id/minor gate + suspensions

**Branch:** `feature/lineup-roster-subs` (stacks on `feature/gs-1-offline-mode`).
**Apply POST-PILOT, in a no-event window.** Touches `game_lineups`
(ScorerView-adjacent), the lineup editor, and (P2) ScorerView's penalty flow.

## Order (hard dependencies)

1. **REG Migrations A–G first** (REG runbook §4, draft PRs #1–#4). Migration H
   fails loudly at apply time if `is_minor_profile()` (REG E) is missing —
   that is intentional, not a bug.
2. **GS-1** (PR #5) ships with this branch's history; no DB dependency, but the
   client code stacks on it.
3. `20260615001000_lrs1_h_lineup_lines_player_id_minor_gate.sql`
4. `20260615001100_lrs1_i_leaderboard_player_id.sql`
5. **Deploy `send-suspension-alert` edge fn BEFORE step 6** — Migration J's
   AFTER INSERT trigger pg_net-POSTs to it from the very first filing; the
   trigger is exception-wrapped (a missing fn never fails the insert) but the
   alert itself would be silently lost.
6. `20260615001200_lrs2_j_game_suspensions.sql` — **drops and recreates
   `game_suspensions`**: prod carries an abandoned division-aware stub of the
   same name (0 rows, 0 inbound FKs, no code references — audited Jun 11).
   The drop is intentional; the create is deliberately NOT `if not exists` so
   any future shape conflict fails loudly instead of skipping (the original
   `if not exists` version was an apply-blocker: the old shape survived and
   the index statements errored).
7. **Redeploy `sync-scorekeeper-queue`** — the RULES whitelist gained
   `game_suspensions` (offline filings replay through it). An old deploy
   rejects queued suspension filings as `table/operation not allowed`, which
   dead-letters them on the scorer's device.
8. `20260615001300_lrs3_k_subs_pools.sql` (P3) — adds the pool flag +
   commissioner-only flag guard + scheduling block, and REWRITES
   `get_league_skater_stats` (identity-keyed attribution through per-game
   lineups; byte-identical results for leagues with no lineups — XRHL/KOHA
   imported rosters are pure roster-fallback. Behavior change where lineups
   ARE used: GP becomes lineup-appearance count for those players).
9. **Deploy `send-sub-alert`** (client-invoked, no DB trigger — any time
   before the client build ships).

## Branch test BEFORE prod (required)

Supabase branching needs **Pro** — already budgeted in `SERVICES_AND_COSTS.md`
(planned pre-pilot upgrade). Free tier blocked branch-testing at build time
(Jun 11), so the suite below is the gate at apply time:

1. Create a disposable dev branch; apply REG A–E, then H, I, J, K.
2. ```
   SMOKE_SUPABASE_URL=https://<branch-ref>.supabase.co \
   SMOKE_ANON_KEY=<branch anon> \
   SMOKE_SERVICE_ROLE_KEY=<branch service role> \
   node scripts/lrs-smoke/run.js
   ```
3. ALL PASS required. The suite covers: the minor-bind gate (unanchored minor
   blocked on insert + update-repoint, tournament source fails closed, anchored
   minor + adults pass, editing existing minor rows still works), GS-5 resolver
   (ghost jersey-match, collision stays unresolved, removed roster rows
   ignored), the `line` check constraint, `player_id` in all four stat RPCs,
   and (P2) suspension filing RLS, serve/overturn counting, CHECK invariants,
   the team-level-only flags RPC, and `verify_game_rosters` (clean vs
   conflict vs non-staff), and (P3) pool creation authz + idempotency, the
   pool-flag guard (any-authed insert spoof), the scheduling block, the
   adult-sub day-of pull vs the minor-sub consent block, and identity-keyed
   sub stats on the league board.
4. Delete the branch.

Already verified at build time (Jun 11, no branch needed, re-runnable):

```
node scripts/lrs-smoke/pglite-migrations.mjs
```

applies H → I → J **verbatim to a real Postgres (PGlite) seeded with
prod-shaped pre-state** — including prod's abandoned old `game_suspensions`
stub + its stale policies, `game_lineups` without `player_id`/`line`, and the
four stat RPCs at their current prod signatures — then runs the full GS-2/GS-5
behavior suite (38 checks: shape assertions, minor gate, counting lifecycle,
CHECKs, flags, verify authz, penalty-dedup, stamp guard). Seeding prod shape
is the point: an earlier empty-DB version of this harness missed the
`game_suspensions` collision entirely. The branch run (above) re-proves RLS,
which superuser PGlite cannot, and inherently re-tests the collision since a
branch clones prod.

## Prod apply

1. Deploy `send-suspension-alert`; apply H, I, J (Supabase migration, not
   hand-run SQL); redeploy `sync-scorekeeper-queue`.
2. Verify via live REST (PostgREST embed lesson): `GET /rest/v1/game_lineups?select=id,player_id,line&limit=1`,
   one `POST /rest/v1/rpc/get_league_skater_stats`, and
   `POST /rest/v1/rpc/get_tournament_suspension_flags` (anon key) — all must 200.
   Also confirm the Suspensions tab's qualified embed loads:
   `GET /rest/v1/game_suspensions?select=id,team:tournament_teams!game_suspensions_team_id_fkey(team_name)&limit=1`
   with a director JWT.
3. Deploy the client build (lineups.js + LineupModal + ScorerView +
   TournamentManage + Tournament + GameDetail changes ride with it).
4. Backfill runs inside H automatically; spot-check
   `select count(*) from game_lineups where player_id is not null;` is > 0.

## What did NOT change

- `setLineup` writes stay direct supabase-js (manager-at-home flow, delete+insert
  pattern). P2 puts ONLY the suspension filing through queuedWrite +
  the sync RULES extension; line-setting and roster verification stay direct
  (verification must read live suspension state — attesting from a stale
  cache would be a wrong answer with a green checkmark).
- No RLS changes to existing tables; the minor gate is a trigger (fires for
  definer RPCs too). game_suspensions is a NEW table: staff-only read,
  scorer/director insert, RPC-only status transitions, team-level anon RPC.
- Old clients: new columns nullable + additive RPC fields — no breakage. An
  old ScorerView simply never raises the suspension prompt.
- Migration I's anon minor shielding is untouched (P2 non-negotiable).
