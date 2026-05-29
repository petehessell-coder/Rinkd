import { supabase } from './supabase';

/**
 * MULTIDIV-1 Phase 3 — suspensions (advisory). A game-misconduct/match penalty
 * in ScorerView prompts a row here; the director manages it from the
 * Suspensions tab. Jersey-keyed (player_user_id usually NULL). Advisory: a
 * suspended player is flagged, never hard-blocked from a lineup.
 */

export async function listSuspensions(tournamentId, divisionId = null) {
  let q = supabase
    .from('game_suspensions')
    .select('id, tournament_id, division_id, team_id, player_user_id, player_jersey, player_name, reason, games_remaining, status, source_game_id, served_game_id, created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function createSuspension(fields) {
  const { data, error } = await supabase
    .from('game_suspensions')
    .insert({
      tournament_id: fields.tournamentId,
      division_id: fields.divisionId || null,
      team_id: fields.teamId || null,
      player_user_id: fields.playerUserId || null,
      player_jersey: fields.playerJersey != null && fields.playerJersey !== '' ? parseInt(fields.playerJersey, 10) : null,
      player_name: fields.playerName?.trim() || null,
      reason: fields.reason || 'game_misconduct',
      games_remaining: fields.gamesRemaining != null ? fields.gamesRemaining : 1,
      source_game_id: fields.sourceGameId || null,
    })
    .select()
    .single();
  return { data, error };
}

export async function updateSuspension(id, fields) {
  const payload = {};
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.gamesRemaining !== undefined) payload.games_remaining = fields.gamesRemaining;
  if (fields.servedGameId !== undefined) payload.served_game_id = fields.servedGameId || null;
  const { error } = await supabase.from('game_suspensions').update(payload).eq('id', id);
  return { error };
}

export async function deleteSuspension(id) {
  const { error } = await supabase.from('game_suspensions').delete().eq('id', id);
  return { error };
}
