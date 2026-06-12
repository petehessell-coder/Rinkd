import { supabase } from './supabase';

/**
 * Game lineups record who actually played in a specific game on a specific team.
 *
 * Why this table exists: without it, every player's GP (games played) on a
 * team inflates to "every final game the team played", which is wrong for
 * mid-season call-ups and players who skipped a game. With lineups, GP =
 * count of finalized games this exact player appeared on the lineup for.
 *
 * One row per (game_id, team_id, jersey_number).
 */

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getLineup(gameId, teamId) {
  const { data, error } = await supabase
    .from('game_lineups')
    .select('*')
    .eq('game_id', gameId)
    .eq('team_id', teamId)
    .order('jersey_number');
  if (error) throw error;
  return data || [];
}

export async function listGamesForUserLineups(userId) {
  // Used by stats to compute roster-aware GP.
  const { data, error } = await supabase
    .from('game_lineups')
    .select('game_id, game_source, team_id, jersey_number')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Replace the lineup for a (game, team). Wipes existing rows and inserts the
 * new set in one go. Atomic enough for our needs.
 *
 * @param {object} ctx     — { gameId, gameSource, teamId }
 * @param {Array}  players — array of { user_id?, player_id?, invite_name?, jersey_number, position?, is_captain?, is_alternate?, is_goalie?, is_starter?, line? }
 *
 * `line` semantics (mirrors the game_lineups.line column comment):
 * forwards L1–L4, defense D-pair 1–3, goalies 1 = starter / 2 = backup.
 */
export async function setLineup(ctx, players) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required.');
  const { gameId, gameSource, teamId } = ctx;
  if (!gameId || !teamId || !gameSource) throw new Error('Missing game or team context.');

  const rows = (players || []).map(p => ({
    user_id: p.user_id || null,
    // Identity resolved at save time when the roster row carries one; ghost
    // rows stay null here and resolveLineupPlayers() jersey-matches them.
    player_id: p.player_id || p.user_id || null,
    invite_name: p.invite_name || null,
    jersey_number: p.jersey_number != null ? p.jersey_number : null,
    position: p.position || null,
    is_captain: !!p.is_captain,
    is_alternate: !!p.is_alternate,
    is_goalie: !!p.is_goalie,
    is_starter: p.is_starter !== false,
    line: p.line != null ? p.line : null,
  }));

  // Server-side transactional replace: a failed insert (duplicate jersey,
  // minor gate) rolls the wipe back, so the saved lineup survives. The old
  // delete-then-insert from the client could commit the delete and then fail
  // the insert, silently erasing the lineup.
  const { data, error } = await supabase.rpc('set_lineup', {
    p_game_id: gameId,
    p_game_source: gameSource,
    p_team_id: teamId,
    p_players: rows,
  });
  if (error) throw error;
  return data || [];
}

/**
 * GS-5 resolver: attribute this game's lineup rows to real profiles via the
 * REG roster (team_members). Server-side RPC; collisions (one jersey worn by
 * two rostered identities) stay unresolved on purpose. Best-effort by design —
 * a failed resolution must never fail the save that triggered it.
 */
export async function resolveLineupPlayers(gameId) {
  try {
    const { data, error } = await supabase.rpc('resolve_lineup_players', { p_game_id: gameId });
    if (error) return 0;
    return data || 0;
  } catch {
    return 0;
  }
}
