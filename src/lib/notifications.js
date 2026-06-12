import { supabase } from './supabase';
import { getBlockedIds } from './blocks';

/**
 * Notifications are written by Postgres triggers (likes, comments, follows,
 * team join requests, push reminders). This module is for the client to
 * read and acknowledge them.
 */

export async function listNotifications({ limit = 50, unreadOnly = false } = {}) {
  let q = supabase
    .from('notifications')
    .select('*, actor:actor_id ( id, name, handle, avatar_color, avatar_initials )')
    // DM notifications exist only to drive web push; they live in the Messages
    // inbox, not the bell. Keep them out of the in-app notification list.
    .neq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is('read_at', null);
  const { data, error } = await q;
  // Drop notifications from blocked users. We filter client-side because
  // actor_id is nullable (system notifications carry null) and a server-side
  // NOT IN would incorrectly exclude those null rows.
  const blocked = await getBlockedIds();
  const rows = (data || []).filter((n) => !n.actor_id || !blocked.has(n.actor_id));
  return { data: rows, error };
}

export async function getUnreadCount(userId) {
  let q = supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    // Exclude DM notifications — those are counted by the Messages badge.
    .neq('kind', 'message');
  // Scope the count to this user. RLS already restricts rows, but being
  // explicit means a future RLS change can't silently inflate the badge.
  if (userId) q = q.eq('recipient_id', userId);
  const { count, error } = await q;
  if (error) throw error;
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
  if (!rpcErr) return { error: null };
  const { error: fallbackErr } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  // Surface the fallback's error so the caller can keep the unread UI honest.
  return { error: fallbackErr };
}

export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  return { error };
}

/**
 * Subscribe to realtime inserts/updates for the current user. Returns an
 * unsubscribe function.
 *
 * The channel name includes a per-call random suffix because supabase-js reuses
 * channels with the same name. Under React StrictMode (and on remounts) this
 * caused "cannot add postgres_changes callbacks after subscribe()" throws that
 * bubbled out of useEffect and blanked the app. A unique name per call avoids
 * the collision and the try/catch makes the whole call non-fatal regardless.
 */
export function subscribe(userId, onChange) {
  if (!userId) return () => {};
  let channel = null;
  try {
    const name = `notifications:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    channel = supabase
      .channel(name)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => { try { onChange?.('insert', payload.new); } catch { /* swallow */ } })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => { try { onChange?.('update', payload.new); } catch { /* swallow */ } })
      .subscribe();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] realtime subscribe failed; falling back to polling-only:', err);
  }
  return () => {
    try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ }
  };
}

export const KIND_META = {
  comment:             { icon: '💬', label: 'Comment' },
  mention:             { icon: '@', label: 'Mention' },
  reaction:            { icon: '🔥', label: 'Reaction' },
  like:                { icon: '❤️', label: 'Like' },
  follow:              { icon: '👀', label: 'New follower' },
  team_join_request:   { icon: '🏒', label: 'Roster request' },
  team_join_approved:  { icon: '✅', label: 'Roster approved' },
  team_join_denied:    { icon: '🚫', label: 'Roster request not accepted' },
  game_reminder:       { icon: '⏰', label: 'Game reminder' },
  suspension:          { icon: '🚨', label: 'Suspension filed' },
  team_invite:         { icon: '✉️', label: 'Team invite' },
  league_invite:       { icon: '🏆', label: 'League invite' },
  game_puck_won:       { icon: '🏒', label: 'Game Puck' },
};
