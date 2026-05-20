// League follow / unfollow — opt-in list for push notifications fired
// from the auto-recap path. Schema: league_subscriptions(user_id,
// league_id) PK with RLS that lets each user manage their own rows only.
//
// The League public-page "🔔 Follow league" button uses these helpers;
// ScorerView's finalize → recap flow uses the row set indirectly (the
// send-league-recap-push Edge Function queries the table with service
// role). Direct mirror of `tournamentSubscriptions.js`.

import { supabase } from './supabase';

export async function followLeague(userId, leagueId) {
  if (!userId || !leagueId) return { error: new Error('missing args') };
  // Upsert pattern lets a panicking double-tap on Follow stay idempotent.
  const { error } = await supabase
    .from('league_subscriptions')
    .upsert({ user_id: userId, league_id: leagueId }, { onConflict: 'user_id,league_id' });
  return { error };
}

export async function unfollowLeague(userId, leagueId) {
  if (!userId || !leagueId) return { error: new Error('missing args') };
  const { error } = await supabase
    .from('league_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('league_id', leagueId);
  return { error };
}

export async function isFollowingLeague(userId, leagueId) {
  if (!userId || !leagueId) return false;
  const { data } = await supabase
    .from('league_subscriptions')
    .select('league_id')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .maybeSingle();
  return !!data;
}
