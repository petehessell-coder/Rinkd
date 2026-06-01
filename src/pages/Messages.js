import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import TapeText from '../components/TapeText';
import { EmptyState, ListRowSkeleton } from '../components/Skeletons';
import { timeAgo } from '../lib/posts';
import {
  listConversations, getMessages, sendMessage, markConversationRead,
  subscribeToConversation, getConversationOther, getOrCreateDm, searchUsers,
} from '../lib/messages';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

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
  const [picker, setPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listConversations();
      setItems(data);
    } catch { /* hold last known */ }
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
          ) : items.length === 0 ? (
            <EmptyState
              icon="💬"
              title="No messages yet"
              body="Start a conversation with a teammate, opponent, or commissioner."
              cta={{ label: 'New message', onClick: () => setPicker(true) }}
            />
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {items.map((c, i) => {
                const o = c.other || {};
                const mine = c.last_message_sender_id === currentUser?.id;
                const unread = c.unread > 0;
                return (
                  <div key={c.conversation_id} onClick={() => navigate(`/messages/${c.conversation_id}`)}
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
                        {c.last_message_preview ? `${mine ? 'You: ' : ''}${c.last_message_preview}` : 'No messages yet'}
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
          // eslint-disable-next-line no-alert
          alert(e?.message === 'cannot message this user' ? "You can't message this user." : "Couldn't start that conversation.");
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
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.steel, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 12 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players by name or @handle"
            style={{ width: '100%', boxSizing: 'border-box', background: C.dark, border: `1px solid ${C.border}`, borderRadius: 10, color: C.ice, padding: '11px 14px', fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none' }} />
        </div>
        <div style={{ maxHeight: '40vh', overflowY: 'auto', paddingBottom: 8 }}>
          {loading && <div style={{ padding: '8px 16px', color: C.steel, fontSize: 13 }}>Searching…</div>}
          {!loading && q.trim() && results.length === 0 && <div style={{ padding: '8px 16px', color: C.steel, fontSize: 13 }}>No players found.</div>}
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

  const scrollToBottom = (behavior = 'auto') => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior, block: 'end' }));
  };

  // Initial load: header (other participant) + messages, then mark read.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: otherProfile }, { data: rows }] = await Promise.all([
        getConversationOther(conversationId, myId),
        getMessages(conversationId),
      ]);
      if (cancelled) return;
      setOther(otherProfile);
      setMsgs(rows);
      setLoading(false);
      scrollToBottom();
      markConversationRead(conversationId);
    })();
    return () => { cancelled = true; };
  }, [conversationId, myId]);

  // Realtime: append incoming messages, de-duping our own optimistic inserts.
  useEffect(() => {
    const unsub = subscribeToConversation(conversationId, (m) => {
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      scrollToBottom('smooth');
      if (m.sender_id !== myId) markConversationRead(conversationId);
    });
    return unsub;
  }, [conversationId, myId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft('');
    const { data, error } = await sendMessage(conversationId, body);
    setSending(false);
    if (error) {
      setDraft(body); // restore so the user doesn't lose their text
      // eslint-disable-next-line no-alert
      alert("Couldn't send. Check your connection and try again.");
      return;
    }
    if (data) {
      setMsgs((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]));
      scrollToBottom('smooth');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <Layout profile={profile}>
      <SEO title={other ? `Chat with ${other.name}` : 'Messages'} noIndex />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif', display: 'flex', flexDirection: 'column' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.dark, zIndex: 5 }}>
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
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <ListRowSkeleton rows={5} />
            ) : msgs.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: C.steel, fontSize: 14 }}>Say hi 👋</div>
            ) : (
              msgs.map((m) => {
                const mine = m.sender_id === myId;
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '76%', padding: '9px 13px', borderRadius: 16,
                      borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
                      background: mine ? C.blue : C.card, color: C.ice, fontSize: 14, lineHeight: 1.4,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {m.body}
                      <div style={{ fontSize: 10, color: mine ? 'rgba(244,247,250,0.6)' : C.steel, marginTop: 4, textAlign: 'right' }}>{timeAgo(m.created_at)}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 12px', borderTop: `1px solid ${C.border}`, background: C.dark, position: 'sticky', bottom: 0 }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="Message…"
              style={{ flex: 1, resize: 'none', maxHeight: 120, background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, color: C.ice, padding: '10px 14px', fontSize: 14, fontFamily: 'Barlow, sans-serif', outline: 'none', lineHeight: 1.4 }} />
            <button onClick={send} disabled={!draft.trim() || sending}
              style={{ background: draft.trim() ? C.red : C.border, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'default', fontFamily: 'Barlow, sans-serif', flexShrink: 0 }}>
              Send
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
