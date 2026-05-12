import { supabase } from './supabase';

/**
 * Notifications are written by Postgres triggers (likes, comments, follows,
 * team join requests, push reminders). This module is for the client to
 * read and acknowledge them.
 */

export async function listNotifications({ limit = 50, unreadOnly = false } = {}) {
  let q = supabase
    .from('notifications')
    .select('*, actor:actor_id ( id, name, handle, avatar_color, avatar_initials )')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function getUnreadCount() {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return count || 0;
}

export async function markRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  return { error };
}

export async function markAllRead() {
  // Try the RPC first; if it doesn't exist yet (deploy lag), fall back to a
  // client-side update which RLS already restricts to the user's own rows.
  const { error: rpcErr } = await supabase.rpc('mark_all_notifications_read');
  if (rpcErr) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);
  }
}

export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  return { error };
}

/**
 * Subscribe to realtime inserts/updates for the current user. Returns an
 * unsubscribe function.
 */
export function subscribe(userId, onChange) {
  if (!userId) return () => {};
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => onChange?.('insert', payload.new))
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => onChange?.('update', payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export const KIND_META = {
  comment:            { icon: '💬', label: 'Comment' },
  like:               { icon: '❤️', label: 'Like' },
  follow:             { icon: '👀', label: 'New follower' },
  team_join_request:  { icon: '🏒', label: 'Roster request' },
  game_reminder:      { icon: '⏰', label: 'Game reminder' },
  team_invite:        { icon: '✉️', label: 'Team invite' },
  league_invite:      { icon: '🏆', label: 'League invite' },
};
