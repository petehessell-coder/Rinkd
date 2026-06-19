import React from 'react';
import { radii } from '../../lib/tokens';

// =============================================================================
// Skeleton — the period-intermission placeholder. Manifesto "Loading States":
// never a generic spinner; skeletons match the exact layout of what's coming.
//
// This is the atomic block — compose it into post/list/card shapes (see
// Skeletons.js for the pre-built compositions). Reserve real dimensions so
// there's no layout shift when content hydrates.
//
//   <Skeleton width="60%" height={14} />
//   <Skeleton width={38} height={38} radius={999} />  // avatar
//
// The shimmer sweep is injected once, globally, and is disabled under
// prefers-reduced-motion (manifesto motion rule) — the block stays a calm,
// static placeholder instead.
// =============================================================================
let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes rinkdSkeletonSweep{0%{background-position:-400px 0}100%{background-position:400px 0}}' +
    '.rinkd-skeleton{background:linear-gradient(90deg,rgba(46,91,140,0.18) 0%,rgba(46,91,140,0.32) 50%,rgba(46,91,140,0.18) 100%);background-size:800px 100%;animation:rinkdSkeletonSweep 1.4s linear infinite}' +
    // Reduced motion: hold a flat tint, no sweep.
    '@media (prefers-reduced-motion: reduce){.rinkd-skeleton{animation:none;background:rgba(46,91,140,0.22)}}';
  document.head.appendChild(el);
}

export default function Skeleton({ width = '100%', height = 14, radius = 4, style, ...rest }) {
  ensureKeyframes();
  return (
    <div
      className="rinkd-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius == null ? radii.chip : radius, ...style }}
      {...rest}
    />
  );
}
