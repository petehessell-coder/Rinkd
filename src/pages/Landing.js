import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Auth from './Auth';
import InAppBrowserNudge from '../components/InAppBrowserNudge';
import SEO from '../components/SEO';
import { RinkdLogo } from '../components/Logos';
import TapeText from '../components/TapeText';
import { track } from '../lib/analytics';
import { C } from '../lib/tokens';

/**
 * Landing — the front door for rinkd.app.
 *
 * Decision tree:
 *   1. Installed PWA (display-mode: standalone) or desktop browser → render Auth
 *      inline (the existing two-column layout is great for desktop).
 *   2. Mobile browser, not installed → marketing splash whose only actions are
 *      "Create Free Account" and "Log in" — both drop straight into Auth.
 *
 * The PWA-install CTA was removed: installing the home-screen shortcut didn't
 * actually get anyone into the app, so account creation / login is the one path.
 */

// iPadOS 13+ reports itself as `Macintosh` in navigator.userAgent — the
// "request desktop site" default Apple ships with. The only reliable signal
// that you're on an iPad and not a real Mac is touch support
// (maxTouchPoints > 1 on Macintosh). Without this, iPad pilot users would be
// treated as desktop and skip the mobile marketing splash.
function isIPadOS() {
  if (typeof navigator === 'undefined') return false;
  return /Macintosh/i.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1;
}

function detectMobile() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || isIPadOS();
}

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [showMarketing, setShowMarketing] = useState(false);
  // Which Auth view to drop into when the user taps a CTA. null = still on the
  // marketing splash. The install-PWA path was removed — it couldn't get anyone
  // into the app — so the only actions are create-account and log-in.
  const [authMode, setAuthMode] = useState(null); // null | 'signup' | 'login'
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
  }, []);

  const goSignup = () => {
    track('landing_create_account');
    setAuthMode('signup');
  };

  const goLogin = () => {
    track('landing_login');
    setAuthMode('login');
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

  // Once a CTA is tapped (or on desktop/standalone), render Auth inline in the
  // requested mode. Desktop/standalone default to signup, matching the old flow.
  if (!showMarketing || authMode) {
    return <>{deletedBanner}<Auth defaultMode={authMode === 'login' ? 'login' : 'signup'} /></>;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0A1E38',
      color: C.ice, fontFamily: "'Barlow', sans-serif",
      padding: '24px 18px 60px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <SEO
        title="The Platform Built for Hockey"
        description="Rinkd is the mobile-first social platform built exclusively for the hockey community. Teams, leagues, scores, and stories — all in one place."
      />

      {/* Big brand mark — logo + the hand-taped "tape job" wordmark */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 18, marginBottom: 26 }}>
        <RinkdLogo size={84} />
        <div style={{ marginTop: 14 }}>
          <TapeText height={56}>RINKD</TapeText>
        </div>
      </div>

      {/* In-app-browser nudge — IG/FB clicks land here and can't complete signup */}
      <div style={{ width: '100%', maxWidth: 420 }}><InAppBrowserNudge /></div>

      {/* Hero headline — big, cold, competitive. Says what Rinkd is in one line. */}
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
        fontSize: 64, lineHeight: 0.9, letterSpacing: '-0.01em', textTransform: 'uppercase',
        color: C.ice, textAlign: 'center', marginBottom: 14,
      }}>
        Where Hockey<br />Lives Online
      </div>
      <div style={{ fontSize: 15, color: C.steel, lineHeight: 1.5, textAlign: 'center', maxWidth: 360, marginBottom: 24 }}>
        Teams, leagues, schedules, live scores — the off-ice home the sport has never had.
      </div>

      {/* PRIMARY CTA — single red pill, the one action: create an account. */}
      <button onClick={goSignup} style={{
        width: '100%', maxWidth: 360,
        background: C.red, color: '#fff', border: 'none',
        padding: '16px 22px', borderRadius: 999, cursor: 'pointer',
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
        fontSize: 18, letterSpacing: '0.05em', textTransform: 'uppercase',
        boxShadow: '0 10px 30px rgba(215,38,56,0.4)',
        marginBottom: 14,
      }}>
        Create Free Account
      </button>

      {/* Secondary — log in for returning users. Subordinate text link. */}
      <button onClick={goLogin} style={{
        background: 'transparent', color: C.steel, border: 'none',
        padding: '8px 16px', cursor: 'pointer',
        fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 500,
        marginBottom: 30,
      }}>
        Already have an account?{' '}
        <span style={{ color: C.ice, textDecoration: 'underline', textUnderlineOffset: 3 }}>Log in →</span>
      </button>

      {/* Stat bar — hockey is big. Jersey-size numbers (Barlow Condensed 900). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { n: '1.18M+', l: 'NA Players' },
          { n: '23M+', l: 'NHL Tickets' },
          { n: '+30%', l: 'Women & Girls' },
        ].map(({ n, l }) => (
          <div key={l} style={{
            background: 'rgba(46,91,140,0.12)', border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 14px', textAlign: 'center', minWidth: 96,
          }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1, color: C.ice }}>{n}</div>
            <div style={{ fontSize: 9, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* What Rinkd is — broadcast lower-third headers, not feature cards. */}
      <div style={{ width: '100%', maxWidth: 380, marginBottom: 24 }}>
        {[
          { tag: 'The Platform', body: 'Teams, leagues, schedules, scoring, and stats — one app.' },
          { tag: 'The Content', body: 'Daily reporting, features, and community storytelling.' },
          { tag: 'The Premium', body: 'Original long-form shows — launching soon.' },
        ].map(({ tag, body }) => (
          <div key={tag} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#0f2847', borderLeft: `4px solid ${C.red}`, borderTopRightRadius: 4, borderBottomRightRadius: 4, padding: '7px 14px', marginBottom: 6 }}>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 16, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
            </div>
            <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.45, paddingLeft: 14 }}>{body}</div>
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

      {deletedBanner}
    </div>
  );
}
