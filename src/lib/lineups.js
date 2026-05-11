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
 * @param {Array}  players — array of { user_id?, invite_name?, jersey_number, position?, is_captain?, is_alternate?, is_goalie?, is_starter? }
 */
export async function setLineup(ctx, players) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required.');
  const { gameId, gameSource, teamId } = ctx;
  if (!gameId || !teamId || !gameSource) throw new Error('Missing game or team context.');

  // 1. Clear existing lineup for this game+team
  const { error: delErr } = await supabase
    .from('game_lineups')
    .delete()
    .eq('game_id', gameId)
    .eq('team_id', teamId);
  if (delErr) throw delErr;

  if (!players || players.length === 0) return [];

  // 2. Insert new rows
  const rows = players.map(p => ({
    game_id: gameId,
    game_source: gameSource,
    team_id: teamId,
    user_id: p.user_id || null,
    invite_name: p.invite_name || null,
    jersey_number: p.jersey_number != null ? p.jersey_number : null,
    position: p.position || null,
    is_captain: !!p.is_captain,
    is_alternate: !!p.is_alternate,
    is_goalie: !!p.is_goalie,
    is_starter: p.is_starter !== false,
    created_by: user.id,
  }));

  const { data, error } = await supabase
    .from('game_lineups')
    .insert(rows)
    .select();
  if (error) throw error;
  return data || [];
}
