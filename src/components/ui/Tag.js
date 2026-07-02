import React from 'react';
import { C, colors, radii, font } from '../../lib/tokens';

// =============================================================================
// Tag — the chip. Manifesto "Design Tokens › Corner Philosophy": badges/chips
// get a 6px radius (radii.chip). Used for feed tags ("Goal Alert"), filters,
// status marks.
//
//   <Tag label="Goal Alert" color="#D72638" />
//   <Tag label="Beer League" color="#F59E0B" variant="soft" />
//   <Tag label="Final" />                                // defaults to steel
//
// variant: 'soft' (default — tinted bg, colored text) · 'solid' (filled) ·
//          'outline' (bordered). All truncate long labels.
// =============================================================================
export default function Tag({
  label,
  color = C.steel,
  variant = 'soft',
  onClick,
  style,
  className,
  ...rest
}) {
  // S09 M3c — a clickable Tag must give tactile press feedback (shared
  // .rinkd-pressable scale-on-tap). Merge with any caller-supplied className.
  const pressClass = [onClick ? 'rinkd-pressable' : '', className].filter(Boolean).join(' ') || undefined;
  const variantStyle = {
    soft:    { background: hexToRgba(color, 0.16), color, border: '1px solid transparent' },
    solid:   { background: color, color: readableOn(color), border: '1px solid transparent' },
    outline: { background: 'transparent', color, border: `1px solid ${hexToRgba(color, 0.6)}` },
  }[variant] || {};

  return (
    <span
      onClick={onClick}
      className={pressClass}
      style={{
        display: 'inline-flex', alignItems: 'center',
        maxWidth: '100%', minWidth: 0,
        padding: '3px 9px', borderRadius: radii.chip,
        fontFamily: font.body, fontSize: 11, fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        cursor: onClick ? 'pointer' : 'default',
        ...variantStyle,
        ...style,
      }}
      {...rest}
    >
      {label}
    </span>
  );
}

// Tags accept arbitrary brand-accent hexes (the feed palette is bright reds,
// ambers, greens). These keep the chip legible without a color library.
function hexToRgba(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex; // already rgba/named — pass through
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Black or ice text on a solid fill, by perceived luminance.
function readableOn(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return C.ice;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return C.ice;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? colors.bg : C.ice;
}
