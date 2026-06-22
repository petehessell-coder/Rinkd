import { supabase } from './supabase';

/**
 * League scorer assignment — direct port of `tournamentScorers.js`.
 *
 * The 'scorer' role exists in the `league_roles` CHECK constraint and is
 * recognized by the league_games_update RLS policy — this module wires the
 * UI to it.
 *
 * Pilot model (Option A): a scorer must have a Rinkd account to be assigned.
 *   - handle/email resolves to an account  → 'scorer' role granted immediately
 *   - email with no account                → "join Rinkd" invite is emailed;
 *                                             commissioner adds them once they sign up
 *   - handle with no account                → can't invite (no address) — caller
 *                                             surfaces a "have them sign up" message
 *
 * The full pending-invite-auto-link flow (Option B) would need invite
 * columns on league_roles; deliberately out of scope for Phase 1.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resolve "@handle", "handle", or "name@example.com" to a profile row, or null. */
export async function resolveProfile(rawInput) {
  const s = (rawInput || '').trim();
  if (!s) return null;
  // YOUTH-PRIVACY: profiles.email is column-revoked from the client. Resolve an
  // email via the SECURITY DEFINER RPC (identity only); handles via a granted
  // column select. Both return { id, name, handle }.
  if (EMAIL_RE.test(s)) {
    const { data, error } = await supabase.rpc('find_account_by_email', { p_email: s.toLowerCase() });
    if (error) return null;
    return (data && data[0]) || null;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle')
    .ilike('handle', s.replace(/^@/, '')) // exact value, no wildcards → case-insensitive exact match
    .limit(1);
  if (error) return null;
  return (data && data[0]) || null;
}

/**
 * Add a scorer to a league by handle/email — optionally with a fallback
 * email when the input is a handle that doesn't resolve. Returns one of:
 *   { status: 'added',     profile }              — account found, 'scorer' role granted
 *   { status: 'already',   profile, role }        — already has a role on this league
 *   { status: 'invited',   email }                — no account; sign-up invite emailed
 *   { status: 'needs_email', handle }             — handle didn't resolve, no fallback email given
 *   { status: 'error',     message }              — bad input or send failure
 */
export async function addScorerByInput({ leagueId, leagueName, input, invitedBy, fallbackEmail }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };

  const profile = await resolveProfile(raw);

  if (profile) {
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
      .insert({ league_id: leagueId, user_id: profile.id, role: 'scorer' });
    if (error) return { status: 'error', message: error.message };
    return { status: 'added', profile };
  }

  // No account. Send an invite if we have an email — either the raw input
  // was an email, or the commissioner supplied a fallback email for a
  // handle that didn't resolve.
  let toEmail = null;
  if (EMAIL_RE.test(raw)) {
    toEmail = raw.toLowerCase();
  } else if (fallbackEmail && EMAIL_RE.test(fallbackEmail.trim())) {
    toEmail = fallbackEmail.trim().toLowerCase();
  } else {
    return { status: 'needs_email', handle: raw.replace(/^@/, '') };
  }

  const { error } = await supabase.functions.invoke('send-invite', {
    body: {
      type: 'league_scorer_invite',
      to_email: toEmail,
      league_name: leagueName || null,
      league_id: leagueId,
      invited_by: invitedBy || null,
    },
  });
  if (error) {
    return { status: 'error', message: 'Could not send the invite email — try again, or have them sign up directly.' };
  }
  return { status: 'invited', email: toEmail };
}

/** List the scorers on a league, joined to their profile. */
export async function listScorers(leagueId) {
  const { data, error } = await supabase
    .from('league_roles')
    .select('id, role, user_id, created_at, profile:profiles!league_roles_user_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq('league_id', leagueId)
    .eq('role', 'scorer')
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

/** Remove a scorer by their league_roles row id. */
export async function removeScorer(roleId) {
  const { error } = await supabase.from('league_roles').delete().eq('id', roleId);
  return { error };
}
