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
    .eq('status', 'active')
    .order('role')
    .order('jersey_number');
  if (error) throw error;
  return data || [];
}

export async function getTeamGames(teamId) {
  const { data, error } = await supabase
    .from('team_games')
    .select('*')
    .eq('team_id', teamId)
    .order('start_time', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addTeamMember({ team_id, user_id, role, jersey_number, position, shot_hand }) {
  const { data, error } = await supabase.from('team_members')
    .insert({ team_id, user_id, role, jersey_number, position, shot_hand, status: 'active' })
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
    .eq('status', 'active');
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
