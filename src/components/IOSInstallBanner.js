import React, { useEffect, useState } from 'react';
import { RinkdLogo } from './Logos';
import { track } from '../lib/analytics';
import { detectPlatform, detectStandalone } from '../lib/platform';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', card: '#112236', border: '#1E3A5C',
};

const VISIT_KEY = 'rinkd_visit_count';
const SESSION_FLAG = 'rinkd_visit_counted';
const DISMISSED_KEY = 'rinkd_ios_install_dismissed';
const DISMISS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // re-prompt after 14 days
const MIN_VISITS = 3; // first two app-opens feel pushy

// The custom event Tournament.js (and anywhere else high-intent) dispatches
// when a user tries to opt into push but iOS install is what's blocking it.
export const IOS_INSTALL_EVENT = 'rinkd:ios-install-prompt';

function dismissedRecently() {
  try {
    const ts = Number(localStorage.getItem(DISMISSED_KEY) || '0');
    return ts > 0 && Date.now() - ts < DISMISS_WINDOW_MS;
  } catch { return false; }
}

// Count one "visit" per browser session so the 3rd-open trigger reflects
// distinct sessions, not page navigations within one session.
function bumpVisitCountOncePerSession() {
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) {
      return Number(localStorage.getItem(VISIT_KEY) || '0');
    }
    const n = Number(localStorage.getItem(VISIT_KEY) || '0') + 1;
    localStorage.setItem(VISIT_KEY, String(n));
    sessionStorage.setItem(SESSION_FLAG, '1');
    return n;
  } catch { return 0; }
}

// Apple's standard share glyph (square with an up-arrow) — drawn inline so the
// instruction matches exactly what the user sees in Safari's toolbar.
function ShareGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ verticalAlign: 'text-bottom', flexShrink: 0 }} aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

/**
 * iOS PWA install prompt (GS-7). iOS Safari only delivers web push once the
 * app is on the home screen (iOS 16.4+), so without this nudge push reach on
 * iPhone ≈ 0. Renders only for iOS Safari that hasn't installed yet; auto-shows
 * on the 3rd app-open, and immediately on the IOS_INSTALL_EVENT (e.g. tapping
 * Follow). Purely instructional — iOS can't trigger "Add to Home Screen"
 * programmatically. Mounted once in Layout.
 */
export default function IOSInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (detectPlatform() !== 'ios-safari' || detectStandalone()) return undefined;

    if (!dismissedRecently() && bumpVisitCountOncePerSession() >= MIN_VISITS) {
      setVisible(true);
      track('ios_install_banner_shown', { trigger: 'visit' });
    }

    const onPrompt = () => {
      if (dismissedRecently()) return;
      setVisible((cur) => {
        if (!cur) track('ios_install_banner_shown', { trigger: 'follow' });
        return true;
      });
    };
    window.addEventListener(IOS_INSTALL_EVENT, onPrompt);
    return () => window.removeEventListener(IOS_INSTALL_EVENT, onPrompt);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* ignore */ }
    track('ios_install_banner_dismissed');
    setVisible(false);
  };

  return (
    <div role="dialog" aria-label="Install Rinkd"
      style={{
        position: 'fixed', left: 0, right: 0,
        // Sit just above the mobile bottom nav (which reserves ~88px + the
        // iOS home-indicator safe area).
        bottom: 'calc(92px + env(safe-area-inset-bottom, 0px))',
        zIndex: 150, padding: '0 12px',
        animation: 'rinkdInstallSlideUp 0.28s ease',
      }}>
      <div style={{
        maxWidth: 480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12,
        background: B.card, border: `1px solid ${B.border}`, borderRadius: 14,
        padding: '12px 14px', boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        fontFamily: "'Barlow', sans-serif",
      }}>
        <div style={{ flexShrink: 0 }}><RinkdLogo size={34} /></div>
        <div style={{ flex: 1, minWidth: 0, color: B.ice, fontSize: 13, lineHeight: 1.4 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Get game alerts — install Rinkd</div>
          <div style={{ color: B.steel, fontSize: 12.5 }}>
            Tap <ShareGlyph /> then <strong style={{ color: B.ice }}>Add to Home Screen</strong>. Push only works once installed.
          </div>
        </div>
        <button onClick={dismiss} aria-label="Dismiss"
          style={{
            flexShrink: 0, alignSelf: 'flex-start', background: 'transparent', border: 'none',
            color: B.steel, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: '2px 4px',
          }}>×</button>
      </div>
      <style>{`@keyframes rinkdInstallSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
