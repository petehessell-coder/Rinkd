import { supabase } from './supabase';

/**
 * Emoji reactions on posts (REACT-1). Additive layer ALONGSIDE the existing
 * ❤️ like — the like and `posts.likes` count are untouched; reactions are a
 * separate, more-expressive affordance. Backed by `post_reactions`
 * (post_id, user_id, emoji) with a unique (post_id, user_id, emoji) so a user
 * can toggle each emoji independently, Slack-style. Counts are aggregated on
 * read (no denormalized column / trigger) — feeds load a bounded page of posts
 * and we fetch their reactions in one batched query.
 */

// Curated beer-league set. Kept short so the picker fits a phone row and the
// pill strip never sprawls. Order is the picker order.
export const REACTION_EMOJIS = ['🔥', '🚨', '😂', '🥅', '💪', '🍺'];

// Toggle one emoji for one user on one post. Mirrors toggleLike: look up the
// row, then insert or delete. Returns { reacted, error } — reacted=true means
// the emoji is now ON for this user.
export async function toggleReaction(postId, userId, emoji) {
  if (!postId || !userId || !emoji) {
    return { reacted: false, error: new Error('toggleReaction requires postId, userId, emoji') };
  }
  const { data: existing, error: lookupErr } = await supabase
    .from('post_reactions')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();
  if (lookupErr) return { reacted: false, error: lookupErr };

  if (existing) {
    const { error } = await supabase
      .from('post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    return { reacted: false, error: error || null };
  }
  const { error } = await supabase
    .from('post_reactions')
    .insert({ post_id: postId, user_id: userId, emoji });
  return { reacted: true, error: error || null };
}

// Batched fetch for the visible page of posts. Returns a map keyed by post id:
//   { [postId]: { [emoji]: { count, mine } } }
// `mine` is whether the passed user reacted with that emoji. Posts with no
// reactions are simply absent from the map (callers default to {}).
export async function getReactions(userId, postIds) {
  if (!Array.isArray(postIds) || postIds.length === 0) return {};
  const { data, error } = await supabase
    .from('post_reactions')
    .select('post_id, user_id, emoji')
    .in('post_id', postIds);
  if (error || !data) return {};
  const map = {};
  for (const r of data) {
    const byEmoji = (map[r.post_id] ||= {});
    const cell = (byEmoji[r.emoji] ||= { count: 0, mine: false });
    cell.count += 1;
    if (userId && r.user_id === userId) cell.mine = true;
  }
  return map;
}
