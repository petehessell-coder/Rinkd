import { supabase } from './supabase';
import { getBlockedIds } from './blocks';

/**
 * @-mention / user tagging (MENTION-1).
 *
 * The composer resolves @handles to real user ids from autocomplete and we
 * STORE those resolved ids in post_mentions / comment_mentions at create time.
 * We never regex the display text to decide who was mentioned — that would let
 * anyone notify a stranger by typing "@someone", and would mis-link ambiguous
 * handles. Notifications fire from AFTER-INSERT triggers on the mention tables
 * (see migration mention_tagging_tables_and_notify_triggers).
 */

// Guardrail: cap mentions per post/comment so one post can't fan out an
// unbounded notification storm.
export const MAX_MENTIONS = 10;

// Token the composer/renderer use to find @handles. Handles are the same
// charset the app allows (letters, digits, underscore). Kept in one place so
// the composer detector and the linkify renderer never drift apart.
export const HANDLE_RE = /@([a-zA-Z0-9_]{1,30})/g;

// Strip characters that have special meaning inside a PostgREST .or() clause —
// mirror of Discover.safeIlikeFragment. Stripping (not escaping) is fine; no
// one @-searches for commas/parens.
function safeIlikeFragment(s) {
  return String(s || '').replace(/[,()*]/g, ' ').trim();
}

/**
 * Autocomplete source for the @-mention composer. Searches profiles by handle
 * or name, hides blocked users (both directions), returns a light shape.
 */
export async function searchMentionable(query, limit = 6) {
  const safe = safeIlikeFragment(query);
  if (!safe) return [];
  const ilike = `%${safe}%`;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, avatar_color, avatar_initials, tier')
    .or(`handle.ilike.${ilike},name.ilike.${ilike}`)
    .not('handle', 'is', null)
    .order('points', { ascending: false, nullsFirst: false })
    .limit(limit + 8); // over-fetch so block-filtering still yields a full list
  if (error) return [];
  const blocked = await getBlockedIds();
  return (data || []).filter((p) => p.handle && !blocked.has(p.id)).slice(0, limit);
}

function dedupeCap(userIds) {
  return [...new Set((userIds || []).filter(Boolean))].slice(0, MAX_MENTIONS);
}

/**
 * Persist resolved mentions for a freshly-created post. Best-effort: a
 * mention-write failure must never unwind a successful post (the post already
 * landed; the worst case is a missing notification). RLS only lets the post's
 * author insert these rows.
 */
export async function savePostMentions(postId, userIds) {
  const ids = dedupeCap(userIds);
  if (!postId || ids.length === 0) return { error: null };
  const rows = ids.map((uid) => ({ post_id: postId, mentioned_user_id: uid }));
  const { error } = await supabase.from('post_mentions').insert(rows);
  return { error: error || null };
}

export async function saveCommentMentions(commentId, userIds) {
  const ids = dedupeCap(userIds);
  if (!commentId || ids.length === 0) return { error: null };
  const rows = ids.map((uid) => ({ comment_id: commentId, mentioned_user_id: uid }));
  const { error } = await supabase.from('comment_mentions').insert(rows);
  return { error: error || null };
}

/**
 * Build a { handleLowercase -> userId } map from the embedded mention rows a
 * feed/comment query returns (post_mentions / comment_mentions with a nested
 * profiles select). MentionText uses this to linkify only handles that were
 * actually resolved + stored — stray "@text" stays plain.
 */
export function mentionMapFromRows(rows) {
  const map = {};
  for (const r of rows || []) {
    const prof = r.profiles || r.mentioned || r.profile;
    const handle = prof?.handle;
    const id = prof?.id || r.mentioned_user_id;
    if (handle && id) map[String(handle).toLowerCase()] = id;
  }
  return map;
}

// PostgREST embed fragments — single source of truth so the five feed queries
// (and the comments query) stay consistent. Two levels deep: parent ->
// mention row -> profile, joined on the mentioned_user_id FK.
export const POST_MENTIONS_EMBED =
  'post_mentions ( mentioned_user_id, profiles ( id, handle ) )';
export const COMMENT_MENTIONS_EMBED =
  'comment_mentions ( mentioned_user_id, profiles ( id, handle ) )';
