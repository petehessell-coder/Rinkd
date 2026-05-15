import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Auth from './Auth';
import SEO from '../components/SEO';
import { Wordmark, RinkdLogo } from '../components/Logos';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', border: 'rgba(46,91,140,0.4)',
};

/**
 * Landing — the front door for rinkd.app.
 *
 * Decision tree:
 *   1. Already running in installed PWA (display-mode: standalone) → render Auth
 *      inline. The user installed us, they don't need a "Install Rinkd" CTA.
 *   2. Desktop browser → render Auth inline (existing two-column layout is great
 *      for desktop, and desktop users rarely install PWAs anyway).
 *   3. Mobile browser, not installed → marketing splash with big Install
 *      Rinkd CTA. iOS shows an Add-to-Home-Screen modal; Android either fires
 *      the native beforeinstallprompt or shows the same modal.
 *
 * The "Continue in browser →" link always falls through to Auth without
 * forcing the install.
 */

// iPadOS 13+ reports itself as `Macintosh` in navigator.userAgent — the
// "request desktop site" default Apple ships with. The only reliable signal
// that you're on an iPad and not a real Mac is touch support
// (maxTouchPoints > 1 on Macintosh). Without this, iPad pilot users skip the
// Install-Rinkd CTA and land on the desktop Auth screen.
function isIPadOS() {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh/i.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1;
}

function detectMobile() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || isIPadOS();
}

function detectIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || isIPadOS();
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [showMarketing, setShowMarketing] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [continueClicked, setContinueClicked] = useState(false);
  // Settings.handleDelete redirects to /?deleted=1 after a successful account
  // deletion. We surface a brief confirmation toast and strip the param so a
  // refresh doesn't show it again.
  const [showDeletedToast, setShowDeletedToast] = useState(false);

  useEffect(() => {
    const isMobile = detectMobile();
    const isStandalone = detectStandalone();
    setShowMarketing(isMobile && !isStandalone);
    track('landing_view', {
      device: isMobile ? 'mobile' : 'desktop',
      standalone: isStandalone,
    });

    // Catch the post-delete-account redirect target. We replace the URL
    // (no history entry) so reload won't re-show the toast.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('deleted') === '1') {
        setShowDeletedToast(true);
        track('account_deleted_landed');
        const url = new URL(window.location.href);
        url.searchParams.delete('deleted');
        window.history.replaceState({}, '', url.pathname + url.hash);
      }
    } catch (_) { /* old browser */ }

    // Capture the Android install prompt for later use
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const handleInstall = async () => {
    track('landing_install_clicked', { has_prompt: !!installPrompt });
    if (installPrompt) {
      // Android native install prompt
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      track('landing_install_choice', { outcome: choice.outcome });
      if (choice.outcome === 'accepted') setShowInstall(false);
      return;
    }
    // iOS or browsers without the native prompt — show our instructions modal
    setShowInstall(true);
  };

  const handleContinue = () => {
    track('landing_continue_in_browser');
    setContinueClicked(true);
  };

  // Shared confirmation banner shown after a successful account deletion —
  // appears in both the Auth render and the marketing-splash render below.
  const deletedBanner = showDeletedToast ? (
    <div style={{
      position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.45)',
      color: C.ice, padding: '10px 16px', borderRadius: 10,
      fontFamily: "'Barlow', sans-serif", fontSize: 13, lineHeight: 1.45,
      zIndex: 10000, maxWidth: 360, textAlign: 'center',
      boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
    }}>
      <strong style={{ color: '#22C55E' }}>Account deleted.</strong>{' '}
      Your personal data has been removed from Rinkd.
    </div>
  ) : null;

  // If user opts to continue in browser, just render Auth inline
  if (!showMarketing || continueClicked) {
    return <>{deletedBanner}<Auth /></>;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse at 20% 30%, ${C.blue}33 0%, transparent 60%), radial-gradient(ellipse at 80% 70%, ${C.red}22 0%, transparent 55%), ${C.dark}`,
      color: C.ice, fontFamily: "'Barlow', sans-serif",
      padding: '24px 18px 60px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <SEO
        title="The Platform Built for Hockey"
        description="Rinkd is the mobile-first social platform built exclusively for the hockey community. Teams, leagues, scores, and stories — all in one place."
      />

      {/* Big brand mark */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 18, marginBottom: 26 }}>
        <RinkdLogo size={84} />
        <div style={{ marginTop: 14 }}>
          <Wordmark height={56} />
        </div>
      </div>

      {/* Headline */}
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
        fontSize: 38, lineHeight: 0.96, letterSpacing: '-0.01em', textTransform: 'uppercase',
        textAlign: 'center', marginBottom: 10,
      }}>
        Where Hockey<br />Lives Online
      </div>
      <div style={{ fontSize: 15, color: C.steel, lineHeight: 1.5, textAlign: 'center', maxWidth: 360, marginBottom: 22 }}>
        Teams, leagues, schedules, lineups, live scores, calendars — the off-ice infrastructure the sport has never had.
      </div>

      {/* Social proof strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { n: '1.18M+', l: 'NA Players' },
          { n: '23M+', l: 'NHL Tickets' },
          { n: '+30%', l: 'Women & Girls' },
        ].map(({ n, l }) => (
          <div key={l} style={{
            background: 'rgba(46,91,140,0.18)', border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '8px 12px', textAlign: 'center', minWidth: 88,
          }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, lineHeight: 1, color: C.ice }}>{n}</div>
            <div style={{ fontSize: 9, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 3 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* PRIMARY CTA */}
      <button onClick={handleInstall} style={{
        width: '100%', maxWidth: 360,
        background: C.red, color: '#fff', border: 'none',
        padding: '15px 22px', borderRadius: 999, cursor: 'pointer',
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
        fontSize: 17, letterSpacing: '0.05em', textTransform: 'uppercase',
        boxShadow: '0 10px 30px rgba(215,38,56,0.4)',
        marginBottom: 12,
      }}>
        📲 Install Rinkd
      </button>

      <button onClick={handleContinue} style={{
        background: 'transparent', color: C.steel, border: 'none',
        padding: '8px 16px', cursor: 'pointer',
        fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 500,
        textDecoration: 'underline', textUnderlineOffset: 3,
        marginBottom: 30,
      }}>
        Continue in browser →
      </button>

      {/* Three-up brand row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 380, marginBottom: 22 }}>
        {[
          { logo: '/rinkd-wordmark.png', tag: 'THE PLATFORM', body: 'Teams · Leagues · Schedules · Scoring · Stats' },
          { logo: '/rinkside-logo.png', tag: 'THE CONTENT', body: 'Daily reporting, features, and community storytelling' },
          { logo: '/crease-logo.png', tag: 'THE PREMIUM', body: 'Original long-form shows · launching soon' },
        ].map(({ logo, tag, body }) => (
          <div key={tag} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(15,40,71,0.6)', border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 12,
          }}>
            <img src={logo} alt="" style={{ height: 44, width: 'auto', maxWidth: 90, objectFit: 'contain', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red, letterSpacing: '0.12em', marginBottom: 3 }}>{tag}</div>
              <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.45 }}>{body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 11, color: C.steel, textAlign: 'center', marginTop: 12, lineHeight: 1.7 }}>
        <a href="mailto:hello@rinkd.app" style={{ color: C.ice, textDecoration: 'none' }}>hello@rinkd.app</a>
        {' · '}
        <a href="/privacy" style={{ color: C.steel, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>Privacy</a>
        {' · '}
        <a href="/terms" style={{ color: C.steel, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>Terms</a>
        <br />© 2026 Rinkd LLC
      </div>

      {/* Install instructions modal (iOS + Android fallback) */}
      {showInstall && <InstallInstructionsModal onClose={() => setShowInstall(false)} />}
      {deletedBanner}
    </div>
  );
}

function InstallInstructionsModal({ onClose }) {
  const isIOS = detectIOS();
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(7,17,31,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.navy, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 24, width: '100%', maxWidth: 420, color: C.ice,
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>
            Add to home screen
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: C.steel, border: 'none', fontSize: 24, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>

        {isIOS ? (
          <>
            <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, marginBottom: 14 }}>
              Three taps to install Rinkd as a real app on your iPhone.
            </div>
            {[
              { n: 1, body: <>Tap the <strong style={{ color: C.ice }}>Share</strong> button at the bottom of Safari — the square with an arrow pointing up.</> },
              { n: 2, body: <>Scroll the share sheet and tap <strong style={{ color: C.ice }}>"Add to Home Screen"</strong>.</> },
              { n: 3, body: <>Tap <strong style={{ color: C.ice }}>Add</strong> in the top right.</> },
            ].map(({ n, body }) => (
              <div key={n} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.red, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{n}</div>
                <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.55, flex: 1 }}>{body}</div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: C.steel, marginTop: 14, lineHeight: 1.5 }}>
              Note: this works in Safari only — not in Chrome or in-app browsers like Instagram or Twitter.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, marginBottom: 14 }}>
              Two taps to install Rinkd as a real app on your phone.
            </div>
            {[
              { n: 1, body: <>Tap the <strong style={{ color: C.ice }}>three-dot menu</strong> in the top right of your browser.</> },
              { n: 2, body: <>Choose <strong style={{ color: C.ice }}>"Install app"</strong> or <strong style={{ color: C.ice }}>"Add to Home screen"</strong>.</> },
            ].map(({ n, body }) => (
              <div key={n} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.red, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{n}</div>
                <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.55, flex: 1 }}>{body}</div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: C.steel, marginTop: 14, lineHeight: 1.5 }}>
              Note: works best in Chrome or Edge. Some browsers may not show the install option.
            </div>
          </>
        )}

        <button onClick={onClose} style={{
          width: '100%', marginTop: 16,
          background: C.red, color: '#fff', border: 'none',
          padding: '12px', borderRadius: 999, cursor: 'pointer',
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic',
          fontSize: 15, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          Got it
        </button>
      </div>
    </div>
  );
}
