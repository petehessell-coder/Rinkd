import { supabase } from './supabase';
import { resolveProfile } from './tournamentScorers';

/**
 * Multi-manager support for teams. Mirrors src/lib/tournamentDirectors.js.
 *
 * Every team has one canonical `teams.manager_id` (the founding manager) —
 * that record is immutable. Additional managers are stored in
 * `team_members` with role='manager' and can be added or removed by any
 * existing manager via the team management UI.
 *
 * Permission checks should use the server-side RPC
 * `is_team_manager(p_team_id, p_user_id)` in RLS, and the existing
 * `getUserRoleOnTeam(teamId)` lib helper client-side (it already returns
 * 'manager' for any team_members row with that role — both for the founder
 * and for additional managers — because createTeam inserts a row for the
 * founder at creation time).
 *
 * Founder protection: RLS forbids deletion of the team_members row where
 * `user_id = teams.manager_id` AND `role = 'manager'`. Even when called
 * from this lib, removeTeamManager() silently no-ops on the founder.
 */

/** List all managers for this team — joined to profile for rendering. */
export async function listTeamManagers(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, role, user_id, joined_at, invite_name, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('team_id', teamId)
    .eq('role', 'manager')
    .order('joined_at', { ascending: true });
  return { data: data || [], error };
}

/**
 * Add a manager by handle or email. Unlike player roster invites, managers
 * must already have a Rinkd account — managers can edit settings, remove
 * players, and add/remove other managers, so we don't email-invite role
 * grants to potentially-wrong addresses.
 *
 * Returns:
 *   { status: 'added',      profile }                — granted manager role
 *   { status: 'promoted',   profile, previousRole }  — already on the team, promoted to manager
 *   { status: 'no_account', input }                  — no Rinkd account for that handle/email
 *   { status: 'error',      message }                — bad input / DB rejection
 */
export async function addTeamManagerByInput({ teamId, input }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };

  const profile = await resolveProfile(raw);
  if (!profile) {
    return { status: 'no_account', input: raw };
  }

  // Already on the team? Promote the existing row instead of adding a duplicate.
  const { data: existing } = await supabase
    .from('team_members')
    .select('id, role')
    .eq('team_id', teamId)
    .eq('user_id', profile.id)
    .limit(1);

  if (existing && existing.length) {
    if (existing[0].role === 'manager') {
      return { status: 'promoted', profile, previousRole: 'manager' };
    }
    const { error } = await supabase
      .from('team_members')
      .update({ role: 'manager' })
      .eq('id', existing[0].id);
    if (error) return { status: 'error', message: error.message };
    return { status: 'promoted', profile, previousRole: existing[0].role };
  }

  // Not on the team yet — add as manager (active status).
  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: profile.id, role: 'manager', status: 'active' });
  if (error) return { status: 'error', message: error.message };
  return { status: 'added', profile };
}

/**
 * Demote a manager back to a regular player. Use this instead of delete
 * when you want them to remain on the roster. RLS will silently no-op
 * for the founder's row.
 */
export async function demoteTeamManager(teamMemberId) {
  const { error } = await supabase
    .from('team_members')
    .update({ role: 'player' })
    .eq('id', teamMemberId);
  return { error };
}

/**
 * Remove a manager from the team entirely. RLS silently no-ops on the
 * founder's row, so it's safe to call. Caller should refresh the manager
 * list after to confirm.
 */
export async function removeTeamManager(teamMemberId) {
  const { error } = await supabase.from('team_members').delete().eq('id', teamMemberId);
  return { error };
}
