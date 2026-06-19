import React from 'react';
import { colors, C, type, radii, font } from '../../lib/tokens';
import Button from './Button';

// =============================================================================
// EmptyState — the pre-game warmup. Manifesto "Arena Analogy › Empty state":
// Rizzo the mascot + a punchy one-liner. An invitation, not an error. Never
// "No posts yet."
//
//   <EmptyState
//     title="The ice is fresh"
//     body="No chirps yet — be the first to drop one."
//     cta={{ label: 'Start a chirp', onClick: openComposer }} />
//
// Defaults to the Rizzo mascot (WebP with PNG fallback, matching NotFound /
// PublicGame). Pass `icon` (an emoji or node) to override with a lighter mark
// for smaller/inline empties.
// =============================================================================
export default function EmptyState({
  title,
  body,
  cta,
  icon,            // optional override — emoji string or a React node
  compact = false, // tighter padding + smaller mascot for inline use
  style,
  ...rest
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: compact ? '32px 20px' : '50px 24px',
        background: colors.surface,
        border: `1px solid ${C.border}`,
        borderRadius: radii.card,
        ...style,
      }}
      {...rest}
    >
      <div style={{ marginBottom: 16, lineHeight: 1 }}>
        {icon != null ? (
          <span style={{ fontSize: compact ? 40 : 52, display: 'inline-block' }}>{icon}</span>
        ) : (
          // <picture> grabs the 78KB WebP everywhere modern; only legacy Safari
          // (<14) falls back to the PNG. Same asset pattern as NotFound.js.
          <picture>
            <source srcSet="/mascot-rizzo.webp" type="image/webp" />
            <img
              src="/mascot-rizzo.png"
              alt="Rizzo, the Rinkd Rat"
              width="160"
              height="160"
              style={{ display: 'block', margin: '0 auto', width: compact ? 96 : 140, height: 'auto' }}
            />
          </picture>
        )}
      </div>

      <div style={{ ...type.pageTitle, fontSize: compact ? 22 : 26, color: C.ice, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>

      {body && (
        <div style={{ fontFamily: font.body, fontSize: 14, fontWeight: 500, color: C.steel, lineHeight: 1.55, maxWidth: 380, margin: '0 auto' }}>
          {body}
        </div>
      )}

      {cta && (
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <Button onClick={cta.onClick} loading={cta.loading} variant={cta.variant || 'primary'}>
            {cta.label}
          </Button>
        </div>
      )}
    </div>
  );
}
