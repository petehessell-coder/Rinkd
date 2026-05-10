import { supabase } from './supabase';

export async function getRsvp(gameId, userId) {
  const { data } = await supabase
    .from('team_game_rsvps')
    .select('*')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function getGameRsvps(gameId) {
  const { data } = await supabase
    .from('team_game_rsvps')
    .select('*, profile:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('game_id', gameId)
    .order('created_at');
  return data || [];
}

export async function upsertRsvp(gameId, userId, status) {
  const { data, error } = await supabase
    .from('team_game_rsvps')
    .upsert({ game_id: gameId, user_id: userId, status }, { onConflict: 'game_id,user_id' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteRsvp(gameId, userId) {
  const { error } = await supabase
    .from('team_game_rsvps')
    .delete()
    .eq('game_id', gameId)
    .eq('user_id', userId);
  if (error) throw error;
}
