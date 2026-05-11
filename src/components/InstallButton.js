import React, { useEffect, useState } from 'react';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', card: '#112236', border: '#1E3A5C',
};

const DISMISSED_KEY = 'rinkd_install_dismissed_v2';

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIPadOS = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
  const isIos = isIOSDevice || isIPadOS;
  const isAndroid = /Android/.test(ua);
  const isInApp = /FBAN|FBAV|Instagram|Line|TikTok|Snapchat/.test(ua);
  const isIosChrome = isIos && /CriOS/.test(ua);
  const isIosFirefox = isIos && /FxiOS/.test(ua);
  const isIosSafari = isIos && /Safari/.test(ua) && !isIosChrome && !isIosFirefox && !isInApp;
  const isAndroidChrome = isAndroid && /Chrome/.test(ua) && !/EdgA|OPR/.test(ua);
  const isDesktopChrome = !isIos && !isAndroid && /Chrome/.test(ua) && !/Edg|OPR/.test(ua);
  const isDesktopEdge = !isIos && !isAndroid && /Edg/.test(ua);
  if (isIosSafari) return 'ios-safari';
  if (isIos)        return 'ios-other';     // Chrome/Firefox on iOS — can't install
  if (isAndroidChrome) return 'android-chrome';
  if (isAndroid)    return 'android-other';
  if (isDesktopChrome || isDesktopEdge) return 'desktop-chrome';
  return 'other';
}

/**
 * Always-visible install affordance until the user installs or dismisses.
 * If Chrome fires `beforeinstallprompt` we use the native prompt; otherwise
 * we fall back to platform-specific instructions because Chrome silently
 * suppresses install prompts under many conditions.
 */
export default function InstallButton({ onAction }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [installed, setInstalled] = useState(detectStandalone());
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
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

  if (installed || dismissed) return null;

  const platform = detectPlatform();
  const isIos = platform === 'ios-safari' || platform === 'ios-other';
  const ctaLabel = isIos ? 'Add to Home Screen' : 'Install Rinkd';

  const handleClick = async () => {
    if (deferredPrompt) {
      // Chrome cooperated — use the real prompt
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'dismissed') {
          // Don't permanently hide — they may want to install later
        }
      } catch {}
      setDeferredPrompt(null);
      if (onAction) onAction();
      return;
    }
    // Chrome didn't fire the event (engagement heuristic, prior dismissal, etc).
    // Fall back to platform-specific instructions.
    setShowModal(true);
  };

  const dismissForever = () => {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch {}
    setDismissed(true);
    setShowModal(false);
    if (onAction) onAction();
  };

  return (
    <>
      <button onClick={handleClick}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: B.ice, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", transition: 'background 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.background = B.border + '66'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <span style={{ fontSize: 16 }}>📲</span>
        <span>{ctaLabel}</span>
      </button>

      {showModal && (
        <div onClick={() => setShowModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: B.card, border: `1px solid ${B.border}`, borderRadius: 14, maxWidth: 420, padding: '20px 22px', fontFamily: "'Barlow', sans-serif", color: B.ice }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, textTransform: 'uppercase', fontSize: 20, marginBottom: 12 }}>
              Install Rinkd
            </div>
            <InstallInstructions platform={platform} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={dismissForever}
                style={{ flex: 1, padding: 10, borderRadius: 999, background: 'rgba(244,247,250,0.08)', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Don't show again
              </button>
              <button onClick={() => setShowModal(false)}
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

function InstallInstructions({ platform }) {
  const list = { fontSize: 13, lineHeight: 1.7, paddingLeft: 18, marginBottom: 6 };
  const note = { fontSize: 11, color: B.steel, marginTop: 10, lineHeight: 1.5 };
  const intro = { fontSize: 13, lineHeight: 1.6, color: B.steel, marginBottom: 12 };

  if (platform === 'ios-safari') {
    return (
      <>
        <div style={intro}>Three taps and Rinkd lives on your home screen like a real app.</div>
        <ol style={list}>
          <li>Hit the <strong>Share</strong> button at the bottom of Safari (square with the arrow flying out the top).</li>
          <li>Scroll down a sec and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> in the top right. Done.</li>
        </ol>
        <div style={note}>Apple only lets Safari do this. If you're in Chrome or Firefox on iOS, switch to Safari first.</div>
      </>
    );
  }
  if (platform === 'ios-other') {
    return (
      <>
        <div style={intro}>
          Apple only lets <strong>Safari</strong> add sites to your home screen — not its fault, that's just how iOS works.
        </div>
        <div style={list}>
          Copy <strong>rinkd.app</strong>, open Safari, paste it in, then tap Share → Add to Home Screen.
        </div>
      </>
    );
  }
  if (platform === 'android-chrome') {
    return (
      <>
        <div style={intro}>Quick install from Chrome's menu.</div>
        <ol style={list}>
          <li>Open the <strong>⋮</strong> menu in Chrome's top-right.</li>
          <li>Tap <strong>Install app</strong> (it might say <strong>Add to Home Screen</strong> — same thing).</li>
          <li>Tap <strong>Install</strong> to confirm.</li>
        </ol>
        <div style={note}>If you don't see the install option yet, poke around the app for a minute first. Chrome wants to know you like us before it offers.</div>
      </>
    );
  }
  if (platform === 'android-other') {
    return (
      <>
        <div style={intro}>
          Pop this page open in <strong>Chrome</strong> (or Samsung Internet) — then ⋮ menu → <strong>Install app</strong>.
        </div>
        <div style={note}>Most other Android browsers don't support installing web apps.</div>
      </>
    );
  }
  // desktop-chrome and fallback
  return (
    <>
      <div style={intro}>Easy on desktop — there's usually an install icon right in your address bar.</div>
      <ol style={list}>
        <li>Look at the right side of your address bar for an <strong>install icon</strong> (small monitor with a down-arrow).</li>
        <li>Or open <strong>⋮ menu → Cast, save, and share → Install Rinkd…</strong></li>
        <li>Click <strong>Install</strong>.</li>
      </ol>
      <div style={note}>Works in Chrome, Edge, Arc, and Brave. Firefox still doesn't support installing web apps.</div>
    </>
  );
}
