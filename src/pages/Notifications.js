import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import { EmptyState, ListRowSkeleton } from '../components/Skeletons';
import { listNotifications, markRead, markAllRead, deleteNotification, KIND_META } from '../lib/notifications';
import { timeAgo } from '../lib/posts';

const C = {
  navy: '#0B1F3A', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

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
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1.1, textTransform: 'uppercase' }}>Notifications</div>
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
              title={filter === 'unread' ? 'All caught up' : 'No notifications yet'}
              body={filter === 'unread' ? 'You\'ve read everything. Go drop a goal.' : 'When teammates like your posts, comment, follow you, or your team has a game coming up, you\'ll see it here.'}
              cta={{ label: 'Back to Chirps', onClick: () => navigate('/feed') }}
            />
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {items.map((n, i) => {
                const meta = KIND_META[n.kind] || { icon: '🔔', label: 'Notification' };
                const isUnread = !n.read_at;
                return (
                  <div key={n.id} onClick={() => openOne(n)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
                      borderTop: i ? '1px solid rgba(46,91,140,0.2)' : 'none',
                      cursor: 'pointer', position: 'relative',
                      background: isUnread ? 'rgba(215,38,56,0.05)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(46,91,140,0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = isUnread ? 'rgba(215,38,56,0.05)' : 'transparent'}>
                    {isUnread && <div style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', width: 6, height: 6, borderRadius: '50%', background: C.red }} />}
                    {n.actor ? (
                      <div style={{ position: 'relative' }}>
                        <Avatar profile={n.actor} size={36} />
                        <div style={{ position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: '50%', background: C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: `1px solid ${C.border}` }}>{meta.icon}</div>
                      </div>
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{meta.icon}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.45 }}>{n.body || meta.label}</div>
                      <div style={{ fontSize: 11, color: C.steel, marginTop: 4 }}>{timeAgo(n.created_at)}</div>
                    </div>
                    <button onClick={(e) => handleDelete(n.id, e)} title="Dismiss"
                      style={{ background: 'transparent', color: C.steel, border: 'none', padding: 4, fontSize: 16, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
