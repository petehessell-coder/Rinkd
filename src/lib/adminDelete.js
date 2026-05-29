import { supabase } from './supabase';

// Rinkd-admin hard-delete of an entire tournament / league / team.
// Backed by SECURITY DEFINER RPCs (migration
// `admin_delete_tournament_league_team_rpcs`) that gate on profiles.is_admin
// via auth.uid(), clean the polymorphic stat tables + scoped posts + games
// (NO ACTION FKs), then delete the parent (CASCADE handles the rest).
// Irreversible. Non-admins get a Postgres `admin_only` (42501) error.

export async function deleteTournamentAsAdmin(id) {
  const { error } = await supabase.rpc('admin_delete_tournament', { p_id: id });
  if (error) throw error;
}

export async function deleteLeagueAsAdmin(id) {
  const { error } = await supabase.rpc('admin_delete_league', { p_id: id });
  if (error) throw error;
}

export async function deleteTeamAsAdmin(id) {
  const { error } = await supabase.rpc('admin_delete_team', { p_id: id });
  if (error) throw error;
}
