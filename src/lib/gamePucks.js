// Rinkd Game Puck (SOCIAL-3, Phase 1) — fan "Game Puck" / Fans' Pick vote on
// FINAL league + tournament games. Jersey-keyed (rosters are thin / tournament
// teams nameplate-only), polymorphic game ref (game_id XOR league_game_id),
// one vote per user per game, change-able. Winner is computed on read; no
// denormalized counts, no push/auto-post in Phase 1.
//
// `kind` is 'league' for a league_games row, anything else (default
// 'tournament') for a games row — mirrors GameDetail's ?type param.

import { supabase } from './supabase';

const isLeague = (kind) => kind === 'league';

// Live tally for one game. Returns { rows, total, leader } where rows are
// { team_id, jersey, votes } sorted votes-desc, and leader is rows[0] (or null).
export async function getGamePuck(gameId, kind) {
  if (!gameId) return { rows: [], total: 0, leader: null };
  const { data, error } = await supabase.rpc('get_game_puck', {
    p_game_id: gameId,
    p_kind: isLeague(kind) ? 'league' : 'tournament',
  });
  if (error) throw error;
  const rows = (data || []).map((r) => ({
    team_id: r.team_id,
    jersey: r.jersey,
    votes: Number(r.votes) || 0,
  }));
  const total = rows.reduce((s, r) => s + r.votes, 0);
  return { rows, total, leader: rows[0] || null };
}

// The signed-in user's current vote on a game, or null. RLS select is open to
// any authenticated viewer, so a plain filtered select is fine.
export async function getMyGamePuckVote(gameId, kind) {
  if (!gameId) return null;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  const col = isLeague(kind) ? 'league_game_id' : 'game_id';
  const { data, error } = await supabase
    .from('game_puck_votes')
    .select('voted_tournament_team_id, voted_league_team_id, voted_jersey')
    .eq('voter_id', uid)
    .eq(col, gameId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    team_id: data.voted_tournament_team_id || data.voted_league_team_id,
    jersey: data.voted_jersey,
  };
}

// Cast or change the user's vote. Upsert via RPC; RLS enforces own-row + that
// the game is final.
export async function castGamePuckVote(gameId, kind, teamId, jersey) {
  const { error } = await supabase.rpc('cast_game_puck_vote', {
    p_game_id: gameId,
    p_kind: isLeague(kind) ? 'league' : 'tournament',
    p_team_id: teamId,
    p_jersey: jersey,
  });
  if (error) throw error;
}

// Season board: how many game-pucks each (team, jersey) won across a scope.
// `scope` is 'league' | 'tournament'. Returns rows
// { team_id, jersey, pucks_won, team_name, player_name } sorted pucks-won desc.
export async function getSeasonGamePucks(scope, scopeId) {
  if (!scopeId) return [];
  const { data, error } = await supabase.rpc('get_season_game_pucks', {
    p_scope: scope === 'league' ? 'league' : 'tournament',
    p_scope_id: scopeId,
  });
  if (error) throw error;
  return (data || []).map((r) => ({
    team_id: r.team_id,
    jersey: r.jersey,
    pucks_won: Number(r.pucks_won) || 0,
    team_name: r.team_name,
    player_name: r.player_name,
  }));
}
