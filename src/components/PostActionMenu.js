import React, { useState, useEffect, useRef } from 'react';
import { Icon, useUndoable } from './ui';
import { reportPost, reportComment, REPORT_REASONS, hidePost, hideComment } from '../lib/moderation';
import { blockUser } from '../lib/blocks';
import { deletePost, deleteComment } from '../lib/posts';
import { C } from '../lib/tokens';

/**
 * ⋯ menu for an individual post or comment. For your OWN content it offers
 * Delete; for someone else's it offers Report + Block. Renders nothing only
 * when logged out or the author is unknown. Closes on outside click, Esc, or
 * after a successful action.
 *
 *   <PostActionMenu
 *     kind="post"             // 'post' | 'comment'
 *     targetId={post.id}
 *     authorId={post.author_id}
 *     authorHandle={post.profiles?.handle}
 *     currentUserId={currentUser?.id}
 *     canModerate={isDirector}// viewer can moderate THIS item's event scope (DIR-MOD-1)
 *     onReported={() => ...}  // parent typically removes the row from local state
 *     onBlocked={() => ...}   // parent typically filters all rows from this user
 *     onDeleted={() => ...}   // own content: parent removes the row (+ adjusts counts)
 *     onModerated={() => ...} // director hid it: parent removes the row (falls back to onDeleted)
 *   />
 */
export default function PostActionMenu({
  kind, targetId, authorId, authorHandle,
  currentUserId, canModerate = false, onReported, onBlocked, onDeleted, onModerated,
  // RESILIENCE: optional optimistic-delete. When provided, it must remove the
  // row from the parent's state NOW and RETURN a restore fn — Delete then runs
  // instantly with a 5-second Undo toast (no confirm dialog), committing the
  // irreversible server delete only after those 5s. Absent → legacy confirm.
  onDelete,
}) {
  const runUndoable = useUndoable();
  const [open, setOpen] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [pickedReason, setPickedReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const rootRef = useRef(null);

  // Close the menu on outside click / Escape. Declared before any conditional
  // return so hook order stays stable across renders.
  useEffect(() => {
    if (!open && !showReportModal) return undefined;
    const onDocClick = (e) => {
      if (showReportModal) return; // modal handles its own outside-clicks
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowReportModal(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, showReportModal]);

  // Only hide when we can't attribute the row to anyone (logged out / no
  // author). Own content shows Delete; others' content shows Report + Block.
  if (!currentUserId || !authorId) return null;
  const isOwn = currentUserId === authorId;

  const doDelete = async () => {
    if (deleting) return;
    const fn = kind === 'comment' ? deleteComment : deletePost;

    // Preferred path: optimistic remove + 5s Undo toast, no confirm dialog.
    if (onDelete) {
      setOpen(false);
      runUndoable({
        message: kind === 'comment' ? 'Comment deleted' : 'Post deleted',
        apply: onDelete, // parent removes the row now, returns a restore fn
        commit: async () => { const { error: e } = await fn(targetId); if (e) throw e; },
        errorMessage: kind === 'comment'
          ? "That comment didn't delete — it's back. Try again."
          : "That post didn't delete — it's back. Try again.",
      });
      return;
    }

    // Legacy fallback (callers that don't own restorable list state).
    const ok = window.confirm(
      kind === 'comment'
        ? "Delete this comment? This can't be undone."
        : "Delete this post? Its comments, likes, and mentions go with it — this can't be undone."
    );
    if (!ok) return;
    setDeleting(true);
    const { error: e } = await fn(targetId);
    setDeleting(false);
    if (e) {
      window.alert(e.message || "That didn't delete — check your connection and try again.");
      return;
    }
    setOpen(false);
    onDeleted?.();
  };

  const doHide = async () => {
    if (hiding) return;
    const ok = window.confirm(
      kind === 'comment'
        ? "Hide this comment from your event? It drops off the feed, but you can bring it back."
        : "Hide this post from your event? It drops off the feed, but you can bring it back."
    );
    if (!ok) return;
    setHiding(true);
    const fn = kind === 'comment' ? hideComment : hidePost;
    const { error: e } = await fn(targetId, true);
    setHiding(false);
    if (e) {
      window.alert(e.message || "That didn't hide — check your connection and try again.");
      return;
    }
    setOpen(false);
    (onModerated || onDeleted)?.();
  };

  const openReport = () => {
    setOpen(false);
    setPickedReason('spam');
    setDetails('');
    setError('');
    setShowReportModal(true);
  };

  const submitReport = async () => {
    setSubmitting(true);
    setError('');
    const fn = kind === 'comment' ? reportComment : reportPost;
    const { error: e } = await fn(targetId, pickedReason, details);
    setSubmitting(false);
    if (e) {
      setError(e.message || "That report didn't send — check your connection and try again.");
      return;
    }
    setShowReportModal(false);
    onReported?.();
  };

  const doBlock = async () => {
    setOpen(false);
    const ok = window.confirm(
      `Block @${authorHandle || 'this user'}? You won't see each other's posts, comments, or notifications. You can unblock anytime.`
    );
    if (!ok) return;
    const { error: e } = await blockUser(authorId);
    if (!e) onBlocked?.();
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 44, margin: '-10px -8px', // 44px tap target without growing the row
          background: 'none', border: 'none', cursor: 'pointer',
          color: C.steel, borderRadius: 8,
          fontSize: 18, lineHeight: 1, fontWeight: 700,
          WebkitTapHighlightColor: 'transparent',
        }}>
        ⋯
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4,
          minWidth: 180, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: 4, zIndex: 50,
          boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        }}>
          {isOwn ? (
            <button onClick={doDelete} disabled={deleting} style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 8, color: C.red, opacity: deleting ? 0.6 : 1 }}>
              <Icon name="delete" size={16} /> {deleting ? 'Deleting…' : `Delete ${kind === 'comment' ? 'comment' : 'post'}`}
            </button>
          ) : (
            <>
              {canModerate && (
                <button onClick={doHide} disabled={hiding} style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 8, opacity: hiding ? 0.6 : 1 }}>
                  <Icon name="hide" size={16} /> {hiding ? 'Hiding…' : `Hide ${kind === 'comment' ? 'comment' : 'post'}`}
                </button>
              )}
              <button onClick={openReport} style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="report" size={16} /> Report</button>
              <button onClick={doBlock} style={{ ...menuItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="block" size={16} /> Block {authorHandle ? `@${authorHandle}` : 'user'}
              </button>
            </>
          )}
        </div>
      )}

      {showReportModal && (
        <ReportModal
          kind={kind}
          pickedReason={pickedReason}
          setPickedReason={setPickedReason}
          details={details}
          setDetails={setDetails}
          submitting={submitting}
          error={error}
          onCancel={() => setShowReportModal(false)}
          onSubmit={submitReport}
        />
      )}
    </div>
  );
}

const menuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 12px', borderRadius: 6,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: C.ice, fontSize: 13, fontFamily: "'Barlow', sans-serif",
};

function ReportModal({
  kind, pickedReason, setPickedReason, details, setDetails,
  submitting, error, onCancel, onSubmit,
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, zIndex: 1000,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: 20, width: '100%', maxWidth: 380, color: C.ice,
          fontFamily: "'Barlow', sans-serif",
        }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
          fontWeight: 900, fontSize: 22, textTransform: 'uppercase',
          letterSpacing: '0.04em', marginBottom: 4,
        }}>
          Report this {kind}
        </div>
        <div style={{ fontSize: 13, color: C.steel, marginBottom: 14 }}>
          We'll review it. They won't know it was you.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {REPORT_REASONS.map((r) => (
            <label key={r.id} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              background: pickedReason === r.id ? 'rgba(215,38,56,0.12)' : 'rgba(11,31,58,0.6)',
              border: `1px solid ${pickedReason === r.id ? C.red : C.border}`,
            }}>
              <input type="radio" name="report_reason" value={r.id}
                checked={pickedReason === r.id}
                onChange={() => setPickedReason(r.id)}
                style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{r.label}</div>
                <div style={{ fontSize: 12, color: C.steel }}>{r.description}</div>
              </div>
            </label>
          ))}
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 500))}
          placeholder="Add details (optional)"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.navy, border: `1px solid ${C.border}`, color: C.ice,
            borderRadius: 8, padding: '10px 12px', fontSize: 13, outline: 'none',
            fontFamily: "'Barlow', sans-serif", resize: 'vertical',
            marginBottom: 8,
          }} />
        <div style={{ textAlign: 'right', fontSize: 11, color: C.steel, marginBottom: 12 }}>
          {details.length}/500
        </div>

        {error && (
          <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={submitting} style={{
            background: 'transparent', color: C.ice, border: `1px solid ${C.border}`,
            padding: '9px 16px', borderRadius: 999, cursor: 'pointer',
            fontFamily: "'Barlow', sans-serif", fontSize: 13, fontWeight: 600,
          }}>Cancel</button>
          <button onClick={onSubmit} disabled={submitting} style={{
            background: C.red, color: '#fff', border: 'none',
            padding: '9px 18px', borderRadius: 999, cursor: 'pointer',
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
            fontStyle: 'italic', fontSize: 14, letterSpacing: '0.05em',
            textTransform: 'uppercase', opacity: submitting ? 0.6 : 1,
          }}>{submitting ? 'Sending…' : 'Send report'}</button>
        </div>
      </div>
    </div>
  );
}
