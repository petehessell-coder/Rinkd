// A1 (feed-engagement) — recap-card data access.
//
// One server-side assembler (the get_game_recap_card RPC, deployed) returns the
// full payload the RINKD GAME RECAP card needs for any game source. The card
// component (components/RecapCard) renders it over /public/recap-card-bg2.png.
//
// Payload shape:
//   { game_id, source, date, rink, home_score, away_score,
//     home:{name,logo_initials,logo_color,has_logo}, away:{...},
//     goals:[{side:'H'|'A', jersey, period, time, name}],
//     shots_home, shots_away, pim_home, pim_away, saves_home, saves_away,
//     period_scores:[{period, side, goals}], stats_available }
// (team-source games are score-only: stats_available=false, goals=[].)

import { supabase } from './supabase';

export async function getRecapCard(gameId, source) {
  if (!gameId || !source) {
    return { data: null, error: new Error('getRecapCard requires gameId + source') };
  }
  const { data, error } = await supabase.rpc('get_game_recap_card', {
    p_game_id: gameId,
    p_source: source,
  });
  return { data, error };
}

// Recap posts carry the scoping ids — derive which game table to read.
export function recapSourceFromPost(post) {
  if (!post) return null;
  if (post.league_id) return 'league';
  if (post.tournament_id) return 'tournament';
  if (post.team_id) return 'team';
  return 'tournament';
}
