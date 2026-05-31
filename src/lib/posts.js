import { supabase } from './supabase';
import { getBlockedIds, excludeBlocked, filterBlockedIds } from './blocks';
import { POST_MENTIONS_EMBED, COMMENT_MENTIONS_EMBED } from './mentions';

export async function getPosts(limit = 30, before = null) {
  let query = supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    // Tournament- and league-scoped posts live on their own Feed tabs. Keep
    // the global feed clean for users who haven't opted into those contexts.
    .is('tournament_id', null)
    .is('league_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  // Keyset pagination — fetch the page of posts older than the last one we hold.
  if (before) query = query.lt('created_at', before);
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

export async function getFollowingPosts(userId, limit = 30, before = null) {
  // Cap the follow list. A user following thousands would build a massive IN
  // clause that hits PostgREST URL limits and slows the query. 1000 is far
  // beyond any real user — the durable fix is a server-side join (tracked in
  // Rinkd_Canonical_Data_Model.md follow-ups).
  const { data: follows } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .limit(1000);

  // The Following feed must include the user's OWN posts. Without this, when
  // someone posts a chirp the feed reloads and their post is invisible to
  // them — looks like the post failed even though it landed cleanly in the
  // DB. Every social platform does this: your home feed always includes you.
  let ids = (follows || []).map((f) => f.following_id);
  if (!ids.includes(userId)) ids.push(userId);
  // Strip blocked users (either direction) from the inclusion list. We do this
  // in the array rather than chaining .not.in() so PostgREST builds one short
  // IN clause instead of an IN combined with a NOT IN.
  ids = await filterBlockedIds(ids);
  if (ids.length === 0) return { data: [], error: null };

  let query = supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .in('author_id', ids)
    // Tournament- and league-scoped posts live on their own Feed tabs.
    .is('tournament_id', null)
    .is('league_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  // Keyset pagination — fetch the page of posts older than the last one we hold.
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  return { data, error };
}

// Posts scoped to a single tournament — surfaces auto-recaps on the
// Tournament page's Feed tab. Mirrors getTeamPosts but keyed on tournament_id.
// Blocked-user filtering applied; the tournament feed isn't immune to the
// block model just because the post landed via auto-recap.
export async function getTournamentPosts(tournamentId, limit = 50) {
  if (!tournamentId) return { data: [], error: null };
  let query = supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

// Posts scoped to a single league — surfaces auto-recaps on the League
// page's Feed tab. Phase 2 of the league-parity build (May 19, 2026).
// Direct mirror of getTournamentPosts; partial index
// posts_league_id_created_at_idx covers the read.
export async function getLeaguePosts(leagueId, limit = 50) {
  if (!leagueId) return { data: [], error: null };
  let query = supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(limit);
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

// Auto-recap post on game finalize. Idempotent: re-finalize after a Reopen
// updates the existing recap row (kept unique by posts_recap_for_game_id_unique_idx)
// rather than spamming the global feed with a second recap. Tournament games
// only for the pilot; league + team game variants can plug in later by
// extending the caller's content builder. Always tagged "Game Recap" so it
// renders with the blue tag stripe in Feed and TeamFeed.
const GAME_RECAP_TAG = 'Game Recap';
const GAME_RECAP_TAG_COLOR = '#2E5B8C';

export async function createGameRecapPost({ scorerId, gameId, content, tournamentId = null, leagueId = null }) {
  if (!scorerId || !gameId || !content) {
    return { data: null, error: new Error('createGameRecapPost requires scorerId, gameId, and content') };
  }
  // Look for an existing recap. Single round-trip is fine — the partial unique
  // index makes this an indexed lookup, and the volume is tiny (one row per
  // finalized game).
  const { data: existing, error: lookupErr } = await supabase
    .from('posts')
    .select('id, author_id')
    .eq('recap_for_game_id', gameId)
    .maybeSingle();
  if (lookupErr) return { data: null, error: lookupErr };

  if (existing) {
    // Re-finalize after a Reopen — keep the original author (the user who
    // first finalized) so the post's permalink-style attribution doesn't
    // shift around. Just refresh the content with the new score line.
    // Also re-stamp tournament_id / league_id in case the caller now has one
    // (older recap rows may pre-date the columns; this self-heals on
    // re-finalize).
    const { data, error } = await supabase
      .from('posts')
      .update({ content, tag: GAME_RECAP_TAG, tag_color: GAME_RECAP_TAG_COLOR, tournament_id: tournamentId, league_id: leagueId })
      .eq('id', existing.id)
      .select()
      .single();
    return { data, error };
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: scorerId,
      content,
      tag: GAME_RECAP_TAG,
      tag_color: GAME_RECAP_TAG_COLOR,
      recap_for_game_id: gameId,
      tournament_id: tournamentId,
      league_id: leagueId,
      likes: 0,
      comment_count: 0,
      repost_count: 0,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  return { data, error };
}

export async function createPost(authorId, { content, tag, tagColor, mediaUrl, mediaType, livebarnVenueId, teamId, tournamentId, leagueId }) {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: authorId,
      content,
      tag: tag || null,
      tag_color: tagColor || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      livebarn_venue_id: livebarnVenueId || null,
      team_id: teamId || null,
      tournament_id: tournamentId || null,
      league_id: leagueId || null,
      likes: 0,
      comment_count: 0,
      repost_count: 0,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  return { data, error };
}

export async function getTeamPosts(teamId, limit = 50) {
  let query = supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

export async function uploadMedia(file, userId) {
  const ext = file.name.split('.').pop();
  const fileName = `${userId}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from('media')
    .upload(fileName, file, { cacheControl: '3600', upsert: false });
  if (error) return { url: null, error };
  const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName);
  const mediaType = file.type.startsWith('video') ? 'video' : 'image';
  return { url: publicUrl, mediaType, error: null };
}

// Toggle a like on/off. Database AFTER INSERT/DELETE triggers on the `likes`
// table now maintain `posts.likes` for us — see migration
// `fix_posts_likes_count_triggers_and_reconcile`. The previous version of
// this function tried to maintain the count in JS with a broken
// `supabase.rpc('decrement', { x: 1 })` expression, which silently no-op'd
// and let counts run away into the hundreds. Triggers are the right home.
export async function toggleLike(postId, userId) {
  const { data: existing, error: lookupErr } = await supabase
    .from('likes')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupErr) return { liked: false, error: lookupErr };

  if (existing) {
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    return { liked: false, error: error || null };
  }
  const { error } = await supabase
    .from('likes')
    .insert({ post_id: postId, user_id: userId });
  return { liked: true, error: error || null };
}

// Scope to the visible posts. The previous unbounded version pulled the user's
// entire like history just to mark ~50 cards — fine for new users, painful for
// power users with thousands of likes, and grows on every feed render.
export async function getLikedPosts(userId, postIds) {
  if (!userId || !Array.isArray(postIds) || postIds.length === 0) return [];
  const { data } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  return data?.map(l => l.post_id) || [];
}

export async function getComments(postId) {
  // Explicit FK hint — there's only one FK from comments → profiles
  // (comments_author_id_fkey) but being explicit means the embed can never get
  // ambiguous if new relationships land later.
  const { data, error } = await supabase
    .from('comments')
    .select(`*, profiles!comments_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier), ${COMMENT_MENTIONS_EMBED}`)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  // Filter blocked users out of the result. Doing it client-side avoids a
  // separate IN-list URL fragment per thread fetch; comment threads are small.
  const blocked = await getBlockedIds();
  const drop = (rows) => blocked.size ? rows.filter((c) => !blocked.has(c.author_id)) : rows;
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[comments] load failed:', error);
    // Graceful fallback: fetch without the embed so users at least see the text.
    const { data: fallback } = await supabase
      .from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
    return drop(fallback || []);
  }
  return drop(data || []);
}

export async function createComment(postId, authorId, content) {
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: authorId, content, created_at: new Date().toISOString() })
    .select().single();
  return { data, error };
}

// Follow system
export async function followUser(followerId, followingId) {
  const { error } = await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId });
  return { error };
}

export async function unfollowUser(followerId, followingId) {
  const { error } = await supabase.from('follows').delete()
    .eq('follower_id', followerId).eq('following_id', followingId);
  return { error };
}

export async function isFollowing(followerId, followingId) {
  const { data } = await supabase.from('follows').select('id')
    .eq('follower_id', followerId).eq('following_id', followingId).single();
  return !!data;
}

export async function getFollowCounts(userId) {
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return { followers: followers || 0, following: following || 0 };
}

export function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
