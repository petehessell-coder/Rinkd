import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import { EmptyState, ListRowSkeleton } from '../components/Skeletons';
import { listNotifications, markRead, markAllRead, deleteNotification, KIND_META } from '../lib/notifications';
import { timeAgo } from '../lib/posts';
import { C } from '../lib/tokens';
import { Icon } from '../components/ui';

export default function NotificationsPage({ currentUser, profile }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | unread

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await listNotifications({ limit: 80, unreadOnly: filter === 'unread' });
    setItems(data);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const openOne = async (n) => {
    if (!n.read_at) {
      // Only mark it read in the UI if the write actually landed — otherwise
      // the badge and this list drift apart on the next load.
      const { error } = await markRead(n.id);
      if (!error) {
        setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read_at: new Date().toISOString() } : p)));
      }
    }
    if (n.url) navigate(n.url);
  };

  const handleMarkAll = async () => {
    const { error } = await markAllRead();
    if (error) {
      // eslint-disable-next-line no-alert
      alert("Couldn't mark everything read. Check your connection and try again.");
      return;
    }
    setItems((prev) => prev.map((p) => ({ ...p, read_at: p.read_at || new Date().toISOString() })));
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    const { error } = await deleteNotification(id);
    if (error) {
      // eslint-disable-next-line no-alert
      alert("Couldn't dismiss that notification. Try again in a moment.");
      return;
    }
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  const unreadCount = items.filter((i) => !i.read_at).length;

  return (
    <Layout profile={profile}>
      <SEO title="Notifications" noIndex />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 80px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1.1, textTransform: 'uppercase' }}><TapeText height={24}>Notifications</TapeText></div>
              <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>{unreadCount} unread</div>
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAll}
                style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['all', 'All'], ['unread', 'Unread']].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                style={{ background: filter === id ? C.red : 'transparent', color: filter === id ? '#fff' : C.steel, border: `1px solid ${filter === id ? C.red : C.border}`, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <ListRowSkeleton rows={6} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="🔔"
              title={filter === 'unread' ? 'All caught up' : 'The ice is quiet'}
              body={filter === 'unread' ? 'You\'ve read everything. Go drop a goal.' : 'Follow some teams and players to change that — likes, mentions, and game alerts all land right here.'}
              cta={filter === 'unread' ? { label: 'Back to Chirps', onClick: () => navigate('/feed') } : { label: 'Discover Teams', onClick: () => navigate('/discover') }}
            />
          ) : (() => {
            // Group into Today / Earlier with broadcast lower-third dividers.
            const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
            const today = items.filter((n) => new Date(n.created_at) >= startToday);
            const earlier = items.filter((n) => new Date(n.created_at) < startToday);
            const sectionCard = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 };
            return (
              <>
                {today.length > 0 && (
                  <>
                    <LowerThird label="Today" />
                    <div style={sectionCard}>
                      {today.map((n, i) => <NotifRow key={n.id} n={n} first={i === 0} onOpen={openOne} onDelete={handleDelete} />)}
                    </div>
                  </>
                )}
                {earlier.length > 0 && (
                  <>
                    <LowerThird label="Earlier" />
                    <div style={sectionCard}>
                      {earlier.map((n, i) => <NotifRow key={n.id} n={n} first={i === 0} onOpen={openOne} onDelete={handleDelete} />)}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </Layout>
  );
}

// Tone of a notification — drives the icon color + text emphasis so a goal-horn
// moment never reads like a quiet follow.
//  · gold  → POTG / milestones (scarce, earned)
//  · red   → urgency (suspension, sub needed, game reminder)
//  · white → everyday social (follow, like, comment, mention, …)
const RED_KINDS = new Set(['suspension', 'sub_alert', 'game_reminder']);
const GOLD_KINDS = new Set(['game_puck_won', 'milestone']);
function toneFor(kind) {
  if (GOLD_KINDS.has(kind)) return 'gold';
  if (RED_KINDS.has(kind)) return 'red';
  return 'white';
}

// Broadcast lower-third date divider — white Barlow Condensed 700 italic caps on
// navy with a red accent slab, bleeding to the content column's left edge.
function LowerThird({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: '#0f2847', borderLeft: '4px solid #D72638', marginLeft: -16, marginBottom: 12, padding: '8px 14px 8px 16px', borderTopRightRadius: 4, borderBottomRightRadius: 4 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 18, lineHeight: 1, letterSpacing: '0.05em', color: '#F4F7FA', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}

function NotifRow({ n, first, onOpen, onDelete }) {
  const meta = KIND_META[n.kind] || { icon: 'notifications', label: 'Notification' };
  const isUnread = !n.read_at;
  const tone = toneFor(n.kind);
  const accent = tone === 'red' ? '#D72638' : tone === 'gold' ? '#C9A84C' : '#F4F7FA';
  const hot = tone !== 'white'; // goal/urgency/POTG → bolder type + accent
  // Split the leading actor name (bold) from the action text (muted). Falls
  // back to the whole body when it isn't name-prefixed (system notifications).
  const actorName = n.actor?.name || '';
  const body = n.body || meta.label;
  const hasName = actorName && body.toLowerCase().startsWith(actorName.toLowerCase());
  const action = hasName ? body.slice(actorName.length).replace(/^\s+/, '') : null;
  return (
    <div onClick={() => onOpen(n)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
        borderTop: first ? 'none' : '1px solid rgba(46,91,140,0.18)',
        borderLeft: isUnread ? '4px solid #D72638' : '4px solid transparent',
        background: isUnread ? '#162f55' : 'transparent',
        cursor: 'pointer', transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!isUnread) e.currentTarget.style.background = 'rgba(46,91,140,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? '#162f55' : 'transparent'; }}>
      {/* Type icon — tone-colored container (red urgency / gold POTG / neutral). */}
      {n.actor ? (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar profile={n.actor} size={38} />
          <div style={{ position: 'absolute', right: -4, bottom: -4, minWidth: 20, height: 20, padding: '0 3px', borderRadius: 999, background: hot ? accent : C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${hot ? accent : C.border}` }}><Icon name={meta.icon} size={12} color={hot ? '#fff' : C.ice} /></div>
        </div>
      ) : (
        <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: tone === 'red' ? 'rgba(215,38,56,0.18)' : tone === 'gold' ? 'rgba(201,168,76,0.18)' : C.navy, border: `1px solid ${hot ? accent : C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={meta.icon} size={20} color={hot ? accent : C.ice} /></div>
      )}
      {/* Name (bold) + action (muted). Goal/POTG get bolder type + accent. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, lineHeight: 1.45, color: C.ice }}>
          {hasName ? (
            <>
              <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: hot ? 800 : 700, color: hot ? accent : C.ice }}>{actorName}</span>
              {action ? <span style={{ color: C.steel, fontWeight: hot ? 600 : 400 }}> {action}</span> : null}
            </>
          ) : (
            <span style={{ fontWeight: hot ? 700 : 500, color: hot ? accent : C.ice }}>{body}</span>
          )}
        </div>
      </div>
      {/* Timestamp (small, right-aligned, muted) + dismiss. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.steel, whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</span>
        <button onClick={(e) => onDelete(n.id, e)} title="Dismiss"
          style={{ background: 'transparent', color: C.steel, border: 'none', padding: 2, fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}
