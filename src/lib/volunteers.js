import { supabase } from './supabase';

/**
 * Volunteer slots = "this team game needs a Scorekeeper / Snack Parent / Gear
 * Hauler" etc. A slot is tied to a team and (optionally) a specific game.
 * Players claim a slot to sign up; manager can hand-assign instead.
 */

const PROFILE_SELECT = 'profile:profiles(id, name, handle, avatar_color, avatar_initials)';

// ── Reads ─────────────────────────────────────────────────────────────────────

/** All open + assigned slots for a single team, ordered by slot_time asc. */
export async function listTeamSlots(teamId) {
  const { data, error } = await supabase
    .from('volunteer_slots')
    .select(`*, assigned:${PROFILE_SELECT}`.replace('profile:', 'assigned_user_id:'))
    .eq('team_id', teamId)
    .order('slot_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

/** Slots across multiple teams (manager's portfolio view). */
export async function listSlotsForTeams(teamIds) {
  if (!teamIds || teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from('volunteer_slots')
    .select('*, team:teams(id, name, logo_color, logo_initials), assigned_user:profiles!assigned_user_id(id, name, handle, avatar_color, avatar_initials)')
    .in('team_id', teamIds)
    .order('slot_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

/** Slots a specific user is signed up for. */
export async function listMyAssignedSlots(userId) {
  const { data, error } = await supabase
    .from('volunteer_slots')
    .select('*, team:teams(id, name, logo_color, logo_initials)')
    .eq('assigned_user_id', userId)
    .order('slot_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createSlot({ team_id, game_id, game_source, role, notes, slot_time }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required.');
  if (!team_id) throw new Error('team_id required.');
  if (!role || !role.trim()) throw new Error('Role is required.');
  const row = {
    team_id,
    game_id: game_id || null,
    game_source: game_source || null,
    role: role.trim(),
    notes: notes ? notes.trim() : null,
    slot_time: slot_time || null,
    created_by: user.id,
  };
  const { data, error } = await supabase.from('volunteer_slots').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateSlot(id, patch) {
  const allowed = ['role', 'notes', 'slot_time', 'game_id', 'game_source', 'assigned_user_id', 'assigned_at'];
  const updates = {};
  for (const k of allowed) if (patch[k] !== undefined) updates[k] = patch[k];
  const { data, error } = await supabase.from('volunteer_slots').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSlot(id) {
  const { error } = await supabase.from('volunteer_slots').delete().eq('id', id);
  if (error) throw error;
}

/** Player signs themselves up for an open slot. */
export async function claimSlot(id) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required.');
  return updateSlot(id, { assigned_user_id: user.id, assigned_at: new Date().toISOString() });
}

/** Player or manager unclaims a slot, opening it back up. */
export async function releaseSlot(id) {
  return updateSlot(id, { assigned_user_id: null, assigned_at: null });
}
