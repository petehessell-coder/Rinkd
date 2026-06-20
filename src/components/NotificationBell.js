import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUnreadCount, subscribe } from '../lib/notifications';

const C = { ice: '#F4F7FA', red: '#D72638', steel: '#8BA3BE' };

/**
 * Bell icon with unread badge. Polls + listens to realtime for live updates.
 * Drop into top bars or anywhere a quick "new stuff" indicator is useful.
 */
export default function NotificationBell({ userId, size = 22, color }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const c = await getUnreadCount(userId);
        if (!cancelled) setCount(c);
      } catch { /* swallow — bell silently stays at last known count */ }
    };
    refresh();

    // perf(scale): realtime + the visibility refresh below are the live paths;
    // this is only a reconciliation fallback for a missed event / dropped socket.
    // 45s × 10k ≈ 220 qps → 5min cuts it ~7×.
    const interval = setInterval(refresh, 300_000);
    // Refresh whenever the tab becomes visible again
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    // Realtime listener — wrapped in try/catch defensively. Polling continues
    // either way, so the user still gets updated counts.
    let unsub = () => {};
    try { unsub = subscribe(userId, () => refresh()); }
    catch { /* swallow — polling-only is fine */ }

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
      try { unsub(); } catch { /* swallow */ }
    };
  }, [userId]);

  return (
    <button onClick={() => navigate('/notifications')} title="Notifications" aria-label="Notifications"
      style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color || C.ice }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span style={{
          position: 'absolute', top: 0, right: 0,
          background: C.red, color: '#fff',
          minWidth: 16, height: 16, borderRadius: 999,
          padding: '0 4px', fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #0B1F3A', lineHeight: 1,
          fontFamily: 'Barlow, sans-serif',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
