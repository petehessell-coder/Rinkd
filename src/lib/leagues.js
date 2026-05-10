import { supabase } from './supabase';

export async function listLeagues({ search = '' } = {}) {
  let q = supabase.from('leagues').select('*').eq('is_public', true).order('name');
  if (search) q = q.ilike('name', `%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getLeague(id) {
  const { data, error } = await supabase
    .from('leagues')
    .select('*, commissioner:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createLeague({ name, division, level, location, season, logo_color, logo_initials, settings }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('leagues')
    .insert({ name, division, level, location, season, logo_color, logo_initials, settings, commissioner_id: user.id })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateLeague(id, updates) {
  const { data, error } = await supabase.from('leagues').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getLeagueTeams(leagueId) {
  const { data, error } = await supabase
    .from('league_teams')
    .select('*, team_name, logo_color, logo_initials, team:teams(id, name, logo_color, logo_initials, home_rink, location)')
    .eq('league_id', leagueId)
    .order('joined_at');
  if (error) throw error;
  return data || [];
}

export async function addLeagueTeam(leagueId, { teamId = null, teamName, logoColor, logoInitials, division = '' }) {
  const { data, error } = await supabase.from('league_teams')
    .insert({ league_id: leagueId, team_id: teamId || null, team_name: teamName, logo_color: logoColor, logo_initials: logoInitials, division })
    .select().single();
  if (error) throw error;
  return data;
}

export async function linkLeagueTeam(leagueTeamId, teamId) {
  const { data, error } = await supabase.from('league_teams')
    .update({ team_id: teamId })
    .eq('id', leagueTeamId)
    .select().single();
  if (error) throw error;
  return data;
}

export async function removeLeagueTeam(id) {
  const { error } = await supabase.from('league_teams').delete().eq('id', id);
  if (error) throw error;
}

export async function getLeagueGames(leagueId) {
  const { data, error } = await supabase
    .from('league_games')
    .select(`*,
      home_lt:league_teams!home_team_id(id, team:teams(id, name, logo_color, logo_initials)),
      away_lt:league_teams!away_team_id(id, team:teams(id, name, logo_color, logo_initials)),
      rink:rinks(id, name, sub_rink, live_barn_venue_id)
    `)
    .eq('league_id', leagueId)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addLeagueGame({ league_id, home_team_id, away_team_id, rink_id, location, start_time }) {
  const { data, error } = await supabase.from('league_games')
    .insert({ league_id, home_team_id, away_team_id, rink_id, location, start_time, status: 'scheduled' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateLeagueGame(id, updates) {
  const { data, error } = await supabase.from('league_games').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getLeagueStandings(leagueId) {
  const { data, error } = await supabase
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getUserLeagueRole(leagueId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('leagues').select('commissioner_id').eq('id', leagueId).single();
  if (!data) return null;
  return data.commissioner_id === user.id ? 'commissioner' : 'viewer';
}
