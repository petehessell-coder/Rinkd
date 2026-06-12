# LRS-1 Phase 1 apply runbook — lines + player_id + minor gate

**Branch:** `feature/lineup-roster-subs` (stacks on `feature/gs-1-offline-mode`).
**Apply POST-PILOT, in a no-event window.** Touches `game_lineups` (ScorerView-adjacent) and the lineup editor.

## Order (hard dependencies)

1. **REG Migrations A–G first** (REG runbook §4, draft PRs #1–#4). Migration H
   fails loudly at apply time if `is_minor_profile()` (REG E) is missing —
   that is intentional, not a bug.
2. **GS-1** (PR #5) ships with this branch's history; no DB dependency, but the
   client code stacks on it.
3. `20260615001000_lrs1_h_lineup_lines_player_id_minor_gate.sql`
4. `20260615001100_lrs1_i_leaderboard_player_id.sql`

## Branch test BEFORE prod (required)

Supabase branching needs **Pro** — already budgeted in `SERVICES_AND_COSTS.md`
(planned pre-pilot upgrade). Free tier blocked branch-testing at build time
(Jun 11), so the suite below is the gate at apply time:

1. Create a disposable dev branch; apply REG A–E, then H, then I.
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
   ignored), the `line` check constraint, and `player_id` in all four stat RPCs.
4. Delete the branch.

## Prod apply

1. Apply H then I (Supabase migration, not hand-run SQL).
2. Verify via live REST (PostgREST embed lesson): `GET /rest/v1/game_lineups?select=id,player_id,line&limit=1`
   and one `POST /rest/v1/rpc/get_league_skater_stats` — both must 200.
3. Deploy the client build (lineups.js + LineupModal changes ride with it).
4. Backfill runs inside H automatically; spot-check
   `select count(*) from game_lineups where player_id is not null;` is > 0.

## What did NOT change

- `setLineup` writes stay direct supabase-js (manager-at-home flow, delete+insert
  pattern). queuedWrite adoption lands with the ScorerView-side writes
  (P2 suspensions, P3 day-of subs) + a `sync-scorekeeper-queue` RULES extension.
- No RLS policy changes; the gate is a trigger (fires for definer RPCs too).
- Old clients: both new columns nullable + additive RPC field — no breakage.
