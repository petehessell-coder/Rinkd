import { supabase } from './supabase';

export async function listLeagues({ search = '' } = {}) {
  // TODO: paginate — cap to avoid pulling the entire leagues table once the
  // directory grows. The search box lets users find anything beyond the cap.
  let q = supabase.from('leagues').select('*').eq('is_public', true).order('name').limit(50);
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

export async function createLeague({
  name, division, level, location, season,
  logo_color, logo_initials, logo_url, accent_color,
  start_date, end_date, venue_name, venue_address,
  settings,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Your session expired — please sign in again.');
  // Null out empty-string date fields so Postgres doesn't reject them.
  const nz = v => (typeof v === 'string' && v.trim() === '' ? null : v);
  const { data, error } = await supabase.from('leagues')
    .insert({
      name,
      division: nz(division),
      level: nz(level),
      location: nz(location),
      season: nz(season),
      logo_color,
      logo_initials: nz(logo_initials),
      logo_url: nz(logo_url),
      accent_color: nz(accent_color),
      start_date: nz(start_date),
      end_date: nz(end_date),
      venue_name: nz(venue_name),
      venue_address: nz(venue_address),
      settings,
      commissioner_id: user.id,
    })
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
      home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id, name, logo_color, logo_initials)),
      away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id, name, logo_color, logo_initials)),
      rink:rinks(id, name, sub_rink, live_barn_venue_id)
    `)
    .eq('league_id', leagueId)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addLeagueGame({ league_id, home_team_id, away_team_id, rink_id, location, start_time, live_barn_venue_id }) {
  const { data, error } = await supabase.from('league_games')
    .insert({ league_id, home_team_id, away_team_id, rink_id, location, start_time, live_barn_venue_id: live_barn_venue_id || null, status: 'scheduled' })
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

/**
 * Returns the highest role the current user has on this league.
 *
 *   'commissioner' — founding commissioner OR has league_roles.role = 'commissioner'
 *   'scorer'       — has league_roles.role = 'scorer'
 *   'viewer'       — signed in but no role on this league
 *   null           — not signed in
 *
 * Multi-commissioner support shipped Phase 1: any caller that previously
 * compared `league.commissioner_id === currentUser.id` synchronously
 * should still work for the founder, but should ALSO honor an async
 * isExtraCommissioner check (or call this function) so additional
 * commissioners get the same access. See src/lib/leagueCommissioners.js.
 */
export async function getUserLeagueRole(leagueId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: lg } = await supabase.from('leagues').select('commissioner_id').eq('id', leagueId).single();
  if (!lg) return null;
  if (lg.commissioner_id === user.id) return 'commissioner';

  const { data: role } = await supabase
    .from('league_roles')
    .select('role')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (role?.role === 'commissioner') return 'commissioner';
  if (role?.role === 'scorer') return 'scorer';
  return 'viewer';
}
