import React, { useEffect, useState } from 'react';
import { C } from '../lib/tokens';

const B = {
  navy: C.navy, blue: C.blue, red: C.red,
  ice: C.ice, steel: C.steel, card: '#112236', border: '#1E3A5C',
  android: '#3DDC84',
};

/** Apple logo (minimal silhouette). */
function AppleLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="currentColor" d="M16.365 1.43c0 1.14-.46 2.23-1.21 3.04-.83.88-2.18 1.57-3.31 1.47-.14-1.11.42-2.27 1.13-3.02.78-.85 2.13-1.49 3.39-1.49zM21 17.13c-.43.99-.65 1.43-1.21 2.31-.79 1.21-1.91 2.72-3.3 2.73-1.24.01-1.56-.81-3.24-.81-1.69 0-2.04.8-3.27.81-1.39.01-2.45-1.34-3.24-2.55C4.32 16.6 4 12.55 5.96 10.06c1.27-1.6 2.84-2.53 4.43-2.53 1.31 0 2.16.72 3.27.72 1.07 0 1.71-.72 3.28-.72 1.39 0 2.86.76 3.9 2.07-3.43 1.87-2.87 6.71.16 8.53z"/>
    </svg>
  );
}

/** Android head (simple robot). */
function AndroidLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="currentColor" d="M17.6 9.48l1.84-3.18a.4.4 0 0 0-.69-.4l-1.86 3.22a11.5 11.5 0 0 0-9.78 0L5.25 5.9a.4.4 0 1 0-.69.4L6.4 9.48A10.2 10.2 0 0 0 1.5 17h21a10.2 10.2 0 0 0-4.9-7.52zM7 14.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
    </svg>
  );
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}

// Step-by-step instructions per platform target — independent of the current device
const INSTRUCTIONS = {
  ios: {
    title: 'Pop Rinkd on your iPhone',
    intro: 'Three taps and you’re skating. Safari only — Apple won’t let other browsers add to your home screen.',
    steps: [
      'Hit the Share button at the bottom of Safari (square with the arrow flying out the top).',
      'Scroll down a sec and tap Add to Home Screen.',
      'Tap Add in the top right. That’s it — Rinkd lives on your home screen now.',
    ],
    note: "On Chrome or Firefox? Copy rinkd.app, paste it into Safari, then come back here.",
  },
  android: {
    title: 'Pop Rinkd on your Android',
    intro: 'Quick install from Chrome. Works in Samsung Internet too.',
    steps: [
      'Open the ⋮ menu in Chrome’s top-right corner.',
      'Tap Install app (it might say Add to Home Screen — same thing).',
      'Confirm Install. Done.',
    ],
    note: 'If you don’t see the install option yet, poke around the app for a minute first. Chrome wants to know you actually like us before it offers.',
  },
};

/**
 * Two-button "Get the app" block for the login screen.
 *
 *  ┌───────────────────────────────┐
 *  │  Get the Rinkd app            │
 *  │  ┌──────────────┐ ┌─────────┐ │
 *  │  │  Apple  iOS  │ │ ▲ Andr. │ │
 *  │  └──────────────┘ └─────────┘ │
 *  └───────────────────────────────┘
 *
 * If we're running standalone we hide ourselves (no point offering install).
 * If a beforeinstallprompt event has fired and the user clicks Android,
 * we trigger the real native install dialog. Otherwise both buttons open
 * a step-by-step modal scoped to the chosen platform.
 */
export default function DownloadCTA() {
  const [platform, setPlatform] = useState(null); // 'ios' | 'android' | null
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(detectStandalone());

  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleAndroid = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      setDeferredPrompt(null);
      return;
    }
    setPlatform('android');
  };

  const cardBtn = {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10, padding: '12px 16px',
    background: B.card, border: `1px solid ${B.border}`, borderRadius: 12,
    color: B.ice, fontFamily: "'Barlow', sans-serif", fontSize: 14, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
  };

  return (
    <>
      <div style={{ marginTop: 28, textAlign: 'center' }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700, fontStyle: 'italic', fontSize: 13,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: B.steel, marginBottom: 10,
        }}>
          Get the App
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setPlatform('ios')}
            style={cardBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = B.ice; e.currentTarget.style.background = B.navy; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.background = B.card; }}>
            <span style={{ color: B.ice, display: 'flex', alignItems: 'center' }}><AppleLogo size={22} /></span>
            <span>iOS</span>
          </button>
          <button onClick={handleAndroid}
            style={cardBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = B.android; e.currentTarget.style.background = B.navy; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.background = B.card; }}>
            <span style={{ color: B.android, display: 'flex', alignItems: 'center' }}><AndroidLogo size={22} /></span>
            <span>Android</span>
          </button>
        </div>
      </div>

      {platform && (
        <div onClick={() => setPlatform(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14, maxWidth: 440, padding: '22px 24px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: B.navy, border: `1px solid ${B.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: platform === 'android' ? B.android : B.ice }}>
                {platform === 'android' ? <AndroidLogo size={22} /> : <AppleLogo size={22} />}
              </span>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase' }}>
                {INSTRUCTIONS[platform].title}
              </div>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: B.steel, marginBottom: 14 }}>{INSTRUCTIONS[platform].intro}</p>
            <ol style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.7, marginBottom: 6 }}>
              {INSTRUCTIONS[platform].steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
            </ol>
            <div style={{ fontSize: 11, color: B.steel, marginTop: 10, lineHeight: 1.5 }}>{INSTRUCTIONS[platform].note}</div>
            <button onClick={() => setPlatform(null)}
              style={{ marginTop: 16, width: '100%', padding: 11, borderRadius: 999, background: B.red, border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
