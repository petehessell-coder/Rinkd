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
