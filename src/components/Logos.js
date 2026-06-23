import React from 'react';


export function RinkdLogo({ size = 40, showText = false }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
      <img src="/rinkd-logo.png" alt="Rinkd" style={{ width:size, height:size, objectFit:'cover', borderRadius:'18%' }}/>
      {showText && (
        <img
          src="/rinkd-wordmark-tape.png"
          alt="Rinkd"
          style={{ height: Math.round(size * 0.72), width: 'auto', display: 'block' }}
        />
      )}
    </div>
  );
}

/**
 * Glowing LED-scoreboard R icon — used on LiveBarn watch buttons and
 * anywhere we need a tiny "Rinkd mark" that matches the bigger RinkdLogo.
 * Pure SVG so it scales crisply at any size.
 */
export function LedR({ size = 16, glowId = 'rinkd-led-glow' }) {
  return (
    <svg viewBox="0 0 37 42" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* OFF dots — dark matrix */}
      {[4, 9, 14, 19, 24, 29, 34].map((x) =>
        [4, 9, 14, 19, 24, 29, 34, 39].map((y) => (
          <circle key={`off-${x}-${y}`} cx={x} cy={y} r="1.6" fill="#1a3050" />
        ))
      )}
      {/* ON dots — red glowing R shape */}
      {[
        [4, 4], [9, 4], [14, 4], [19, 4], [24, 4],
        [4, 9], [29, 9],
        [4, 14], [29, 14],
        [4, 19], [9, 19], [14, 19], [19, 19], [24, 19],
        [4, 24], [19, 24],
        [4, 29], [24, 29],
        [4, 34], [29, 34],
        [4, 39], [34, 39],
      ].map(([x, y]) => (
        <circle key={`on-${x}-${y}`} cx={x} cy={y} r="1.8" fill="#D72638" filter={`url(#${glowId})`} />
      ))}
    </svg>
  );
}

/**
 * Standalone wordmark for hero/login spots. Use anywhere we'd otherwise
 * render "Rinkd" as Barlow Condensed Italic text.
 */
export function Wordmark({ height = 60, style, src = '/rinkd-wordmark-tape.png' }) {
  return (
    <img src={src} alt="Rinkd" style={{ height, width: 'auto', display: 'block', ...style }} />
  );
}

// ============================================================================
// Brand nav icons — small SVGs that match the visual weight of the Rinkside and
// Crease logos in the sidebar. Square-aspect, brand-colored, recognizable at
// 22-26px. Each accepts a size prop so it can scale for desktop sidebar (22)
// and mobile menu (24) without losing crispness.
// ============================================================================

// Leagues — trophy on a podium. Red cup, ice base.
export function LeaguesNavIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {/* Handles */}
      <path d="M5 6h2v2a2 2 0 002 2v1.5M19 6h-2v2a2 2 0 01-2 2v1.5" stroke="#F4F7FA" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      {/* Cup body */}
      <path d="M7 4h10v5a5 5 0 01-10 0V4z" fill="#D72638"/>
      {/* Cup highlight */}
      <path d="M9 4v3.5a3 3 0 001.5 2.6" stroke="#F4F7FA" strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round" fill="none"/>
      {/* Stem */}
      <rect x="10.5" y="13.5" width="3" height="3" fill="#F4F7FA"/>
      {/* Base */}
      <rect x="7" y="17" width="10" height="3" rx="0.8" fill="#F4F7FA"/>
    </svg>
  );
}

// Profile — head + shoulders silhouette in a navy/blue gradient circle.
export function ProfileNavIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="rinkd-profile-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2E5B8C"/>
          <stop offset="1" stopColor="#0B1F3A"/>
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11.2" fill="url(#rinkd-profile-bg)" stroke="#D72638" strokeWidth="0.8"/>
      {/* Head */}
      <circle cx="12" cy="9.5" r="3.2" fill="#F4F7FA"/>
      {/* Shoulders */}
      <path d="M4.5 22c1.4-3.7 4.6-5.5 7.5-5.5s6.1 1.8 7.5 5.5z" fill="#F4F7FA"/>
    </svg>
  );
}

// Tournaments — 4-team bracket, red lines on dark background.
export function TournamentsNavIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {/* Left side — 2 first-round matches */}
      <rect x="2" y="4"  width="5" height="3" rx="0.6" fill="#0B1F3A" stroke="#D72638" strokeWidth="1.1"/>
      <rect x="2" y="11" width="5" height="3" rx="0.6" fill="#0B1F3A" stroke="#D72638" strokeWidth="1.1"/>
      <rect x="2" y="17" width="5" height="3" rx="0.6" fill="#0B1F3A" stroke="#D72638" strokeWidth="1.1"/>
      {/* Connectors left → semifinal */}
      <path d="M7 5.5h2v6.5M7 12.5h2M7 18.5h2v-6" stroke="#F4F7FA" strokeWidth="1.1" strokeLinecap="round" fill="none"/>
      {/* Semifinal box */}
      <rect x="9" y="9" width="5" height="6" rx="0.6" fill="#D72638"/>
      {/* Connector → final */}
      <path d="M14 12h3" stroke="#F4F7FA" strokeWidth="1.1" strokeLinecap="round" fill="none"/>
      {/* Trophy/winner */}
      <circle cx="19" cy="12" r="2.6" fill="#F4F7FA"/>
    </svg>
  );
}

// Chirp — Rinkd's original nav mark for the Feed.
// The word "CHIRP" flies out of an open beak. Deliberately anti-Twitter:
// no smooth songbird curves, no rounded blue, no soft serif. This is angular
// red, italic Barlow Condensed, scoreboard energy. The beak is a wedge
// (two triangles + an ice-white pupil eye dot). Wordmark is rotated -12°
// so it feels mid-flight.
//
// viewBox is intentionally 2.5:1 (56 × 22). The component supports an `inline`
// prop — when true (used inside the nav) it renders the FULL wordmark; when
// false (default), it renders just the beak/eye square (for cases where we
// need a square block, like a fallback avatar background).
export function ChirpNavIcon({ size = 22, inline = true }) {
  if (!inline) {
    // Compact square version — just the open beak + eye. Used anywhere we
    // need a 1:1 icon shape (e.g. notifications, settings rows).
    return (
      <svg width={size} height={size} viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
        {/* Upper jaw */}
        <path d="M2 11 L17 4 L17 10 Z" fill="#D72638"/>
        {/* Lower jaw (open) */}
        <path d="M2 11 L17 18 L17 12 Z" fill="#D72638"/>
        {/* Eye — ice white with navy pupil */}
        <circle cx="6.5" cy="8.8" r="1.7" fill="#F4F7FA"/>
        <circle cx="6.5" cy="8.8" r="0.75" fill="#0B1F3A"/>
      </svg>
    );
  }
  // Full wordmark — word coming out of the open beak. Renders wider than tall.
  // We scale height to the requested size and let width follow the 2.5:1 ratio.
  const w = Math.round(size * 2.5);
  return (
    <svg width={w} height={size} viewBox="0 0 56 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {/* Upper jaw of the beak */}
      <path d="M0 11 L13 5 L13 10 Z" fill="#D72638"/>
      {/* Lower jaw of the beak — opened to let the word fly out */}
      <path d="M0 11 L13 17 L13 12 Z" fill="#D72638"/>
      {/* Eye — ice white with navy pupil. Sits on the upper jaw. */}
      <circle cx="4" cy="9" r="1.4" fill="#F4F7FA"/>
      <circle cx="4" cy="9" r="0.6" fill="#0B1F3A"/>
      {/* The chirp itself — the word flying out, rotated like it's mid-air */}
      <text x="14" y="14"
        fontFamily="'Barlow Condensed', 'Arial Black', sans-serif"
        fontStyle="italic" fontWeight="900"
        fontSize="15"
        fill="#D72638"
        transform="rotate(-12, 14, 14)"
        letterSpacing="0.4">CHIRP</text>
    </svg>
  );
}

export function TierBadge({ tier, size = 'sm' }) {
  const colors = { Mite:'#8BA3BE',Squirt:'#22C55E',Peewee:'#0EA5E9',Bantam:'#F59E0B',Midget:'#8B5CF6',Junior:'#D72638',Pro:'#F4F7FA' };
  const color = colors[tier]||'#8BA3BE';
  const sizes = { xs:{px:6,py:2,fs:9},sm:{px:8,py:3,fs:10},md:{px:10,py:4,fs:12} };
  const s = sizes[size]||sizes.sm;
  return <span style={{ display:'inline-block',padding:`${s.py}px ${s.px}px`,background:color+'22',color,border:`1px solid ${color}44`,borderRadius:4,fontSize:s.fs,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:'0.08em',textTransform:'uppercase',lineHeight:1.2 }}>{tier}</span>;
}

/**
 * Reusable team logo / crest. Renders the team's uploaded `logo_url` image,
 * falling back to a colored box with `logo_initials` (or the first two letters
 * of the name). Use this anywhere a team mark appears — game cards, schedules,
 * standings, directories — so logos render consistently and degrade gracefully.
 *
 * Defensive by design (DESIGN_MANIFESTO): the initials sit BEHIND the <img>, so
 * a broken/deleted image URL fades to initials instead of an empty square.
 * `object-fit: cover` keeps non-square uploads from distorting.
 *
 * Accepts a `team`-shaped object: { name, logo_url, logo_color, logo_initials }.
 */
export function TeamLogo({ team, size = 40, radius, style }) {
  const r = radius != null ? radius : Math.round(size * 0.2);
  const color = team?.logo_color || '#2E5B8C';
  const initials = team?.logo_initials || (team?.name || '?').slice(0, 2).toUpperCase();
  const common = {
    width: size, height: size, borderRadius: r, flexShrink: 0, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: color, color: '#fff',
    fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
    fontSize: Math.round(size * 0.35), lineHeight: 1,
    ...style,
  };
  if (team?.logo_url) {
    return (
      <div style={{ ...common, position: 'relative' }}>
        {/* Fallback initials sit behind the image; if the image errors out
            (deleted bucket object, broken URL) it hides and these show through. */}
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {initials}
        </span>
        <img
          src={team.logo_url}
          alt={team?.name || ''}
          loading="lazy"
          style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
    );
  }
  return <div style={common}>{initials}</div>;
}

export function Avatar({ profile, size = 36 }) {
  const tierColors = { Mite:'#8BA3BE',Squirt:'#22C55E',Peewee:'#0EA5E9',Bantam:'#F59E0B',Midget:'#8B5CF6',Junior:'#D72638',Pro:'#F4F7FA' };
  const borderColor = tierColors[profile?.tier]||'#8BA3BE';
  const common = {
    width: size, height: size, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: `2px solid ${borderColor}`, flexShrink: 0,
    overflow: 'hidden',
  };
  // Photo avatar — falls back to initials+color if the image errors out (deleted bucket object, broken URL).
  if (profile?.avatar_url) {
    return (
      <div style={common}>
        <img
          src={profile.avatar_url}
          alt={profile?.name || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
    );
  }
  return (
    <div style={{
      ...common,
      background: profile?.avatar_color || '#2E5B8C',
      fontSize: size * 0.35, fontWeight: 700, color: 'white',
      fontFamily: "'Barlow',sans-serif",
    }}>
      {profile?.avatar_initials || '?'}
    </div>
  );
}
