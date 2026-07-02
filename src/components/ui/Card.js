import React from 'react';
import { colors, C, radii, shadows } from '../../lib/tokens';

// =============================================================================
// Card — the three-tier hierarchy. Manifesto "Design Tokens › Card Hierarchy".
//
//   hero     — live games / featured. Elevated surface (#162f55), 1px red
//              border glow, blue shadow underneath. You notice it before you
//              read it. Pass `live` for the red-ring + red-glow treatment.
//   standard — regular feed content. Flat navy, 1px border, no shadow. The
//              rink wall — just content.
//   quiet    — metadata / secondary. More transparent, lower-opacity border.
//              Fades back; never competes.
//
// Defensive by default: `min-width: 0` so it can shrink inside flex/grid and
// `overflow: hidden` so nothing inside bleeds past the rounded corners.
// =============================================================================
const VARIANTS = {
  hero: {
    background: colors.surfaceElevated,
    border: '1px solid rgba(215,38,56,0.5)',
    boxShadow: shadows.heroBlue,
  },
  standard: {
    background: colors.surface,
    border: `1px solid ${C.border}`,
    boxShadow: shadows.resting,
  },
  quiet: {
    background: 'rgba(15,40,71,0.5)',
    border: '1px solid rgba(46,91,140,0.22)',
    boxShadow: shadows.resting,
  },
};

export default function Card({
  variant = 'standard',
  live = false,
  as: Tag = 'div',
  padding = 16,
  onClick,
  className,
  style,
  children,
  ...rest
}) {
  // Tappable cards get the global press state (scale dip on :active, reduced-
  // motion-guarded in index.css) via the .rinkd-pressable hook class.
  const classes = [onClick ? 'rinkd-pressable' : '', className].filter(Boolean).join(' ') || undefined;
  // D-S09-1 hover lift: the stylesheet's .rinkd-pressable:hover box-shadow
  // loses to this component's INLINE boxShadow, so tappable cards apply
  // shadows.hover via state instead. Live cards keep their red ring (it
  // outranks the lift); touch devices never hover so mobile feel is unchanged.
  const [hovered, setHovered] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.standard;
  // Live games override the hero shadow with the red-ring treatment — manifesto
  // "Live game cards: 0 0 0 1px rgba(215,38,56,0.6), 0 8px 32px ...".
  const liveStyle = live
    ? { border: '1px solid rgba(215,38,56,0.6)', boxShadow: shadows.live }
    : null;

  const hoverStyle = onClick && !live && hovered ? { boxShadow: shadows.hover } : null;

  return (
    <Tag
      onClick={onClick}
      className={classes}
      onMouseEnter={onClick ? () => setHovered(true) : undefined}
      onMouseLeave={onClick ? () => setHovered(false) : undefined}
      style={{
        position: 'relative',
        borderRadius: radii.card,
        padding,
        minWidth: 0,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        transition: 'box-shadow 150ms ease',
        ...v,
        ...liveStyle,
        ...hoverStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
