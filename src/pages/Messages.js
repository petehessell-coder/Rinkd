import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import TapeText from '../components/TapeText';
import { ListRowSkeleton } from '../components/Skeletons';
import { Button, EmptyState, ErrorState, useToast } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { timeAgo } from '../lib/posts';
import {
  listConversations, getMessages, sendMessage, markConversationRead,
  subscribeToConversation, getConversationOther, getOrCreateDm, searchUsers,
} from '../lib/messages';
import { C, motion } from '../lib/tokens';
import { transition, motionSafe, ensureMotionKeyframes } from '../lib/motion';

export default function Messages({ currentUser, profile }) {
  const { conversationId } = useParams();
  return conversationId
    ? <Thread key={conversationId} conversationId={conversationId} currentUser={currentUser} profile={profile} />
    : <Inbox currentUser={currentUser} profile={profile} />;
}

// =========================================================================
// INBOX — list of conversations + "new message" picker
// =========================================================================
function Inbox({ currentUser, profile }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [picker, setPicker] = useState(false);
  const online = useOnline();
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await listConversations();
      setItems(data);
      setError(false);
    } catch { setError(true); /* hold last known list if we have one */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Layout profile={profile}>
      <SEO title="Messages" noIndex />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 80px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1.1, textTransform: 'uppercase' }}>
              <TapeText height={24}>Messages</TapeText>
            </div>
            <button onClick={() => setPicker(true)}
              style={{ background: C.red, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
              New
            </button>
          </div>

          {loading ? (
            <ListRowSkeleton rows={6} />
          ) : error && items.length === 0 ? (
            <ErrorState
              title="Couldn’t load messages"
              offline={!online}
              onRetry={load}
              retrying={loading}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon="💬"
              title="Quiet in here"
              body="Start a conversation with a teammate, an opponent, or your commissioner."
              cta={{ label: 'Start a message', onClick: () => setPicker(true) }}
            />
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {items.map((c, i) => {
                const o = c.other || {};
                const mine = c.last_message_sender_id === currentUser?.id;
                const unread = c.unread > 0;
                return (
                  <div key={c.conversation_id} className="rinkd-pressable" onClick={() => navigate(`/messages/${c.conversation_id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                      borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none', cursor: 'pointer',
                      background: unread ? 'rgba(215,38,56,0.05)' : 'transparent', transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(46,91,140,0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = unread ? 'rgba(215,38,56,0.05)' : 'transparent'}>
                    <Avatar profile={o} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: unread ? 800 : 600, color: C.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.name || 'Unknown'}</span>
                        {c.last_message_at && <span style={{ fontSize: 11, color: C.steel, flexShrink: 0 }}>{timeAgo(c.last_message_at)}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: unread ? C.ice : C.steel, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: unread ? 600 : 400 }}>
                        {c.last_message_preview ? `${mine ? 'You: ' : ''}${c.last_message_preview}` : 'Say hi to get things going'}
                      </div>
                    </div>
                    {unread && <div style={{ flexShrink: 0, minWidth: 20, height: 20, borderRadius: 999, background: C.red, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{c.unread > 99 ? '99+' : c.unread}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {picker && <NewMessageModal currentUser={currentUser} onClose={() => setPicker(false)} onPicked={async (userId) => {
        try {
          const id = await getOrCreateDm(userId);
          setPicker(false);
          navigate(`/messages/${id}`);
        } catch (e) {
          toast({
            message: e?.message === 'cannot message this user'
              ? "You can't message this player right now."
              : "Couldn't start that conversation — try again in a sec.",
            tone: 'alert',
          });
        }
      }} />}
    </Layout>
  );
}

// =========================================================================
// NEW MESSAGE — search people, pick one to open/create a DM
// =========================================================================
function NewMessageModal({ currentUser, onClose, onPicked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const frag = q.trim();
    if (!frag) { setResults([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchUsers(frag, { excludeIds: [currentUser?.id] });
        if (!cancelled) setResults(data);
      } catch { if (!cancelled) setResults([]); }
      if (!cancelled) setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, currentUser?.id]);

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px 16px' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: C.navy, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 16, color: C.ice }}>New message</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.steel, fontSize: 22, cursor: 'pointer', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '-11px -12px -11px auto' }}>×</button>
        </div>
        <div style={{ padding: 12 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players by name or @handle"
            style={{ width: '100%', boxSizing: 'border-box', background: C.dark, border: `1px solid ${C.border}`, borderRadius: 10, color: C.ice, padding: '11px 14px', fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none' }} />
        </div>
        <div style={{ maxHeight: '40vh', overflowY: 'auto', paddingBottom: 8 }}>
          {loading && <div style={{ padding: '8px 16px', color: C.steel, fontSize: 13 }}>Searching…</div>}
          {!loading && q.trim() && results.length === 0 && <div style={{ padding: '8px 16px', color: C.steel, fontSize: 13 }}>No players match that — try a different name or @handle.</div>}
          {results.map((u) => (
            <button key={u.id} onClick={() => onPicked(u.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: C.ice }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(46,91,140,0.18)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <Avatar profile={u} size={38} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                <div style={{ fontSize: 12, color: C.steel }}>@{u.handle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// THREAD — one conversation
// =========================================================================
function Thread({ conversationId, currentUser, profile }) {
  const navigate = useNavigate();
  const myId = currentUser?.id;
  const [other, setOther] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const { toast } = useToast();
  // perf(scale) C08 PR-F — keyset "load earlier" at the top of the thread.
  // Same pattern as CommentThread: hasMore only true when a full page came
  // back. The optimistic-send + realtime-append logic below is UNTOUCHED.
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const scrollToBottom = (behavior = 'auto') => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior, block: 'end' }));
  };

  // Initial load: header (other participant) + messages, then mark read.
  useEffect(() => {
    ensureMotionKeyframes(); // registers rinkdStaggerIn (reduced-motion gated)
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: otherProfile }, { data: rows, hasMore: more }] = await Promise.all([
        getConversationOther(conversationId, myId),
        getMessages(conversationId),
      ]);
      if (cancelled) return;
      setOther(otherProfile);
      setMsgs(rows);
      setHasMore(!!more);
      setLoading(false);
      scrollToBottom();
      markConversationRead(conversationId);
    })();
    return () => { cancelled = true; };
  }, [conversationId, myId]);

  // Realtime: append incoming messages, de-duping our own optimistic inserts.
  // UNTOUCHED — do not fold "load earlier" concerns into this effect.
  useEffect(() => {
    const unsub = subscribeToConversation(conversationId, (m) => {
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      scrollToBottom('smooth');
      if (m.sender_id !== myId) markConversationRead(conversationId);
    });
    return unsub;
  }, [conversationId, myId]);

  // "Load earlier" — prepend the next (older) page above what's shown, using
  // the oldest currently-loaded message as the cursor. Preserves scroll
  // position (anchors on the scroll container's height delta) instead of
  // jumping the viewport, since this button lives at the TOP of a
  // bottom-anchored thread.
  const loadEarlier = async () => {
    if (loadingEarlier || !msgs.length) return;
    setLoadingEarlier(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const prevScrollTop = el?.scrollTop || 0;
    try {
      const cursor = msgs[0]?.created_at;
      const { data: older, hasMore: more } = await getMessages(conversationId, { before: cursor });
      setMsgs((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !seen.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMore(more);
      // Restore scroll position after the prepend so the viewport doesn't
      // jump — run after the DOM paints the new (taller) content.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = (el.scrollHeight - prevHeight) + prevScrollTop;
      });
    } catch (e) {
      console.warn('[Messages] load earlier failed:', e?.message || e);
      toast({ message: "Couldn't load earlier messages — check your connection and try again.", tone: 'alert' });
    }
    setLoadingEarlier(false);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);

    // Optimistic bubble — show it instantly with a temp id, then swap for the
    // real row when the server confirms (mirrors CommentThread). The temp id is
    // `temp-…`, so the realtime echo (which dedups on the REAL row id) can never
    // match it — no double-render while it's pending.
    const tempId = `temp-${Date.now()}`;
    const tempMsg = { id: tempId, body, sender_id: myId, created_at: new Date().toISOString(), __pending: true };
    setMsgs((prev) => [...prev, tempMsg]);
    setDraft('');
    scrollToBottom('smooth');

    const { data, error } = await sendMessage(conversationId, body);
    setSending(false);

    if (error) {
      // Roll the temp bubble back out, restore the typed text, and say so.
      setMsgs((prev) => prev.filter((x) => x.id !== tempId));
      setDraft(body);
      toast({ message: "That didn't send — check your connection and try again.", tone: 'alert' });
      return;
    }

    if (data) {
      // Swap temp → real. If the realtime echo beat us and already inserted the
      // real row, drop the temp instead of adding a duplicate (dedup on real id).
      setMsgs((prev) => {
        const realAlreadyIn = prev.some((x) => x.id === data.id);
        return realAlreadyIn
          ? prev.filter((x) => x.id !== tempId)
          : prev.map((x) => (x.id === tempId ? data : x));
      });
      scrollToBottom('smooth');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <Layout profile={profile}>
      <SEO title={other ? `Chat with ${other.name}` : 'Messages'} noIndex />
      {/* Fixed chat panel: sits between the mobile top bar (52px) and bottom nav
          (88px + safe area) on phones, and fills the content column to the right
          of the desktop sidebar (240px) on desktop. Messages scroll INTERNALLY
          so the composer is always pinned and visible without scrolling. */}
      <style>{`
        .dm-thread {
          position: fixed;
          top: 0; bottom: 0; left: 240px; right: 0;
          display: flex; flex-direction: column;
          background: ${C.dark};
        }
        .dm-thread-inner {
          max-width: 680px; margin: 0 auto; width: 100%;
          flex: 1; min-height: 0;
          display: flex; flex-direction: column;
        }
        .dm-back { display: inline-flex; }
        @media (max-width: 768px) {
          .dm-thread {
            left: 0; right: 0;
            top: 52px;
            bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          }
          .dm-back { display: none !important; }
        }
      `}</style>
      <div className="dm-thread" style={{ color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div className="dm-thread-inner">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${C.border}`, background: C.dark, flexShrink: 0 }}>
            <button className="dm-back" onClick={() => navigate(-1)} aria-label="Back"
              style={{ background: 'transparent', border: 'none', color: C.ice, fontSize: 26, lineHeight: 1, cursor: 'pointer', padding: 0, marginRight: 4 }}>
              ‹
            </button>
            {other && (
              <div onClick={() => navigate(`/profile/${other.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <Avatar profile={other} size={36} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{other.name}</div>
                  <div style={{ fontSize: 12, color: C.steel }}>@{other.handle}</div>
                </div>
              </div>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <ListRowSkeleton rows={5} />
            ) : msgs.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: C.steel, fontSize: 14 }}>Say hi 👋</div>
            ) : (
              <>
                {/* perf(scale) C08 PR-F — quiet "load earlier" at the TOP of
                    the thread, only shown once a full page came back. */}
                {hasMore && (
                  <div style={{ textAlign: 'center', marginBottom: 4 }}>
                    <button onClick={loadEarlier} disabled={loadingEarlier}
                      style={{
                        background: 'transparent', border: 'none', color: C.steel,
                        fontSize: 12, fontWeight: 600, cursor: loadingEarlier ? 'default' : 'pointer',
                        padding: '4px 8px', fontFamily: "'Barlow', sans-serif",
                        opacity: loadingEarlier ? 0.6 : 1,
                      }}>
                      {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                    </button>
                  </div>
                )}
                {msgs.map((m) => {
                  const mine = m.sender_id === myId;
                  return (
                    <div key={m.id} style={{
                      display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start',
                      animation: motionSafe(`rinkdStaggerIn ${motion.duration.entrance}ms ${motion.easing.out} both`),
                    }}>
                      <div style={{
                        maxWidth: '76%', padding: '9px 13px', borderRadius: 16,
                        borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
                        background: mine ? C.blue : C.card, color: C.ice, fontSize: 14, lineHeight: 1.4,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        opacity: m.__pending ? 0.55 : 1, transition: transition('opacity', motion.duration.entrance),
                      }}>
                        {m.body}
                        <div style={{ fontSize: 10, color: mine ? 'rgba(244,247,250,0.6)' : C.steel, marginTop: 4, textAlign: 'right' }}>
                          {m.__pending ? 'sending…' : timeAgo(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: `1px solid ${C.border}`, background: C.dark, flexShrink: 0 }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="Message…"
              style={{ flex: 1, resize: 'none', maxHeight: 120, background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, color: C.ice, padding: '10px 14px', fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none', lineHeight: 1.4 }} />
            <Button
              variant="primary"
              size="sm"
              onClick={send}
              disabled={!draft.trim() || sending}
              disabledReason="Type a message first"
              style={{ borderRadius: 999, flexShrink: 0 }}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
