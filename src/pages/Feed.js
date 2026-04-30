import React, { useState, useEffect, useContext, useCallback } from 'react';
import { AuthContext } from '../App';
import { Avatar } from '../components/Layout';
import { TierBadge } from '../components/Logos';
import { getPosts, createPost, toggleLike, getLikedPosts, getComments, createComment } from '../lib/posts';
import { getTier } from '../lib/tiers';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', dark: '#07111F', card: '#112236', card2: '#0D2A47',
  lgray: '#8BA3BE', mgray: '#4A6180', border: '#1E3A5C',
};

const TAGS = ['GOAL ALERT','HIGHLIGHT','GAME RECAP','BEER LEAGUE','COACH\'S CORNER','QUESTION','TRADE REQUEST','RINKSIDE'];
const TAG_COLORS = { 'GOAL ALERT':'#D72638','HIGHLIGHT':'#2E5B8C','GAME RECAP':'#22C55E','BEER LEAGUE':'#F59E0B','COACH\'S CORNER':'#60A5FA','QUESTION':'#8B5CF6','TRADE REQUEST':'#F97316','RINKSIDE':'#2E5B8C','POST':'#2E5B8C' };
const HASHTAGS = ['#BarDown','#BeerLeague','#Bantam','#GoalAlert','#Rinkside','#NeverStopPlaying'];
const FEED_TABS = ['FOR YOU','FOLLOWING','LEAGUES'];

function Composer({ onPost, profile }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [tag, setTag] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const tagColor = TAG_COLORS[tag] || C.blue;
      await onPost({ content: text, tag: tag || 'POST', tagColor });
      setText(''); setTag(''); setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: C.card, borderRadius: 12, padding: '12px 14px', marginBottom: 12, border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Avatar user={profile} size={38} />
        <button onClick={() => setOpen(o => !o)} style={{
          flex: 1, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 24,
          padding: '10px 16px', color: C.mgray, fontSize: 13, textAlign: 'left',
        }}>
          {open ? '' : "What's happening on the ice? 🏒"}
        </button>
        {!open && <div style={{ display: 'flex', gap: 8 }}><span style={{ fontSize: 18 }}>📸</span></div>}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <textarea
            autoFocus value={text} onChange={e => setText(e.target.value)}
            placeholder="What's happening on the ice? 🏒" rows={3}
            style={{ width: '100%', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', resize: 'none', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {HASHTAGS.map(h => (
              <button key={h} onClick={() => setText(t => t + ' ' + h)} style={{ background: `${C.blue}22`, border: `1px solid ${C.blue}44`, borderRadius: 16, color: C.blue, fontSize: 11, padding: '3px 10px', fontFamily: "'Barlow Condensed'" }}>{h}</button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <select value={tag} onChange={e => setTag(e.target.value)} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.lgray, fontSize: 12, padding: '6px 10px', outline: 'none' }}>
              <option value="">Tag your post...</option>
              {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setOpen(false)} style={{ color: C.lgray, fontSize: 13, padding: '8px 14px' }}>Cancel</button>
              <button onClick={submit} disabled={submitting || !text.trim()} style={{ background: submitting || !text.trim() ? C.mgray : C.red, color: '#fff', borderRadius: 8, padding: '8px 20px', fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 13, letterSpacing: '0.08em' }}>
                {submitting ? '...' : 'POST'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, currentUser, likedPosts, onLikeToggle }) {
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [localLiked, setLocalLiked] = useState(likedPosts.includes(post.id));
  const [localLikes, setLocalLikes] = useState(post.likes || 0);

  const author = post.profiles || {};
  const tier = getTier(0);
  const tagColor = TAG_COLORS[post.tag] || C.blue;

  const handleLike = async () => {
    const wasLiked = localLiked;
    setLocalLiked(!wasLiked);
    setLocalLikes(l => wasLiked ? l - 1 : l + 1);
    try {
      await onLikeToggle(post.id);
    } catch {
      setLocalLiked(wasLiked);
      setLocalLikes(l => wasLiked ? l + 1 : l - 1);
    }
  };

  const loadComments = async () => {
    if (!showComments) {
      setLoadingComments(true);
      try {
        const data = await getComments(post.id);
        setComments(data);
      } finally {
        setLoadingComments(false);
      }
    }
    setShowComments(s => !s);
  };

  const submitComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const c = await createComment({ postId: post.id, authorId: currentUser.id, content: commentText });
      setComments(prev => [...prev, c]);
      setCommentText('');
    } finally {
      setSubmittingComment(false);
    }
  };

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <article style={{ background: C.card, borderRadius: 12, marginBottom: 12, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      {/* Tag bar */}
      <div style={{ background: tagColor, padding: '4px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 10, color: '#fff', letterSpacing: '0.15em' }}>{post.tag || 'POST'}</span>
        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>{timeAgo(post.created_at)}</span>
      </div>

      {/* User row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 8px' }}>
        <Avatar user={author} size={40} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 15, color: '#fff' }}>{author.name || 'Rinkd User'}</span>
            <TierBadge tier={getTier(0)} size="sm" />
          </div>
          <div style={{ color: C.lgray, fontSize: 11 }}>@{author.handle || 'user'} {author.position ? `· ${author.position}` : ''}</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '0 14px 12px', color: '#E8F4FD', fontSize: 14, lineHeight: 1.55 }}>{post.content}</div>

      {/* Actions */}
      <div style={{ borderTop: `1px solid ${C.border}`, display: 'flex', padding: '4px 6px' }}>
        <button onClick={handleLike} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 6, background: localLiked ? `${C.red}18` : 'transparent' }}>
          <span style={{ fontSize: 16 }}>{localLiked ? '🚨' : '🏒'}</span>
          <span style={{ color: localLiked ? C.red : C.lgray, fontSize: 12, fontWeight: localLiked ? 700 : 400 }}>{localLikes}</span>
        </button>
        <button onClick={loadComments} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 6 }}>
          <span style={{ fontSize: 16 }}>💬</span>
          <span style={{ color: showComments ? C.blue : C.lgray, fontSize: 12 }}>{post.comment_count || 0}</span>
        </button>
        <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 10px', borderRadius: 6 }}>
          <span style={{ fontSize: 16 }}>↗</span>
          <span style={{ color: C.lgray, fontSize: 12 }}>{post.repost_count || 0}</span>
        </button>
        <button style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 10px', borderRadius: 6 }}>
          <span style={{ fontSize: 16 }}>🔖</span>
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px' }}>
          {loadingComments ? (
            <div style={{ color: C.mgray, fontSize: 12, textAlign: 'center', padding: '8px 0' }}>Loading...</div>
          ) : (
            comments.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <Avatar user={c.profiles || {}} size={28} />
                <div style={{ background: C.card2, borderRadius: 8, padding: '7px 10px', flex: 1 }}>
                  <div style={{ color: C.lgray, fontSize: 10, marginBottom: 3 }}>{c.profiles?.name || 'User'}</div>
                  <div style={{ color: '#E8F4FD', fontSize: 13 }}>{c.content}</div>
                </div>
              </div>
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Avatar user={currentUser} size={28} />
            <input
              value={commentText} onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitComment()}
              placeholder="Add a comment..."
              style={{ flex: 1, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 20, padding: '7px 14px', color: '#fff', fontSize: 13, outline: 'none' }}
            />
            <button onClick={submitComment} disabled={submittingComment || !commentText.trim()} style={{ background: C.red, color: '#fff', borderRadius: 20, padding: '7px 14px', fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 12 }}>POST</button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function Feed() {
  const { user, profile } = useContext(AuthContext);
  const [posts, setPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const [postsData, likedData] = await Promise.all([
        getPosts(),
        user ? getLikedPosts(user.id) : Promise.resolve([]),
      ]);
      setPosts(postsData);
      setLikedPosts(likedData);
    } catch (err) {
      console.error('Error loading posts:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const handlePost = async ({ content, tag, tagColor }) => {
    const newPost = await createPost({ authorId: user.id, content, tag, tagColor });
    setPosts(prev => [newPost, ...prev]);
  };

  const handleLikeToggle = async (postId) => {
    const liked = await toggleLike(postId, user.id);
    setLikedPosts(prev => liked ? [...prev, postId] : prev.filter(id => id !== postId));
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
      <div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {FEED_TABS.map((t, i) => (
            <button key={i} onClick={() => setActiveTab(i)} style={{
              flex: 1, padding: '9px 0',
              background: activeTab === i ? C.red : C.card,
              border: `1px solid ${activeTab === i ? C.red : C.border}`,
              borderRadius: 8, color: activeTab === i ? '#fff' : C.lgray,
              fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 12, letterSpacing: '0.1em',
            }}>{t}</button>
          ))}
        </div>

        {profile && <Composer onPost={handlePost} profile={profile} />}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ background: C.card, borderRadius: 12, height: 160, border: `1px solid ${C.border}`, animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏒</div>
            <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, color: '#fff', marginBottom: 8 }}>BE THE FIRST TO POST</div>
            <div style={{ color: C.lgray, fontSize: 14 }}>The ice is fresh. Drop a goal, a highlight, or just say what's up.</div>
          </div>
        ) : (
          posts.map(p => (
            <PostCard
              key={p.id} post={p}
              currentUser={profile || {}}
              likedPosts={likedPosts}
              onLikeToggle={handleLikeToggle}
            />
          ))
        )}
      </div>

      {/* Right sidebar */}
      <div style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
        {profile && (
          <div style={{ background: C.card, borderRadius: 12, padding: '16px', marginBottom: 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Avatar user={profile} size={44} />
              <div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 15, color: '#fff' }}>{profile.name}</div>
                <div style={{ color: C.lgray, fontSize: 11 }}>@{profile.handle}</div>
                <div style={{ color: getTier(profile.points || 0).color, fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed'", letterSpacing: '0.06em', marginTop: 2 }}>
                  {getTier(profile.points || 0).name.toUpperCase()} · {profile.points || 0} pts
                </div>
              </div>
            </div>
            {/* tier bar */}
            <div style={{ background: C.card2, borderRadius: 4, height: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${getTier(profile.points||0).color}88, ${getTier(profile.points||0).color})`, width: `${Math.min(((profile.points||0) - getTier(profile.points||0).minPts) / (getTier(profile.points||0).maxPts - getTier(profile.points||0).minPts) * 100, 100)}%` }} />
            </div>
          </div>
        )}

        <div style={{ background: C.card, borderRadius: 12, padding: '14px 16px', border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 13, color: '#fff', letterSpacing: '0.08em', marginBottom: 10 }}>TRENDING 🔥</div>
          {[['#BarDown','2.4K posts',C.red],['#BeerLeague','1.8K posts',C.blue],['#Crease','987 posts','#F5C842'],['#GoalAlert','743 posts','#22C55E']].map(([t,p,c]) => (
            <div key={t} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: c, fontFamily: "'Barlow Condensed'", fontWeight: 700, fontSize: 13 }}>{t}</span>
              <span style={{ color: C.mgray, fontSize: 11 }}>{p}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @media (max-width: 900px) {
          div[style*="gridTemplateColumns"] { grid-template-columns: 1fr !important; }
          div[style*="position: sticky"] { display: none !important; }
        }
      `}</style>
    </div>
  );
}
