import React, { useEffect, useState } from 'react';
import { Avatar } from './Logos';
import PostActionMenu from './PostActionMenu';
import { MentionInput, MentionText } from './Mentions';
import { mentionMapFromRows, saveCommentMentions } from '../lib/mentions';
import { getComments, createComment, timeAgo } from '../lib/posts';
import { C } from '../lib/tokens';
import { useToast } from './ui';

// ===========================================================================
// CommentThread — the ONE comment list + composer shared by every feed
// (global chirp, team, league, tournament). Extracting it means parity is
// STRUCTURAL and can't drift: the recap-card bug (three near-copies, one
// fixed, two not) is exactly what this prevents.
//
// Open-controlled: the parent owns the toggle button + count chip (so each
// feed keeps its own action-row layout) and flips `open`. This component owns
// everything inside — lazy load on first open, optimistic insert with temp-id
// swap + rollback, @-mention persistence, and the PostActionMenu 5s-Undo
// delete. `onCountChange(delta)` lets the parent keep its comment-count chip
// in sync without a refetch.
// ===========================================================================
export default function CommentThread({ open, postId, currentUser, viewerProfile, onCountChange, onUserBlocked }) {
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentMentionIds, setCommentMentionIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  // Lazy load on first open (manifesto: comment threads don't load until needed).
  useEffect(() => {
    if (!open || loaded) return undefined;
    let alive = true;
    (async () => {
      try {
        const c = await getComments(postId);
        if (alive) { setComments(c); setLoaded(true); }
      } catch (e) {
        console.warn('[CommentThread] load failed:', e?.message || e);
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [open, loaded, postId]);

  // Optimistic insert: show the comment instantly with a temp id, then swap for
  // the real row when Supabase confirms. Roll back + restore typed text on error.
  const submitComment = async (e) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || submitting || !currentUser) return;
    setSubmitting(true);

    const tempId = `temp-${Date.now()}`;
    const tempComment = {
      id: tempId, content: trimmed, created_at: new Date().toISOString(),
      profiles: viewerProfile || null, __pending: true,
    };
    const mentionIds = commentMentionIds;
    setComments((prev) => [...prev, tempComment]);
    setCommentText('');
    setCommentMentionIds([]);

    const { data, error } = await createComment(postId, currentUser.id, trimmed);
    setSubmitting(false);

    if (error) {
      console.warn('[CommentThread] insert failed, rolling back:', error?.message || error);
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentText(trimmed);
      setCommentMentionIds(mentionIds);
      toast({ message: "That didn't send — check your connection and try again.", tone: 'alert' });
      return;
    }

    if (data?.id && mentionIds.length) {
      saveCommentMentions(data.id, mentionIds).then(({ error: mErr }) => {
        if (mErr) console.warn('[CommentThread] mention save failed:', mErr?.message || mErr);
      });
    }

    setComments((prev) => prev.map((c) => (c.id === tempId ? { ...data, profiles: c.profiles } : c)));
    onCountChange?.(1);
  };

  if (!open) return null;

  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
      {comments.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10, opacity: c.__pending ? 0.55 : 1, transition: 'opacity 0.18s' }}>
          <Avatar profile={c.profiles} size={28} />
          <div style={{ flex: 1, minWidth: 0, background: C.navy, borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.ice, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.profiles?.name || (c.__pending ? 'You' : '')}
                  <span style={{ fontWeight: 400, color: C.steel }}> · {c.__pending ? 'sending…' : timeAgo(c.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: C.ice, wordBreak: 'break-word' }}><MentionText text={c.content} mentions={mentionMapFromRows(c.comment_mentions)} /></div>
              </div>
              {!c.__pending && (
                <PostActionMenu
                  kind="comment"
                  targetId={c.id}
                  authorId={c.author_id}
                  authorHandle={c.profiles?.handle}
                  currentUserId={currentUser?.id}
                  onReported={() => setComments((prev) => prev.filter((x) => x.id !== c.id))}
                  onBlocked={() => {
                    setComments((prev) => prev.filter((x) => x.author_id !== c.author_id));
                    onUserBlocked?.(c.author_id);
                  }}
                  onDeleted={() => {
                    setComments((prev) => prev.filter((x) => x.id !== c.id));
                    onCountChange?.(-1);
                  }}
                  onDelete={() => {
                    // Optimistic remove + restore (the menu wraps this in a 5s Undo).
                    const idx = comments.findIndex((x) => x.id === c.id);
                    setComments((prev) => prev.filter((x) => x.id !== c.id));
                    onCountChange?.(-1);
                    return () => {
                      setComments((prev) => (prev.some((x) => x.id === c.id)
                        ? prev
                        : (() => { const n = [...prev]; n.splice(idx < 0 ? n.length : Math.min(idx, n.length), 0, c); return n; })()));
                      onCountChange?.(1);
                    };
                  }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
      {/* F4 — open + loaded + empty: an invitation, not a dead end (manifesto:
          empty states are invitations). Sits above the composer, muted + centered. */}
      {loaded && comments.length === 0 && (
        <div style={{ textAlign: 'center', color: C.steel, fontSize: 13, fontFamily: "'Barlow', sans-serif", padding: '4px 0 10px' }}>
          Be the first to chirp back 🏒
        </div>
      )}
      {currentUser && (
        <form onSubmit={submitComment} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Avatar profile={viewerProfile || currentUser} size={28} />
          <MentionInput value={commentText} onChange={setCommentText} onMentionsChange={setCommentMentionIds}
            placeholder="Add a comment… use @ to tag" maxLength={280} rows={1}
            style={{ flex: 1 }}
            textareaStyle={{ padding: '8px 12px', borderRadius: 8, background: C.navy, border: `1px solid ${C.border}`, color: C.ice, fontSize: 13, fontFamily: "'Barlow', sans-serif", lineHeight: 1.4 }} />
          <button type="submit" disabled={!commentText.trim() || submitting}
            style={{ padding: '8px 14px', borderRadius: 8, background: commentText.trim() ? C.red : C.border, color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}>Post</button>
        </form>
      )}
    </div>
  );
}
