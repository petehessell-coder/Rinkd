import { supabase } from './supabase';

const LIVEBARN_BASE = 'https://watch.livebarn.com/en/videoplayer';
const LIVEBARN_PROMO = 'RINKD10';

export async function getTournament(id) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getStandings(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_standings')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('pool', { ascending: true })
    .order('pool_rank', { ascending: true });
  if (error) return {};
  return data.reduce((acc, row) => {
    if (!acc[row.pool]) acc[row.pool] = [];
    acc[row.pool].push(row);
    return acc;
  }, {});
}

export async function getGames(tournamentId) {
  const { data, error } = await supabase
    .from('games')
    .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,logo_url), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
    .eq('tournament_id', tournamentId)
    .order('start_time', { ascending: true });
  if (error) return [];
  return data;
}

export function subscribeToGames(tournamentId, onUpdate) {
  const channel = supabase
    .channel('tournament-games-' + tournamentId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: 'tournament_id=eq.' + tournamentId }, (payload) => onUpdate(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function getLiveBarnUrl(venueId) {
  if (!venueId) return null;
  return LIVEBARN_BASE + '?venueid=' + venueId + '&referrer=rinkd&promo=' + LIVEBARN_PROMO;
}

export async function getUserRole(tournamentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'viewer';
  const { data } = await supabase
    .from('tournament_roles')
    .select('role')
    .eq('tournament_id', tournamentId)
    .eq('user_id', user.id)
    .single();
  return data?.role ?? 'viewer';
}
