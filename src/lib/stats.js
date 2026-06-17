import { supabase } from './supabase';

export async function getPlayerLeagueStats(userId) {
  // Server-side aggregation via the get_player_league_stats RPC — replaces the
  // old ~50-query N+1 loop (one DB query per team per league per stat) with a
  // single round-trip. Same return shape as before, so Profile.js is unchanged;
  // sorted by points here for the UI.
  const { data, error } = await supabase.rpc('get_player_league_stats', { p_user_id: userId });
  if (error) {
    console.warn('[stats] getPlayerLeagueStats failed:', error.message);
    return [];
  }
  return (data || []).sort((a, b) => b.points - a.points);
}

export async function getPlayerTournamentStats(userId) {
  // STATS-3: tournament half of the player profile. Mirrors getPlayerLeagueStats
  // but reads get_player_tournament_stats, which anchors on game_lineups.user_id
  // (tournaments have no team_members link). Kept SEPARATE from league stats —
  // the two are never blended. Empty until a tournament lineup carries a user_id
  // (adult links via link_tournament_player; minors stay consent-gated).
  const { data, error } = await supabase.rpc('get_player_tournament_stats', { p_user_id: userId });
  if (error) {
    console.warn('[stats] getPlayerTournamentStats failed:', error.message);
    return [];
  }
  return (data || []).sort((a, b) => b.points - a.points);
}
