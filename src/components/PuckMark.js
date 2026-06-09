import React, { useState } from 'react';

// The RINKD Game Puck brand mark (the 3D mascot puck). Used everywhere the Game
// Puck feature shows its icon — card headers, the reveal medallion, the season
// board, the teaser. If the image can't load it degrades to the legacy black
// puck dot so nothing ever renders empty.
//
// `size` drives WIDTH; height follows the asset's aspect ratio. For the tiny
// header marks keep it ≥16 so the puck reads.
//
// Served as <picture> webp + PNG fallback: modern devices get the small webp,
// older ones (some iOS/Safari that don't decode webp) get the PNG. If BOTH fail
// it degrades to the legacy black puck dot.

export default function PuckMark({ size = 18, style, alt = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        aria-hidden
        style={{
          width: size, height: size, borderRadius: '50%', background: '#0a0a0a',
          border: '1px solid rgba(244,247,250,0.35)', display: 'inline-block', flexShrink: 0, ...style,
        }}
      />
    );
  }
  return (
    <picture style={{ display: 'inline-flex', flexShrink: 0 }}>
      <source srcSet="/gamepuck/puck.webp" type="image/webp" />
      <img
        src="/gamepuck/puck.png"
        alt={alt}
        aria-hidden={alt ? undefined : true}
        draggable={false}
        onError={() => setFailed(true)}
        style={{ width: size, height: 'auto', display: 'inline-block', userSelect: 'none', ...style }}
      />
    </picture>
  );
}
