import React from 'react';
import { useOnline } from '../lib/useOnline';
import { C, font } from '../lib/tokens';

// RESILIENCE — the global offline indicator.
//
// Mounted once at the app root. When the device drops offline it pins a slim,
// honest bar to the top ("You're offline. …") so a user staring at stale
// content knows WHY nothing's updating — and that we'll catch up automatically.
// Self-hides the moment connectivity returns. No-op (renders nothing) while
// online, so it costs nothing on the happy path. Reduced-motion safe.

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes rinkdOfflineDrop{from{transform:translateY(-100%)}to{transform:translateY(0)}}' +
    '.rinkd-offline-bar{animation:rinkdOfflineDrop 250ms cubic-bezier(0.22,0.61,0.36,1) both}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-offline-bar{animation:none}}';
  document.head.appendChild(el);
}

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  ensureKeyframes();
  return (
    <div
      className="rinkd-offline-bar"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9500,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        paddingBottom: 8, paddingLeft: 14, paddingRight: 14,
        background: C.red, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
        fontFamily: font.body, fontSize: 13, fontWeight: 700, lineHeight: 1.3,
        boxShadow: '0 2px 12px rgba(0,0,0,0.35)', textAlign: 'center',
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: '#fff', flexShrink: 0, opacity: 0.9 }} />
      <span style={{ minWidth: 0 }}>You’re offline — showing the last update. We’ll catch up when you reconnect.</span>
    </div>
  );
}
