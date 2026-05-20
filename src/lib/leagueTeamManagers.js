// Commissioner-side helper: grant management of a league's team to a user.
//
// Calls the `assign_league_team_manager` RPC (SECURITY DEFINER, gated on
// is_league_commissioner). The RPC inserts a team_members(role=manager)
// row + promotes the target to founder if the team has no manager yet.
//
// Mirrors the shape of addCommissionerByInput in leagueCommissioners.js
// — account-required (no email-invite path). Granting team management is
// privileged; we don't want to email it to a potentially-wrong address.

import { supabase } from './supabase';
import { resolveProfile } from './leagueScorers';

/**
 * Returns one of:
 *   { status: 'assigned',   profile }            — manager role granted
 *   { status: 'no_account', input }              — handle/email didn't resolve
 *   { status: 'error',      message }            — bad input or RPC rejection
 */
export async function assignTeamManagerByInput({ leagueId, teamId, input }) {
  const raw = (input || '').trim();
  if (!raw) return { status: 'error', message: 'Enter a handle or email.' };
  if (!leagueId || !teamId) return { status: 'error', message: 'Missing league or team.' };

  const profile = await resolveProfile(raw);
  if (!profile) {
    return { status: 'no_account', input: raw };
  }

  const { error } = await supabase.rpc('assign_league_team_manager', {
    p_league_id: leagueId,
    p_team_id: teamId,
    p_user_id: profile.id,
  });
  if (error) return { status: 'error', message: error.message };
  return { status: 'assigned', profile };
}
