import React, { useEffect, useRef, useState } from 'react';
import { REACTION_EMOJIS, toggleReaction } from '../lib/reactions';

const C = { ice: '#F4F7FA', steel: '#8BA3BE', blue: '#5B9FE2', border: 'rgba(46,91,140,0.5)' };

/**
 * Emoji-reaction strip for a single post (REACT-1). Self-contained: seeded from
 * the parent's batched `initial` summary ({ emoji: { count, mine } }) but owns
 * its optimistic state from there, so parents only have to load + pass the
 * snapshot — no per-tap handler threading. Toggling is its own inverse, so a
 * failed write just re-applies the same toggle to roll back.
 *
 * Logged-out viewers see read-only pills (no picker, no toggling).
 *
 *   <PostReactions postId={p.id} currentUserId={user?.id} initial={reactionMap[p.id]} />
 */
export default function PostReactions({ postId, currentUserId, initial }) {
  const [reactions, setReactions] = useState(initial || {});
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef(null);
  const inFlight = useRef(new Set());

  // Re-seed when the parent hands us a genuinely new snapshot (feed reload),
  // but not on mere render churn — compare by content, and never stomp a
  // reaction that's mid-flight.
  const initialSig = JSON.stringify(initial || {});
  useEffect(() => {
    if (inFlight.current.size === 0) setReactions(initial ? JSON.parse(initialSig) : {});
  }, [initialSig, initial]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setPickerOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  const applyToggle = (prev, emoji) => {
    const cur = prev[emoji] || { count: 0, mine: false };
    const mineNow = !cur.mine;
    const count = Math.max(0, cur.count + (mineNow ? 1 : -1));
    const next = { ...prev, [emoji]: { count, mine: mineNow } };
    if (count === 0) delete next[emoji];
    return next;
  };

  const onToggle = (emoji) => {
    if (!currentUserId) return;
    setPickerOpen(false);
    setReactions((prev) => applyToggle(prev, emoji));
    if (inFlight.current.has(emoji)) return;
    inFlight.current.add(emoji);
    (async () => {
      const { error } = await toggleReaction(postId, currentUserId, emoji);
      if (error) setReactions((prev) => applyToggle(prev, emoji)); // toggle is its own inverse
      inFlight.current.delete(emoji);
    })();
  };

  // Show pills only for emojis that have at least one reaction, in the curated
  // order. Anything off-set (legacy) is appended after.
  const active = REACTION_EMOJIS.filter((e) => reactions[e]?.count > 0)
    .concat(Object.keys(reactions).filter((e) => !REACTION_EMOJIS.includes(e) && reactions[e]?.count > 0));

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {active.map((emoji) => {
        const cell = reactions[emoji];
        const mine = cell?.mine;
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
            disabled={!currentUserId}
            title={mine ? 'Remove reaction' : 'React'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: mine ? 'rgba(91,159,226,0.22)' : 'rgba(11,31,58,0.6)',
              border: `1px solid ${mine ? C.blue : C.border}`,
              color: C.ice, fontSize: 12, lineHeight: 1.4,
              cursor: currentUserId ? 'pointer' : 'default',
              fontFamily: "'Barlow', sans-serif",
            }}>
            <span style={{ fontSize: 13 }}>{emoji}</span>
            <span style={{ fontWeight: mine ? 700 : 400 }}>{cell.count}</span>
          </button>
        );
      })}

      {currentUserId && (
        <button
          aria-label="Add reaction"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 24, borderRadius: 999,
            background: 'rgba(11,31,58,0.6)', border: `1px solid ${C.border}`,
            color: C.steel, fontSize: 15, cursor: 'pointer', padding: 0, fontWeight: 700,
          }}>
          ＋
        </button>
      )}

      {pickerOpen && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 60,
          display: 'flex', gap: 4, padding: 6,
          background: '#0f2847', border: `1px solid ${C.border}`, borderRadius: 999,
          boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        }}>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
              style={{
                background: reactions[emoji]?.mine ? 'rgba(91,159,226,0.22)' : 'transparent',
                border: 'none', borderRadius: 999, cursor: 'pointer',
                fontSize: 18, lineHeight: 1, padding: '4px 6px',
              }}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
