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

// SOCIAL-3 P2 — the SETTLED winner for a game, or null if voting is still open.
// Once a row exists, the card shows the locked winner state instead of voting.
export async function getGamePuckResult(gameId, kind) {
  if (!gameId) return null;
  const { data, error } = await supabase.rpc('get_game_puck_result', {
    p_game_id: gameId,
    p_kind: isLeague(kind) ? 'league' : 'tournament',
  });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    team_id: r.team_id,
    jersey: r.jersey,
    winner_user_id: r.winner_user_id || null,
    winner_name: r.winner_name || null,
    votes: Number(r.votes) || 0,
    total_votes: Number(r.total_votes) || 0,
    settled_at: r.settled_at,
  };
}

// SOCIAL-3 reconcile — the voting window state for a game. Voting opens on the
// FIRST vote and runs 30 min; the tally is hidden during the last 10 min
// (blackout) to build the reveal. phase ∈ 'none' (no votes yet) | 'open' |
// 'blackout' | 'closed' (window elapsed, awaiting settle) | 'settled'.
export async function getGamePuckState(gameId, kind) {
  if (!gameId) return { phase: 'none', opened_at: null, closes_at: null, total_votes: 0, is_settled: false };
  const { data, error } = await supabase.rpc('get_game_puck_state', {
    p_game_id: gameId,
    p_kind: isLeague(kind) ? 'league' : 'tournament',
  });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { phase: 'none', opened_at: null, closes_at: null, total_votes: 0, is_settled: false };
  return {
    phase: r.phase || 'none',
    opened_at: r.opened_at || null,
    closes_at: r.closes_at || null,
    total_votes: Number(r.total_votes) || 0,
    is_settled: !!r.is_settled,
  };
}

// Lazy settle-on-view: when a signed-in viewer opens a game whose 30-min window
// has closed but isn't settled yet, nudge the settle so the reveal is instant
// instead of waiting for the cron. Window-guarded + idempotent server-side, so
// a no-op (or an anon caller's permission error) is harmless — swallow it.
export async function settleGamePuck(gameId, kind) {
  if (!gameId) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return null;
  const { data, error } = await supabase.rpc('settle_game_puck', {
    p_game_id: gameId,
    p_kind: isLeague(kind) ? 'league' : 'tournament',
  });
  if (error) return null;
  return data || null;
}

// The winner's public profile (for the reveal avatar), or null when the winner
// is nameplate-only (no resolved user). Only the display-safe columns — these
// are publicly readable; never select email/PII here.
export async function getGamePuckWinnerProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, avatar_color, avatar_initials, tier')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

// How many Game Pucks a user has won (settled) — the "Nx Game Puck" badge.
export async function getUserGamePuckCount(userId) {
  if (!userId) return 0;
  const { data, error } = await supabase.rpc('get_user_game_puck_count', { p_user_id: userId });
  if (error) return 0;
  return Number(data) || 0;
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
