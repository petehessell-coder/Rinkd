// GROWTH-SHARE-1 · M3 — fetch + build recap-card data from just a game id.
//
// The public page already has the game loaded, but a recap post in a feed only
// carries recap_for_game_id. This loader fetches the game + box score and returns
// the same card object the composer consumes, so the Share button works anywhere.
// Mirrors PublicGame's embeds/normalization (kept intentionally parallel).

import { supabase } from './supabase';
import { buildRecapCardData } from './shareCard';
import { areScorersHidden } from './publicShare';

const TOURN_BLUE = '#2E5B8C';
const TOURN_RED = '#D72638';

function roundLabelFor(isLeague, game) {
  if (isLeague) return game.round && game.round !== 'pool' ? titleCase(game.round) : 'Regular season';
  const r = (game.round || '').toLowerCase();
  if (r === 'pool' || r === '') {
    const hp = game.home_team?.pool, ap = game.away_team?.pool;
    return hp && ap && hp === ap ? hp : (hp || ap ? `${hp || 'Pool ?'} vs ${ap || 'Pool ?'}` : 'Pool play');
  }
  if (r === 'final' || r === 'championship') return '🏆 Championship';
  if (r === 'semifinal' || r === 'sf') return 'Semifinal';
  if (r === 'quarterfinal' || r === 'qf') return 'Quarterfinal';
  return titleCase(r);
}

export async function loadGameCardData(gameId, isLeague) {
  let g, parent;
  if (isLeague) {
    const { data } = await supabase.from('league_games')
      .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), league:leagues(name,settings)')
      .eq('id', gameId).maybeSingle();
    g = data; parent = data?.league || null;
  } else {
    const { data } = await supabase.from('games')
      .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,seed,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,seed,logo_url), tournament:tournaments(name,settings)')
      .eq('id', gameId).maybeSingle();
    g = data; parent = data?.tournament || null;
  }
  if (!g) throw new Error('Game not found');

  const youth = areScorersHidden(parent?.settings);
  const [{ data: goals }, { data: lineups }] = await Promise.all([
    supabase.from('game_goals').select('team_id, scorer_number, is_shootout').eq('game_id', gameId),
    youth ? Promise.resolve({ data: [] }) : supabase.from('game_lineups').select('team_id, jersey_number, invite_name').eq('game_id', gameId),
  ]);
  const lineup = {};
  (lineups || []).forEach(r => { if (r.jersey_number == null) return; (lineup[r.team_id] = lineup[r.team_id] || {})[r.jersey_number] = r.invite_name || null; });

  const home = isLeague
    ? { name: g.home_lt?.team?.name || g.home_lt?.team_name, logo_color: g.home_lt?.team?.logo_color || g.home_lt?.logo_color, logo_initials: g.home_lt?.team?.logo_initials || g.home_lt?.logo_initials, logo_url: g.home_lt?.team?.logo_url || g.home_lt?.logo_url, id: g.home_team_id }
    : { name: g.home_team?.team_name, color: TOURN_BLUE, logo_url: g.home_team?.logo_url, id: g.home_team_id };
  const away = isLeague
    ? { name: g.away_lt?.team?.name || g.away_lt?.team_name, logo_color: g.away_lt?.team?.logo_color || g.away_lt?.logo_color, logo_initials: g.away_lt?.team?.logo_initials || g.away_lt?.logo_initials, logo_url: g.away_lt?.team?.logo_url || g.away_lt?.logo_url, id: g.away_team_id }
    : { name: g.away_team?.team_name, color: TOURN_RED, logo_url: g.away_team?.logo_url, id: g.away_team_id };

  const scorers = (teamId) => {
    if (youth) return [];
    const counts = {};
    (goals || []).filter(x => x.team_id === teamId && !x.is_shootout).forEach(x => { const k = x.scorer_number; if (k == null) return; counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts).map(([num, n]) => ({ name: lineup[teamId]?.[num] || `#${num}`, goals: n })).sort((a, b) => b.goals - a.goals);
  };

  const competition = parent?.name || 'Rinkd';
  return buildRecapCardData({
    home, away,
    homeScore: g.home_score, awayScore: g.away_score,
    round: roundLabelFor(isLeague, g), competition, league: competition,
    tie: g.status === 'final' && g.home_score === g.away_score,
    scorersHome: scorers(home.id), scorersAway: scorers(away.id),
  });
}

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
