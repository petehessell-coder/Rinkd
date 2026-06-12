// GS-1 Offline Mode — ordered, idempotent replay of a scorekeeper's queued
// writes (see src/lib/syncQueue.js + public/service-worker.js).
//
// Runs with the SERVICE ROLE because a client that was offline for a long
// stretch may arrive with anything from a fresh token to none at all — RLS
// can't be the enforcement layer here. That makes THIS file the enforcement
// layer, and it is deliberately paranoid:
//   * Caller identity comes from the verified JWT only — never the body.
//   * Every op is authorized against its own game: the caller must be the
//     assigned scorekeeper, the tournament director / league commissioner,
//     or hold a tournament_roles / league_roles scorer role (the exact
//     authorization set ScorerView itself enforces — mirrors submit-scoresheet).
//   * The parent tournament/league must be activated — service role must not
//     become a paywall bypass around the is_activated RLS gate.
//   * Tables, operations, and COLUMNS are whitelisted. Payloads are rebuilt
//     from the whitelist, never spread — this function cannot write
//     scorekeeper_id, scoresheet_url, tournament_id, or any other column a
//     scoring client has no business touching.
//   * team_id on every event row must be one of the game's two teams.
//   * Replay is sequential in (ts, seq) order; a hard failure STOPS the batch
//     so a delete can never apply before its own insert.
//   * Inserts are upsert-on-conflict-do-nothing keyed on the client-generated
//     id → a replay of a write the server already applied (response lost to
//     the connection drop) reports 'duplicate' instead of double-counting.
//   * A game that is already 'final' only accepts event-log writes (the
//     append-only truth a director can re-derive from after Reopen) — a stale
//     queued score/period update must not silently un-finalize or rewrite a
//     locked game. Those report 'skipped_finalized'.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

const MAX_OPS = 200

// table → allowed operations + allowed payload columns. `needsTeam` columns
// are additionally validated against the game's own two team ids.
const RULES: Record<string, { ops: string[]; cols: string[]; needsTeam: boolean }> = {
  game_goals: {
    ops: ["insert", "delete"],
    cols: ["id", "game_id", "team_id", "scorer_number", "assist1_number", "assist2_number", "period", "time_in_period", "is_shootout", "created_at"],
    needsTeam: true,
  },
  game_penalties: {
    ops: ["insert", "delete"],
    cols: ["id", "game_id", "team_id", "player_number", "penalty_type", "severity", "duration_minutes", "period", "time_in_period", "created_at"],
    needsTeam: true,
  },
  game_goalie_changes: {
    ops: ["insert"],
    cols: ["id", "game_id", "team_id", "goalie_out_number", "goalie_in_number", "period", "time_in_period", "created_at"],
    needsTeam: true,
  },
  game_shots: {
    ops: ["upsert"],
    cols: ["game_id", "team_id", "period", "count"],
    needsTeam: true,
  },
  // LRS-1 Phase 2 (GS-2): rink-side suspension filing. Tournament games only
  // (enforced below — the table has no league shape). tournament_id and
  // created_by are NOT client columns: both are forced from the authorized
  // game + verified JWT in the per-op block, like game_id.
  game_suspensions: {
    ops: ["insert"],
    cols: ["id", "game_id", "team_id", "player_name", "jersey_number", "penalty_id", "suspension_type", "games_remaining", "notes", "created_at"],
    needsTeam: true,
  },
  games: {
    ops: ["update"],
    cols: ["home_score", "away_score", "period", "status", "shootout_winner"],
    needsTeam: false,
  },
  league_games: {
    ops: ["update"],
    cols: ["home_score", "away_score", "period", "status", "shootout_winner", "decided_in"],
    needsTeam: false,
  },
}

const ALLOWED_STATUS = ["scheduled", "live", "final"]

type Op = {
  id: string
  gameId: string
  isLeague: boolean
  table: string
  operation: string
  payload: Record<string, unknown>
  match?: Record<string, unknown>
  ts: number
  seq: number
}

type GameAuth = {
  ok: boolean
  status?: number
  error?: string
  game?: { home_team_id: string | null; away_team_id: string | null; status: string | null; tournament_id?: string | null }
}

const SUSPENSION_TYPES = ["game_misconduct", "match_penalty", "suspension_1", "suspension_2", "suspension_3", "indefinite"]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Authorize one (gameId, isLeague) group. Mirrors ScorerView's own access
// check and the hardened submit-scoresheet pattern.
async function authorizeGame(svc: ReturnType<typeof createClient>, gameId: string, isLeague: boolean, userId: string): Promise<GameAuth> {
  if (isLeague) {
    const { data: g } = await svc.from("league_games")
      .select("league_id, scorekeeper_id, home_team_id, away_team_id, status, league:leagues(is_activated)")
      .eq("id", gameId).single()
    if (!g) return { ok: false, status: 404, error: "game not found" }
    if (g.league?.is_activated === false) return { ok: false, status: 403, error: "league not activated" }
    let ok = g.scorekeeper_id === userId
    if (!ok) {
      const { data: isCommish } = await svc.rpc("is_league_commissioner", { p_league_id: g.league_id, p_user_id: userId })
      ok = !!isCommish
    }
    if (!ok) {
      const { data: role } = await svc.from("league_roles")
        .select("user_id").eq("league_id", g.league_id).eq("user_id", userId).eq("role", "scorer").maybeSingle()
      ok = !!role
    }
    if (!ok) return { ok: false, status: 403, error: "forbidden" }
    return { ok: true, game: { home_team_id: g.home_team_id, away_team_id: g.away_team_id, status: g.status } }
  }

  const { data: g } = await svc.from("games")
    .select("tournament_id, scorekeeper_id, home_team_id, away_team_id, status, tournament:tournaments(is_activated)")
    .eq("id", gameId).single()
  if (!g) return { ok: false, status: 404, error: "game not found" }
  if (g.tournament?.is_activated === false) return { ok: false, status: 403, error: "tournament not activated" }
  let ok = g.scorekeeper_id === userId
  if (!ok) {
    const { data: isDir } = await svc.rpc("is_tournament_director", { p_tournament_id: g.tournament_id, p_user_id: userId })
    ok = !!isDir
  }
  if (!ok) {
    // role='scorer' only — directors are already covered by the RPC above.
    // (ScorerView accepts any tournament_roles row, but only director/scorer
    // exist today; this fn matches the tighter submit-scoresheet pattern so a
    // future non-scoring role doesn't silently inherit replay rights.)
    const { data: role } = await svc.from("tournament_roles")
      .select("user_id").eq("tournament_id", g.tournament_id).eq("user_id", userId).eq("role", "scorer").maybeSingle()
    ok = !!role
  }
  if (!ok) return { ok: false, status: 403, error: "forbidden" }
  return { ok: true, game: { home_team_id: g.home_team_id, away_team_id: g.away_team_id, status: g.status, tournament_id: g.tournament_id } }
}

// Rebuild the payload from the whitelist — unknown keys are silently dropped,
// game_id is forced to the authorized game, and team_id (where present) must
// be one of the game's two teams.
function sanitizePayload(op: Op, rules: { cols: string[]; needsTeam: boolean }, game: GameAuth["game"]): { payload?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {}
  for (const col of rules.cols) {
    if (op.payload && Object.prototype.hasOwnProperty.call(op.payload, col)) out[col] = op.payload[col]
  }
  if ("game_id" in out || rules.cols.includes("game_id")) out.game_id = op.gameId
  if (rules.needsTeam) {
    const teamId = out.team_id
    const valid = [game?.home_team_id, game?.away_team_id].filter(Boolean)
    if (!teamId || !valid.includes(teamId)) return { error: "team_id is not part of this game" }
  }
  if ("id" in out && !UUID_RE.test(String(out.id))) return { error: "invalid id" }
  if ("status" in out && !ALLOWED_STATUS.includes(String(out.status))) return { error: "invalid status" }
  // shootout_winner must reference this game's own teams: 'home'/'away' on
  // tournament games (plain text column), a league_teams uuid on league
  // games (the FK only proves it's SOME league team, not one of this game's).
  if ("shootout_winner" in out && out.shootout_winner != null) {
    const valid = op.isLeague
      ? [game?.home_team_id, game?.away_team_id].filter(Boolean)
      : ["home", "away"]
    if (!valid.includes(out.shootout_winner)) return { error: "invalid shootout_winner" }
  }
  return { payload: out }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    // Identity from the verified JWT only.
    const authHeader = req.headers.get("Authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "")
    if (!token) return json({ error: "missing authorization" }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token)
    if (userErr || !user) return json({ error: "unauthorized" }, 401)

    const body = await req.json().catch(() => null)
    const ops: Op[] = body?.ops
    if (!Array.isArray(ops) || ops.length === 0) return json({ error: "ops required" }, 400)
    if (ops.length > MAX_OPS) return json({ error: `too many ops (max ${MAX_OPS})` }, 400)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Authorize each distinct game once, up front. A group that fails closes
    // every op in it as 'rejected' — fail-closed, no partial trust.
    const authCache = new Map<string, GameAuth>()
    for (const op of ops) {
      const key = `${op.isLeague ? "l" : "t"}:${op.gameId}`
      if (!authCache.has(key)) {
        if (!op.gameId || !UUID_RE.test(String(op.gameId))) {
          authCache.set(key, { ok: false, status: 400, error: "invalid gameId" })
        } else {
          authCache.set(key, await authorizeGame(svc, op.gameId, !!op.isLeague, user.id))
        }
      }
    }

    // Replay strictly in client action order.
    const sorted = [...ops].sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq))
    const results: { id: string; status: string; error?: string }[] = []
    let stopped = false

    for (const op of sorted) {
      const rules = RULES[op.table]
      const auth = authCache.get(`${op.isLeague ? "l" : "t"}:${op.gameId}`)!
      if (!rules || !rules.ops.includes(op.operation)) {
        results.push({ id: op.id, status: "rejected", error: "table/operation not allowed" })
        continue
      }
      if (!auth.ok) {
        results.push({ id: op.id, status: "rejected", error: auth.error || "forbidden" })
        continue
      }

      const clean = sanitizePayload(op, rules, auth.game)
      if (clean.error) {
        results.push({ id: op.id, status: "rejected", error: clean.error })
        continue
      }
      const payload = clean.payload!

      // GS-2 suspension filings get table-specific hardening: tournament-only,
      // tournament_id + created_by forced server-side (never from the body),
      // and the type/count pair validated to the same invariants the DB CHECKs
      // pin — a rejection here dead-letters cleanly instead of hard-failing
      // the batch on a constraint violation.
      if (op.table === "game_suspensions") {
        if (op.isLeague || !auth.game?.tournament_id) {
          results.push({ id: op.id, status: "rejected", error: "suspensions are tournament-only" })
          continue
        }
        payload.tournament_id = auth.game.tournament_id
        payload.created_by = user.id
        const sType = String(payload.suspension_type || "")
        if (!SUSPENSION_TYPES.includes(sType)) {
          results.push({ id: op.id, status: "rejected", error: "invalid suspension_type" })
          continue
        }
        const gr = Number(payload.games_remaining)
        if (!Number.isInteger(gr) || gr < 0 || gr > 99 || (sType === "indefinite" ? gr !== 0 : gr < 1)) {
          results.push({ id: op.id, status: "rejected", error: "invalid games_remaining" })
          continue
        }
        if (!payload.player_name || typeof payload.player_name !== "string") {
          results.push({ id: op.id, status: "rejected", error: "player_name required" })
          continue
        }
        if (payload.jersey_number != null && !Number.isInteger(Number(payload.jersey_number))) {
          results.push({ id: op.id, status: "rejected", error: "invalid jersey_number" })
          continue
        }
        if (payload.penalty_id != null) {
          if (!UUID_RE.test(String(payload.penalty_id))) {
            results.push({ id: op.id, status: "rejected", error: "invalid penalty_id" })
            continue
          }
          // The linking penalty may never have made it (its insert was
          // rejected/dead-lettered earlier in the queue, or the scorer
          // deleted it). The suspension RECORD matters more than the link —
          // drop the FK instead of letting the insert hard-fail and wedge
          // the rest of the replay behind it.
          const { data: pen } = await svc.from("game_penalties")
            .select("id").eq("id", payload.penalty_id).eq("game_id", op.gameId).maybeSingle()
          if (!pen) payload.penalty_id = null
        }
      }

      try {
        if (op.operation === "insert") {
          if (!payload.id) { results.push({ id: op.id, status: "rejected", error: "insert requires client id" }); continue }
          // on conflict (id) do nothing → replaying an already-applied write
          // is a clean no-op. PINNED ASSUMPTION (supabase-js v2 / PostgREST):
          // with ignoreDuplicates the conflicting row is NOT returned, so
          // data=[] ⇔ duplicate. If that ever changes, the worst case is a
          // duplicate misreported as 'applied' — cosmetic; the row itself
          // still can't double.
          const { data, error } = await svc.from(op.table)
            .upsert(payload, { onConflict: "id", ignoreDuplicates: true }).select("id")
          if (error) throw error
          results.push({ id: op.id, status: (data && data.length) ? "applied" : "duplicate" })
        } else if (op.operation === "delete") {
          const rowId = op.match?.id ?? op.payload?.id
          if (!rowId || !UUID_RE.test(String(rowId))) { results.push({ id: op.id, status: "rejected", error: "delete requires row id" }); continue }
          // Scoped to the authorized game — a scorer cannot delete another
          // game's rows by id. Deleting an already-gone row is idempotent.
          const { error } = await svc.from(op.table).delete().eq("id", rowId).eq("game_id", op.gameId)
          if (error) throw error
          results.push({ id: op.id, status: "applied" })
        } else if (op.operation === "upsert") {
          // game_shots — absolute per-period count, so replay order makes
          // last-write-wins land on the scorer's final number.
          const { error } = await svc.from(op.table)
            .upsert(payload, { onConflict: "game_id,team_id,period" })
          if (error) throw error
          results.push({ id: op.id, status: "applied" })
        } else if (op.operation === "update") {
          delete payload.game_id // games/league_games key on id, not game_id
          // A replayed patch must never walk a game backwards to 'scheduled'
          // — drop the status field, keep the scores (cross-device staleness;
          // the next legitimate write sets it 'live' again).
          if (payload.status === "scheduled") delete payload.status
          if (Object.keys(payload).length === 0) { results.push({ id: op.id, status: "rejected", error: "no allowed columns" }); continue }
          if (payload.status !== "final") {
            // Atomic finalized-game guard: the .neq makes "is it final?" and
            // the write one statement, so two racing drains can't interleave
            // a stale 'live' patch past a just-applied finalize (a read-then-
            // write version of this check could). 0 rows ⇒ game was final
            // (or gone) ⇒ skipped. Stale queued writes never rewrite or
            // un-finalize a locked game; the scorer resolves via Reopen.
            const { data, error } = await svc.from(op.table)
              .update(payload).eq("id", op.gameId).neq("status", "final").select("id")
            if (error) throw error
            results.push({ id: op.id, status: (data && data.length) ? "applied" : "skipped_finalized" })
          } else {
            // A finalize replay is allowed onto an already-final game —
            // deliberate last-write-wins per the GS-1 spec.
            const { error } = await svc.from(op.table).update(payload).eq("id", op.gameId)
            if (error) throw error
            results.push({ id: op.id, status: "applied" })
          }
        } else {
          results.push({ id: op.id, status: "rejected", error: "unknown operation" })
        }
      } catch (err) {
        // A duplicate ACTIVE filing for the same penalty (the partial unique
        // index on game_suspensions.penalty_id) means another device already
        // filed it — a clean terminal rejection, not a batch-stopping
        // failure. Nothing later in the queue depends on a suspension row.
        if (op.table === "game_suspensions" && (err as { code?: string })?.code === "23505") {
          results.push({ id: op.id, status: "rejected", error: "a suspension is already filed for this penalty" })
          continue
        }
        // Hard DB failure — report and STOP so later ops can't leapfrog an
        // earlier one they may depend on (replay order is the contract).
        console.error("[sync-scorekeeper-queue] op failed", { op_id: op.id, table: op.table, operation: op.operation, error: err?.message })
        results.push({ id: op.id, status: "failed", error: err?.message || "db error" })
        stopped = true
        break
      }
    }

    return json({ results, stopped })
  } catch (err) {
    console.error("[sync-scorekeeper-queue] unhandled error", { error: err?.message })
    return json({ error: err?.message || "internal error" }, 500)
  }
})
