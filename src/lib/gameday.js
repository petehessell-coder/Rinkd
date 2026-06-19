// =============================================================================
// Game-day loop — the data layer for the schedule-driven feed surfaces:
// pre-game hype, the live float, and (already shipped) the auto-recap.
//
// Scale (CLAUDE.md "Saturday Night"): every query here is BOUNDED and keyed off
// the user's small set of followed events. No "fetch all games" — we read the
// live set + the soonest upcoming set per followed event, each capped. Realtime
// (not polling) drives status changes; this loader just re-runs on a ping.
// =============================================================================
import { supabase } from './supabase';

const LIVE_CAP = 12;      // live games across all followed events (top of feed)
const UPCOMING_CAP = 8;   // soonest upcoming games to consider for hype
const DEFAULT_WINDOW_H = 24;

// The events this user follows (+ teams they're rostered on, for RSVP/"my game"
// flagging). All three reads are tiny and indexed by user_id.
export async function getGamedayContext(userId) {
  if (!userId) return { tournamentIds: [], leagueIds: [], teamIds: [] };
  const [tourns, leagues, teams] = await Promise.all([
    supabase.from('tournament_subscriptions').select('tournament_id').eq('user_id', userId),
    supabase.from('league_subscriptions').select('league_id').eq('user_id', userId),
    supabase.from('team_members').select('team_id').eq('user_id', userId).eq('status', 'active'),
  ]);
  return {
    tournamentIds: (tourns.data || []).map((r) => r.tournament_id),
    leagueIds: (leagues.data || []).map((r) => r.league_id),
    teamIds: (teams.data || []).map((r) => r.team_id),
  };
}

// Normalize a row from either game table to one shape the strip renders.
function normTournamentGame(g) {
  return {
    id: g.id, source: 'tournament', status: g.status, startTime: g.start_time,
    homeScore: g.home_score, awayScore: g.away_score,
    home: { id: g.home_team_id, name: g.home_team?.team_name || 'Home', logoUrl: g.home_team?.logo_url || null, teamId: null },
    away: { id: g.away_team_id, name: g.away_team?.team_name || 'Away', logoUrl: g.away_team?.logo_url || null, teamId: null },
    eventId: g.tournament_id, eventName: g.tournament?.name || 'Tournament',
    gameUrl: `/game/${g.id}`,
  };
}
function normLeagueGame(g, teamIds) {
  const homeTeamId = g.home_lt?.team_id || null;
  const awayTeamId = g.away_lt?.team_id || null;
  return {
    id: g.id, source: 'league', status: g.status, startTime: g.start_time,
    homeScore: g.home_score, awayScore: g.away_score,
    home: { id: g.home_team_id, name: g.home_lt?.team?.name || g.home_lt?.team_name || 'Home', logoUrl: g.home_lt?.team?.logo_url || g.home_lt?.logo_url || null, teamId: homeTeamId },
    away: { id: g.away_team_id, name: g.away_lt?.team?.name || g.away_lt?.team_name || 'Away', logoUrl: g.away_lt?.team?.logo_url || g.away_lt?.logo_url || null, teamId: awayTeamId },
    eventId: g.league_id, eventName: g.league?.name || 'League',
    // League games open in the league-game detail view.
    gameUrl: `/league-game/${g.id}?type=league`,
    // "My game" → I'm rostered on one of the two teams. Drives the RSVP nudge.
    isMine: teamIds.includes(homeTeamId) || teamIds.includes(awayTeamId),
  };
}

const T_SELECT = 'id, status, start_time, home_score, away_score, tournament_id, home_team:tournament_teams!home_team_id(id,team_name,logo_url), away_team:tournament_teams!away_team_id(id,team_name,logo_url), tournament:tournaments(name)';
const L_SELECT = 'id, status, start_time, home_score, away_score, league_id, home_team_id, away_team_id, home_lt:league_teams!home_team_id(id,team_name,logo_color,logo_initials,logo_url,team_id,team:teams(id,name,logo_url)), away_lt:league_teams!away_team_id(id,team_name,logo_color,logo_initials,logo_url,team_id,team:teams(id,name,logo_url)), league:leagues(name)';

// The live + soonest-upcoming games across everything the user follows.
// Returns { live: [...normalized], upcoming: [...normalized] }, each capped.
export async function getGamedayGames(userId, { windowHours = DEFAULT_WINDOW_H, ctx } = {}) {
  const c = ctx || (await getGamedayContext(userId));
  const { tournamentIds, leagueIds, teamIds } = c;
  if (!tournamentIds.length && !leagueIds.length) return { live: [], upcoming: [] };

  const nowIso = new Date().toISOString();
  const windowIso = new Date(Date.now() + windowHours * 3600 * 1000).toISOString();
  const q = [];

  // Two cheap queries per source: live (any start_time) + upcoming-in-window.
  // Keeping them separate means a long-running live game is never dropped by a
  // start_time filter.
  if (tournamentIds.length) {
    q.push(supabase.from('games').select(T_SELECT).in('tournament_id', tournamentIds).eq('status', 'live').limit(LIVE_CAP).then((r) => ({ k: 'live', rows: (r.data || []).map(normTournamentGame) })));
    q.push(supabase.from('games').select(T_SELECT).in('tournament_id', tournamentIds).eq('status', 'scheduled').gte('start_time', nowIso).lte('start_time', windowIso).order('start_time').limit(UPCOMING_CAP).then((r) => ({ k: 'up', rows: (r.data || []).map(normTournamentGame) })));
  }
  if (leagueIds.length) {
    q.push(supabase.from('league_games').select(L_SELECT).in('league_id', leagueIds).eq('status', 'live').limit(LIVE_CAP).then((r) => ({ k: 'live', rows: (r.data || []).map((g) => normLeagueGame(g, teamIds)) })));
    q.push(supabase.from('league_games').select(L_SELECT).in('league_id', leagueIds).eq('status', 'scheduled').gte('start_time', nowIso).lte('start_time', windowIso).order('start_time').limit(UPCOMING_CAP).then((r) => ({ k: 'up', rows: (r.data || []).map((g) => normLeagueGame(g, teamIds)) })));
  }

  const parts = await Promise.all(q);
  const live = parts.filter((p) => p.k === 'live').flatMap((p) => p.rows);
  const upcoming = parts.filter((p) => p.k === 'up').flatMap((p) => p.rows)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  return { live: live.slice(0, LIVE_CAP), upcoming: upcoming.slice(0, UPCOMING_CAP) };
}

// Head-to-head record between two teams, scoped to the same event's finals
// (the only meaningful, queryable scope). Returns { homeWins, awayWins, ties,
// played } from the perspective of the passed home/away team ids.
export async function getHeadToHead(game) {
  if (!game) return null;
  const table = game.source === 'league' ? 'league_games' : 'games';
  const h = game.home.id, a = game.away.id;
  if (!h || !a) return null;
  const { data } = await supabase
    .from(table)
    .select('home_team_id, away_team_id, home_score, away_score')
    .eq('status', 'final')
    .or(`and(home_team_id.eq.${h},away_team_id.eq.${a}),and(home_team_id.eq.${a},away_team_id.eq.${h})`)
    .limit(50);
  if (!data || !data.length) return { homeWins: 0, awayWins: 0, ties: 0, played: 0 };
  let homeWins = 0, awayWins = 0, ties = 0;
  for (const g of data) {
    const hs = g.home_score ?? 0, as = g.away_score ?? 0;
    if (hs === as) { ties++; continue; }
    const winnerTeam = hs > as ? g.home_team_id : g.away_team_id;
    if (winnerTeam === h) homeWins++; else if (winnerTeam === a) awayWins++;
  }
  return { homeWins, awayWins, ties, played: data.length };
}
