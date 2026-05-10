import { supabase } from './supabase';

export async function getTeam(id) {
  const { data, error } = await supabase
    .from('teams')
    .select('*, manager:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listTeams({ search = '' } = {}) {
  let query = supabase.from('teams').select('*').eq('is_public', true).order('name');
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTeam({ name, division, level, location, home_rink, logo_color, logo_initials }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('teams')
    .insert({ name, division, level, location, home_rink, logo_color, logo_initials, manager_id: user.id })
    .select().single();
  if (error) throw error;
  // Auto-add manager as member
  await supabase.from('team_members').insert({ team_id: data.id, user_id: user.id, role: 'manager', status: 'active' });
  return data;
}

export async function updateTeam(id, updates) {
  const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getTeamMembers(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('*, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('team_id', teamId)
    .in('status', ['active', 'pending'])
    .order('role')
    .order('jersey_number');
  if (error) throw error;
  return data || [];
}

export async function getTeamGames(teamId) {
  // Get regular team games
  const { data: teamGames, error } = await supabase
    .from('team_games')
    .select('*')
    .eq('team_id', teamId)
    .order('start_time', { ascending: false });
  if (error) throw error;

  // Get league_teams rows for this team
  const { data: leagueTeamRows } = await supabase
    .from('league_teams')
    .select('id, league_id, league:leagues(id, name)')
    .eq('team_id', teamId);

  if (!leagueTeamRows || leagueTeamRows.length === 0) {
    return (teamGames || []).map(g => ({ ...g, _source: 'team' }));
  }

  const ltIds = leagueTeamRows.map(lt => lt.id);

  // Get league games where this team is home or away
  const { data: homeGames } = await supabase
    .from('league_games')
    .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), rink:rinks(name,sub_rink,live_barn_venue_id)')
    .in('home_team_id', ltIds);

  const { data: awayGames } = await supabase
    .from('league_games')
    .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), rink:rinks(name,sub_rink,live_barn_venue_id)')
    .in('away_team_id', ltIds);

  // Normalize league games to match team_games shape
  const normalizeLeagueGame = (g) => {
    const lt = leagueTeamRows.find(lt => lt.id === g.home_team_id || lt.id === g.away_team_id);
    const isHome = ltIds.includes(g.home_team_id);
    const oppLt = isHome ? g.away_lt : g.home_lt;
    const opponent = oppLt?.team?.name || oppLt?.team_name || 'Unknown';
    return {
      ...g,
      _source: 'league',
      _league_name: lt?.league?.name,
      _league_id: lt?.league?.id,
      is_home: isHome,
      opponent,
      location: g.rink ? `${g.rink.sub_rink || ''} · ${g.rink.name}` : g.location,
      home_score: g.home_score,
      away_score: g.away_score,
    };
  };

  const allLeagueGames = [
    ...(homeGames || []).map(normalizeLeagueGame),
    ...(awayGames || []).map(normalizeLeagueGame),
  ];

  // Deduplicate (a game could appear in both home and away if same team plays itself)
  const seen = new Set();
  const deduped = allLeagueGames.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });

  // Merge and sort by start_time descending
  const all = [
    ...(teamGames || []).map(g => ({ ...g, _source: 'team' })),
    ...deduped,
  ].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

  return all;
}

export async function addTeamMember({ team_id, user_id, role, jersey_number, position, shot_hand, invite_email, invite_name }) {
  const status = user_id ? 'active' : 'pending';
  const { data, error } = await supabase.from('team_members')
    .insert({ team_id, user_id: user_id || null, role, jersey_number, position, shot_hand, invite_email, invite_name, status })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateTeamMember(id, updates) {
  const { data, error } = await supabase.from('team_members').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function removeTeamMember(id) {
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  if (error) throw error;
}

export async function addTeamGame({ team_id, opponent, is_home, location, start_time, notes }) {
  const { data, error } = await supabase.from('team_games')
    .insert({ team_id, opponent, is_home, location, start_time, notes, status: 'scheduled' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateTeamGame(id, updates) {
  const { data, error } = await supabase.from('team_games').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function requestToJoin(teamId, message = '') {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('team_join_requests')
    .insert({ team_id: teamId, user_id: user.id, message })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getJoinRequests(teamId) {
  const { data, error } = await supabase
    .from('team_join_requests')
    .select('*, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function approveJoinRequest(requestId, { team_id, user_id, role = 'player', jersey_number, position }) {
  await supabase.from('team_join_requests').update({ status: 'approved' }).eq('id', requestId);
  return addTeamMember({ team_id, user_id, role, jersey_number, position });
}

export async function denyJoinRequest(requestId) {
  const { error } = await supabase.from('team_join_requests').update({ status: 'denied' }).eq('id', requestId);
  if (error) throw error;
}

export async function getUserTeams(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('*, team:teams(*)')
    .eq('user_id', userId)
    .in('status', ['active', 'pending']);
  if (error) throw error;
  return data || [];
}

export async function getUserRoleOnTeam(teamId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('team_members')
    .select('role, is_captain, is_alternate')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .single();
  return data ?? null;
}
