import { supabase } from './supabase';

/**
 * User-block plumbing. A "block" hides content in both directions:
 *   - if I block someone, I don't see their posts/comments/notifications
 *   - if I'm blocked, I don't see the blocker's posts/comments/notifications
 *
 * The bidirectional invisibility is enforced client-side. The RLS on
 * user_blocks lets either party see the row (so the blocked side can filter
 * their own feed), but only the blocker can write or delete.
 *
 * Read paths call `getBlockedIds()` (cached) and either pass the resulting Set
 * to `filterBlockedIds(arr)` (strip from an existing IDs array, used by
 * getFollowingPosts) or `excludeBlocked(query, col)` (append a `.not.in(...)`
 * clause, used by getPosts/getTeamPosts/listNotifications).
 *
 * Cache lifecycle:
 *   - Lazy: first call resolves it from the DB.
 *   - Refreshed on Supabase auth state change (sign-in flips identity).
 *   - Invalidated on blockUser/unblockUser.
 */

let cachedSet = null;       // Set<uuid> | null
let resolving = null;       // in-flight Promise<Set<uuid>> | null

async function resolveBlockedIds() {
  // Returns a fresh Set<uuid> covering both directions: rows where I'm the
  // blocker, plus rows where I'm the blocked party.
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id;
  if (!uid) return new Set();
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${uid},blocked_id.eq.${uid}`);
  if (error) {
    // Fail open — don't break the feed if blocks can't be loaded.
    // eslint-disable-next-line no-console
    console.warn('[blocks] load failed:', error);
    return new Set();
  }
  const out = new Set();
  for (const row of data || []) {
    out.add(row.blocker_id === uid ? row.blocked_id : row.blocker_id);
  }
  return out;
}

/** Public: the cached Set of user IDs to filter from reads (both directions). */
export async function getBlockedIds() {
  if (cachedSet) return cachedSet;
  if (resolving) return resolving;
  resolving = (async () => {
    try {
      cachedSet = await resolveBlockedIds();
    } finally {
      resolving = null;
    }
    return cachedSet;
  })();
  return resolving;
}

/** Invalidate the cache (e.g. after block/unblock or sign-out). */
export function invalidateBlocksCache() {
  cachedSet = null;
  resolving = null;
}

// Re-resolve on sign-in / sign-out so a different user gets their own block list.
if (typeof window !== 'undefined' && supabase?.auth) {
  try {
    supabase.auth.onAuthStateChange(() => {
      invalidateBlocksCache();
    });
  } catch { /* never break boot for this */ }
}

/**
 * Block the target user. Inserts the row, then unfollows in the blocker→blocked
 * direction. The reverse follow can't be deleted client-side (RLS on `follows`
 * only allows the follower to delete their own row), but it doesn't matter:
 * once the block exists, the blocked party's feeds filter out the blocker's
 * content, so the dangling follow is inert.
 */
export async function blockUser(targetUserId) {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess?.session?.user?.id;
  if (!me) return { error: { message: 'Not signed in' } };
  if (me === targetUserId) return { error: { message: "Can't block yourself" } };

  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: me, blocked_id: targetUserId });
  if (error && error.code !== '23505') {
    // 23505 = unique_violation — already blocked, treat as success.
    return { error };
  }

  // Best-effort unfollow in my direction. Don't block the call on this failing.
  try {
    await supabase
      .from('follows')
      .delete()
      .eq('follower_id', me)
      .eq('following_id', targetUserId);
  } catch { /* swallow */ }

  invalidateBlocksCache();
  return { error: null };
}

/** Remove the block. The reverse follow (if any) is left alone. */
export async function unblockUser(targetUserId) {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess?.session?.user?.id;
  if (!me) return { error: { message: 'Not signed in' } };

  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', me)
    .eq('blocked_id', targetUserId);
  invalidateBlocksCache();
  return { error };
}

/** True if I currently block the target (one direction only — me → them). */
export async function isBlockedByMe(targetUserId) {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess?.session?.user?.id;
  if (!me) return false;
  const { data } = await supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocker_id', me)
    .eq('blocked_id', targetUserId)
    .maybeSingle();
  return !!data;
}

/** For the Settings list — returns my outbound blocks with profile metadata. */
export async function listMyBlocks() {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess?.session?.user?.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from('user_blocks')
    .select(`
      blocked_id,
      created_at,
      profiles!user_blocks_blocked_id_fkey (id, name, handle, avatar_url, avatar_color, avatar_initials)
    `)
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[blocks] listMyBlocks failed:', error);
    return [];
  }
  return data || [];
}

/** Strip blocked user IDs from an existing array of user IDs. */
export async function filterBlockedIds(ids) {
  const blocked = await getBlockedIds();
  if (!blocked.size) return ids;
  return ids.filter((id) => !blocked.has(id));
}

/**
 * Append a `.not(col, 'in', '(...)')` clause to a Supabase query builder so
 * blocked users' content is excluded. Returns the chained builder. No-op if
 * there are no blocks (avoids an empty `in ()` clause which PostgREST rejects).
 */
export async function excludeBlocked(query, column = 'author_id') {
  const blocked = await getBlockedIds();
  if (!blocked.size) return query;
  return query.not(column, 'in', `(${[...blocked].join(',')})`);
}
