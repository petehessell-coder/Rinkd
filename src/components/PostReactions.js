import React, { useEffect, useRef, useState } from 'react';
import { REACTION_EMOJIS, toggleReaction } from '../lib/reactions';
import { haptics } from '../lib/haptics';
import { C } from '../lib/tokens';

// Preserved local drift (C01): the "mine" chip border is the bright sky-blue
// matching its rgba(91,159,226,...) fill, and borders here run a hair heavier
// (alpha .5) than the token (.4). Kept pixel-identical; drift pass may revisit.
const LOCAL = { blue: '#5B9FE2', border: 'rgba(46,91,140,0.5)' };

// Inject the reaction micro-interaction keyframes once (the app styles inline,
// so there's no global stylesheet to drop these in). `rinkdReactPop` springs
// the tapped emoji; `rinkdReactFloat` lofts a ghost copy up + away for a beat.
if (typeof document !== 'undefined' && !document.getElementById('rinkd-reaction-anim')) {
  const el = document.createElement('style');
  el.id = 'rinkd-reaction-anim';
  el.textContent =
    '@keyframes rinkdReactPop{0%{transform:scale(1)}35%{transform:scale(1.45)}60%{transform:scale(.9)}100%{transform:scale(1)}}' +
    '@keyframes rinkdReactFloat{0%{transform:translate(-50%,0) scale(1);opacity:.9}100%{transform:translate(-50%,-26px) scale(1.5);opacity:0}}';
  document.head.appendChild(el);
}

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
  // Transient "just reacted" marker that drives the pop + float animation.
  const [pop, setPop] = useState(null); // { emoji, key }
  const popSeq = useRef(0);
  const popTimer = useRef(null);
  useEffect(() => () => clearTimeout(popTimer.current), []);

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
    // Only celebrate adding a reaction, not removing one.
    const willReactOn = !(reactions[emoji]?.mine);
    setReactions((prev) => applyToggle(prev, emoji));
    if (willReactOn) {
      haptics.tick();
      const key = ++popSeq.current;
      setPop({ emoji, key });
      clearTimeout(popTimer.current);
      popTimer.current = setTimeout(() => setPop(null), 650);
    }
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
        const popping = pop?.emoji === emoji;
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
            disabled={!currentUserId}
            title={mine ? 'Remove reaction' : 'React'}
            style={{
              position: 'relative',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: mine ? 'rgba(91,159,226,0.22)' : 'rgba(11,31,58,0.6)',
              border: `1px solid ${mine ? LOCAL.blue : LOCAL.border}`,
              color: C.ice, fontSize: 12, lineHeight: 1.4,
              cursor: currentUserId ? 'pointer' : 'default',
              fontFamily: "'Barlow', sans-serif",
              transition: 'background 0.15s, border-color 0.15s',
            }}>
            <span
              key={popping ? pop.key : 'static'}
              style={{ fontSize: 13, display: 'inline-block', animation: popping ? 'rinkdReactPop .45s ease' : 'none' }}>{emoji}</span>
            <span style={{ fontWeight: mine ? 700 : 400 }}>{cell.count}</span>
            {popping && (
              <span key={`float-${pop.key}`} aria-hidden="true"
                style={{ position: 'absolute', left: '50%', top: -4, transform: 'translate(-50%,0)', fontSize: 17, pointerEvents: 'none', animation: 'rinkdReactFloat .6s ease forwards' }}>{emoji}</span>
            )}
          </button>
        );
      })}

      {currentUserId && (
        <button
          aria-label="Add reaction"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: 999,
            background: 'rgba(11,31,58,0.6)', border: `1px solid ${LOCAL.border}`,
            color: C.steel, fontSize: 15, cursor: 'pointer', padding: 0, fontWeight: 700,
          }}>
          ＋
        </button>
      )}

      {pickerOpen && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 60,
          display: 'flex', gap: 4, padding: 6,
          background: C.card, border: `1px solid ${LOCAL.border}`, borderRadius: 999,
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
