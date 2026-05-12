import { supabase } from './supabase';

export async function getPosts(limit = 30) {
  const { data, error } = await supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_color, avatar_initials, tier, position)`)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data, error };
}

export async function getFollowingPosts(userId, limit = 30) {
  const { data: follows } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
  
  if (!follows || follows.length === 0) return { data: [], error: null };
  
  const ids = follows.map(f => f.following_id);
  const { data, error } = await supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_color, avatar_initials, tier, position)`)
    .in('author_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data, error };
}

export async function createPost(authorId, { content, tag, tagColor, mediaUrl, mediaType, livebarnVenueId, teamId }) {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: authorId,
      content,
      tag: tag || null,
      tag_color: tagColor || null,
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      team_id: teamId || null,
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
  const { data, error } = await supabase
    .from('posts')
    .select(`*, profiles(id, name, handle, avatar_color, avatar_initials, tier, position)`)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
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

export async function toggleLike(postId, userId) {
  const { data: existing } = await supabase
    .from('likes').select('id').eq('post_id', postId).eq('user_id', userId).single();
  if (existing) {
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId);
    await supabase.from('posts').update({ likes: supabase.rpc('decrement', { x: 1 }) }).eq('id', postId).catch(() => {});
    return { liked: false };
  } else {
    await supabase.from('likes').insert({ post_id: postId, user_id: userId });
    return { liked: true };
  }
}

export async function getLikedPosts(userId) {
  const { data } = await supabase.from('likes').select('post_id').eq('user_id', userId);
  return data?.map(l => l.post_id) || [];
}

export async function getComments(postId) {
  // Explicit FK hint — there's only one FK from comments → profiles
  // (comments_author_id_fkey) but being explicit means the embed can never get
  // ambiguous if new relationships land later.
  const { data, error } = await supabase
    .from('comments')
    .select(`*, profiles!comments_author_id_fkey(id, name, handle, avatar_color, avatar_initials, tier)`)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[comments] load failed:', error);
    // Graceful fallback: fetch without the embed so users at least see the text.
    const { data: fallback } = await supabase
      .from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
    return fallback || [];
  }
  return data || [];
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
