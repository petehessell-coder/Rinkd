import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout, { BRAND_COLORS as C } from '../components/Layout';
import { Avatar, TierBadge } from '../components/Logos';
import { getPosts, getFollowingPosts, createPost, toggleLike, getLikedPosts, getComments, createComment, uploadMedia, timeAgo } from '../lib/posts';
import PushPrompt from '../components/PushPrompt';
import { track } from '../lib/analytics';
import { FeedSkeleton, EmptyState } from '../components/Skeletons';

const TAGS = [
  { label: 'Goal Alert', color: '#D72638' },
  { label: 'Game Recap', color: '#2E5B8C' },
  { label: 'Beer League', color: '#F59E0B' },
  { label: 'Youth Hockey', color: '#22C55E' },
  { label: 'Training', color: '#0EA5E9' },
  { label: 'Hot Take', color: '#8B5CF6' },
  { label: 'Trade Talk', color: '#EC4899' },
  { label: 'Question', color: '#8BA3BE' },
];

// Tap-to-fullscreen lightbox so highlight clips and goal photos actually look
// like highlight clips and goal photos.
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
        style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 999, width: 40, height: 40, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
        ×
      </button>
      {type === 'video'
        ? <video src={url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 10 }} onClick={e => e.stopPropagation()}/>
        : <img src={url} alt="Post media" style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 10, objectFit: 'contain' }} onClick={e => e.stopPropagation()}/>}
    </div>
  );
}

function MediaDisplay({ url, type }) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  if (type === 'video') return (
    <>
      <div style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 10, background: '#000', position: 'relative' }}>
        <video src={url} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 400, display: 'block' }}/>
        <button onClick={() => setOpen(true)} title="Open fullscreen"
          style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
          ⤢
        </button>
      </div>
      {open && <MediaLightbox url={url} type="video" onClose={() => setOpen(false)} />}
    </>
  );
  return (
    <>
      <div onClick={() => setOpen(true)} style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 10, cursor: 'zoom-in' }}>
        <img src={url} alt="Post" style={{ width: '100%', maxHeight: 500, objectFit: 'cover', display: 'block' }} loading="lazy"/>
      </div>
      {open && <MediaLightbox url={url} type="image" onClose={() => setOpen(false)} />}
    </>
  );
}

function PostCard({ post, currentUser, likedPosts, onLike, onComment }) {
  const navigate = useNavigate();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isLiked = likedPosts.includes(post.id);
  const profile = post.profiles;

  const loadComments = async () => {
    if (!showComments) { const c = await getComments(post.id); setComments(c); }
    setShowComments(v => !v);
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmitting(true);
    await createComment(post.id, currentUser.id, commentText);
    const c = await getComments(post.id);
    setComments(c); setCommentText(''); setSubmitting(false); onComment();
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
        </div>
        {post.content && <p style={{ fontSize: 15, color: C.ice, lineHeight: 1.55, marginBottom: 10, wordBreak: 'break-word' }}>{post.content}</p>}
        <MediaDisplay url={post.media_url} type={post.media_type} />
        {post.livebarn_venue_id && (
          <a href={"https://watch.livebarn.com/en/videoplayer?venueid=" + post.livebarn_venue_id + "&referrer=rinkd"} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, marginBottom: 10, background: 'rgba(46,91,140,0.2)', border: '1px solid #2E5B8C', color: '#F4F7FA', fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}>
            <span style={{ fontSize: 16 }}>📺</span> Watch Live on LiveBarn
          </a>
        )}
        <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <button onClick={() => onLike(post.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: isLiked ? C.red : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: 0 }}>
            <span style={{ fontSize: 16 }}>{isLiked ? '❤️' : '🤍'}</span>
            <span style={{ fontWeight: isLiked ? 600 : 400 }}>{post.likes || 0}</span>
          </button>
          <button onClick={loadComments} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: showComments ? C.ice : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: 0 }}>
            <span style={{ fontSize: 16 }}>💬</span><span>{post.comment_count || 0}</span>
          </button>
        </div>
        {showComments && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            {comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Avatar profile={c.profiles} size={28} />
                <div style={{ flex: 1, background: C.navy, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, marginBottom: 2 }}>{c.profiles?.name} <span style={{ fontWeight: 400, color: C.steel }}>· {timeAgo(c.created_at)}</span></div>
                  <div style={{ fontSize: 13, color: C.ice }}>{c.content}</div>
                </div>
              </div>
            ))}
            {currentUser && (
              <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Avatar profile={currentUser} size={28} />
                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a comment..." maxLength={280}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: C.navy, border: `1px solid ${C.border}`, color: C.ice, fontSize: 13, outline: 'none', fontFamily: "'Barlow', sans-serif" }}/>
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

export default function Feed({ currentUser, profile }) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [posting, setPosting] = useState(false);
  const [tab, setTab] = useState('foryou');
  const [livebarnId, setLivebarnId] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    let data;
    if (tab === 'following' && currentUser) {
      ({ data } = await getFollowingPosts(currentUser.id, 50));
    } else {
      ({ data } = await getPosts(50));
    }
    setPosts(data || []);
    if (currentUser) { const liked = await getLikedPosts(currentUser.id); setLikedPosts(liked); }
    setLoading(false);
  }, [currentUser, tab]);

  useEffect(() => { load(); }, [load]);

  const handleMediaSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Hard cap — Supabase free plan caps single uploads ~50MB, and big mobile clips
    // bomb out on flaky rinks-wifi anyway. Fail fast with a clear message.
    const isVideo = file.type.startsWith('video');
    const maxMB = isVideo ? 50 : 10;
    if (file.size > maxMB * 1024 * 1024) {
      // eslint-disable-next-line no-alert
      alert(`${isVideo ? 'Video' : 'Image'} is ${(file.size / 1024 / 1024).toFixed(1)}MB — max ${maxMB}MB. Trim a highlight or compress and try again.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setMediaFile(file);
    setMediaPreview({ url: URL.createObjectURL(file), type: isVideo ? 'video' : 'image' });
  };

  const removeMedia = () => { setMediaFile(null); setMediaPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handlePost = async (e) => {
    e.preventDefault();
    if ((!content.trim() && !mediaFile) || !currentUser) return;
    setPosting(true); setUploadProgress(0);
    let mediaUrl = null, mediaType = null;
    if (mediaFile) {
      setUploadProgress(30);
      const { url, mediaType: mt, error } = await uploadMedia(mediaFile, currentUser.id);
      if (error) { setPosting(false); alert('Upload failed. Please try again.'); return; }
      mediaUrl = url; mediaType = mt; setUploadProgress(80);
    }
    await createPost(currentUser.id, { content: content.trim(), tag: selectedTag?.label || null, tagColor: selectedTag?.color || null, mediaUrl, mediaType, livebarnVenueId: livebarnId.trim() || null });
    track('post_created', { has_media: !!mediaUrl, media_type: mediaType, tag: selectedTag?.label, scope: 'global', livebarn: !!livebarnId.trim() });
    setContent(''); setSelectedTag(null); setLivebarnId(''); removeMedia(); setComposerOpen(false); setUploadProgress(0);
    await load(); setPosting(false);
  };

  const handleLike = async (postId) => {
    if (!currentUser) return;
    const { liked } = await toggleLike(postId, currentUser.id);
    setLikedPosts(prev => liked ? [...prev, postId] : prev.filter(id => id !== postId));
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: liked ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 0) - 1) } : p));
  };

  return (
    <Layout profile={profile}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
        <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 32, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 20 }}>Feed</h1>

        <PushPrompt userId={currentUser?.id} />
        
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: C.navy, borderRadius: 10, padding: 4, border: `1px solid ${C.border}` }}>
          {[{ id: 'foryou', label: 'For You' }, { id: 'following', label: 'Following' }, { id: 'leagues', label: 'Leagues' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: tab === t.id ? C.blue : 'transparent', color: tab === t.id ? C.ice : C.steel, fontFamily: "'Barlow', sans-serif", fontWeight: tab === t.id ? 600 : 400, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' }}>{t.label}</button>
          ))}
        </div>

        {currentUser && (
          <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 16, overflow: 'hidden' }}>
            {!composerOpen ? (
              <button onClick={() => setComposerOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Avatar profile={profile} size={36} />
                <span style={{ flex: 1, color: C.steel, fontSize: 15, fontFamily: "'Barlow', sans-serif", textAlign: 'left' }}>What's happening on the ice?</span>
                <span style={{ padding: '6px 14px', borderRadius: 8, background: C.red, color: 'white', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13 }}>POST</span>
              </button>
            ) : (
              <form onSubmit={handlePost} style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <Avatar profile={profile} size={36} />
                  <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="What's happening on the ice?" maxLength={500} rows={3} autoFocus
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: C.navy, border: `1.5px solid ${C.blue}`, color: C.ice, fontSize: 15, outline: 'none', resize: 'none', fontFamily: "'Barlow', sans-serif", lineHeight: 1.5 }}/>
                </div>
                {mediaPreview && (
                  <div style={{ position: 'relative', marginBottom: 12, borderRadius: 10, overflow: 'hidden' }}>
                    {mediaPreview.type === 'video'
                      ? <video src={mediaPreview.url} style={{ width: '100%', maxHeight: 200, borderRadius: 10 }} controls/>
                      : <img src={mediaPreview.url} alt="preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }}/>
                    }
                    <button type="button" onClick={removeMedia} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                )}
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div style={{ height: 3, background: C.border, borderRadius: 2, marginBottom: 12 }}>
                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: C.blue, borderRadius: 2, transition: 'width 0.3s' }}/>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {TAGS.map(tag => (
                    <button key={tag.label} type="button" onClick={() => setSelectedTag(selectedTag?.label === tag.label ? null : tag)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: selectedTag?.label === tag.label ? tag.color : tag.color + '22', color: selectedTag?.label === tag.label ? 'white' : tag.color, fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em' }}>{tag.label}</button>
                  ))}
                </div>
                <input value={livebarnId} onChange={e => setLivebarnId(e.target.value)} placeholder="📺 LiveBarn Venue ID (optional)" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, background: C.navy, border: '1px solid ' + C.border, color: C.ice, fontSize: 13, outline: 'none', fontFamily: "'Barlow', sans-serif", marginBottom: 10, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaSelect} style={{ display: 'none' }} id="media-upload"/>
                    <label htmlFor="media-upload" style={{ padding: '7px 12px', borderRadius: 8, cursor: 'pointer', background: C.navy, border: `1px solid ${C.border}`, color: C.steel, fontSize: 18, display: 'flex', alignItems: 'center' }}>📷</label>
                    <span style={{ fontSize: 12, color: C.steel }}>{content.length}/500</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => { setComposerOpen(false); removeMedia(); }} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.steel, fontFamily: "'Barlow', sans-serif", cursor: 'pointer', fontSize: 13 }}>Cancel</button>
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

        {loading ? (
          <FeedSkeleton count={4} />
        ) : posts.length === 0 ? (
          <EmptyState
            icon="🏒"
            title={tab === 'following' ? 'Your following feed is quiet' : 'No posts yet'}
            body={tab === 'following' ? 'Follow some players and teams to see their highlights and updates here.' : 'Be the first to drop something on the ice. Photos, video clips, goal alerts — all welcome.'}
            cta={tab === 'following' ? { label: 'Discover Players', onClick: () => navigate('/discover') } : { label: 'Drop a Post', onClick: () => setComposerOpen(true) }}
          />
        ) : posts.map(post => (
          <PostCard key={post.id} post={post} currentUser={currentUser} likedPosts={likedPosts} onLike={handleLike} onComment={load} />
        ))}
      </div>
    </Layout>
  );
}
