import { supabase } from './supabase';

/**
 * Direct Messages (1:1). The schema + RLS live in the DB; this module is the
 * client's read/write surface. Conversations are deduped server-side by
 * get_or_create_dm, so opening a DM is idempotent.
 *
 * Realtime: messages is in the supabase_realtime publication and RLS-gated, so
 * an unfiltered INSERT subscription only delivers rows in the caller's own
 * conversations — we lean on that for the inbox badge. The open thread uses a
 * conversation-scoped filter for efficiency.
 */

// Strip PostgREST .or() metacharacters so a stray comma/paren can't break the
// query (same approach as Discover's player search).
function safeIlikeFragment(s) {
  return String(s || '').replace(/[,()*]/g, ' ').trim();
}

// People picker for "New message". Searches name + handle, excludes self and
// blocked users. Returns up to `limit` profiles.
export async function searchUsers(query, { limit = 12, excludeIds = [] } = {}) {
  const frag = safeIlikeFragment(query);
  if (!frag) return [];
  let q = supabase
    .from('profiles')
    .select('id, name, handle, avatar_color, avatar_initials, avatar_url')
    .or(`name.ilike.%${frag}%,handle.ilike.%${frag}%`)
    .limit(limit + excludeIds.length);
  const { data, error } = await q;
  if (error) throw error;
  const exclude = new Set(excludeIds.filter(Boolean));
  return (data || []).filter((u) => !exclude.has(u.id)).slice(0, limit);
}

// The other participant of a 1:1 conversation (for the thread header on a
// direct deep-link, when we don't already have it from the inbox).
export async function getConversationOther(conversationId, myId) {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('user_id, profile:user_id ( id, name, handle, avatar_color, avatar_initials, avatar_url )')
    .eq('conversation_id', conversationId);
  if (error) return { data: null, error };
  const row = (data || []).find((r) => r.user_id !== myId);
  return { data: row?.profile || null, error: null };
}

// Find-or-create the 1:1 conversation with another user. Returns the id.
export async function getOrCreateDm(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_dm', { p_other: otherUserId });
  if (error) throw error;
  return data; // uuid
}

// Inbox: conversations with the other participant, last-message summary, unread.
export async function listConversations() {
  const { data, error } = await supabase.rpc('list_my_conversations');
  if (error) throw error;
  return data || [];
}

export async function getMessages(conversationId, { limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  return { data: data || [], error };
}

export async function sendMessage(conversationId, body) {
  const trimmed = (body || '').trim();
  if (!trimmed) return { data: null, error: new Error('empty message') };
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: uid, body: trimmed })
    .select('id, conversation_id, sender_id, body, created_at')
    .single();
  return { data, error };
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
  return { error };
}

// Total unread DM count across all conversations (for the top-bar badge).
export async function getDmUnreadCount() {
  const { data, error } = await supabase.rpc('dm_unread_count');
  if (error) throw error;
  return data || 0;
}

/**
 * Cheap "does this user have ANY conversation?" check — used to gate the
 * unfiltered inbox realtime channel (subscribeInbox) so the large majority of
 * pilot users, who have never sent or received a DM, never open it. RLS on
 * conversation_participants (cp_select → is_conversation_participant) already
 * scopes the visible rows to the caller's own conversations, so a bare head
 * count is > 0 iff they participate in at least one — no profile-id lookup
 * needed. head:true fetches only the count, not rows.
 */
export async function hasAnyConversations() {
  try {
    const { count, error } = await supabase
      .from('conversation_participants')
      .select('conversation_id', { count: 'exact', head: true });
    if (error) return false; // fail-closed: no channel rather than a leaked one
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Realtime INSERTs for a single conversation's thread. Unique channel name per
 * call dodges the supabase-js same-name reuse throw under StrictMode/remounts
 * (same pattern as lib/notifications.subscribe). Returns an unsubscribe fn.
 */
export function subscribeToConversation(conversationId, onInsert) {
  if (!conversationId) return () => {};
  let channel = null;
  try {
    const name = `messages:${conversationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    channel = supabase
      .channel(name)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => { try { onInsert?.(payload.new); } catch { /* swallow */ } })
      .subscribe();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[messages] thread realtime subscribe failed; polling-only:', err);
  }
  return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
}

/**
 * Realtime INSERTs across all of the caller's conversations. No filter — RLS on
 * messages only delivers rows the user can SELECT (i.e. their own threads), so
 * this is a cheap "any new DM" signal for the inbox + unread badge. Returns an
 * unsubscribe fn.
 */
export function subscribeInbox(onChange) {
  let channel = null;
  try {
    const name = `dm-inbox:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    channel = supabase
      .channel(name)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => { try { onChange?.(payload.new); } catch { /* swallow */ } })
      .subscribe();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[messages] inbox realtime subscribe failed; polling-only:', err);
  }
  return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
}
