import { supabase } from './supabase';
import { resolveProfile } from './leagueScorers';

/**
 * Multi-commissioner support for leagues — direct port of
 * `tournamentDirectors.js` shipped May 18. See handoff §9 entry
 * "Multi-director permission model" for the canonical pattern.
 *
 * Every league has one canonical `leagues.commissioner_id` (the founding
 * commissioner) — that record is immutable. Additional commissioners are
 * stored in `league_roles` with role='commissioner' and can be added or
 * removed by any existing commissioner via the management UI.
 *
 * Permission checks should ALWAYS use isExtraCommissioner() (or the
 * server-side RPC `is_league_commissioner(p_league_id, p_user_id)`) in
 * addition to the legacy `league.commissioner_id === currentUser.id`
 * synchronous check. Both paths converge to the same answer; the legacy
 * field is the fast path for the founder (no DB round-trip).
 *
 * The DB function `is_league_commissioner` is the authoritative source of
 * truth (used in league_roles + league_games + leagues RLS). Keep this lib
 * in sync with it.
 */

/** Boolean: does this user have role='commissioner' in league_roles for this league? */
export async function isExtraCommissioner(userId, leagueId) {
  if (!userId || !leagueId) return false;
  const { data, error } = await supabase
    .from('league_roles')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .eq('role', 'commissioner')
    .limit(1);
  if (error) return false;
  return !!(data && data.length);
}

/** List all commissioners for this league — joined to profile for rendering. */
export async function listCommissioners(leagueId) {
  const { data, error } = await supabase
    .from('league_roles')
    .select('id, role, user_id, created_at, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('league_id', leagueId)
    .eq('role', 'commissioner')
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

/**
 * Add a commissioner by handle/email. Unlike scorers, commissioners must
 * already have a Rinkd account — no email-invite path. Commissioners have
 * powerful permissions; we don't want to email out role grants to
 * potentially-wrong addresses.
 *
 * Returns one of:
 *   { status: 'added',     profile }              — account found, 'commissioner' role granted
 *   { status: 'already',   profile, role }        — already has a role on this league
 *   { status: 'no_account', input }               — no Rinkd account for that handle/email
 *   { status: 'error',     message }              — bad input or DB rejection
 */
export async function addCommissionerByInput({ leagueId, input }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };

  const profile = await resolveProfile(raw);
  if (!profile) {
    return { status: 'no_account', input: raw };
  }

  // Already has any role (commissioner/scorer/viewer) on this league?
  const { data: existing } = await supabase
    .from('league_roles')
    .select('id, role')
    .eq('league_id', leagueId)
    .eq('user_id', profile.id)
    .limit(1);
  if (existing && existing.length) {
    return { status: 'already', profile, role: existing[0].role };
  }

  const { error } = await supabase
    .from('league_roles')
    .insert({ league_id: leagueId, user_id: profile.id, role: 'commissioner' });
  if (error) return { status: 'error', message: error.message };
  return { status: 'added', profile };
}

/**
 * Remove a commissioner by their league_roles row id. RLS protects the
 * founding commissioner (their row matching leagues.commissioner_id) from
 * being deleted — the delete will silently no-op there. Always call
 * listCommissioners after to verify intent.
 */
export async function removeCommissioner(roleId) {
  const { error } = await supabase.from('league_roles').delete().eq('id', roleId);
  return { error };
}
