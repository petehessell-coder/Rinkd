import React from 'react';
import { colors, C, type, radii, font } from '../../lib/tokens';
import Button from './Button';

// =============================================================================
// ErrorState — the manifesto's "error states must tell you exactly what to do
// next, not just that something failed." A designed card (never a bare string)
// with: a one-line what-happened title, a what-to-do-next body, and a primary
// Retry. Offline-aware: pass `offline` and it swaps to connectivity copy so the
// user isn't told to "try again" into a dead network.
//
//   <ErrorState onRetry={load} />                       // generic load failure
//   <ErrorState offline onRetry={load} />               // dropped connection
//   <ErrorState title="Couldn't post that chirp"
//               body="Your text is safe. Tap to try again." onRetry={submit} />
//
// `compact` tightens it for inline/in-list use (a failed section inside a page).
// =============================================================================
export default function ErrorState({
  title,
  body,
  onRetry,
  retrying = false,
  offline = false,
  retryLabel,
  icon,
  compact = false,
  style,
  children,
}) {
  const heading = title || (offline ? 'You’re offline' : 'That didn’t load');
  const help = body || (offline
    ? 'Reconnect to the internet and we’ll pull this right up.'
    : 'A hiccup on our end or your connection. Give it another shot.');
  const mark = icon != null ? icon : (offline ? '📡' : '🏒');

  return (
    <div
      role="alert"
      style={{
        textAlign: 'center',
        padding: compact ? '28px 18px' : '44px 24px',
        background: colors.surface,
        border: `1px solid ${C.border}`,
        borderRadius: radii.card,
        ...style,
      }}
    >
      <div style={{ fontSize: compact ? 34 : 44, lineHeight: 1, marginBottom: 12 }}>{mark}</div>
      <div style={{ ...type.pageTitle, fontSize: compact ? 20 : 24, color: C.ice, textTransform: 'uppercase', marginBottom: 8 }}>
        {heading}
      </div>
      <div style={{ fontFamily: font.body, fontSize: 14, fontWeight: 500, color: C.steel, lineHeight: 1.55, maxWidth: 360, margin: '0 auto' }}>
        {help}
      </div>
      {onRetry && (
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <Button onClick={onRetry} loading={retrying} variant="primary">
            {retryLabel || (offline ? 'Try again' : 'Retry')}
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}
