import { supabase } from './supabase';
import { track } from './analytics';
import { getBlockedIds, excludeBlocked, filterBlockedIds } from './blocks';
import { POST_MENTIONS_EMBED, COMMENT_MENTIONS_EMBED } from './mentions';
import { relativeTime } from './format';
import { compressImage } from './image';
import { colors } from './tokens';

export async function getPosts(limit = 30, before = null) {
  let query = supabase
    .from('posts')
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    // Tournament-, league- and team-scoped posts live on their own Feed tabs.
    // Keep the global feed clean for users who haven't opted into those contexts.
    .is('tournament_id', null)
    .is('league_id', null)
    .is('team_id', null)
    // Hide moderated content from the feed too, so it stays consistent with the
    // gallery — a blocklist-flagged post can't leak into the global timeline.
    .eq('is_hidden', false)
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
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .in('author_id', ids)
    // Tournament-, league- and team-scoped posts live on their own Feed tabs.
    .is('tournament_id', null)
    .is('league_id', null)
    .is('team_id', null)
    // Mirror the global feed: keep moderated content out of the Following feed.
    .eq('is_hidden', false)
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
export async function getTournamentPosts(tournamentId, limit = 50, before = null) {
  if (!tournamentId) return { data: [], error: null };
  let query = supabase
    .from('posts')
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('tournament_id', tournamentId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before); // keyset: page older than what we hold
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

// Posts scoped to a single league — surfaces auto-recaps on the League
// page's Feed tab. Phase 2 of the league-parity build (May 19, 2026).
// Direct mirror of getTournamentPosts; partial index
// posts_league_id_created_at_idx covers the read.
export async function getLeaguePosts(leagueId, limit = 50, before = null) {
  if (!leagueId) return { data: [], error: null };
  let query = supabase
    .from('posts')
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('league_id', leagueId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before); // keyset: page older than what we hold
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

// Auto-recap post on game finalize. Idempotent: re-finalize after a Reopen
// updates the existing recap row (kept unique by the matching partial unique
// index) rather than spamming the feed with a second recap. Always tagged
// "Game Recap" so it renders with the blue tag stripe in Feed and TeamFeed.
//
// Two game id-spaces: tournament `games` (keyed on recap_for_game_id) and
// `league_games` (keyed on recap_for_league_game_id). The caller signals which
// by passing tournamentId vs leagueId — a league recap MUST NOT write the
// league_games id into recap_for_game_id, whose FK points at games(id) and
// would reject it (this is why league recaps were silently failing before
// recap_for_league_game_id existed). The poller's postLeagueRecapAndPush
// targets the same recap_for_league_game_id column, so both paths stay
// idempotent against one recap per league game.
const GAME_RECAP_TAG = 'Game Recap';
const GAME_RECAP_TAG_COLOR = colors.blue;

export async function createGameRecapPost({ scorerId, gameId, content, tournamentId = null, leagueId = null }) {
  if (!scorerId || !gameId || !content) {
    return { data: null, error: new Error('createGameRecapPost requires scorerId, gameId, and content') };
  }
  // Pick the recap key column by id-space: league games → recap_for_league_game_id,
  // tournament/global games → recap_for_game_id.
  const recapCol = leagueId ? 'recap_for_league_game_id' : 'recap_for_game_id';
  // Look for an existing recap. Single round-trip is fine — the partial unique
  // index makes this an indexed lookup, and the volume is tiny (one row per
  // finalized game).
  const { data: existing, error: lookupErr } = await supabase
    .from('posts')
    .select('id, author_id')
    .eq(recapCol, gameId)
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
      [recapCol]: gameId,
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

export async function createPost(authorId, { content, tag, tagColor, mediaUrl, mediaType, livebarnVenueId, teamId, tournamentId, tournamentTeamId, leagueId, leagueTeamId }) {
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
      tournament_team_id: tournamentTeamId || null,
      league_id: leagueId || null,
      league_team_id: leagueTeamId || null,
      likes: 0,
      comment_count: 0,
      repost_count: 0,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  return { data, error };
}

// Hard delete a post the caller authored. RLS (posts_delete_own) enforces
// author-only — a non-author delete simply affects zero rows, never another
// user's post. All children cascade via ON DELETE CASCADE: comments, likes,
// post_mentions, and post-referencing notifications. No soft delete / recovery.
export async function deletePost(postId) {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  return { error };
}

export async function getTeamPosts(teamId, limit = 50, before = null) {
  let query = supabase
    .from('posts')
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), ${POST_MENTIONS_EMBED}`)
    .eq('team_id', teamId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before); // keyset: page older than what we hold
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

// Photo/video gallery (GALLERY-1) — a media-only view over scoped posts, so it
// inherits reactions, comments, likes and moderation for free (no separate
// gallery table). Scope is exactly one of tournament/league; an optional team
// filter narrows to one competing team. Competing teams live in their own
// per-scope tables (tournament_teams / league_teams), so the team tag uses the
// matching scoped column (tournament_team_id / league_team_id) — not the global
// posts.team_id, which is the team's own TeamFeed scope. Both scoped team names
// are embedded so the lightbox can label a photo regardless of scope.
// Hidden/flagged posts are excluded from the gallery just as they are from feeds.
export async function getGalleryPosts({ tournamentId = null, leagueId = null, tournamentTeamId = null, leagueTeamId = null, limit = 60, before = null } = {}) {
  if (!tournamentId && !leagueId) return { data: [], error: null };
  let query = supabase
    .from('posts')
    .select(`*, profiles!posts_author_id_fkey(id, name, handle, avatar_url, avatar_color, avatar_initials, tier, position), tournament_teams(id, team_name, logo_url), league_teams(id, team_name, logo_color, logo_initials), ${POST_MENTIONS_EMBED}`)
    .not('media_url', 'is', null)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  if (leagueId) query = query.eq('league_id', leagueId);
  if (tournamentTeamId) query = query.eq('tournament_team_id', tournamentTeamId);
  if (leagueTeamId) query = query.eq('league_team_id', leagueTeamId);
  // Keyset pagination — fetch the page of posts older than the last one we hold.
  if (before) query = query.lt('created_at', before);
  query = await excludeBlocked(query, 'author_id');
  const { data, error } = await query;
  return { data, error };
}

export async function uploadMedia(file, userId, opts = {}) {
  // perf(scale): downscale + re-encode images before they ever hit Storage or
  // the feed (videos / unsupported formats pass through untouched). One shared
  // chokepoint, so every upload call site (feed, team feed, avatars, covers,
  // team/league/tournament logos, gallery) is covered at once. Pass
  // { maxEdge: 512 } from avatar/logo call sites for an even smaller asset.
  const slim = await compressImage(file, opts);
  const ext = slim.name.split('.').pop();
  const fileName = `${userId}/${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from('media')
    // Unique filename per upload → the bytes are immutable, so cache them for a
    // year. Cuts repeat egress for an image that's served to thousands of feeds.
    .upload(fileName, slim, { cacheControl: '31536000', upsert: false });
  if (error) return { url: null, error };
  const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName);
  const mediaType = slim.type.startsWith('video') ? 'video' : 'image';
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
  // PILOT-ANALYTICS: fire on the LIKE (add) path only — never on un-like.
  if (!error) track('post_liked', { post_id: postId });
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
    .eq('is_hidden', false)
    .order('created_at', { ascending: true })
    .limit(200); // perf(scale): cap a viral thread; "load earlier" pagination is a follow-up
  // Filter blocked users out of the result. Doing it client-side avoids a
  // separate IN-list URL fragment per thread fetch; comment threads are small.
  const blocked = await getBlockedIds();
  const drop = (rows) => blocked.size ? rows.filter((c) => !blocked.has(c.author_id)) : rows;
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[comments] load failed:', error);
    // Graceful fallback: fetch without the embed so users at least see the text.
    const { data: fallback } = await supabase
      .from('comments').select('*').eq('post_id', postId).eq('is_hidden', false).order('created_at', { ascending: true });
    return drop(fallback || []);
  }
  return drop(data || []);
}

export async function createComment(postId, authorId, content) {
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: authorId, content, created_at: new Date().toISOString() })
    .select().single();
  // PILOT-ANALYTICS: a comment is always a create (no toggle). No body/PII.
  if (!error) track('comment_created', { post_id: postId });
  return { data, error };
}

// Hard delete a comment the caller authored. RLS (comments_delete_own) enforces
// author-only. posts.comment_count stays correct via the
// trg_bump_post_comment_count AFTER DELETE trigger — callers only adjust their
// own local count for the optimistic UI. comment_mentions cascade.
export async function deleteComment(commentId) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  return { error };
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

// Kept as a named export for the many existing import sites; the implementation
// now lives in lib/format.js (relativeTime) so there's one formatter app-wide.
export function timeAgo(dateStr) {
  return relativeTime(dateStr);
}
