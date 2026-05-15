import { supabase } from './supabase';

/**
 * Tournament scorer assignment.
 *
 * The 'scorer' role already exists in the tournament_roles CHECK constraint and
 * is recognized by the games_scorer_update RLS policy — this module just wires
 * the UI to it.
 *
 * Pilot model (Option A): a scorer must have a Rinkd account to be assigned.
 *   - handle/email resolves to an account  → 'scorer' role granted immediately
 *   - email with no account                → a "join Rinkd" invite is emailed;
 *                                             the director adds them once they sign up
 *   - handle with no account                → can't invite (no address) — caller
 *                                             surfaces a "have them sign up" message
 *
 * The full pending-invite-auto-link flow (Option B) would need invite columns on
 * tournament_roles; deliberately out of scope for the pilot.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resolve "@handle", "handle", or "name@example.com" to a profile row, or null. */
export async function resolveProfile(rawInput) {
  const s = (rawInput || '').trim();
  if (!s) return null;
  const isEmail = EMAIL_RE.test(s);
  const column = isEmail ? 'email' : 'handle';
  const value = isEmail ? s.toLowerCase() : s.replace(/^@/, '');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, email')
    .ilike(column, value) // exact value, no wildcards → case-insensitive exact match
    .limit(1);
  if (error) return null;
  return (data && data[0]) || null;
}

/**
 * Add a scorer to a tournament by handle/email — optionally with a fallback
 * email when the input is a handle that doesn't resolve. Returns one of:
 *   { status: 'added',     profile }              — account found, 'scorer' role granted
 *   { status: 'already',   profile, role }        — already has a role on this tournament
 *   { status: 'invited',   email }                — no account; sign-up invite emailed
 *   { status: 'needs_email', handle }             — handle didn't resolve, no fallback email given
 *   { status: 'error',     message }              — bad input or send failure
 */
export async function addScorerByInput({ tournamentId, tournamentName, input, invitedBy, fallbackEmail }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };

  const profile = await resolveProfile(raw);

  if (profile) {
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
      .insert({ tournament_id: tournamentId, user_id: profile.id, role: 'scorer' });
    if (error) return { status: 'error', message: error.message };
    return { status: 'added', profile };
  }

  // No account. Send an invite if we have an email — either the raw input
  // was an email, or the director supplied a fallback email for a handle
  // that didn't resolve.
  let toEmail = null;
  if (EMAIL_RE.test(raw)) {
    toEmail = raw.toLowerCase();
  } else if (fallbackEmail && EMAIL_RE.test(fallbackEmail.trim())) {
    toEmail = fallbackEmail.trim().toLowerCase();
  } else {
    // Tell the UI to prompt the director for an email instead of just refusing.
    return { status: 'needs_email', handle: raw.replace(/^@/, '') };
  }

  const { error } = await supabase.functions.invoke('send-invite', {
    body: {
      type: 'tournament_scorer_invite',
      to_email: toEmail,
      tournament_name: tournamentName || null,
      tournament_id: tournamentId,
      invited_by: invitedBy || null,
    },
  });
  if (error) {
    return { status: 'error', message: 'Could not send the invite email — try again, or have them sign up directly.' };
  }
  return { status: 'invited', email: toEmail };
}

/** List the scorers on a tournament, joined to their profile. */
export async function listScorers(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_roles')
    .select('id, role, user_id, created_at, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('tournament_id', tournamentId)
    .eq('role', 'scorer')
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

/** Remove a scorer by their tournament_roles row id. */
export async function removeScorer(roleId) {
  const { error } = await supabase.from('tournament_roles').delete().eq('id', roleId);
  return { error };
}
