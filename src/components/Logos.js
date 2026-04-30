import React from 'react';

const R_GRID = [
  [1,1,1,1,1,1,0],
  [1,0,0,0,0,0,1],
  [1,0,0,0,0,0,1],
  [1,1,1,1,1,1,0],
  [1,0,0,1,0,0,0],
  [1,0,0,0,1,0,0],
  [1,0,0,0,0,1,0],
  [1,0,0,0,0,0,1],
];

function LEDGrid({ size = 48, dotColor = '#D72638', offColor = '#1A3050', glowColor = '#D72638', showOff = true }) {
  const cols = 7, rows = 8;
  const dotSize = size / (cols * 1.8);
  const gap = dotSize * 0.55;
  const totalW = cols * (dotSize + gap) - gap;
  const totalH = rows * (dotSize + gap) - gap;
  const ox = (size - totalW) / 2;
  const oy = (size - totalH) / 2;

  const dots = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = R_GRID[r][c] === 1;
      const x = ox + c * (dotSize + gap) + dotSize / 2;
      const y = oy + r * (dotSize + gap) + dotSize / 2;
      const key = `${r}-${c}`;
      if (on) {
        dots.push(
          <g key={key}>
            <circle cx={x} cy={y} r={dotSize * 1.1} fill={glowColor} opacity={0.3}
              filter={`blur(${dotSize * 0.4}px)`} />
            <circle cx={x} cy={y} r={dotSize / 2} fill={dotColor} />
            <circle cx={x - dotSize * 0.1} cy={y - dotSize * 0.1} r={dotSize * 0.16} fill="rgba(255,255,255,0.5)" />
          </g>
        );
      } else if (showOff) {
        dots.push(<circle key={key} cx={x} cy={y} r={dotSize / 2 * 0.6} fill={offColor} opacity={0.3} />);
      }
    }
  }
  return <>{dots}</>;
}

export function RinkdIcon({ size = 32 }) {
  const r = Math.round(size * 0.18);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      <rect width={size} height={size} rx={r} fill="#07111F" />
      <radialGradient id={`ig${size}`} cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#D72638" stopOpacity="0.15" />
        <stop offset="100%" stopColor="transparent" stopOpacity="0" />
      </radialGradient>
      <rect width={size} height={size} rx={r} fill={`url(#ig${size})`} />
      <rect width={size} height={size} rx={r} fill="none" stroke="#1A3A5C" strokeWidth={size * 0.025} />
      <LEDGrid size={size} showOff={size > 24} />
    </svg>
  );
}

export function RinkdLogo({ size = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.4 }}>
      <RinkdIcon size={size} />
      <span style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 900, fontStyle: 'italic',
        fontSize: size * 0.85, color: '#fff',
        letterSpacing: '0.1em', lineHeight: 1,
      }}>RINKD</span>
    </div>
  );
}

export function TierBadge({ tier, size = 'sm' }) {
  const s = { sm: { font: 9, px: '2px 6px', r: 3 }, md: { font: 11, px: '3px 9px', r: 4 }, lg: { font: 14, px: '5px 12px', r: 5 } }[size] || { font: 9, px: '2px 6px', r: 3 };
  const t = typeof tier === 'string' ? { name: tier, color: '#64748B' } : tier;
  return (
    <span style={{
      background: t.color, color: '#0B1F3A',
      fontFamily: "'Barlow Condensed', sans-serif",
      fontWeight: 800, fontSize: s.font,
      padding: s.px, borderRadius: s.r,
      letterSpacing: '0.06em', lineHeight: 1,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>{t.name?.toUpperCase()}</span>
  );
}

export function Avatar({ user, size = 36 }) {
  const tier = typeof user.tier === 'string' ? { color: '#64748B' } : (user.tier || { color: '#64748B' });
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: user.avatar_color || '#2E5B8C',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Barlow Condensed', sans-serif",
      fontWeight: 800, fontSize: size * 0.36, color: '#fff',
      border: `2px solid ${tier.color}`,
      flexShrink: 0,
    }}>{user.avatar_initials || '??'}</div>
  );
}
