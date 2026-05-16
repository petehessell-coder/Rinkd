// Tournament follow / unfollow — opt-in list for push notifications fired
// from the auto-recap path. Schema: tournament_subscriptions(user_id,
// tournament_id) PK with RLS that lets each user manage their own rows only.
//
// The Tournament public-page "🔔 Follow tournament" button uses these
// helpers; ScorerView's finalize → recap flow uses the row set indirectly
// (the send-recap-push Edge Function queries the table with service role).

import { supabase } from './supabase';

export async function followTournament(userId, tournamentId) {
  if (!userId || !tournamentId) return { error: new Error('missing args') };
  // Upsert pattern lets a panicking double-tap on Follow stay idempotent.
  const { error } = await supabase
    .from('tournament_subscriptions')
    .upsert({ user_id: userId, tournament_id: tournamentId }, { onConflict: 'user_id,tournament_id' });
  return { error };
}

export async function unfollowTournament(userId, tournamentId) {
  if (!userId || !tournamentId) return { error: new Error('missing args') };
  const { error } = await supabase
    .from('tournament_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId);
  return { error };
}

export async function isFollowingTournament(userId, tournamentId) {
  if (!userId || !tournamentId) return false;
  const { data } = await supabase
    .from('tournament_subscriptions')
    .select('tournament_id')
    .eq('user_id', userId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  return !!data;
}
