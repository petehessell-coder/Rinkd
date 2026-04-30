import { supabase } from './supabase';

export async function getPosts(limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      profiles:author_id (
        id, name, handle, avatar_color, avatar_initials, tier, position
      )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data || [];
}

export async function createPost({ authorId, content, tag, tagColor }) {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: authorId,
      content,
      tag: tag || 'POST',
      tag_color: tagColor || '#2E5B8C',
      likes: 0,
      comment_count: 0,
      repost_count: 0,
    })
    .select(`
      *,
      profiles:author_id (
        id, name, handle, avatar_color, avatar_initials, tier, position
      )
    `)
    .single();
  if (error) throw error;
  return data;
}

export async function deletePost(postId, userId) {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('author_id', userId);
  if (error) throw error;
}

export async function toggleLike(postId, userId) {
  // Check if already liked
  const { data: existing } = await supabase
    .from('likes')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .single();

  if (existing) {
    // Unlike
    await supabase.from('likes').delete().eq('post_id', postId).eq('user_id', userId);
    await supabase.rpc('decrement_likes', { post_id: postId });
    return false;
  } else {
    // Like
    await supabase.from('likes').insert({ post_id: postId, user_id: userId });
    await supabase.rpc('increment_likes', { post_id: postId });
    // Award points
    await supabase.rpc('add_points', { user_id: userId, pts: 1 });
    return true;
  }
}

export async function getLikedPosts(userId) {
  const { data } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId);
  return (data || []).map(l => l.post_id);
}

export async function getComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select(`
      *,
      profiles:author_id (
        id, name, handle, avatar_color, avatar_initials, tier
      )
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createComment({ postId, authorId, content }) {
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: authorId, content })
    .select(`
      *,
      profiles:author_id (
        id, name, handle, avatar_color, avatar_initials, tier
      )
    `)
    .single();
  if (error) throw error;
  // Increment comment count
  await supabase.rpc('increment_comments', { post_id: postId });
  // Award points for commenting
  await supabase.rpc('add_points', { user_id: authorId, pts: 1 });
  return data;
}
