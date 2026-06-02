import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyPrimaryLeague } from '../lib/leagues';

const C = { ice: '#F4F7FA', steel: '#8BA3BE', blue: '#2E5B8C', border: '#1E3A5C' };

// Module-level cache so the league is derived ONCE per session, not on every
// route change. Pages mount their own <Layout>, so this component remounts on
// each navigation — without the cache that's up to 4 queries per nav. A user's
// league membership rarely changes mid-session; a hard reload re-derives.
let _cache = { key: null, value: null, loaded: false };

/**
 * League quick-nav pin. Surfaces the user's own league as a one-tap shortcut —
 * the league logo as the avatar — so they jump straight to /league/:id instead
 * of digging through the More drawer or Discover search. Renders nothing if the
 * user has no league (or while it's first resolving). See lib/leagues
 * getMyPrimaryLeague for how "my league" is chosen.
 *
 * variant 'icon' — mobile top bar / compact (avatar only)
 * variant 'row'  — desktop sidebar (avatar + "My League" + name)
 */
export default function LeaguePinIcon({ userId, size = 26, variant = 'icon' }) {
  const navigate = useNavigate();
  const [league, setLeague] = useState(() =>
    (_cache.loaded && _cache.key === userId) ? _cache.value : null
  );

  useEffect(() => {
    if (!userId) { setLeague(null); return undefined; }
    if (_cache.loaded && _cache.key === userId) { setLeague(_cache.value); return undefined; }

    let cancelled = false;
    (async () => {
      let l = null;
      try { l = await getMyPrimaryLeague(userId); }
      catch { /* fail-soft: no pin */ }
      _cache = { key: userId, value: l, loaded: true };
      if (!cancelled) setLeague(l);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!league) return null;

  const initials = league.logo_initials
    || (league.name ? league.name.trim().charAt(0).toUpperCase() : '?');
  const bg = league.accent_color || league.logo_color || C.blue;

  const avatar = (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0,
      background: bg, color: '#fff',
      fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      fontFamily: "'Barlow Condensed', sans-serif",
      border: `2px solid ${C.steel}`,
    }}>
      {league.logo_url ? (
        <img src={league.logo_url} alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : initials}
    </div>
  );

  const go = () => navigate(`/league/${league.id}`);

  if (variant === 'row') {
    return (
      <button onClick={go} title={league.name}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 8px', background: 'transparent', border: 'none',
          borderRadius: 10, cursor: 'pointer', color: C.ice,
          textAlign: 'left', fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.border + '66'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
        {avatar}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>My League</div>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{league.name}</div>
        </div>
      </button>
    );
  }

  return (
    <button onClick={go} title={`Go to ${league.name}`} aria-label={`Go to ${league.name}`}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {avatar}
    </button>
  );
}
