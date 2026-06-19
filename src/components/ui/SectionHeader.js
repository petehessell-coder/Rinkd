import React from 'react';
import { colors, C, type, radii } from '../../lib/tokens';

// =============================================================================
// SectionHeader — the broadcast lower-third. Manifesto "Arena Analogy ›
// Section headers": white Barlow Condensed 700 italic caps on a solid
// navy/red bar that bleeds to the column's left edge. Think "PERIOD 2 · LIVE",
// not "Recent Games".
//
//   <SectionHeader label="Recent Games" />
//   <SectionHeader label="Live Now" live accessory={<span>3</span>} />
//
// `bleed` is how far the slab pushes past the content column's left padding
// (default 16, matching the app's standard gutter). `accessory` renders on the
// right — a count, a live dot, a "see all" link.
// =============================================================================
export default function SectionHeader({
  label,
  accessory,
  live = false,
  bleed = 16,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: live ? 'rgba(215,38,56,0.14)' : colors.surface,
        borderLeft: `4px solid ${C.red}`,
        marginLeft: -bleed,
        paddingLeft: bleed, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
        borderTopRightRadius: radii.hero, borderBottomRightRadius: radii.hero,
        marginBottom: 12,
        ...style,
      }}
      {...rest}
    >
      {live && <LiveDot />}
      <span
        style={{
          flex: 1, minWidth: 0,
          ...type.sectionHead,
          color: C.ice,
          // Real section labels can run long ("Eastern Conference Quarterfinals").
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {accessory != null && (
        <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>{accessory}</span>
      )}
    </div>
  );
}

// Pulsing red ring — the "red light on" live tell. Decorative-but-meaningful, so
// it respects reduced motion via the injected media query.
function LiveDot() {
  ensureLiveKeyframes();
  return (
    <span
      aria-label="Live"
      style={{
        position: 'relative', flexShrink: 0,
        width: 9, height: 9, borderRadius: 999, background: C.red,
      }}
    >
      <span className="rinkd-sh-livering" style={{
        position: 'absolute', inset: 0, borderRadius: 999,
        boxShadow: `0 0 0 2px ${C.red}`,
      }} />
    </span>
  );
}

let liveInjected = false;
function ensureLiveKeyframes() {
  if (liveInjected || typeof document === 'undefined') return;
  liveInjected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes rinkdShLive{0%{opacity:0.9;transform:scale(1)}100%{opacity:0;transform:scale(2.4)}}' +
    '.rinkd-sh-livering{animation:rinkdShLive 1.5s ease-out infinite}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-sh-livering{animation:none;opacity:0}}';
  document.head.appendChild(el);
}
