import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { C, colors } from '../lib/tokens';
import { Icon, useExpand, Img, ErrorState, useToast, EmptyState, SectionHeader } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { staggerStyle, useDelayedFlag } from '../lib/motion';
import TapeText from '../components/TapeText';
import { Avatar, TierBadge } from '../components/Logos';
import { getPosts, getFollowingPosts, createPost, toggleLike, getLikedPosts, uploadMedia, timeAgo } from '../lib/posts';
import PushPrompt from '../components/PushPrompt';
import { track } from '../lib/analytics';
import { FeedSkeleton, PostSkeleton } from '../components/Skeletons';
import GamedayStrip from '../components/Gameday/GamedayStrip';
import ReciprocityNudges from '../components/ReciprocityNudges';
import { classifyImage } from '../lib/imageModeration';
import PostActionMenu from '../components/PostActionMenu';
import PostReactions from '../components/PostReactions';
import { getReactions } from '../lib/reactions';
import { MentionInput, MentionText } from '../components/Mentions';
import { savePostMentions, mentionMapFromRows } from '../lib/mentions';
import CommentThread from '../components/CommentThread';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import ShareButton from '../components/ShareButton';
import { loadGameCardData } from '../lib/gameCardData';
import RecapCard from '../components/RecapCard';
import { recapSourceFromPost, getRecapCardWithSponsor } from '../lib/recapCard';
import { haptics } from '../lib/haptics';
import PullToRefresh from '../components/PullToRefresh';
import { prefetchGamePage, prefetchHandlers } from '../lib/prefetch';

// Feed page size — keyset pagination pulls this many chirps per request.
const PAGE_SIZE = 20;

const TAGS = [
  { label: 'Goal Alert', color: C.red },
  { label: 'Game Recap', color: C.blue },
  { label: 'Beer League', color: colors.warning },
  { label: 'Youth Hockey', color: colors.success },
  { label: 'Training', color: '#0EA5E9' },
  { label: 'Hot Take', color: colors.premium },
  { label: 'Trade Talk', color: '#EC4899' },
  { label: 'Question', color: C.steel },
];

// Rotating composer prompts — keeps the chirp box feeling alive instead of a
// dead "What's the chirp?". Cycles while the composer is collapsed; when the
// user opens it, whatever prompt was showing becomes the ghost text.
const CHIRP_STARTERS = [
  "What's the chirp?",
  "Who's got a game tonight? 🏒",
  'Hottest take in your beer league?',
  "Best goal you've seen this week?",
  'Brag about a W — or own the L.',
  'Drop a highlight clip 🎥',
  "Who's your line's MVP tonight?",
  'Beer-league nickname that needs a backstory?',
  'Rate the rink coffee ☕',
];

// One-time keyframe inject for the prompt crossfade + live pulse (app styles
// inline). The live dot uses the manifesto's "red light on" ring-expand and is
// disabled under prefers-reduced-motion.
if (typeof document !== 'undefined' && !document.getElementById('rinkd-feed-anim')) {
  const el = document.createElement('style');
  el.id = 'rinkd-feed-anim';
  el.textContent =
    '@keyframes rinkdStarterFade{0%{opacity:0;transform:translateY(3px)}100%{opacity:1;transform:translateY(0)}}'
    + '@keyframes rinkdLivePulse{0%{box-shadow:0 0 0 0 rgba(215,38,56,0.55)}70%{box-shadow:0 0 0 7px rgba(215,38,56,0)}100%{box-shadow:0 0 0 0 rgba(215,38,56,0)}}'
    // Manifesto like physics — on the ADD only: the heart springs 1.0→1.3→1.0
    // with the red fill landing during the bounce (color is applied on the same
    // tick the class mounts). The count slides up from -4px→0 as it increments.
    + '@keyframes rinkdLikePop{0%{transform:scale(1)}45%{transform:scale(1.3)}100%{transform:scale(1)}}'
    + '@keyframes rinkdLikeCount{0%{transform:translateY(-4px)}100%{transform:translateY(0)}}'
    + '.rinkd-like-pop{animation:rinkdLikePop 300ms cubic-bezier(0.34,1.56,0.64,1)}'
    + '.rinkd-like-count{animation:rinkdLikeCount 300ms ease-out}'
    + '.rinkd-live-dot{animation:rinkdLivePulse 1.5s ease-out infinite}'
    + '.rinkd-starter-fade{animation:rinkdStarterFade .5s ease}'
    // Honest upload — an INDETERMINATE sweep (we don't get true % from the SDK),
    // so a fixed-width slug travels the track on a 1.5s loop instead of faking a
    // percentage. Reduced motion collapses it to a static tinted bar.
    + '@keyframes rinkdIndeterminate{0%{transform:translateX(-140%)}100%{transform:translateX(320%)}}'
    + '.rinkd-indeterminate{animation:rinkdIndeterminate 1.5s cubic-bezier(0.4,0,0.2,1) infinite}'
    + '@media (prefers-reduced-motion: reduce){.rinkd-live-dot,.rinkd-starter-fade,.rinkd-like-pop,.rinkd-like-count{animation:none}.rinkd-indeterminate{animation:none;transform:none;width:100%!important;opacity:0.55}}';
  document.head.appendChild(el);
}

// Honest upload bar — an INDETERMINATE track (the storage SDK gives us no true
// progress %, so we don't fake 30→80 steps). A slug sweeps the rail on a 1.5s
// loop while the upload is in flight; reduced motion shows a static tinted bar
// (see the .rinkd-indeterminate rules above). Exported so Gallery reuses the
// exact same visual instead of a near-copy that can drift.
export function IndeterminateBar({ color = C.blue }) {
  return (
    <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
      <div className="rinkd-indeterminate"
        style={{ height: '100%', width: '45%', background: color, borderRadius: 2 }} />
    </div>
  );
}

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
      <button onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 999, width: 44, height: 44, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
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
      {/* Reserved 16:9 box — no layout shift while the poster frame loads. */}
      <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', marginBottom: 10, background: '#000' }}>
        <video src={url} controls playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
        <button onClick={() => setOpen(true)} title="Open fullscreen"
          style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', zIndex: 1 }}>
          ⤢
        </button>
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

// Pulsing red light — the manifesto's "red light on, siren" live indicator.
// Pure CSS ring-expand (see keyframes above); honors prefers-reduced-motion.
function LiveDot({ size = 7 }) {
  return (
    <span className="rinkd-live-dot" aria-hidden="true"
      style={{ width: size, height: size, borderRadius: 999, background: C.red, display: 'inline-block', flex: '0 0 auto' }} />
  );
}

// "LIVE" pill for cards backed by an actually-live stream (LiveBarn). Kept
// honest — only genuinely-live content claims LIVE.
function LiveBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
      padding: '3px 8px', borderRadius: 6,
      background: 'rgba(215,38,56,0.15)', border: '1px solid rgba(215,38,56,0.6)',
      color: C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
      fontStyle: 'italic', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      <LiveDot /> Live
    </span>
  );
}

// S10 — the feed section header is now the shared ui/SectionHeader (broadcast
// lower-third: white Barlow Condensed caps on a red-slab bar, pulsing LIVE dot).
// The former local BroadcastHeader was a hand-rolled copy of that primitive.

function PostCard({ post, currentUser, profile: viewerProfile, likedPosts, reactions, onLike, onComment, onCommentRemoved, onPostHidden, onPostDelete, onUserBlocked, index = 0 }) {
  const navigate = useNavigate();
  const expand = useExpand();
  const [showComments, setShowComments] = useState(false);
  const isLiked = likedPosts.includes(post.id);
  const profile = post.profiles;

  // F1 — manifesto like physics on the ADD transition only. We detect the
  // not-liked → liked flip and stamp a one-shot animation key so the heart
  // springs + the count slides. Un-like (liked → not) leaves `liked` false so
  // nothing animates — the color just snaps back. `keyof React` re-mounting the
  // animated nodes via `key` restarts the CSS animation on every fresh add.
  const wasLiked = useRef(isLiked);
  const [likeAnim, setLikeAnim] = useState(0);
  useEffect(() => {
    if (isLiked && !wasLiked.current) setLikeAnim((n) => n + 1);
    wasLiked.current = isLiked;
  }, [isLiked]);
  const postMentionMap = mentionMapFromRows(post.post_mentions);

  // Card-hero "live" treatment. Reserved for genuinely red-earning moments so
  // the glow stays scarce and meaningful (manifesto: red = live/urgent only).
  // A LiveBarn embed is an actually-live stream; a Goal Alert is the feed's
  // urgent game moment. Derived purely from fields already on the post — no
  // extra fetch, no change to data logic.
  const isLiveStream = !!post.livebarn_venue_id;
  const isLive = isLiveStream || post.tag === 'Goal Alert';

  // Comment threads now live in the shared <CommentThread> (one source of truth
  // across all four feeds). This just flips the thread open/closed; the
  // component lazy-loads + owns the optimistic list/composer/undo.
  const loadComments = () => setShowComments(v => !v);

  return (
    <div style={{
      // card-hero (surface #162f55, 1px red border glow, red drop-shadow) when
      // live so it floats above the flat standard cards; card-standard otherwise.
      background: isLive ? colors.surfaceElevated : C.card,
      borderRadius: 14,
      border: isLive ? '1px solid rgba(215,38,56,0.6)' : `1px solid ${C.border}`,
      boxShadow: isLive ? '0 8px 32px rgba(215,38,56,0.2)' : 'none',
      marginBottom: isLive ? 16 : 12,
      overflow: 'hidden',
      ...staggerStyle(index),
    }}>
      {post.tag && <div style={{ height: 3, background: post.tag_color || C.blue }}/>}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <div onClick={() => navigate(`/profile/${profile?.id}`)} style={{ cursor: 'pointer' }}><Avatar profile={profile} size={38} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span onClick={() => navigate(`/profile/${profile?.id}`)} style={{ fontWeight: 600, fontSize: 14, color: C.ice, cursor: 'pointer', textDecoration: 'underline', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.name || 'Player'}</span>
              <TierBadge tier={profile?.tier || 'Mite'} size="xs" />
              {post.tag && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', background: (post.tag_color || C.blue) + '22', color: post.tag_color || C.blue, border: `1px solid ${(post.tag_color || C.blue)}44`, borderRadius: 4, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em' }}>{post.tag}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.steel, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{profile?.handle} · {profile?.position} · {timeAgo(post.created_at)}</div>
          </div>
          {isLiveStream && <LiveBadge />}
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
        {post.content && <p style={{ fontSize: 15, color: C.ice, lineHeight: 1.55, marginBottom: 10, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}><MentionText text={post.content} mentions={postMentionMap} /></p>}
        <MediaDisplay url={post.media_url} type={post.media_type} />
        {/* Auto-recap posts link straight to the game page — saves the
            spectator from copy/pasting the URL out of the content body. */}
        {(post.recap_for_game_id || post.recap_for_league_game_id) && (
          <div style={{ marginBottom: 10 }}>
            <RecapCard gameId={post.recap_for_game_id || post.recap_for_league_game_id} source={recapSourceFromPost(post)} />
          </div>
        )}
        {(post.recap_for_game_id || post.recap_for_league_game_id) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <button type="button" {...prefetchHandlers(prefetchGamePage)} onClick={(e) => expand(e, () => navigate(`/game/${post.recap_for_game_id || post.recap_for_league_game_id}${post.league_id ? '?type=league' : ''}`))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: 'rgba(46,91,140,0.2)', border: `1px solid ${C.blue}`, color: C.ice, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
              <span style={{ fontSize: 16 }}>🏒</span> View game →
            </button>
            <ShareButton gameId={post.recap_for_game_id || post.recap_for_league_game_id} isLeague={!!post.league_id} variant="ghost" cardType="recapv2"
              getCard={async () => (await getRecapCardWithSponsor(post.recap_for_game_id || post.recap_for_league_game_id, recapSourceFromPost(post))).data} />
          </div>
        )}
        {/* Sealed Game Puck teaser — no winner named; tap through to the game
            card to peel the tape (the reveal lives there). No Share (would spoil). */}
        {post.gamepuck_reveal_game_id && (
          <div style={{ marginBottom: 10 }}>
            <button type="button" {...prefetchHandlers(prefetchGamePage)} onClick={(e) => expand(e, () => navigate(`/game/${post.gamepuck_reveal_game_id}${post.league_id ? '?type=league' : ''}`))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: 'rgba(215,38,56,0.15)', border: `1px solid ${C.red}`, color: C.ice, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer' }}>
              <span style={{ fontSize: 16 }}>🏒</span> Peel to reveal →
            </button>
          </div>
        )}
        {post.livebarn_venue_id && (
          <a href={"https://watch.livebarn.com/en/videoplayer?venueid=" + post.livebarn_venue_id + "&referrer=rinkd"} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, marginBottom: 10, background: 'rgba(46,91,140,0.2)', border: `1px solid ${C.blue}`, color: C.ice, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}>
            <Icon name="live" size={16} /> Watch Live on LiveBarn
          </a>
        )}
        <div style={{ display: 'flex', gap: 16, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <button onClick={() => onLike(post.id)} aria-label="Like" style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: isLiked ? C.red : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: '0 4px', minHeight: 44 }}>
            <span key={`h${likeAnim}`} className={likeAnim ? 'rinkd-like-pop' : undefined} style={{ display: 'inline-flex', transformOrigin: 'center' }}>
              <Icon name="like" size={16} fill={isLiked ? C.red : 'none'} />
            </span>
            <span key={`c${likeAnim}`} className={likeAnim ? 'rinkd-like-count' : undefined} style={{ display: 'inline-block', fontWeight: isLiked ? 600 : 400 }}>{post.likes || 0}</span>
          </button>
          <button onClick={loadComments} aria-label="Comments" style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: showComments ? C.ice : C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: '0 4px', minHeight: 44 }}>
            <Icon name="comment" size={16} /><span>{post.comment_count || 0}</span>
          </button>
          <PostReactions postId={post.id} currentUserId={currentUser?.id} initial={reactions} />
        </div>
        <CommentThread
          open={showComments}
          postId={post.id}
          currentUser={currentUser}
          viewerProfile={viewerProfile}
          onCountChange={(d) => (d > 0 ? onComment(post.id) : onCommentRemoved?.(post.id))}
          onUserBlocked={onUserBlocked}
        />
      </div>
    </div>
  );
}

// ONBOARD-1 (May 28, 2026) — dismissible top-of-feed nudge for users who
// skipped the OnboardingModal (welcome_seen=true, profile_complete=false).
// Single-tap conversion: pick a persona chip → writes profiles.persona +
// profile_complete=true + add_points(50) → banner fades. No modal, no route
// change — friction floor for the segmentation prompt.
//
// Hidden when: profile_complete=true, no profile yet, OR the user has
// already dismissed it this session (sessionStorage flag).
const PERSONAS = [
  { id: 'player',       icon: 'player',       label: 'Player' },
  { id: 'coach',        icon: 'coach',        label: 'Coach' },
  { id: 'parent',       icon: 'parent',       label: 'Parent' },
  { id: 'commissioner', icon: 'commissioner', label: 'Commissioner' },
  { id: 'official',     icon: 'official',     label: 'Official' },
  { id: 'fan',          icon: 'fan',          label: 'Fan' },
];

function ProfileNudgeBanner() {
  const { profile, setProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('rinkd_persona_nudge_dismissed') === '1') setHidden(true);
    } catch (_) { /* private mode */ }
  }, []);

  if (hidden) return null;
  if (!profile || profile.profile_complete) return null;

  const pick = async (personaId) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ persona: personaId, profile_complete: true })
        .eq('id', profile.id);
      if (error) throw error;
      // +50 points via the existing SECURITY DEFINER RPC. Best-effort —
      // if it errors the persona still landed and the banner still hides.
      try { await supabase.rpc('add_points', { user_id: profile.id, pts: 50 }); } catch (_) {}
      setProfile?.((p) => ({ ...(p || {}), persona: personaId, profile_complete: true }));
      track('profile_nudge_persona_picked', { persona: personaId });
      setHidden(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ProfileNudgeBanner] persona update failed:', e?.message || e);
      setBusy(false);
    }
  };

  const dismiss = () => {
    try { sessionStorage.setItem('rinkd_persona_nudge_dismissed', '1'); } catch (_) { /* private mode */ }
    setHidden(true);
    track('profile_nudge_dismissed');
  };

  return (
    <div style={{
      background: 'rgba(46,91,140,0.12)',
      border: '1px solid rgba(46,91,140,0.35)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 14,
      color: C.ice,
      fontFamily: 'Barlow, sans-serif',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
        <span style={{ fontSize: 13, lineHeight: 1.4 }}>
          Quick — who are you? <span style={{ color: C.red, fontWeight: 700 }}>+50 pts</span> for one tap.
        </span>
        <button onClick={dismiss} aria-label="Dismiss"
          style={{ background: 'transparent', color: C.steel, border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {PERSONAS.map(p => (
          <button key={p.id} onClick={() => pick(p.id)} disabled={busy}
            style={{
              background: C.navy,
              color: C.ice,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Barlow, sans-serif',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.5 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            <Icon name={p.icon} size={14} />{p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Feed({ currentUser, profile }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [posts, setPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [reactionMap, setReactionMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const online = useOnline();
  // Skeleton only appears once a load passes 1s (manifesto: under 300ms show
  // nothing, over 1s show the skeleton) so fast feeds never flash placeholders.
  const showSkeleton = useDelayedFlag(loading);
  const [hasMore, setHasMore] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [content, setContent] = useState('');
  const [postMentionIds, setPostMentionIds] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [posting, setPosting] = useState(false);
  // 4D.5-3: default to "following" so new users see signal, not noise.
  // "For You" is still available as a secondary tab for discovery.
  const [tab, setTab] = useState('following');
  // Cold-start fix: a new user follows nobody, so the Following feed is empty
  // and they'd hit a blank wall. When Following comes back empty we fall back
  // to the global "For You" posts and show a hint. This flag also keeps
  // loadMore paginating the right source.
  const [followingFallback, setFollowingFallback] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [starterIdx, setStarterIdx] = useState(0);

  // Cycle the composer prompt while it's collapsed so the feed feels alive.
  // Pauses while composing; respects prefers-reduced-motion.
  useEffect(() => {
    if (composerOpen) return undefined;
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;
    const id = setInterval(() => setStarterIdx(i => (i + 1) % CHIRP_STARTERS.length), 4200);
    return () => clearInterval(id);
  }, [composerOpen]);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
    let data;
    let fellBack = false;
    if (tab === 'following' && currentUser) {
      ({ data } = await getFollowingPosts(currentUser.id, PAGE_SIZE));
      // Never blank-wall a user who follows nobody yet: fall back to the global
      // discovery feed (with a hint they can personalize it).
      if (!data || data.length === 0) {
        ({ data } = await getPosts(PAGE_SIZE));
        fellBack = true;
      }
    } else {
      ({ data } = await getPosts(PAGE_SIZE));
    }
    setFollowingFallback(fellBack);
    const page = data || [];
    setPosts(page);
    setHasMore(page.length === PAGE_SIZE);
    // perf(C08 PR-C): likes + reaction counts are independent reads off the same
    // page — fire them together instead of a sequential waterfall. Each is
    // wrapped in its own catch so one failing (e.g. a reactions hiccup) still
    // lets the other hydrate instead of blanking the whole feed via the outer
    // catch below.
    const postIds = page.map(p => p.id);
    await Promise.all([
      currentUser
        ? getLikedPosts(currentUser.id, postIds)
            .then(liked => setLikedPosts(liked))
            .catch(e => console.error('[Feed] getLikedPosts failed', e))
        : Promise.resolve(),
      // Reaction counts are public — load them whether or not we're signed in.
      getReactions(currentUser?.id, postIds)
        .then(map => setReactionMap(map))
        .catch(e => console.error('[Feed] getReactions failed', e)),
    ]);
    } catch (e) {
      // A network drop / server hiccup must surface a retry, never hang the
      // skeleton forever.
      console.error('[Feed] load failed', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser, tab]);

  useEffect(() => { load(); }, [load]);

  // Keyset pagination — append the next page of older chirps.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return;
    setLoadingMore(true);
    const before = posts[posts.length - 1].created_at;
    let data;
    // When the Following feed fell back to global, keep paginating global too.
    if (tab === 'following' && currentUser && !followingFallback) {
      ({ data } = await getFollowingPosts(currentUser.id, PAGE_SIZE, before));
    } else {
      ({ data } = await getPosts(PAGE_SIZE, before));
    }
    const page = data || [];
    setPosts(prev => [...prev, ...page]);
    setHasMore(page.length === PAGE_SIZE);
    // Fetch liked state for just this page and merge — getLikedPosts is now
    // scoped to visible posts, so the initial load doesn't know about these yet.
    if (currentUser && page.length > 0) {
      const newLiked = await getLikedPosts(currentUser.id, page.map(p => p.id));
      if (newLiked.length > 0) setLikedPosts(prev => Array.from(new Set([...prev, ...newLiked])));
    }
    if (page.length > 0) {
      const newReactions = await getReactions(currentUser?.id, page.map(p => p.id));
      setReactionMap(prev => ({ ...prev, ...newReactions }));
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, posts, tab, currentUser, followingFallback]);

  // A new comment just bumps the count chip on that one card — no full reload.
  const handleCommentAdded = useCallback((postId) => {
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p
    ));
  }, []);

  // Deleting a comment drops the count chip. The DB trigger keeps the stored
  // count correct; this just mirrors it locally so the chip updates instantly.
  const handleCommentRemoved = useCallback((postId) => {
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) - 1) } : p
    ));
  }, []);

  const handleMediaSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Hard cap — Supabase free plan caps single uploads ~50MB, and big mobile clips
    // bomb out on flaky rinks-wifi anyway. Fail fast with a clear message.
    const isVideo = file.type.startsWith('video');
    const maxMB = isVideo ? 50 : 10;
    if (file.size > maxMB * 1024 * 1024) {
      toast({ message: `${isVideo ? 'Video' : 'Image'} is ${(file.size / 1024 / 1024).toFixed(1)}MB — max ${maxMB}MB. Trim a highlight or compress and try again.`, tone: 'alert' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    // Client-side NSFW check (images only). Runs entirely in the browser.
    if (!isVideo) {
      const verdict = await classifyImage(file);
      if (!verdict.ok) {
        toast({ message: "That image won't clear our community guidelines — pick a different one and try again.", tone: 'alert' });
        if (fileInputRef.current) fileInputRef.current.value = '';
        track('upload_blocked_nsfw', { label: verdict.label, score: verdict.score });
        return;
      }
    }
    setMediaFile(file);
    setMediaPreview({ url: URL.createObjectURL(file), type: isVideo ? 'video' : 'image' });
  };

  const removeMedia = () => { setMediaFile(null); setMediaPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; };

  const handlePost = async (e) => {
    e.preventDefault();
    if ((!content.trim() && !mediaFile) || !currentUser) return;
    setPosting(true);
    let mediaUrl = null, mediaType = null;
    if (mediaFile) {
      const { url, mediaType: mt, error } = await uploadMedia(mediaFile, currentUser.id);
      if (error) { setPosting(false); toast({ message: "That upload didn't go through — check your connection and try again.", tone: 'alert' }); return; }
      mediaUrl = url; mediaType = mt;
    }
    const { data: newPost, error: postError } = await createPost(currentUser.id, { content: content.trim(), tag: selectedTag?.label || null, tagColor: selectedTag?.color || null, mediaUrl, mediaType });
    if (postError) {
      // The insert failed — don't clear the composer or fire analytics, or the
      // user loses their text and we log a chirp that never landed. The composer
      // stays open with the typed content intact (it's only cleared on success).
      setPosting(false);
      // eslint-disable-next-line no-console
      console.warn('[handlePost] createPost failed:', postError?.message || postError);
      toast({ message: "That didn't send — check your connection and try again.", tone: 'alert' });
      return;
    }
    // F5 — optimistic prepend. The author's own chirp appears at the top of the
    // feed the instant the insert confirms, instead of waiting on a full reload.
    // createPost's row has no `profiles` embed (it's a bare insert().select()),
    // so we graft the author embed from the current viewer's profile and default
    // the mention embed — otherwise PostCard's `post.profiles` / `post.post_mentions`
    // reads would render a nameless avatar and crash the mention map.
    if (newPost?.id) {
      const optimisticPost = {
        ...newPost,
        profiles: newPost.profiles || profile || null,
        post_mentions: newPost.post_mentions || [],
      };
      setPosts(prev => (prev.some(p => p.id === optimisticPost.id) ? prev : [optimisticPost, ...prev]));
    }
    // Persist resolved @-mentions (best-effort — the post already landed).
    if (newPost?.id && postMentionIds.length) {
      const { error: mErr } = await savePostMentions(newPost.id, postMentionIds);
      if (mErr) console.warn('[handlePost] mention save failed:', mErr?.message || mErr);
    }
    // Fire both events during the rename window. `post_created` keeps historical
    // continuity in dashboards; `chirp_created` is the going-forward name and
    // will become canonical once we backfill old data and retire the legacy event.
    const eventProps = { has_media: !!mediaUrl, media_type: mediaType, tag: selectedTag?.label, scope: 'global' };
    track('post_created', eventProps);
    track('chirp_created', eventProps);
    setContent(''); setPostMentionIds([]); setSelectedTag(null); removeMedia(); setComposerOpen(false);
    setPosting(false);
    // Reconcile in the background (no await) — swaps the grafted row for the
    // canonical one (real embeds, server counts) without making the author stare
    // at a spinner. If it fails the optimistic row already stands on its own.
    load();
  };

  // 4E-1 · Optimistic UI on likes (v2 — race-safe)
  // ─────────────────────────────────────────────────────────────────────────
  // v1 read `likedPosts.includes(postId)` from the closure, which is stale
  // during rapid taps — every tap saw the same "not liked" state and bumped
  // the counter, producing a runaway count. Fix: derive the next state
  // INSIDE the functional updater (which always sees the freshest array),
  // and gate concurrent network calls with an in-flight ref so a burst of
  // taps converges on a single round-trip and doesn't race itself.
  const likeInFlightRef = useRef(new Set());

  const handleLike = (postId) => {
    if (!currentUser) return;

    // Toggle the local heart state using a functional updater. We capture
    // the "after toggle" value in a sentinel so setPosts below can stay
    // mathematically consistent with what likedPosts ended up as.
    let nextLiked = null;
    setLikedPosts(prev => {
      nextLiked = !prev.includes(postId);
      return nextLiked ? [...prev, postId] : prev.filter(id => id !== postId);
    });
    if (nextLiked) haptics.like();   // a soft tap — only when adding a like, not removing
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, likes: nextLiked ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 0) - 1) }
      : p
    ));

    // Network reconciliation. If a call is already in flight for this post,
    // skip — when it returns we'll reconcile to truth anyway, and firing
    // another toggle would race it (and re-toggle the server state).
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
        // Rollback: flip the local state back to whatever it was before
        // this tap-burst. We use a functional updater so we don't double-
        // toggle if the user kept tapping during the network call.
        setLikedPosts(prev => nextLiked ? prev.filter(id => id !== postId) : [...prev, postId]);
        setPosts(prev => prev.map(p => p.id === postId
          ? { ...p, likes: nextLiked ? Math.max(0, (p.likes || 0) - 1) : (p.likes || 0) + 1 }
          : p
        ));
        // eslint-disable-next-line no-console
        console.warn('[Feed] like toggle failed, rolled back:', _e?.message || _e);
        toast({ message: "That didn't send — check your connection and try again.", tone: 'alert' });
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

  // Broadcast lower-third label for the current view + whether any visible post
  // is live (lights the header's LIVE marker).
  const headerLabel = followingFallback ? 'Popular Now' : tab === 'following' ? 'Following' : 'For You';
  const hasLive = posts.some(p => !!p.livebarn_venue_id || p.tag === 'Goal Alert');
  // Live games float above everything else: genuinely-live (LiveBarn) posts are
  // rendered first. Pure render-time ordering — the `posts` state array (and the
  // keyset pagination cursor that reads its last element) is left untouched.
  const liveFirst = [...posts.filter(p => !!p.livebarn_venue_id), ...posts.filter(p => !p.livebarn_venue_id)];

  return (
    <Layout profile={profile}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>
      <PullToRefresh onRefresh={load}>
        <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 32, color: C.ice, textTransform: 'uppercase', letterSpacing: '0.02em', marginBottom: 20 }}><TapeText height={32}>Chirps</TapeText></h1>

        {/* ONBOARD-1 progressive-disclosure nudge — only renders for users who
            skipped the OnboardingModal (welcome_seen=true, profile_complete=false). */}
        <ProfileNudgeBanner />

        <PushPrompt userId={currentUser?.id} />
        
        {/* Tabs: Leagues hidden until Sprint 5B/5C ships team-aware membership.
            Today it silently falls through to getPosts() in load() which makes
            it identical to For You — quietly broken. Restore the third tab
            once posts can be filtered by user's team/league context. */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: C.navy, borderRadius: 10, padding: 4, border: `1px solid ${C.border}` }}>
          {[{ id: 'following', label: 'Following' }, { id: 'foryou', label: 'For You' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px', borderRadius: 7, border: 'none', background: tab === t.id ? C.blue : 'transparent', color: tab === t.id ? C.ice : C.steel, fontFamily: "'Barlow', sans-serif", fontWeight: tab === t.id ? 600 : 400, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' }}>{t.label}</button>
          ))}
        </div>

        {currentUser && (
          <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 16, overflow: 'hidden' }}>
            {!composerOpen ? (
              <button onClick={() => setComposerOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Avatar profile={profile} size={36} eager />
                <span key={starterIdx} className="rinkd-starter-fade" style={{ flex: 1, color: C.steel, fontSize: 15, fontFamily: "'Barlow', sans-serif", textAlign: 'left' }}>{CHIRP_STARTERS[starterIdx]}</span>
                <span style={{ padding: '6px 14px', borderRadius: 8, background: C.red, color: 'white', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13 }}>CHIRP</span>
              </button>
            ) : (
              <form onSubmit={handlePost} style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <Avatar profile={profile} size={36} eager />
                  <MentionInput value={content} onChange={setContent} onMentionsChange={setPostMentionIds}
                    placeholder={`${CHIRP_STARTERS[starterIdx]} · tag players with @`} maxLength={500} rows={3} autoFocus
                    style={{ flex: 1 }}
                    textareaStyle={{ padding: '10px 12px', borderRadius: 10, background: C.navy, border: `1.5px solid ${C.blue}`, color: C.ice, fontSize: 15, resize: 'none', fontFamily: "'Barlow', sans-serif", lineHeight: 1.5 }}/>
                </div>
                {mediaPreview && (
                  <div style={{ position: 'relative', marginBottom: 12, borderRadius: 10, overflow: 'hidden' }}>
                    {mediaPreview.type === 'video'
                      ? <video src={mediaPreview.url} style={{ width: '100%', maxHeight: 200, borderRadius: 10 }} controls/>
                      : <img src={mediaPreview.url} alt="preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }}/>
                    }
                    <button type="button" onClick={removeMedia} aria-label="Remove media" style={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                )}
                {posting && mediaFile && (
                  <div style={{ marginBottom: 12 }}>
                    <IndeterminateBar />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {TAGS.map(tag => (
                    <button key={tag.label} type="button" onClick={() => setSelectedTag(selectedTag?.label === tag.label ? null : tag)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: selectedTag?.label === tag.label ? tag.color : tag.color + '22', color: selectedTag?.label === tag.label ? 'white' : tag.color, fontSize: 11, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.06em' }}>{tag.label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaSelect} style={{ display: 'none' }} id="media-upload"/>
                    <label htmlFor="media-upload" aria-label="Add photo or video" style={{ padding: '7px 12px', minHeight: 44, borderRadius: 8, cursor: 'pointer', background: C.navy, border: `1px solid ${C.border}`, color: C.steel, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📷</label>
                    <span style={{ fontSize: 12, color: C.steel }}>{content.length}/500</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => { setComposerOpen(false); removeMedia(); }} style={{ padding: '8px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.steel, fontFamily: "'Barlow', sans-serif", cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                    <button type="submit" disabled={(!content.trim() && !mediaFile) || posting}
                      style={{ padding: '8px 20px', borderRadius: 8, background: (content.trim() || mediaFile) ? C.red : C.border, color: 'white', border: 'none', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 15, letterSpacing: '0.05em' }}>
                      {posting ? 'Chirping...' : 'Drop a Chirp →'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Game-day loop: live games float here, then the next game's hype card.
            Self-hides when the user has no live/upcoming games in followed events. */}
        <ReciprocityNudges currentUserId={currentUser?.id} navigate={navigate} />
        <GamedayStrip currentUserId={currentUser?.id} navigate={navigate} />

        {loading ? (
          showSkeleton ? (
            <>
              <div style={{ marginBottom: 12, color: C.steel, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Getting the ice ready.
              </div>
              <FeedSkeleton count={4} />
            </>
          ) : null
        ) : error ? (
          <ErrorState
            title="Couldn’t load your feed"
            offline={!online}
            onRetry={load}
            retrying={loading}
          />
        ) : posts.length === 0 ? (
          <EmptyState
            icon="🏒"
            title={tab === 'following' ? 'Nobody on your line yet' : 'Fresh sheet of ice'}
            body={tab === 'following' ? 'Follow players, teams, and leagues — their goals, clips, and chirps drop right here.' : 'No chirps yet. Grab the first shift — drop a goal clip, a hot take, or a locker-room photo.'}
            cta={tab === 'following' ? { label: 'Find Players to Follow', onClick: () => navigate('/discover') } : { label: 'Drop the First Chirp', onClick: () => setComposerOpen(true) }}
          />
        ) : (
          <>
            <SectionHeader label={headerLabel} live={hasLive} />
            {followingFallback && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '10px 12px', marginBottom: 8, borderRadius: 10, background: C.navy, border: `1px solid ${C.border}`, color: C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>
                <span>✨ Showing popular chirps —</span>
                <button onClick={() => navigate('/discover')} style={{ background: 'transparent', border: 'none', color: C.blue, fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13, fontFamily: 'inherit' }}>follow players</button>
                <span>to personalize your feed.</span>
              </div>
            )}
            {liveFirst.map((post, i) => (
              <PostCard
                key={post.id}
                index={i}
                post={post}
                currentUser={currentUser}
                profile={profile}
                likedPosts={likedPosts}
                reactions={reactionMap[post.id]}
                onLike={handleLike}
                onComment={handleCommentAdded}
                onCommentRemoved={handleCommentRemoved}
                onPostHidden={(id) => setPosts(prev => prev.filter(p => p.id !== id))}
                onPostDelete={removePostOptimistic}
                onUserBlocked={(uid) => setPosts(prev => prev.filter(p => p.author_id !== uid))}
              />
            ))}
            {/* Skeleton matching the exact card layout being loaded — never a
                generic spinner — plus hockey copy on the trigger itself. */}
            {loadingMore && <PostSkeleton />}
            {hasMore && (
              <button onClick={loadMore} disabled={loadingMore}
                style={{ width: '100%', padding: '12px', marginTop: 4, borderRadius: 10, background: C.navy, border: `1px solid ${C.border}`, color: C.steel, fontFamily: "'Barlow', sans-serif", fontSize: 14, fontWeight: 600, cursor: loadingMore ? 'default' : 'pointer' }}>
                {loadingMore ? 'Warming up…' : 'Load more chirps'}
              </button>
            )}
          </>
        )}
      </PullToRefresh>
      </div>
    </Layout>
  );
}
