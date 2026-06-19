import React, { useState } from 'react';
import { radii } from '../../lib/tokens';
import Skeleton from './Skeleton';
import { prefersReducedMotion } from '../../lib/motion';

// =============================================================================
// Img — the no-CLS image. Manifesto "Bulletproof Layout Resilience": reserve
// space with an aspect ratio so the page never jumps when the image decodes,
// object-fit so it never dictates layout, and a designed fallback so a missing
// image looks intentional, not broken. Plus a blur-up reveal (shimmer skeleton →
// the image fades + un-blurs in) so a slow rink connection feels considered.
//
//   <Img src={post.media_url} ratio={4/5} radius={10} />            // reserved box
//   <Img src={url} ratio={1} cover={false} fallback={<Initials/>} /> // contain + fallback
//
// Pass `ratio` (number or CSS string) to reserve space — the single most
// important prop for killing layout shift. Without it the image still blur-ups
// but can't pre-reserve height (use only where the container height is fixed).
// =============================================================================
export default function Img({
  src,
  alt = '',
  ratio,                 // e.g. 4/5, 16/9, or '4 / 5'
  cover = true,          // object-fit cover (default) vs contain
  radius = radii.card,
  background = 'rgba(46,91,140,0.14)',
  fallback = null,       // node shown when there's no src / it fails to load
  loading = 'lazy',
  imgStyle,
  style,
  onClick,
  ...rest
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduced = prefersReducedMotion();
  const hasRatio = ratio != null;
  const showImg = !!src && !failed;

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: radius, width: '100%',
        aspectRatio: hasRatio ? String(ratio) : undefined,
        background,
        ...style,
      }}
      {...rest}
    >
      {/* blur-up placeholder — shimmer until the image decodes (reserves space) */}
      {showImg && !loaded && (
        <Skeleton aria-hidden width="100%" height="100%" radius={0} style={{ position: 'absolute', inset: 0 }} />
      )}

      {showImg ? (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            position: hasRatio ? 'absolute' : 'relative',
            inset: hasRatio ? 0 : undefined,
            width: '100%',
            height: hasRatio ? '100%' : 'auto',
            display: 'block',
            objectFit: cover ? 'cover' : 'contain',
            opacity: loaded ? 1 : 0,
            filter: !loaded && !reduced ? 'blur(12px)' : 'none',
            transform: !loaded && !reduced ? 'scale(1.04)' : 'none',
            transition: reduced ? 'opacity 0.15s linear' : 'opacity 0.4s ease, filter 0.5s ease, transform 0.5s ease',
            ...imgStyle,
          }}
        />
      ) : (
        // No src or it failed — the designed fallback fills the reserved box.
        <div style={{ position: hasRatio ? 'absolute' : 'relative', inset: hasRatio ? 0 : undefined, width: '100%', height: hasRatio ? '100%' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {fallback}
        </div>
      )}
    </div>
  );
}
