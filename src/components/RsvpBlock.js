import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getRsvp, getGameRsvps, upsertRsvp, deleteRsvp } from '../lib/rsvp';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  green: '#22C55E', card: '#112236', border: '#1E3A5C',
};

export default function RsvpBlock({ gameId, compact = false }) {
  const [myRsvp, setMyRsvp] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    const [mine, all] = await Promise.all([
      getRsvp(gameId, user.id),
      getGameRsvps(gameId),
    ]);
    setMyRsvp(mine);
    setRsvps(all);
    setLoading(false);
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  const handleRsvp = async (status) => {
    if (!userId || saving) return;
    setSaving(true);

    // Optimistic update — instant UI feedback
    const prevRsvp = myRsvp;
    const prevRsvps = rsvps;

    if (myRsvp?.status === status) {
      // Toggle off
      setMyRsvp(null);
      setRsvps(prev => prev.filter(r => r.user_id !== userId));
    } else {
      const optimistic = { id: myRsvp?.id || 'temp', game_id: gameId, user_id: userId, status, profile: myRsvp?.profile };
      setMyRsvp(optimistic);
      setRsvps(prev => {
        const filtered = prev.filter(r => r.user_id !== userId);
        return [...filtered, optimistic];
      });
    }

    try {
      if (prevRsvp?.status === status) {
        await deleteRsvp(gameId, userId);
      } else {
        await upsertRsvp(gameId, userId, status);
      }
      // Refresh from DB to get accurate counts + profiles
      await load();
    } catch(e) {
      console.error(e);
      // Rollback on error
      setMyRsvp(prevRsvp);
      setRsvps(prevRsvps);
    }

    setSaving(false);
  };

  const inCount    = rsvps.filter(r => r.status === 'in').length;
  const outCount   = rsvps.filter(r => r.status === 'out').length;
  const maybeCount = rsvps.filter(r => r.status === 'maybe').length;

  if (loading) return null;
  if (!userId) return null;

  const btnBase = {
    borderRadius: 999,
    padding: compact ? '6px 14px' : '8px 20px',
    fontSize: compact ? 12 : 13,
    fontWeight: 700,
    fontFamily: 'Barlow, sans-serif',
    cursor: saving ? 'not-allowed' : 'pointer',
    border: 'none',
    transition: 'all 0.15s',
    opacity: saving ? 0.7 : 1,
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

        {/* I'm In */}
        <button onClick={() => handleRsvp('in')}
          style={{ ...btnBase, background: myRsvp?.status === 'in' ? B.green : 'rgba(34,197,94,0.15)', color: myRsvp?.status === 'in' ? '#ffffff' : B.green }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : '1'}>
          ✓ I'm In{inCount > 0 ? ` (${inCount})` : ''}
        </button>

        {/* I'm Out */}
        <button onClick={() => handleRsvp('out')}
          style={{ ...btnBase, background: myRsvp?.status === 'out' ? B.red : '#1E3A5C', color: myRsvp?.status === 'out' ? '#ffffff' : B.steel }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : '1'}>
          ✗ I'm Out{outCount > 0 ? ` (${outCount})` : ''}
        </button>

        {/* Who's In */}
        <button onClick={() => handleRsvp('maybe')}
          style={{ ...btnBase, background: 'none', color: myRsvp?.status === 'maybe' ? B.ice : B.steel, opacity: saving ? 0.7 : myRsvp?.status === 'maybe' ? 1 : 0.5 }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : myRsvp?.status === 'maybe' ? '1' : '0.5'}>
          ? Who's In{maybeCount > 0 ? ` (${maybeCount})` : ''}
        </button>

      </div>

      {/* Attendee preview */}
      {!compact && inCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <div style={{ display: 'flex' }}>
            {rsvps.filter(r => r.status === 'in').slice(0, 5).map((r, i) => (
              <div key={r.id || i} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: r.profile?.avatar_color || B.blue,
                border: `2px solid ${B.navy}`,
                marginLeft: i > 0 ? -6 : 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic',
                fontWeight: 900, fontSize: 9, color: '#fff', flexShrink: 0,
                zIndex: 5 - i,
              }}>
                {r.profile?.avatar_initials || '?'}
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11, color: B.steel }}>
            {inCount === 1
              ? `${rsvps.find(r => r.status === 'in')?.profile?.name?.split(' ')[0] || 'Someone'} is in`
              : `${inCount} players in`}
            {outCount > 0 && ` · ${outCount} out`}
          </span>
        </div>
      )}
    </div>
  );
}
