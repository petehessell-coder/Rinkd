import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Img, ErrorState } from './ui';
import { useOnline } from '../lib/useOnline';
import { Avatar, TierBadge } from './Logos';
import {
  getTeamPosts, createPost, toggleLike, getLikedPosts,
  getComments, createComment, uploadMedia, timeAgo,
} from '../lib/posts';
import { track } from '../lib/analytics';
import { FeedSkeleton, EmptyState } from './Skeletons';
import { classifyImage } from '../lib/imageModeration';
import PostActionMenu from './PostActionMenu';
import PostReactions from './PostReactions';
import { getReactions } from '../lib/reactions';
import { haptics } from '../lib/haptics';
import RecapCard from './RecapCard';
import ShareButton from './ShareButton';
import { recapSourceFromPost, getRecapCardWithSponsor } from '../lib/recapCard';
import { MentionInput, MentionText } from './Mentions';
import { savePostMentions, saveCommentMentions, mentionMapFromRows } from '../lib/mentions';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', card: '#112236', border: 'rgba(46,91,140,0.4)',
};

const TAGS = [
  { label: 'Goal Alert', color: '#D72638' },
  { label: 'Game Recap', color: '#2E5B8C' },
  { label: 'Practice', color: '#F59E0B' },
  { label: 'Lineup', color: '#22C55E' },
  { label: 'Travel', color: '#0EA5E9' },
  { label: 'Question', color: '#8BA3BE' },
];

// Tap-to-fullscreen lightbox.
function MediaLightbox({ url, type, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <button onClick={onClose}
        style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 999, width: 40, height: 40, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
      {type === 'video'
        ? <video src={url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 10 }} onClick={e => e.stopPropagation()}/>
        : <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 10, objectFit: 'contain' }} onClick={e => e.stopPropagation()}/>}
    </div>
  );
}

function MediaDisplay({ url, type }) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  if (type === 'video') return (
    <>
      {/* Reserved 16:9 box — no layout shift while the poster frame loads. */}
      <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', marginBottom: 10, background: '#000' }}>
        <video src={url} controls playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
        <button onClick={() => setOpen(true)}
          style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', zIndex: 1 }}>⤢</button>
      </div>
      {open && <MediaLightbox url={url} type="video" onClose={() => setOpen(false)} />}
    </>
  );
  return (
    <>
      {/* Reserved 5:4 box + blur-up — the page never jumps when the photo
          decodes, and a slow rink connection gets a designed shimmer. */}
      <Img src={url} alt="Post" ratio={5 / 4} radius={10} loading="lazy"
        onClick={() => setOpen(true)} style={{ marginBottom: 10, cursor: 'zoom-in' }} />
      {open && <MediaLightbox url={url} type="image" onClose={() => setOpen(false)} />}
    </>
  );
}

function PostCard({ post, currentUser, isLiked, reactions, onLike, onCommentChange, onPostHidden, onPostDelete, onUserBlocked }) {
  const navigate = useNavigate();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentMentionIds, setCommentMentionIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const profile = post.profiles;
  const postMentionMap = mentionMapFromRows(post.post_mentions);

  const loadAndToggle = async () => {
    if (!showComments) { const c = await getComments(post.id); setComments(c); }
    setShowComments(v => !v);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !currentUser) return;
    setSubmitting(true);
    const mentionIds = commentMentionIds;
    const { data, error } = await createComment(post.id, currentUser.id, commentText);
    if (error) { setSubmitting(false); alert("That comment didn't post — check your connection and try again."); return; }
    if (data?.id && mentionIds.length) {
      saveCommentMentions(data.id, mentionIds).then(({ error: mErr }) => {
        if (mErr) console.warn('[TeamFeed comment] mention save failed:', mErr?.message || mErr);
      });
    }
    const c = await getComments(post.id);
    setComments(c); setCommentText(''); setCommentMentionIds([]); setSubmitting(false);
    onCommentChange?.();
  };

  return (
    <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 12, overflow: 'hidden' }}>
      {post.tag && <div style={{ height: 3, background: post.tag_color || C.blue }}/>}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div onClick={() => navigate(`/profile/${profile?.id}`)} style={{ cursor: 'pointer' }}><Avatar profile={profile} size={38} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span onClick={() => navigate(`/profile/${profile?.id}`)} style={{ fontWeight: 600, fontSize: 14, color: C.ice, cursor: 'pointer', textDecoration: 'underline' }}>{profile?.name || 'Player'}</span>
              <TierBadge tier={profile?.tier || 'Mite'} size="xs" />
              {post.tag && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', background: (post.tag_color || C.blue) + '22', color: post.tag_color || C.blue, border: `1px solid ${(post.tag_color || C.blue)}44`, borderRadius: 4, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em' }}>{post.tag}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.steel, marginTop: 1 }}>@{profile?.handle} · {profile?.position} · {timeAgo(post.created_at)}</div>
          </div>
          <PostActionMenu
            kind="post"
            targetId={post.id}
            authorId={post.author_id}
            authorHandle={profile?.handle}
            currentUserId={currentUser?.id}
            onReported={() => onPostHidden?.(post.id)}
            onBlocked={() => onUserBlocked?.(post.author_id)}
            onDeleted={() => onPostHidden?.(post.id)}
            onDelete={onPostDelete ? () => onPostDelete(post) : undefined}
          />
        </div>
        {post.content && <p style={{ fontSize: 15, color: C.ice, lineHeight: 1.55, marginBottom: 10, wordBreak: 'break-word' }}><MentionText text={post.content} mentions={postMentionMap} /></p>}
        <MediaDisplay url={post.media_url} type={post.media_type} />
        {post.recap_for_game_id && (
          <div style={{ margin: '4px 0 10px' }}>
            <RecapCard gameId={post.recap_for_game_id} source={recapSourceFromPost(post)} />
            <div style={{ marginTop: 8 }}>
              <ShareButton gameId={post.recap_for_game_id} isLeague={!!post.league_id} variant="ghost" cardType="recapv2"
                getCard={async () => (await getRecapCardWithSponsor(post.recap_for_game_id, recapSourceFromPost(post))).data} />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <button onClick={() => onLike(post.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: isLiked ? C.red : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: 0 }}>
            {isLiked ? <Icon name="like" size={16} color="#D72638" /> : <Icon name="like" size={16} />}
            <span style={{ fontWeight: isLiked ? 600 : 400 }}>{post.likes || 0}</span>
          </button>
          <button onClick={loadAndToggle} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: showComments ? C.ice : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: 0 }}>
            <Icon name="comment" size={16} /><span>{post.comment_count || 0}</span>
          </button>
          <PostReactions postId={post.id} currentUserId={currentUser?.id} initial={reactions} />
        </div>
        {showComments && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Avatar profile={c.profiles} size={28} />
                <div style={{ flex: 1, background: C.navy, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, marginBottom: 2 }}>{c.profiles?.name} <span style={{ fontWeight: 400, color: C.steel }}>· {timeAgo(c.created_at)}</span></div>
                      <div style={{ fontSize: 13, color: C.ice }}><MentionText text={c.content} mentions={mentionMapFromRows(c.comment_mentions)} /></div>
                    </div>
                    <PostActionMenu
                      kind="comment"
                      targetId={c.id}
                      authorId={c.author_id}
                      authorHandle={c.profiles?.handle}
                      currentUserId={currentUser?.id}
                      onReported={() => setComments(prev => prev.filter(x => x.id !== c.id))}
                      onBlocked={() => {
                        setComments(prev => prev.filter(x => x.author_id !== c.author_id));
                        onUserBlocked?.(c.author_id);
                      }}
                      onDeleted={() => {
                        setComments(prev => prev.filter(x => x.id !== c.id));
                        onCommentChange?.();
                      }}
                      onDelete={() => {
                        // Optimistic remove + restore (the menu wraps this in a 5s Undo).
                        const idx = comments.findIndex(x => x.id === c.id);
                        setComments(prev => prev.filter(x => x.id !== c.id));
                        onCommentChange?.();
                        return () => {
                          setComments(prev => prev.some(x => x.id === c.id)
                            ? prev
                            : (() => { const n = [...prev]; n.splice(idx < 0 ? n.length : Math.min(idx, n.length), 0, c); return n; })());
                          onCommentChange?.();
                        };
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {currentUser && (
              <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Avatar profile={currentUser} size={28} />
                <MentionInput value={commentText} onChange={setCommentText} onMentionsChange={setCommentMentionIds}
                  placeholder="Add a comment… use @ to tag" maxLength={280} rows={1}
                  style={{ flex: 1 }}
                  textareaStyle={{ padding: '8px 12px', borderRadius: 8, background: C.navy, border: `1px solid ${C.border}`, color: C.ice, fontSize: 13, fontFamily: "'Barlow', sans-serif", lineHeight: 1.4 }}/>
                <button type="submit" disabled={!commentText.trim() || submitting}
                  style={{ padding: '8px 14px', borderRadius: 8, background: commentText.trim() ? C.red : C.border, color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Post</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Team-scoped feed: posts.team_id is set on insert so only this team's roster
 * + followers see them on the team page.
 */
export default function TeamFeed({ teamId, currentUser, isMember }) {
  const [posts, setPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [reactionMap, setReactionMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const online = useOnline();
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState('');
  const [postMentionIds, setPostMentionIds] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [posting, setPosting] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await getTeamPosts(teamId, 50);
      const page = data || [];
      setPosts(page);
      if (currentUser) {
        const liked = await getLikedPosts(currentUser.id, page.map(p => p.id));
        setLikedPosts(liked);
      }
      setReactionMap(await getReactions(currentUser?.id, page.map(p => p.id)));
    } catch (e) {
      // A network drop / server hiccup must surface a retry, never hang the
      // skeleton forever.
      console.error('[TeamFeed] load failed', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [teamId, currentUser]);

  useEffect(() => { load(); }, [load]);

  const onMediaSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video');
    const maxMB = isVideo ? 50 : 10;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`${isVideo ? 'Video' : 'Image'} is ${(file.size / 1024 / 1024).toFixed(1)}MB — max ${maxMB}MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!isVideo) {
      const verdict = await classifyImage(file);
      if (!verdict.ok) {
        alert('Looks like this image may violate Rinkd\'s community guidelines. Try a different one.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        track('upload_blocked_nsfw', { label: verdict.label, score: verdict.score, scope: 'team' });
        return;
      }
    }
    setMediaFile(file);
    setMediaPreview({ url: URL.createObjectURL(file), type: isVideo ? 'video' : 'image' });
  };

  const removeMedia = () => { setMediaFile(null); setMediaPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const onPost = async (e) => {
    e.preventDefault();
    if ((!content.trim() && !mediaFile) || !currentUser) return;
    setPosting(true);
    let mediaUrl = null, mediaType = null;
    if (mediaFile) {
      const { url, mediaType: mt, error } = await uploadMedia(mediaFile, currentUser.id);
      if (error) { setPosting(false); alert("That upload didn't go through — check your connection and try again."); return; }
      mediaUrl = url; mediaType = mt;
    }
    const { data, error } = await createPost(currentUser.id, {
      content: content.trim(),
      tag: selectedTag?.label || null,
      tagColor: selectedTag?.color || null,
      mediaUrl, mediaType,
      teamId,
    });
    if (error) { setPosting(false); alert("That post didn't go up — check your connection and try again."); return; }
    if (data?.id && postMentionIds.length) {
      const { error: mErr } = await savePostMentions(data.id, postMentionIds);
      if (mErr) console.warn('[TeamFeed post] mention save failed:', mErr?.message || mErr);
    }
    track('post_created', { has_media: !!mediaUrl, media_type: mediaType, tag: selectedTag?.label, scope: 'team', team_id: teamId });
    setContent(''); setPostMentionIds([]); setSelectedTag(null); removeMedia(); setComposerOpen(false);
    await load(); setPosting(false);
  };

  // Race-safe like handler — same pattern as Feed.js handleLike v2.
  // Derive the next liked state INSIDE the functional updater so rapid taps
  // see the freshest array, and gate concurrent network calls with an
  // in-flight ref so a burst of taps converges on a single round-trip.
  const likeInFlightRef = useRef(new Set());

  const onLike = (postId) => {
    if (!currentUser) return;

    let nextLiked = null;
    setLikedPosts(prev => {
      nextLiked = !prev.includes(postId);
      return nextLiked ? [...prev, postId] : prev.filter(id => id !== postId);
    });
    if (nextLiked) haptics.like();
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, likes: nextLiked ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 0) - 1) }
      : p
    ));

    if (likeInFlightRef.current.has(postId)) return;
    likeInFlightRef.current.add(postId);

    (async () => {
      try {
        const { liked, error } = await toggleLike(postId, currentUser.id);
        if (error) throw error;
        // Snap to server truth if our final optimistic state diverged.
        setLikedPosts(prev => {
          const currentlyLiked = prev.includes(postId);
          if (currentlyLiked === liked) return prev;
          return liked ? [...prev, postId] : prev.filter(id => id !== postId);
        });
      } catch (_e) {
        // Rollback to pre-tap state. Functional updater so we don't double-toggle.
        setLikedPosts(prev => nextLiked ? prev.filter(id => id !== postId) : [...prev, postId]);
        setPosts(prev => prev.map(p => p.id === postId
          ? { ...p, likes: nextLiked ? Math.max(0, (p.likes || 0) - 1) : (p.likes || 0) + 1 }
          : p
        ));
      } finally {
        likeInFlightRef.current.delete(postId);
      }
    })();
  };

  // RESILIENCE — optimistic post delete. Removes the row now and returns a
  // restore fn; PostActionMenu wraps both in a 5-second Undo toast and only
  // fires the irreversible server delete once it expires.
  const removePostOptimistic = (post) => {
    const idx = posts.findIndex(p => p.id === post.id);
    setPosts(prev => prev.filter(p => p.id !== post.id));
    return () => setPosts(prev => prev.some(p => p.id === post.id)
      ? prev
      : (() => { const next = [...prev]; next.splice(idx < 0 ? next.length : Math.min(idx, next.length), 0, post); return next; })());
  };

  return (
    <div>
      {/* COMPOSER (members only) */}
      {currentUser && isMember && (
        <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 14, padding: 14 }}>
          {!composerOpen ? (
            <div onClick={() => setComposerOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <Avatar profile={currentUser} size={34} />
              <div style={{ flex: 1, padding: '9px 14px', borderRadius: 999, background: C.navy, color: C.steel, fontSize: 14, fontFamily: "'Barlow', sans-serif" }}>
                Share with the team…
              </div>
            </div>
          ) : (
            <form onSubmit={onPost}>
              <MentionInput value={content} onChange={setContent} onMentionsChange={setPostMentionIds}
                placeholder="What's happening with the team? Tag with @" maxLength={500} rows={3} autoFocus
                style={{ marginBottom: 10 }}
                textareaStyle={{ padding: 10, borderRadius: 8, background: C.navy, border: `1px solid ${C.border}`, color: C.ice, fontSize: 14, fontFamily: "'Barlow', sans-serif", resize: 'vertical' }}/>
              {mediaPreview && (
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  {mediaPreview.type === 'video'
                    ? <video src={mediaPreview.url} style={{ width: '100%', maxHeight: 200, borderRadius: 10 }} controls/>
                    : <img src={mediaPreview.url} alt="preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }}/>}
                  <button type="button" onClick={removeMedia}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 999, width: 26, height: 26, fontSize: 14, cursor: 'pointer' }}>×</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {TAGS.map(tag => (
                  <button key={tag.label} type="button" onClick={() => setSelectedTag(selectedTag?.label === tag.label ? null : tag)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: selectedTag?.label === tag.label ? tag.color : tag.color + '22', color: selectedTag?.label === tag.label ? 'white' : tag.color, fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em' }}>{tag.label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={onMediaSelect} style={{ display: 'none' }} id={`team-media-${teamId}`}/>
                  <label htmlFor={`team-media-${teamId}`} style={{ padding: '7px 12px', borderRadius: 8, cursor: 'pointer', background: C.navy, border: `1px solid ${C.border}`, color: C.steel, fontSize: 18, display: 'flex', alignItems: 'center' }}><Icon name="camera" size={18} /></label>
                  <span style={{ fontSize: 12, color: C.steel }}>{content.length}/500</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => { setComposerOpen(false); removeMedia(); setContent(''); setSelectedTag(null); }}
                    style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.steel, fontFamily: "'Barlow', sans-serif", cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                  <button type="submit" disabled={(!content.trim() && !mediaFile) || posting}
                    style={{ padding: '8px 20px', borderRadius: 8, background: (content.trim() || mediaFile) ? C.red : C.border, color: 'white', border: 'none', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 15, letterSpacing: '0.05em' }}>
                    {posting ? 'Posting...' : 'Post It →'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* POSTS */}
      {loading ? (
        <FeedSkeleton count={2} />
      ) : error ? (
        <ErrorState
          title="Couldn’t load the feed"
          offline={!online}
          onRetry={load}
          retrying={loading}
        />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="📣"
          title={isMember ? 'Nothing here yet' : 'No team posts yet'}
          body={isMember ? 'Be the first to share with the team — practice notes, game recaps, locker-room hype.' : 'When the team starts sharing updates, they\'ll show up here.'}
          cta={isMember && currentUser ? { label: 'Drop a Post', onClick: () => setComposerOpen(true) } : null}
        />
      ) : posts.map(post => (
        <PostCard key={post.id} post={post} currentUser={currentUser}
          isLiked={likedPosts.includes(post.id)} reactions={reactionMap[post.id]} onLike={onLike}
          onCommentChange={load}
          onPostHidden={(id) => setPosts(prev => prev.filter(p => p.id !== id))}
          onPostDelete={removePostOptimistic}
          onUserBlocked={(uid) => setPosts(prev => prev.filter(p => p.author_id !== uid))}
        />
      ))}
    </div>
  );
}
