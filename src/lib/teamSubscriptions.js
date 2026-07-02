import { supabase } from './supabase';

// S07 D-S07-1 — team spectator follow ("follow your rink, not just people").
// Mirrors the league_subscriptions pattern: own-rows RLS, non-optimistic
// writes (the callers await + flip state only on success — a false
// "Following" is worse than a 200ms wait). Distinct from team_members:
// following is a fan relationship; joining is a roster relationship.

/** Is the current user following this team? */
export async function isFollowingTeam(userId, teamId) {
  if (!userId || !teamId) return false;
  const { data } = await supabase
    .from('team_subscriptions')
    .select('team_id')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .maybeSingle();
  return !!data;
}

/** Follow. Idempotent (PK conflict = already following = success). */
export async function followTeam(userId, teamId) {
  const { error } = await supabase
    .from('team_subscriptions')
    .upsert({ user_id: userId, team_id: teamId }, { onConflict: 'user_id,team_id', ignoreDuplicates: true });
  return { error };
}

/** Unfollow. Deleting an absent row is a clean no-op. */
export async function unfollowTeam(userId, teamId) {
  const { error } = await supabase
    .from('team_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('team_id', teamId);
  return { error };
}

/** The current user's followed team ids (bounded — a fan follows a handful). */
export async function getMyFollowedTeamIds(userId) {
  if (!userId) return [];
  const { data } = await supabase
    .from('team_subscriptions')
    .select('team_id')
    .eq('user_id', userId)
    .limit(100);
  return (data || []).map((r) => r.team_id);
}
