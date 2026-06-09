// LEAGUE-MGR-1 — commissioner-side helpers to grant LEAGUE-level management.
//
// Mirrors leagueTeamManagers.js (team scope) one level up, at the league. A
// league "manager" is operational staff: runs teams/schedule/divisions/playoffs,
// approves roster join-requests, moderates the league feed/gallery — but CANNOT
// change settings/branding/billing, (de)activate, delete the league, or manage
// staff. All gating is server-side (RLS + SECURITY DEFINER RPCs).
//
// Two paths:
//   1. assignLeagueManagerByInput — target already has a Rinkd account.
//      resolveProfile() -> assign_league_manager RPC. Grants the role on the spot.
//   2. inviteLeagueManagerByEmail — target has no account yet.
//      create_league_manager_invite RPC -> token -> send-league-manager-invite
//      Edge Function emails a magic link. When the invitee signs up + opens the
//      link, accept_league_manager_invite consumes the token (email-match) and
//      grants the role.

import { supabase } from './supabase';
import { resolveProfile } from './leagueScorers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Assign immediately if the input resolves to an existing Rinkd account; else,
 * if it's an email (or a fallback email is given for an unresolved handle), send
 * a magic-link invite.
 *
 * Returns one of:
 *   { status: 'assigned',    profile }   — manager role granted
 *   { status: 'invited',     email }     — magic-link email sent
 *   { status: 'needs_email', handle }    — handle didn't resolve + no fallback email
 *   { status: 'error',       message }   — bad input or DB/email error
 */
export async function assignLeagueManagerByInput({ leagueId, input, leagueName, invitedBy, fallbackEmail }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };
  if (!leagueId) return { status: 'error', message: 'Missing league.' };

  const profile = await resolveProfile(raw);
  if (profile) {
    const { error } = await supabase.rpc('assign_league_manager', {
      p_league_id: leagueId,
      p_user_id: profile.id,
    });
    if (error) return { status: 'error', message: error.message };
    return { status: 'assigned', profile };
  }

  let toEmail = null;
  if (EMAIL_RE.test(raw)) {
    toEmail = raw.toLowerCase();
  } else if (fallbackEmail && EMAIL_RE.test(fallbackEmail.trim())) {
    toEmail = fallbackEmail.trim().toLowerCase();
  } else {
    return { status: 'needs_email', handle: raw.replace(/^@/, '') };
  }
  return inviteLeagueManagerByEmail({ leagueId, email: toEmail, leagueName, invitedBy });
}

/** Always-create-invite path (e.g. a dedicated "Invite by email" action). */
export async function inviteLeagueManagerByEmail({ leagueId, email, leagueName, invitedBy }) {
  const e = (email || '').trim().toLowerCase();
  if (!e || !EMAIL_RE.test(e)) return { status: 'error', message: 'Valid email required.' };

  const { data, error: rpcErr } = await supabase.rpc('create_league_manager_invite', {
    p_league_id: leagueId,
    p_email: e,
  });
  if (rpcErr) return { status: 'error', message: rpcErr.message };
  const row = Array.isArray(data) ? data[0] : data;
  const token = row?.token;
  if (!token) return { status: 'error', message: 'Could not create invite.' };

  const { error: sendErr } = await supabase.functions.invoke('send-league-manager-invite', {
    body: { to_email: e, league_name: leagueName || null, invited_by: invitedBy || null, accept_token: token },
  });
  if (sendErr) {
    return { status: 'error', message: 'Could not send the invite email — try again, or have them sign up directly.' };
  }
  return { status: 'invited', email: e };
}

/** Called from the AcceptLeagueInvite page after the recipient is signed in. */
export async function acceptLeagueManagerInvite(token) {
  const { data, error } = await supabase.rpc('accept_league_manager_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { leagueId: row?.league_id };
}

/** Staff list for the commissioner Staff UI: { managers: [...], pending_invites: [...] }. */
export async function listLeagueStaff(leagueId) {
  const { data, error } = await supabase.rpc('list_league_staff', { p_league_id: leagueId });
  if (error) throw error;
  return data || { managers: [], pending_invites: [] };
}

export async function removeLeagueManager(leagueId, userId) {
  const { error } = await supabase.rpc('remove_league_manager', { p_league_id: leagueId, p_user_id: userId });
  if (error) throw error;
}

export async function revokeLeagueManagerInvite(inviteId) {
  const { error } = await supabase.rpc('revoke_league_manager_invite', { p_invite_id: inviteId });
  if (error) throw error;
}
