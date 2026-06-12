# GOALIE-1 apply runbook — goalie-in-net attribution (Migration M)

**Branch:** `feature/goalie-1` (stacks on `feature/lineup-roster-subs` → `feature/gs-1-offline-mode`).
**Apply POST-PILOT, in a no-event window**, after the full LRS apply
(`docs/LRS1_APPLY_RUNBOOK.md`). Touches the two LIVE goalie boards
(signature-frozen rewrite), `game_goals` (one additive column), ScorerView,
and the sync edge fn whitelist.

## What it is

The goalie-change capture already existed (`game_goalie_changes` + ScorerView's
goalie modal, offline-safe). Migration M derives **who was in net at each
moment** and attributes per-goalie GA / SA / W-L-T / SO, replacing the
n=1-roster-goalie fallback. This unblocks the goalie-sub stats deferred in the
LRS cluster: a pool goalie's split-game line attributes by identity across
whatever team they subbed for.

## Pinned conventions (full detail in the migration header)

- **Count-DOWN clock**: within a period, earlier = HIGHER `time_in_period`.
  All ordering goes through `game_clock_key()` (period asc, clock desc); a
  count-up override later changes exactly that one function.
- **Boundary**: a goal at the exact change instant charges the **outgoing**
  goalie; a change at period start hands the period's **shots** to the
  incoming goalie.
- **`game_goals.empty_net` is authoritative** (charges no one); the pulled-
  goalie NULL segment is the backstop.
- **Shots** are attributed at period granularity to the period-start goalie
  (`game_shots` is a per-period aggregate — documented limitation).
- **W/L/T** go to the goalie of record (in net for the deciding goal, else
  the finisher); **SO** only for a sole-goalie game with 0 GA by both the
  board's GA semantics and the official score; shared 0-GA = no SO.
- **Never mis-attribute**: unknown starter / unclocked goal in a split period
  / pulled net → charge no one; unknown-timeline games roll to a per-game
  "<Team> (goaltending)" residual row.

## Order (hard dependencies)

1. **Full LRS apply first** (REG A–G → GS-1 → H → I → J → K → L, per the LRS
   runbook). M `DROP`s the post-I goalie RPC signatures and reads
   `game_lineups.line`/`player_id` (H).
2. `20260615001500_goalie1_m_in_net_attribution.sql` — adds
   `game_goals.empty_net` (plain ALTER, fails loud on collision — audited
   clean against prod Jun 12), creates `parse_game_clock` / `game_clock_key`
   / `goalie_in_net_timeline` / `goalie_game_lines`, rewrites
   `get_league_goalie_stats` + `get_tournament_goalie_stats` at their exact
   Migration-I signatures (additive `player_id` kept; deployed clients keep
   working; `shield_minor_player_id` keeps minor goalies' ids off anon).
3. **Redeploy `sync-scorekeeper-queue`** — the `game_goals` whitelist gained
   `empty_net`, and the fn now FORCES `game_source` server-side on all four
   event tables (an old deploy silently drops the EN flag from offline-filed
   goals — they'd replay as regular goals and charge a goalie).
4. Ship the client build (ScorerView empty-net toggle + starter nudge +
   `game_source` stamping; GameDetail "(EN)" tag).
5. `20260615001600_goalie1_n_game_source_backfill_skater_null_tolerance.sql`
   (`feature/game-source-null-fix`, stacked on this branch) — backfills the
   historical NULL `game_source` rows (fail-closed if any game id ever
   appears in BOTH `games` and `league_games`; verified 0 on prod Jun 12)
   and makes the two SKATER RPCs tolerate `game_source IS NULL` exactly like
   M's goalie fns. **Do NOT run a manual prod UPDATE for the backfill — the
   migration does it**, atomically with the RPC fix, and catches any null
   rows written between now and the apply. The two `game_shots` rows whose
   parent game was deleted (May 25) stay NULL on purpose — unreachable
   through the parent joins, nothing to attribute them to.

## Verification already run (Jun 12)

- **PGlite prod-shaped harness**: `node scripts/lrs-smoke/pglite-migrations.mjs`
  — 97/97 (the 67 LRS checks + 30 GOALIE-1 checks: clock-key unit tests,
  boundary goal, EN flag vs backstop, unknown starter, mid-game first
  appearance, untimed goals (charged when unambiguous, dropped when split),
  starter-nudge row semantics, same-instant double change, shared 0-GA,
  cross-team sub goalie + jersey collision, residual rows, minor shield,
  full board aggregation tallies, tournament SO-decision + residuals).
- **Supabase Pro branch** (disposable, deleted): pre-state + H→M applied via
  the migration tooling on PG17 with RLS ENABLED; verified anon EXECUTE
  grants, the anon→RLS→INVOKER read path end-to-end, boundary + W-of-record
  semantics, minor `player_id` NULL for anon / visible signed-in.
  (Note: branch creation from prod reports MIGRATIONS_FAILED + empty DB —
  prod's base schema predates the migration files. Seed the harness
  pre-state first; this is expected, not a blocker.)

## Behavior changes to expect on the live boards

- Teams with 2+ goalies (or goalie subs) get **individual rows** instead of
  "<Team> (goaltending)" whenever lineups/changes identify who played.
- Single-goalie league teams keep their **exact pre-M numbers** (score-based
  GA parity path), minus goals now flagged/derived empty-net (correct: EN
  goals never charge a goalie).
- Tournament games with no goalie data now show a team-level residual row
  instead of silently dropping off the board.
- Event reads tolerate `game_source IS NULL` (the GS-1 write path left it
  null; the client + edge fn now stamp it again). Migration N (step 5)
  backfills the historical null rows and brings the skater RPCs to the same
  tolerance — after N, a board can never silently drop an event row over a
  missing source tag.

## What did NOT change

- Both RPC signatures, grants (anon/authenticated/service_role), SECURITY
  INVOKER, and the boards' login-gated client surface.
- Team-level W/L/T/GA semantics per board (league: score-only; tournament:
  score + `shootout_winner`; OTL still folds into L/T — no new column).
- `game_goalie_changes` capture path and its whitelist entry.
- No new write surface: the starter nudge writes an ordinary goalie-change
  row (out=null, in=#, P1, no clock) through the existing queue + whitelist.
