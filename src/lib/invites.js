import { supabase } from './supabase';

async function sendInvite(payload) {
  const { data, error } = await supabase.functions.invoke('send-invite', { body: payload });
  if (error) console.error('Invite error:', error);
  return { data, error };
}

export async function sendTeamInvite({ to_email, to_name, team_name, invited_by }) {
  if (!to_email) return; // No email = no invite, silent
  return sendInvite({ type: 'team_invite', to_email, to_name, team_name, invited_by });
}

export async function sendLeagueInvite({ to_email, league_name }) {
  if (!to_email) return;
  return sendInvite({ type: 'league_invite', to_email, league_name });
}
