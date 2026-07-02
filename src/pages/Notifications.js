import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';
import SEO from '../components/SEO';
import { Avatar } from '../components/Logos';
import { ListRowSkeleton } from '../components/Skeletons';
import { listNotifications, markRead, markAllRead, deleteNotification, KIND_META } from '../lib/notifications';
import { timeAgo } from '../lib/posts';
import { C, colors, motion } from '../lib/tokens';
import { Icon, ErrorState, EmptyState, SectionHeader, useToast } from '../components/ui';
import { transition, prefersReducedMotion } from '../lib/motion';
import { useOnline } from '../lib/useOnline';
import { prefetchGamePage, prefetchHandlers } from '../lib/prefetch';

export default function NotificationsPage({ currentUser, profile }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Read-once initial filter from ?filter= (e.g. the reciprocity nudge deep-links
  // to ?filter=unread). Only the two valid states are honored; anything else
  // falls back to 'all'. This page doesn't WRITE query params, so a raw
  // window.location read in the initializer is safe (no useSearchParams needed).
  const [filter, setFilter] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('filter');
    return q === 'unread' || q === 'all' ? q : 'all';
  }); // all | unread
  // Rows mid-exit: fired dismiss, still animating out before filter() drops them.
  const [leaving, setLeaving] = useState(() => new Set());
  const online = useOnline();
  const { toast } = useToast();
  // perf(scale) C08 PR-F — "Show older" keyset page. hasMore/loadingOlder
  // drive the button below the list; resets whenever the filter changes
  // (load() below always fetches a fresh first page).
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e, hasMore: more } = await listNotifications({ limit: 80, unreadOnly: filter === 'unread' });
    setItems(data || []);
    setError(e || null);
    setHasMore(!!more);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const loadOlder = async () => {
    if (loadingOlder || !items.length) return;
    setLoadingOlder(true);
    try {
      const cursor = items[items.length - 1]?.created_at;
      const { data, error: e, hasMore: more } = await listNotifications({ limit: 80, unreadOnly: filter === 'unread', before: cursor });
      if (e) throw e;
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const fresh = (data || []).filter((n) => !seen.has(n.id));
        return [...prev, ...fresh];
      });
      setHasMore(!!more);
    } catch (e) {
      toast({ message: "Couldn't load older notifications — check your connection and try again.", tone: 'alert' });
    }
    setLoadingOlder(false);
  };

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
      toast({ message: "Couldn't mark everything read. Check your connection and try again.", tone: 'alert' });
      return;
    }
    setItems((prev) => prev.map((p) => ({ ...p, read_at: p.read_at || new Date().toISOString() })));
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();

    // Reduced motion: fire the write and remove instantly — no exit animation.
    if (prefersReducedMotion()) {
      const { error } = await deleteNotification(id);
      if (error) {
        toast({ message: "Couldn't dismiss that notification. Try again in a moment.", tone: 'alert' });
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== id));
      return;
    }

    // Fire the dismiss immediately (don't wait on the animation), then animate
    // the row out concurrently and filter it once the exit finishes.
    const req = deleteNotification(id);
    setLeaving((prev) => { const n = new Set(prev); n.add(id); return n; });
    setTimeout(async () => {
      const { error } = await req;
      if (error) {
        // The write failed — un-mark it as leaving so the row settles back in.
        setLeaving((prev) => { const n = new Set(prev); n.delete(id); return n; });
        toast({ message: "Couldn't dismiss that notification. Try again in a moment.", tone: 'alert' });
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== id));
      setLeaving((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, motion.duration.exit);
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
                style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '7px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
                Mark all read
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['all', 'All'], ['unread', 'Unread']].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                style={{ background: filter === id ? C.red : 'transparent', color: filter === id ? '#fff' : C.steel, border: `1px solid ${filter === id ? C.red : C.border}`, padding: '6px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Barlow, sans-serif' }}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <ListRowSkeleton rows={6} />
          ) : error && items.length === 0 ? (
            <ErrorState
              title="Couldn’t load notifications"
              offline={!online}
              onRetry={load}
              retrying={loading}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon="🔔"
              title={filter === 'unread' ? 'All caught up' : 'The ice is quiet'}
              body={filter === 'unread' ? 'You\'ve read everything. Go drop a goal.' : 'Follow some teams and players to change that — likes, mentions, and game alerts all land right here.'}
              cta={filter === 'unread' ? { label: 'Home Ice', onClick: () => navigate('/home') } : { label: 'Discover Teams', onClick: () => navigate('/discover') }}
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
                    <SectionHeader label="Today" />
                    <div style={sectionCard}>
                      {today.map((n, i) => <NotifRow key={n.id} n={n} first={i === 0} leaving={leaving.has(n.id)} onOpen={openOne} onDelete={handleDelete} />)}
                    </div>
                  </>
                )}
                {earlier.length > 0 && (
                  <>
                    <SectionHeader label="Earlier" />
                    <div style={sectionCard}>
                      {earlier.map((n, i) => <NotifRow key={n.id} n={n} first={i === 0} leaving={leaving.has(n.id)} onOpen={openOne} onDelete={handleDelete} />)}
                    </div>
                  </>
                )}
                {/* perf(scale) C08 PR-F — keyset "Show older", matches the
                    Mark-all-read pill styling. Only shown once a full page
                    came back (listNotifications' hasMore contract). */}
                {hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <button onClick={loadOlder} disabled={loadingOlder}
                      style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, padding: '7px 14px', minHeight: 44, display: 'inline-flex', alignItems: 'center', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: loadingOlder ? 'default' : 'pointer', fontFamily: 'Barlow, sans-serif', opacity: loadingOlder ? 0.6 : 1 }}>
                      {loadingOlder ? 'Loading…' : 'Show older'}
                    </button>
                  </div>
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
// A notification that deep-links to a game → prefetch the game chunk on touch.
const isGameUrl = (u) => typeof u === 'string' && (u.includes('/game/') || u.includes('/league-game/'));
const RED_KINDS = new Set(['suspension', 'sub_alert', 'game_reminder']);
const GOLD_KINDS = new Set(['game_puck_won', 'milestone']);
function toneFor(kind) {
  if (GOLD_KINDS.has(kind)) return 'gold';
  if (RED_KINDS.has(kind)) return 'red';
  return 'white';
}

function NotifRow({ n, first, leaving, onOpen, onDelete }) {
  const meta = KIND_META[n.kind] || { icon: 'notifications', label: 'Notification' };
  const isUnread = !n.read_at;
  const tone = toneFor(n.kind);
  const accent = tone === 'red' ? C.red : tone === 'gold' ? C.gold : C.ice;
  const hot = tone !== 'white'; // goal/urgency/POTG → bolder type + accent
  // Split the leading actor name (bold) from the action text (muted). Falls
  // back to the whole body when it isn't name-prefixed (system notifications).
  const actorName = n.actor?.name || '';
  const body = n.body || meta.label;
  const hasName = actorName && body.toLowerCase().startsWith(actorName.toLowerCase());
  const action = hasName ? body.slice(actorName.length).replace(/^\s+/, '') : null;
  return (
    <div onClick={() => onOpen(n)} className="rinkd-pressable"
      {...(isGameUrl(n.url) ? prefetchHandlers(prefetchGamePage) : {})}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
        borderTop: first ? 'none' : '1px solid rgba(46,91,140,0.18)',
        borderLeft: isUnread ? '4px solid #D72638' : '4px solid transparent',
        background: isUnread ? colors.surfaceElevated : C.card,
        cursor: 'pointer',
        // Mark-read: the red unread left-border eases to transparent over `tab`
        // instead of snapping. Exit (M4b): fade + slide down over `exit`.
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'none',
        transition: leaving
          ? transition(['opacity', 'transform'], motion.duration.exit, 'in')
          : (prefersReducedMotion()
            ? 'background 0.15s'
            : `background 0.15s, border-color ${motion.duration.tab}ms ${motion.easing.inOut}`),
      }}
      onMouseEnter={(e) => { if (!isUnread) e.currentTarget.style.background = 'rgba(46,91,140,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? colors.surfaceElevated : C.card; }}>
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
              <span style={{ fontFamily: "'Barlow', sans-serif", fontWeight: hot ? 800 : 700, color: hot ? accent : C.ice, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{actorName}</span>
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
        <button onClick={(e) => onDelete(n.id, e)} title="Dismiss" aria-label="Dismiss notification"
          style={{ background: 'transparent', color: C.steel, border: 'none', fontSize: 16, cursor: 'pointer', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '-12px -8px -12px 0' }}>×</button>
      </div>
    </div>
  );
}
