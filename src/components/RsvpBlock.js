import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getGameRsvps, upsertRsvp, deleteRsvp } from '../lib/rsvp';
import { colors } from '../lib/tokens';
import { haptics } from '../lib/haptics';

const B = {
  navy: colors.bg, blue: colors.blue, red: colors.red,
  ice: colors.ice, steel: colors.muted, dark: colors.surfaceDeep,
  green: colors.success, amber: colors.warning,
  card: '#112236', border: '#1E3A5C',
};

// Dedupe rsvps by user_id — keeps the most recent row only.
// Defensive: even though the DB has a UNIQUE(game_id,user_id) constraint, this
// prevents transient duplicates if an optimistic row and a freshly-loaded row
// briefly coexist after a network refresh.
function dedupeByUser(list) {
  const byUser = new Map();
  for (const r of list) {
    if (!r || !r.user_id) continue;
    byUser.set(r.user_id, r);
  }
  return Array.from(byUser.values());
}

// `source` selects which game table this RSVP belongs to ('team' | 'league' |
// 'tournament'). Defaults to 'team' so existing team_games callers are
// unaffected. GameDetail passes the kind it already derives; Team.js team-game
// rows keep the default. See lib/rsvp.js for the column mapping.
export default function RsvpBlock({ gameId, compact = false, source = 'team' }) {
  const [rsvps, setRsvps]     = useState([]);   // canonical list for this game
  const [userId, setUserId]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (mounted.current) setLoading(false); return; }
    const all = await getGameRsvps(gameId, source);
    if (!mounted.current) return;
    setUserId(user.id);
    setRsvps(dedupeByUser(all));
    setLoading(false);
  }, [gameId, source]);

  useEffect(() => { load(); }, [load]);

  // Refresh when the tab regains focus so counts stay live as teammates RSVP.
  // Skip while a save is in flight: a refocus mid-save would race a stale read
  // against the optimistic update and flicker the button. The post-save
  // `load()` in handleRsvp picks up any teammate changes anyway.
  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && !savingRef.current) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // Single source of truth: derive myRsvp from rsvps. No separate myRsvp state.
  const myRsvp = useMemo(
    () => rsvps.find(r => r.user_id === userId) || null,
    [rsvps, userId]
  );

  const inCount    = useMemo(() => rsvps.filter(r => r.status === 'in').length,    [rsvps]);
  const outCount   = useMemo(() => rsvps.filter(r => r.status === 'out').length,   [rsvps]);
  const maybeCount = useMemo(() => rsvps.filter(r => r.status === 'maybe').length, [rsvps]);

  const handleRsvp = async (status, e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (!userId || saving) return;
    setSaving(true);

    const prevRsvps = rsvps;
    const currentStatus = myRsvp?.status;
    const togglingOff = currentStatus === status;

    // A committed "I'm in" earns a confirmation buzz (no-op on iOS/desktop by
    // design). Only the opt-in tap thumps — not out, not maybe, not toggling off.
    if (status === 'in' && !togglingOff) haptics.success();

    // Optimistic update — always operate by user_id, then dedupe.
    if (togglingOff) {
      setRsvps(prev => prev.filter(r => r.user_id !== userId));
    } else {
      const optimistic = {
        id: myRsvp?.id || `temp-${userId}`,
        game_id: gameId,
        user_id: userId,
        status,
        profile: myRsvp?.profile,
      };
      setRsvps(prev => dedupeByUser([
        ...prev.filter(r => r.user_id !== userId),
        optimistic,
      ]));
    }

    try {
      if (togglingOff) {
        await deleteRsvp(gameId, userId, source);
      } else {
        await upsertRsvp(gameId, userId, status, source);
      }
      // Refresh from DB to get accurate counts + profiles.
      await load();
    } catch (e) {
      console.error('[RSVP] save failed', e);
      if (mounted.current) setRsvps(prevRsvps);   // rollback
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  if (loading) return null;
  if (!userId) return null;

  const btnBase = {
    borderRadius: 999,
    // ≥44px tap target (accessibility floor) regardless of compact density —
    // compact only trims font/horizontal padding + drops the attendee preview.
    minHeight: 44,
    padding: compact ? '0 14px' : '0 20px',
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>

        {/* I'm In */}
        <button onClick={(e) => handleRsvp('in', e)} disabled={saving}
          style={{ ...btnBase, background: myRsvp?.status === 'in' ? B.green : 'rgba(34,197,94,0.15)', color: myRsvp?.status === 'in' ? '#ffffff' : B.green }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : '1'}>
          {`✓ I'm In${inCount > 0 ? ` (${inCount})` : ''}`}
        </button>

        {/* I'm Out */}
        <button onClick={(e) => handleRsvp('out', e)} disabled={saving}
          style={{ ...btnBase, background: myRsvp?.status === 'out' ? B.red : '#1E3A5C', color: myRsvp?.status === 'out' ? '#ffffff' : B.steel }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : '1'}>
          {`✗ I'm Out${outCount > 0 ? ` (${outCount})` : ''}`}
        </button>

        {/* Maybe — formerly "Who's In", which made the count next to it ambiguous. */}
        <button onClick={(e) => handleRsvp('maybe', e)} disabled={saving}
          style={{ ...btnBase, background: myRsvp?.status === 'maybe' ? B.amber : 'transparent', color: myRsvp?.status === 'maybe' ? '#ffffff' : B.steel, opacity: saving ? 0.7 : myRsvp?.status === 'maybe' ? 1 : 0.6 }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => e.currentTarget.style.opacity = saving ? '0.7' : myRsvp?.status === 'maybe' ? '1' : '0.6'}>
          {`? Maybe${maybeCount > 0 ? ` (${maybeCount})` : ''}`}
        </button>

      </div>

      {/* Attendee preview */}
      {!compact && inCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <div style={{ display: 'flex' }}>
            {rsvps.filter(r => r.status === 'in').slice(0, 5).map((r, i) => (
              <div key={r.id || r.user_id || i} style={{
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
            {myRsvp?.status === 'in'
              ? (inCount > 1 ? `You + ${inCount - 1} in` : `You're in`)
              : (inCount === 1
                  ? `${rsvps.find(r => r.status === 'in')?.profile?.name?.split(' ')[0] || 'Someone'} is in`
                  : `${inCount} players in`)}
            {outCount > 0 && ` · ${outCount} out`}
            {maybeCount > 0 && ` · ${maybeCount} maybe`}
          </span>
        </div>
      )}
    </div>
  );
}
