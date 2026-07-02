import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDmUnreadCount, subscribeInbox, hasAnyConversations } from '../lib/messages';
import { C } from '../lib/tokens';

/**
 * Speech-bubble icon with an unread-DM badge. Mirrors NotificationBell: polls
 * every 45s + refreshes on tab focus, and listens to realtime message inserts
 * (RLS scopes those to the user's own threads) for instant updates.
 */
export default function MessagesIcon({ userId, size = 22, color }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    const refresh = async () => {
      try {
        const c = await getDmUnreadCount();
        if (!cancelled) setCount(c);
      } catch { /* swallow — hold last known count */ }
    };
    refresh();

    // perf(scale): realtime (subscribeInbox) + the visibility refresh below are
    // the live paths; this interval is just a sparse reconciliation fallback.
    // 45s × 10k ≈ 220 qps → 5min cuts it ~7×.
    const interval = setInterval(refresh, 300_000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);

    // perf(scale): subscribeInbox opens an UNFILTERED postgres_changes channel
    // on `messages` (RLS scopes deliveries, but the channel + its per-row RLS
    // eval still exist for every logged-in user). Most pilot users have zero
    // DMs, so we only open it when they actually have a conversation. Trade-off:
    // a user who RECEIVES their first-ever DM while this tab is open won't get a
    // live badge until the next 5-min poll or a remount — accepted, since the
    // reconciliation interval already covers it and first-DM-while-watching is
    // rare. The gate is async, so guard against unmount landing first.
    let unsub = () => {};
    hasAnyConversations()
      .then((has) => {
        if (cancelled || !has) return;
        try { unsub = subscribeInbox(() => refresh()); }
        catch { /* polling-only is fine */ }
      })
      .catch(() => { /* polling-only is fine */ });

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      try { unsub(); } catch { /* swallow */ }
    };
  }, [userId]);

  return (
    <button onClick={() => navigate('/messages')} title="Messages" aria-label="Messages"
      style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color || C.ice }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {count > 0 && (
        <span style={{
          position: 'absolute', top: 0, right: 0,
          background: C.red, color: '#fff',
          minWidth: 16, height: 16, borderRadius: 999,
          padding: '0 4px', fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${C.navy}`, lineHeight: 1,
          fontFamily: 'Barlow, sans-serif',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
