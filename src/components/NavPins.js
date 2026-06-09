import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyNavPins } from '../lib/navPins';

const C = { ice: '#F4F7FA', steel: '#8BA3BE', blue: '#2E5B8C', border: '#1E3A5C' };
const TYPE_LABEL = { league: 'League', team: 'Team', tournament: 'Tournament' };

// NAV-PIN-2 — the user's explicit nav pins (up to 3: league / team / tournament),
// pinned via the 📌 toggle on each page. Renders the avatars in the mobile top
// cluster ('icon') and a labeled list in the desktop sidebar ('row'). Renders
// nothing if the user has pinned nothing (fully explicit — no auto-derive).
//
// variant 'icon' — mobile / compact: a row of avatar buttons
// variant 'row'  — desktop sidebar: avatar + type label + name, one per line

function Avatar({ pin, size }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', flexShrink: 0, background: pin.bg, color: '#fff',
      fontSize: size * 0.42, fontWeight: 800, lineHeight: 1,
      fontFamily: "'Barlow Condensed', sans-serif", border: `2px solid ${C.steel}`,
    }}>
      {pin.logo_url ? (
        <img src={pin.logo_url} alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : pin.initials}
    </div>
  );
}

export default function NavPins({ userId, size = 26, variant = 'icon' }) {
  const navigate = useNavigate();
  const [pins, setPins] = useState([]);

  useEffect(() => {
    if (!userId) { setPins([]); return undefined; }
    let cancelled = false;
    (async () => {
      let p = [];
      try { p = await getMyNavPins(userId); } catch { /* fail-soft */ }
      if (!cancelled) setPins(p);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!pins.length) return null;

  if (variant === 'row') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {pins.map((pin) => (
          <button
            key={`${pin.pin_type}:${pin.target_id}`}
            onClick={() => navigate(pin.href)} title={pin.name}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px', background: 'transparent', border: 'none',
              borderRadius: 10, cursor: 'pointer', color: C.ice, textAlign: 'left', fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.border + '66'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <Avatar pin={pin} size={size} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>{TYPE_LABEL[pin.pin_type]}</div>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.name}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {pins.map((pin) => (
        <button
          key={`${pin.pin_type}:${pin.target_id}`}
          onClick={() => navigate(pin.href)}
          title={`${TYPE_LABEL[pin.pin_type]} · ${pin.name}`} aria-label={`Go to ${pin.name}`}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Avatar pin={pin} size={size} />
        </button>
      ))}
    </div>
  );
}
