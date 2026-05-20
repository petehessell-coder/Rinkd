// Commissioner-side helpers: grant management of a league's team to a user.
//
// Two paths:
//   1. assignTeamManagerByInput — target already has a Rinkd account.
//      Calls assign_league_team_manager RPC directly. Grants role on
//      the spot.
//   2. inviteTeamManagerByEmail — target doesn't have an account yet.
//      Calls create_team_manager_invite RPC, gets a token, hands it
//      off to send-invite Edge Function which emails a magic link.
//      When the invitee signs up + opens the link, accept_team_manager_invite
//      consumes the token and grants the role.
//
// Both RPCs are SECURITY DEFINER + gated on is_league_commissioner +
// a team-in-this-league check on the server.

import { supabase } from './supabase';
import { resolveProfile } from './leagueScorers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Try to assign management immediately if the input resolves to an existing
 * Rinkd account. If not, and the input is an email, send a magic-link invite
 * via the send-invite Edge Function.
 *
 * Returns one of:
 *   { status: 'assigned',   profile }                  — manager role granted
 *   { status: 'invited',    email }                    — magic-link email sent
 *   { status: 'needs_email', handle }                  — handle didn't resolve + no fallback email
 *   { status: 'error',      message }                  — bad input or DB/email error
 */
export async function assignTeamManagerByInput({ leagueId, teamId, input, leagueName, teamName, invitedBy, fallbackEmail }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };
  if (!leagueId || !teamId) return { status: 'error', message: 'Missing league or team.' };

  const profile = await resolveProfile(raw);
  if (profile) {
    const { error } = await supabase.rpc('assign_league_team_manager', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_user_id: profile.id,
    });
    if (error) return { status: 'error', message: error.message };
    return { status: 'assigned', profile };
  }

  // No account. If the raw input is an email, or a fallback email was
  // supplied for a handle that didn't resolve, send a magic-link invite.
  let toEmail = null;
  if (EMAIL_RE.test(raw)) {
    toEmail = raw.toLowerCase();
  } else if (fallbackEmail && EMAIL_RE.test(fallbackEmail.trim())) {
    toEmail = fallbackEmail.trim().toLowerCase();
  } else {
    return { status: 'needs_email', handle: raw.replace(/^@/, '') };
  }
  return inviteTeamManagerByEmail({ leagueId, teamId, email: toEmail, leagueName, teamName, invitedBy });
}

/**
 * Always-create-invite path. Useful when the commissioner KNOWS the target
 * doesn't have an account (e.g. dedicated "Invite by email" button).
 */
export async function inviteTeamManagerByEmail({ leagueId, teamId, email, leagueName, teamName, invitedBy }) {
  const e = (email || '').trim().toLowerCase();
  if (!e || !EMAIL_RE.test(e)) return { status: 'error', message: 'Valid email required.' };

  // 1. Create the pending invite row + get the token.
  const { data, error: rpcErr } = await supabase.rpc('create_team_manager_invite', {
    p_league_id: leagueId,
    p_team_id: teamId,
    p_email: e,
  });
  if (rpcErr) return { status: 'error', message: rpcErr.message };
  // The RPC returns SETOF (id, token) — Supabase serializes as an array.
  const row = Array.isArray(data) ? data[0] : data;
  const token = row?.token;
  if (!token) return { status: 'error', message: 'Could not create invite.' };

  // 2. Hand the token off to send-invite Edge Function. It builds the
  //    magic-link URL + sends via Resend.
  const { error: sendErr } = await supabase.functions.invoke('send-invite', {
    body: {
      type: 'team_manager_invite',
      to_email: e,
      team_name: teamName || null,
      league_name: leagueName || null,
      invited_by: invitedBy || null,
      accept_token: token,
    },
  });
  if (sendErr) {
    return { status: 'error', message: 'Could not send the invite email — try again, or have them sign up directly.' };
  }
  return { status: 'invited', email: e };
}

/**
 * Called from the AcceptTeamInvite page after the recipient is signed in.
 * Returns { leagueId, teamId } on success; throws on RPC failure.
 */
export async function acceptTeamManagerInvite(token) {
  const { data, error } = await supabase.rpc('accept_team_manager_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { leagueId: row?.league_id, teamId: row?.team_id };
}
