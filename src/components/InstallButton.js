import React, { useEffect, useState } from 'react';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', card: '#112236', border: '#1E3A5C',
};

const STORAGE_KEY = 'rinkd_install_dismissed_v1';
const IOS_KEY = 'rinkd_ios_install_hint_dismissed_v1';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  // Older iOS Safari sets navigator.standalone
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  // iPadOS reports as Mac; detect via touch points
  const isIPadOS = ua.includes('Mac') && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
}

function isIosSafari() {
  if (!isIos()) return false;
  const ua = navigator.userAgent || '';
  // Exclude in-app browsers (FB/Insta/etc) and Chrome iOS (CriOS) — those can't add to home screen
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line/.test(ua);
}

/**
 * Renders nothing if the app is already installed. Otherwise renders a tappable
 * row that either:
 *   - Calls the captured BeforeInstallPromptEvent.prompt() (Chrome/Edge/Samsung)
 *   - Opens a small iOS instructions modal (Safari on iPhone/iPad)
 *
 * Designed to slot into the sidebar dropdown menu — looks like the other rows.
 */
export default function InstallButton({ onAction }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());
  const [hideAndroid, setHideAndroid] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [hideIos, setHideIos] = useState(() => {
    try { return localStorage.getItem(IOS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'dismissed') {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
      setHideAndroid(true);
    }
    setDeferredPrompt(null);
    if (onAction) onAction();
  };

  // Android/Chrome path — install prompt event was captured
  if (deferredPrompt && !hideAndroid) {
    return (
      <button onClick={handleAndroidInstall}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: B.ice, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", transition: 'background 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.background = B.border + '66'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ fontSize: 16 }}>📲</span>
        <span>Install Rinkd</span>
      </button>
    );
  }

  // iOS Safari path — no programmatic prompt; show instructions modal
  if (isIosSafari() && !hideIos) {
    return (
      <>
        <button onClick={() => setShowIosHint(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: B.ice, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", transition: 'background 0.12s' }}
          onMouseEnter={e => e.currentTarget.style.background = B.border + '66'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span style={{ fontSize: 16 }}>📲</span>
          <span>Add to Home Screen</span>
        </button>

        {showIosHint && (
          <div onClick={() => setShowIosHint(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14, maxWidth: 380, padding: '20px 22px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, textTransform: 'uppercase', fontSize: 20, marginBottom: 10 }}>Add Rinkd to your home screen</div>
              <div style={{ fontSize: 13, color: B.steel, lineHeight: 1.5, marginBottom: 14 }}>
                iOS doesn't let websites show an install button. It takes three taps:
              </div>
              <ol style={{ paddingLeft: 18, fontSize: 13, color: B.ice, lineHeight: 1.7, marginBottom: 16 }}>
                <li>Tap the <strong>Share</strong> button at the bottom of Safari (the square with the up arrow).</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top-right.</li>
              </ol>
              <div style={{ fontSize: 11, color: B.steel, marginBottom: 14, lineHeight: 1.5 }}>
                Tip: only works in Safari. Chrome/Firefox on iOS don't support home-screen install — Apple's restriction.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { try { localStorage.setItem(IOS_KEY, '1'); } catch {} setHideIos(true); setShowIosHint(false); if (onAction) onAction(); }}
                  style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Don't show again
                </button>
                <button onClick={() => setShowIosHint(false)}
                  style={{ flex: 1, padding: 10, borderRadius: 999, background: B.red, border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop without prompt yet, or already-dismissed — render nothing
  return null;
}
