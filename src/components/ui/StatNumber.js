import React from 'react';
import { C, type, font } from '../../lib/tokens';

// =============================================================================
// StatNumber — the TV score overlay. Manifesto "Arena Analogy › Stats" + the
// hard typography rule: "stat numbers are ALWAYS Barlow Condensed 900 italic".
//
// Number first, huge, with `font-variant-numeric: tabular-nums` so a column of
// stats doesn't jitter as digits change (14 is exactly as wide as 88). Label
// underneath, small and muted. Never inside a bordered table.
//
//   <StatNumber value={12} label="Goals" />
//   <StatNumber value="5-game" label="Point streak" tone="gold" size="lg" />
//
// tone: 'ice' (default) · 'gold' (milestone/PB) · 'red' (live/urgent) · 'muted'
// align: 'start' (default) · 'center'
// =============================================================================
const TONES = { ice: C.ice, gold: C.gold, red: C.red, muted: C.steel };

const SIZES = {
  sm: 22,
  md: 34,
  lg: 48,
  xl: 64, // hero stat — the screenshot-to-the-group-chat number
};

export default function StatNumber({
  value,
  label,
  tone = 'ice',
  size = 'md',
  align = 'start',
  style,
  labelStyle,
  ...rest
}) {
  const fontSize = SIZES[size] || SIZES.md;
  const color = TONES[tone] || TONES.ice;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        minWidth: 0,
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          ...type.stat,
          fontSize,
          lineHeight: 0.95,
          color,
          // A long stat string ("5-game") must not shatter the layout.
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
      {label != null && label !== '' && (
        <span
          style={{
            fontFamily: font.body, fontWeight: 600, fontSize: 11,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: C.steel, marginTop: 4,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textAlign: align === 'center' ? 'center' : 'left',
            ...labelStyle,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
