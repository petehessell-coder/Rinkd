import { supabase } from './supabase';
import { resolveProfile } from './tournamentScorers';

/**
 * Multi-director support.
 *
 * Every tournament has one canonical `tournaments.director_id` (the original
 * creator) — that record is immutable. Additional directors are stored in
 * `tournament_roles` with role='director' and can be added or removed by any
 * existing director via the management UI.
 *
 * Permission checks should ALWAYS use isExtraDirector() (or the server-side
 * RPC `is_tournament_director(p_tournament_id, p_user_id)`) in addition to
 * the legacy `tournament.director_id === currentUser.id` synchronous check.
 * Both paths converge to the same "is this user a director" answer; the
 * legacy field is the fast path for the original creator (no DB round-trip).
 *
 * The DB function `is_tournament_director` is the authoritative source of
 * truth (used in tournament_roles RLS). Keep this lib in sync with it.
 */

/** Boolean: does this user have role='director' in tournament_roles for this tournament? */
export async function isExtraDirector(userId, tournamentId) {
  if (!userId || !tournamentId) return false;
  const { data, error } = await supabase
    .from('tournament_roles')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .eq('role', 'director')
    .limit(1);
  if (error) return false;
  return !!(data && data.length);
}

/** List all directors for this tournament — joined to profile for rendering. */
export async function listDirectors(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_roles')
    .select('id, role, user_id, created_at, profile:profiles!tournament_roles_user_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq('tournament_id', tournamentId)
    .eq('role', 'director')
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

/**
 * Add a director by handle/email. Unlike scorers, directors must already
 * have a Rinkd account — no email-invite path. Directors have powerful
 * permissions; we don't want to email out role grants to potentially-wrong
 * addresses.
 *
 * Returns one of:
 *   { status: 'added',     profile }              — account found, 'director' role granted
 *   { status: 'already',   profile, role }        — already has a role on this tournament
 *   { status: 'no_account', input }               — no Rinkd account for that handle/email
 *   { status: 'error',     message }              — bad input or DB rejection
 */
export async function addDirectorByInput({ tournamentId, input }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };

  const profile = await resolveProfile(raw);
  if (!profile) {
    return { status: 'no_account', input: raw };
  }

  // Already has any role (director/scorer/viewer) on this tournament?
  const { data: existing } = await supabase
    .from('tournament_roles')
    .select('id, role')
    .eq('tournament_id', tournamentId)
    .eq('user_id', profile.id)
    .limit(1);
  if (existing && existing.length) {
    return { status: 'already', profile, role: existing[0].role };
  }

  const { error } = await supabase
    .from('tournament_roles')
    .insert({ tournament_id: tournamentId, user_id: profile.id, role: 'director' });
  if (error) return { status: 'error', message: error.message };
  return { status: 'added', profile };
}

/**
 * Remove a director by their tournament_roles row id. RLS protects the
 * original director (their row matching tournaments.director_id) from being
 * deleted — the delete will silently no-op there. Always check the affected
 * row count or call listDirectors after to verify intent.
 */
export async function removeDirector(roleId) {
  const { error } = await supabase.from('tournament_roles').delete().eq('id', roleId);
  return { error };
}
