import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getGalleryPosts, createPost, uploadMedia, timeAgo } from '../lib/posts';
import { getReactions } from '../lib/reactions';
import PostReactions from './PostReactions';
import { MentionText } from './Mentions';
import { mentionMapFromRows } from '../lib/mentions';
import ShareButton from './ShareButton';
import { absoluteShareUrl } from '../lib/share';
import { IndeterminateBar } from '../pages/Feed';
import { Button, Skeleton, EmptyState } from './ui';
import { isPublicSharingEnabled, areScorersHidden } from '../lib/publicShare';
import { classifyImage } from '../lib/imageModeration';
import { C, colors } from '../lib/tokens';

// Local drift: no exact token match, kept inline per migration rules.
const GAL_STEEL = '#9BB5D6';
const GAL_DIM = '#7C8B9F';
const GAL_PANEL = '#11253E';
const GAL_BORDER = '#1F3553';
const GAL_BLUE = '#5B9FE2';

/**
 * Photo/video gallery for a tournament or league (GALLERY-1). A media-only grid
 * over scoped posts — NOT a new table — so every photo inherits the same
 * reactions, comments, likes and moderation as the feed. Pass exactly one of
 * `tournamentId` / `leagueId`; the component figures out the matching scoped
 * team column (tournament_team_id / league_team_id) and loads the competing
 * teams for the filter chips itself.
 *
 *   <Gallery tournamentId={id} currentUser={currentUser} settings={t.settings} />
 *   <Gallery leagueId={id} currentUser={currentUser} settings={league.settings} />
 *
 * YOUTH-PRIVACY (C06 PR-1, D-C06-3): pass the parent event's `settings` so the
 * gallery reads the same guardrails as the public game page:
 *   - ANON visitors on a youth event (!isPublicSharingEnabled) lose the tab
 *     content behind a quiet "sign in" invitation — signed-in members keep it.
 *   - when the event hides scorers (areScorersHidden) AND the viewer is anon,
 *     uploader display-names + free-text captions are suppressed (a caption like
 *     "Great game Jake #23!" must not publish a minor's name to anon visitors).
 */
export default function Gallery({ tournamentId = null, leagueId = null, currentUser, settings = null }) {
  const isTournament = !!tournamentId;
  // Anon on a non-publicly-shareable (youth) event: gate the content entirely.
  const anonYouthLocked = !currentUser && !isPublicSharingEnabled(settings);
  // Anon on a scorers-hidden event: strip uploader name + caption (still shows
  // the photo + team tag, which aren't minor PII).
  const suppressMeta = !currentUser && areScorersHidden(settings);
  const [teams, setTeams] = useState([]);            // [{ id, name }]
  const [teamFilter, setTeamFilter] = useState(null); // team id, or null = all
  const [posts, setPosts] = useState(null);          // null = loading
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reactionMap, setReactionMap] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);    // post object, or null

  // Competing teams for the filter chips. Tournament teams live in
  // tournament_teams, league teams in league_teams — both expose team_name and
  // are public-read, so this works for anon viewers too.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isTournament) {
        const { data } = await supabase.from('tournament_teams')
          .select('id, team_name').eq('tournament_id', tournamentId).order('team_name');
        if (!cancelled) setTeams((data || []).map((t) => ({ id: t.id, name: t.team_name })));
      } else if (leagueId) {
        const { data } = await supabase.from('league_teams')
          .select('id, team_name').eq('league_id', leagueId).order('team_name');
        if (!cancelled) setTeams((data || []).map((t) => ({ id: t.id, name: t.team_name })));
      }
    })();
    return () => { cancelled = true; };
  }, [isTournament, tournamentId, leagueId]);

  // Load the grid. Re-runs when the team filter flips; we map the generic filter
  // id onto the scope-correct column inside getGalleryPosts.
  const GALLERY_PAGE = 60;
  const galleryParams = useCallback((before) => {
    const params = { tournamentId, leagueId, limit: GALLERY_PAGE, before };
    if (teamFilter) params[isTournament ? 'tournamentTeamId' : 'leagueTeamId'] = teamFilter;
    return params;
  }, [tournamentId, leagueId, teamFilter, isTournament]);

  const load = useCallback(async () => {
    setPosts(null);
    const { data } = await getGalleryPosts(galleryParams(null));
    const page = data || [];
    setPosts(page);
    setHasMore(page.length === GALLERY_PAGE);
  }, [galleryParams]);
  useEffect(() => { load(); }, [load]);

  // perf(scale): keyset "load more" instead of a one-shot 60-cap that silently
  // hid older shots once a popular event's gallery grew.
  const loadMore = useCallback(async () => {
    if (loadingMore || !Array.isArray(posts) || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const before = posts[posts.length - 1].created_at;
      const { data } = await getGalleryPosts(galleryParams(before));
      const page = data || [];
      setPosts((prev) => [...(prev || []), ...page]);
      setHasMore(page.length === GALLERY_PAGE);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, posts, galleryParams]);

  // Reaction counts are public — load whenever the visible set changes (keyed on
  // the id SET so optimistic toggles don't trigger a refetch). Mirrors the feed.
  const reactionKeyRef = useRef('');
  useEffect(() => {
    let cancelled = false;
    if (!Array.isArray(posts) || posts.length === 0) { setReactionMap({}); reactionKeyRef.current = ''; return undefined; }
    const key = posts.map((p) => p.id).join(',');
    if (key === reactionKeyRef.current) return undefined;
    reactionKeyRef.current = key;
    getReactions(currentUser?.id, posts.map((p) => p.id)).then((m) => { if (!cancelled) setReactionMap(m); });
    return () => { cancelled = true; };
  }, [posts, currentUser]);

  // New upload lands at the top immediately; the next reload re-fetches by id.
  // If a team filter is active and the new photo doesn't match it, don't show a
  // ghost that would vanish on reload — only prepend when it belongs.
  const onAdded = (newPost) => {
    const field = isTournament ? 'tournament_team_id' : 'league_team_id';
    if (teamFilter && newPost?.[field] !== teamFilter) return;
    setPosts((prev) => [newPost, ...(prev || [])]);
  };

  const scopeLabel = isTournament ? 'tournament' : 'league';

  // D-C06-3: anon on a youth event — the gallery is member-only. Quiet,
  // partner-safe invitation (no "youth" wording, no leaky counts/thumbnails).
  if (anonYouthLocked) {
    return (
      <div style={{ padding: '0 12px', fontFamily: 'Barlow, sans-serif' }}>
        <EmptyState
          compact
          icon="📸"
          title="Sign in to view photos"
          body={`Photos from this ${scopeLabel} are shared with signed-in fans and families.`}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 12px', fontFamily: 'Barlow, sans-serif' }}>
      {/* Header: team filter chips + Add Photo CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {teams.length > 0 && (
            <Chip active={teamFilter === null} onClick={() => setTeamFilter(null)}>All</Chip>
          )}
          {teams.map((t) => (
            <Chip key={t.id} active={teamFilter === t.id} onClick={() => setTeamFilter(t.id)}>{t.name}</Chip>
          ))}
        </div>
        {currentUser && (
          <button
            onClick={() => setAddOpen(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
              background: GAL_BLUE, color: C.ice, border: 'none', borderRadius: 8,
              padding: '8px 14px', minHeight: 44, fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>
            <span style={{ fontSize: 15 }}>＋</span> Add Photo
          </button>
        )}
      </div>

      {posts === null ? (
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 6 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={0} radius={8} style={{ aspectRatio: '1 / 1', height: 'auto' }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', color: GAL_DIM, fontSize: 13, padding: '48px 16px', lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
          {teamFilter ? 'This team’s gallery is wide open.' : 'The gallery’s wide open.'}<br />
          {currentUser ? 'Drop the first shot — tap Add Photo.' : `Sign in to share shots from the ${scopeLabel}.`}
        </div>
      ) : (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 6 }}>
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => setLightbox(p)}
              style={{
                position: 'relative', padding: 0, border: 'none', cursor: 'pointer',
                aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: C.dark,
              }}>
              {p.media_type === 'video' ? (
                <>
                  <video src={p.media_url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>▶</span>
                </>
              ) : (
                <img src={p.media_url} alt={!suppressMeta && p.content ? p.content.slice(0, 60) : ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
            </button>
          ))}
        </div>
        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button onClick={loadMore} disabled={loadingMore}
              style={{ background: 'transparent', color: C.ice, border: '1px solid rgba(46,91,140,0.4)', borderRadius: 999, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: loadingMore ? 'default' : 'pointer', fontFamily: 'inherit', opacity: loadingMore ? 0.6 : 1 }}>
              {loadingMore ? 'Loading…' : 'Load more photos'}
            </button>
          </div>
        )}
        </>
      )}

      {addOpen && (
        <AddPhotoModal
          scopeLabel={scopeLabel}
          teams={teams}
          currentUser={currentUser}
          tournamentId={tournamentId}
          leagueId={leagueId}
          isTournament={isTournament}
          onClose={() => setAddOpen(false)}
          onAdded={(post) => { onAdded(post); setAddOpen(false); }}
        />
      )}

      {lightbox && (
        <Lightbox
          post={lightbox}
          isTournament={isTournament}
          scopeId={tournamentId || leagueId}
          currentUser={currentUser}
          suppressMeta={suppressMeta}
          reactionInitial={reactionMap[lightbox.id]}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(91,159,226,0.22)' : 'rgba(11,31,58,0.6)',
        border: `1px solid ${active ? GAL_BLUE : GAL_BORDER}`,
        color: active ? C.ice : GAL_STEEL, borderRadius: 999,
        padding: '4px 12px', minHeight: 44, display: 'inline-flex', alignItems: 'center',
        fontSize: 12, fontWeight: active ? 700 : 500,
        cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

function AddPhotoModal({ scopeLabel, teams, currentUser, tournamentId, leagueId, isTournament, onClose, onAdded }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState('');
  const [teamTag, setTeamTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!currentUser?.id || !file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Image moderation parity with the Feed composer (imageModeration.js is a
      // no-op stub today; wiring the call site now means Gallery gets real
      // Sightengine moderation for free when it ships — no call-site change).
      if (!file.type?.startsWith('video')) {
        const verdict = await classifyImage(file);
        if (!verdict.ok) {
          setError("That image won’t clear our community guidelines — pick a different one and try again.");
          setSubmitting(false);
          return;
        }
      }
      const up = await uploadMedia(file, currentUser.id);
      if (up.error) { setError('That didn’t upload — check your connection and try again.'); setSubmitting(false); return; }
      const params = {
        content: caption.trim(),
        mediaUrl: up.url,
        mediaType: up.mediaType,
        tournamentId: tournamentId || null,
        leagueId: leagueId || null,
      };
      if (teamTag) params[isTournament ? 'tournamentTeamId' : 'leagueTeamId'] = teamTag;
      const { data, error: postErr } = await createPost(currentUser.id, params);
      if (postErr) { setError(postErr.message || 'That didn’t post — give it another shot.'); setSubmitting(false); return; }
      const tagged = teamTag ? teams.find((t) => t.id === teamTag) : null;
      // Stitch in the bits the grid/lightbox read, so the optimistic row matches
      // the shape getGalleryPosts returns (it embeds profiles + scoped team).
      const enriched = {
        ...data,
        profiles: currentUser.profile || null,
        tournament_teams: isTournament && tagged ? { id: tagged.id, team_name: tagged.name } : null,
        league_teams: !isTournament && tagged ? { id: tagged.id, team_name: tagged.name } : null,
      };
      onAdded(enriched);
    } catch (e) {
      setError(e?.message || 'That didn’t post — give it another shot.');
      setSubmitting(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(440px, 92vw)', maxHeight: '88vh', overflowY: 'auto',
        background: GAL_PANEL, borderRadius: 14, padding: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', fontFamily: 'Barlow, sans-serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: C.ice, fontWeight: 700, fontSize: 16 }}>Add Photo</div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: GAL_DIM, fontSize: 20, cursor: 'pointer', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '-12px -12px -12px 0' }}>×</button>
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          aspectRatio: previewUrl ? 'auto' : '4 / 3', minHeight: 140,
          border: `2px dashed ${GAL_BORDER}`, borderRadius: 10, cursor: 'pointer',
          overflow: 'hidden', background: C.dark, marginBottom: 12,
        }}>
          {previewUrl ? (
            file?.type?.startsWith('video')
              ? <video src={previewUrl} controls style={{ width: '100%', display: 'block' }} />
              : <img src={previewUrl} alt="preview" style={{ width: '100%', display: 'block' }} />
          ) : (
            <span style={{ color: GAL_STEEL, fontSize: 13, textAlign: 'center', padding: 16 }}>
              📷 Tap to pick a photo or video
            </span>
          )}
          <input type="file" accept="image/*,video/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
        </label>

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={`Add a caption (optional) — posts to the ${scopeLabel} feed too`}
          rows={2}
          maxLength={500}
          style={{
            width: '100%', boxSizing: 'border-box', background: C.dark, color: C.ice,
            border: `1px solid ${GAL_BORDER}`, borderRadius: 8, padding: '8px 10px',
            fontFamily: 'Barlow, sans-serif', fontSize: 13, resize: 'vertical', marginBottom: 12,
          }} />

        {teams.length > 0 && (
          <select
            value={teamTag}
            onChange={(e) => setTeamTag(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', background: C.dark, color: C.ice,
              border: `1px solid ${GAL_BORDER}`, borderRadius: 8, padding: '8px 10px',
              fontFamily: 'Barlow, sans-serif', fontSize: 13, marginBottom: 12,
            }}>
            <option value="">Tag a team (optional)</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        {submitting && (
          <div style={{ marginBottom: 12 }}>
            <IndeterminateBar color={GAL_BLUE} />
          </div>
        )}

        {error && <div style={{ color: colors.redSoft, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${GAL_BORDER}`, color: GAL_STEEL, borderRadius: 8, padding: '8px 14px', minHeight: 44, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            loading={submitting}
            disabled={!file}
            disabledReason="Pick a photo first"
          >
            {submitting ? 'Posting…' : 'Post to the Feed'}
          </Button>
        </div>
      </div>
    </Backdrop>
  );
}

function Lightbox({ post, isTournament, scopeId, currentUser, suppressMeta = false, reactionInitial, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // YOUTH-PRIVACY (C06 PR-1): for anon viewers on a scorers-hidden event, the
  // uploader's display name and free-text caption may name a minor — suppress
  // both (team tag + timestamp + the photo itself stay; those aren't minor PII).
  const author = suppressMeta ? '' : (post.profiles?.name || post.profiles?.handle || '');
  const team = isTournament ? post.tournament_teams : post.league_teams;
  const teamName = team?.team_name || null;
  const mentionMap = mentionMapFromRows(post.post_mentions);
  const showCaption = !suppressMeta && !!post.content;
  const isImage = post.media_type !== 'video';
  // Shared photos get a Rinkd corner watermark + a tap-back link to the event.
  const photoDeepLink = scopeId ? absoluteShareUrl(`/${isTournament ? 'tournament' : 'league'}/${scopeId}`) : absoluteShareUrl('/');
  const getPhotoCard = () => ({ imageUrl: post.media_url, tag: teamName, deepLink: photoDeepLink });

  return (
    <Backdrop onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(560px, 94vw)', maxHeight: '92vh', overflowY: 'auto',
        background: GAL_PANEL, borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.5)', fontFamily: 'Barlow, sans-serif',
      }}>
        <div style={{ position: 'relative', background: '#000' }}>
          <button onClick={onClose} aria-label="Close" style={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            width: 44, height: 44, borderRadius: 999, border: 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 20, cursor: 'pointer',
          }}>×</button>
          {post.media_type === 'video' ? (
            <video src={post.media_url} controls autoPlay style={{ width: '100%', maxHeight: '70vh', display: 'block' }} />
          ) : (
            <img src={post.media_url} alt={showCaption ? post.content : ''} style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }} />
          )}
        </div>

        <div style={{ padding: 14, color: C.ice }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: GAL_DIM, marginBottom: showCaption ? 8 : 10 }}>
            {teamName && (
              <span style={{ background: 'rgba(91,159,226,0.18)', color: GAL_BLUE, borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>{teamName}</span>
            )}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {author ? `${author} · ` : ''}{timeAgo(post.created_at)} ago
            </span>
          </div>
          {showCaption && (
            <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 10 }}>
              <MentionText text={post.content} mentions={mentionMap} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <PostReactions postId={post.id} currentUserId={currentUser?.id} initial={reactionInitial} />
            {isImage && (
              <ShareButton cardType="photo" gameId={post.id} isLeague={!isTournament} variant="ghost" label="Share"
                getCard={getPhotoCard} />
            )}
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(3,10,20,0.78)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      {children}
    </div>
  );
}
