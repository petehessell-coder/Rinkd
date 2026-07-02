import { supabase } from './supabase';
import { getBlockedIds } from './blocks';

/**
 * Notifications are written by Postgres triggers (likes, comments, follows,
 * team join requests, push reminders). This module is for the client to
 * read and acknowledge them.
 */

// perf(scale) C08 PR-F — `before` keyset param ("Show older" cursor). Default
// limit/behavior unchanged (80, newest-first) so the initial bell/page load
// is identical; `before` (an ISO created_at) pages further back on demand.
export async function listNotifications({ limit = 80, unreadOnly = false, before = null } = {}) {
  let q = supabase
    .from('notifications')
    .select('*, actor:actor_id ( id, name, handle, avatar_color, avatar_initials )')
    // DM notifications exist only to drive web push; they live in the Messages
    // inbox, not the bell. Keep them out of the in-app notification list.
    .neq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is('read_at', null);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  // Drop notifications from blocked users. We filter client-side because
  // actor_id is nullable (system notifications carry null) and a server-side
  // NOT IN would incorrectly exclude those null rows.
  const blocked = await getBlockedIds();
  const raw = data || [];
  const rows = raw.filter((n) => !n.actor_id || !blocked.has(n.actor_id));
  // hasMore reflects the raw (pre-filter) page size — the blocked-user filter
  // can shrink `rows` below `limit` even when more rows exist past this page,
  // which would otherwise prematurely hide "Show older".
  return { data: rows, error, hasMore: raw.length === limit };
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

// `icon` is a semantic Icon name (see components/ui/Icon.js), not an emoji —
// Notifications.js renders it as <Icon name={meta.icon} />.
export const KIND_META = {
  comment:             { icon: 'comment', label: 'Comment' },
  mention:             { icon: 'mention', label: 'Mention' },
  reaction:            { icon: 'reaction', label: 'Reaction' },
  like:                { icon: 'like', label: 'Like' },
  follow:              { icon: 'follow', label: 'New follower' },
  team_join_request:   { icon: 'rosterRequest', label: 'Roster request' },
  team_join_approved:  { icon: 'approved', label: 'Roster approved' },
  team_join_denied:    { icon: 'denied', label: 'Roster request not accepted' },
  game_reminder:       { icon: 'gameReminder', label: 'Game reminder' },
  suspension:          { icon: 'suspension', label: 'Suspension filed' },
  sub_alert:           { icon: 'subAlert', label: 'Sub needed' },
  lineup_alert:        { icon: 'lineup', label: "Tonight's lines" },
  team_invite:         { icon: 'teamInvite', label: 'Team invite' },
  league_invite:       { icon: 'leagueInvite', label: 'League invite' },
  game_puck_won:       { icon: 'gamePuck', label: 'Game Puck' },
  milestone:           { icon: 'milestone', label: 'Milestone' },
};
