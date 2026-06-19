import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RinkdLogo, Wordmark } from '../components/Logos';
import InAppBrowserNudge from '../components/InAppBrowserNudge';
import { signIn, signUp } from '../lib/auth';
import { track } from '../lib/analytics';
import HelpButton from '../components/HelpButton';
import DownloadCTA from '../components/DownloadCTA';
import TurnstileWidget, { isTurnstileEnabled } from '../components/TurnstileWidget';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
};

// ONBOARD-1 (May 28, 2026): POSITIONS / LEVELS removed from the signup gate —
// the wizard collapsed to a single step (email + password + DOB + Turnstile +
// marketing opt-in). Position / level / persona / handle / full name are
// filled in progressively via the OnboardingModal + dismissible Feed banner.

function Input({ label, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label style={{
          display: 'block', fontSize: 12, fontWeight: 600, color: C.steel,
          marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase',
          fontFamily: "'Barlow Condensed', sans-serif",
        }}>{label}</label>
      )}
      {props.as === 'select' ? (
        <select {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'as'))}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            background: focused ? C.card : '#080F1C',
            border: `1.5px solid ${focused ? C.blue : C.border}`,
            color: C.ice, fontSize: 15, outline: 'none', appearance: 'none',
            fontFamily: "'Barlow', sans-serif",
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
      ) : (
        <input {...props}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            background: focused ? C.card : '#080F1C',
            border: `1.5px solid ${focused ? C.blue : C.border}`,
            color: C.ice, fontSize: 15, outline: 'none',
            fontFamily: "'Barlow', sans-serif",
            transition: 'all 0.15s',
            boxSizing: 'border-box',
          }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
      )}
    </div>
  );
}

// Pull a safe `returnTo` from the URL: must be a relative path beginning with
// a single `/` (rejects `//evil.com`, `http://...`, and protocol-relative
// URLs). Falls back to /feed when missing, malformed, or unsafe — prevents
// open-redirect to attacker-controlled origins.
function readReturnTo(searchParams) {
  const raw = searchParams.get('returnTo');
  if (!raw) return '/feed';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/feed';
  return raw;
}

export default function Auth({ defaultMode = 'login' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  // Initial view: cold visitors from the marketing Landing page open on the
  // signup wizard (Landing passes defaultMode="signup"); /login renders Auth
  // with no prop so returning-user intent still opens on login.
  const [mode, setMode] = useState(defaultMode === 'signup' ? 'signup' : 'login'); // login | signup | coppa | forgot | check-email
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ONBOARD-1: signup is single-step now — `step` state removed.
  const [confirmEmail, setConfirmEmail] = useState(''); // remembered for the "Check your email" screen
  // Cloudflare Turnstile token — captured by the widget on step 3 and forwarded
  // to supabase.auth.signUp. Stays null until Turnstile validates. When the
  // env var isn't set (dev / preview), the widget renders nothing and the
  // signup flow proceeds unblocked (isTurnstileEnabled === false).
  const [captchaToken, setCaptchaToken] = useState(null);
  // Bumping this `key` on the TurnstileWidget forces React to remount the
  // widget — gives us a fresh challenge after a failed login (where Supabase
  // consumed the previous token and we cleared it server-side, but the widget
  // UI was still showing "Success!"). Without the remount, users saw a green
  // check next to a red "please complete the verification" message.
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const resetTurnstile = () => {
    setCaptchaToken(null);
    setTurnstileResetKey((k) => k + 1);
  };

  // Reset the Turnstile token + widget whenever the user switches between
  // login / signup / forgot. Tokens are challenge-specific + short-lived —
  // a token captured on the signup form would be rejected when forwarded to
  // /signin, and stale tokens from an abandoned mode shouldn't poison the
  // next attempt. Inline the resetTurnstile body so the effect deps stay
  // honest under CRA's default eslint config.
  //
  // Also fires `auth_view` so the funnel dashboard can distinguish "they
  // saw the marketing splash" (landing_view from Landing.js) from "they
  // saw the actual auth form" — different drop-off points.
  useEffect(() => {
    setCaptchaToken(null);
    setTurnstileResetKey((k) => k + 1);
    track('auth_view', { mode });
  }, [mode]);

  // First-input tracker — fires once per Auth mount when the user first
  // engages with any form field. Tells us whether the form is a graveyard
  // (low first-input rate) or whether users abandon mid-form (high
  // first-input but low completion). Reset on mode change so each form
  // gets its own first-input signal.
  const firstInputFiredRef = useRef(null);
  useEffect(() => { firstInputFiredRef.current = null; }, [mode]);

  // ONBOARD-1: signup form collects only what's needed at the auth gate.
  // `dob` is the YYYY-MM-DD string from <input type="date"> (forwarded to
  // signUp as `dateOfBirth`). `marketingOptIn` defaults FALSE (CAN-SPAM /
  // GDPR — explicit opt-in for marketing email).
  const [form, setForm] = useState({
    email: '', password: '', dob: '', marketingOptIn: false,
  });

  const set = (key, val) => {
    // First-input funnel signal: fires the moment a user engages with any
    // form field in the current mode. Differentiates form abandoners from
    // form non-starters in the analytics dashboard.
    if (!firstInputFiredRef.current) {
      firstInputFiredRef.current = key;
      track('auth_first_input', { mode, field: key });
    }
    setForm(f => ({ ...f, [key]: val }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    // Turnstile gate (mirror of the signup path). Supabase's CAPTCHA Protection
    // is on globally — without a token /auth/v1/signin returns
    // "captcha protection: request disallowed (no captcha_token found)".
    if (isTurnstileEnabled && !captchaToken) {
      setError('Finish the quick check below, then try again.');
      return;
    }
    setLoading(true); setError('');
    const { error: err } = await signIn({ email: form.email, password: form.password, captchaToken });
    setLoading(false);
    if (err) {
      track('login_failed', { reason: err.message?.slice(0, 80) });
      setError(err.message);
      // Supabase consumed the Turnstile token even on a wrong-password
      // rejection. Remount the widget so the UI matches state (otherwise
      // the user sees a stale "Success!" check next to a "please complete"
      // error on their next submit).
      resetTurnstile();
    } else { track('login_success'); navigate(returnTo); }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    if (isTurnstileEnabled && !captchaToken) {
      setError('Finish the quick check below, then try again.');
      return;
    }
    setForgotBusy(true); setError('');
    const { supabase } = await import('../lib/supabase');
    const { error: err } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: captchaToken || undefined,
    });
    setForgotBusy(false);
    if (err) {
      track('password_reset_request_failed', { reason: err.message?.slice(0, 80) });
      setError(err.message);
      resetTurnstile();
      return;
    }
    track('password_reset_requested');
    setForgotSent(true);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    // ONBOARD-1 (May 28, 2026): single-step signup. No step-advance branch —
    // submit fires once, hits Supabase, and either lands on /feed (auto-confirm)
    // or the "check email" screen (email confirmation ON).
    if (isTurnstileEnabled && !captchaToken) {
      setError('Finish the quick check below, then try again.');
      return;
    }
    setLoading(true); setError('');
    const result = await signUp({
      email: form.email,
      password: form.password,
      dateOfBirth: form.dob,
      marketingOptIn: form.marketingOptIn,
      captchaToken,
    });
    setLoading(false);
    if (result.error) {
      track('signup_failed', { reason: result.error.message?.slice(0, 80) });
      if (result.error.message?.includes('13')) setMode('coppa');
      else setError(result.error.message);
      return;
    }
    if (result.needsConfirmation) {
      // Supabase has email confirmation turned on — we have a user row but no
      // session yet. Show the "Check your email" state instead of pushing to
      // /feed (which would just bounce back through ProtectedRoute).
      track('signup_needs_confirmation', { marketing_opt_in: form.marketingOptIn });
      setConfirmEmail(form.email);
      setMode('check-email');
      return;
    }
    track('signup_success', { marketing_opt_in: form.marketingOptIn });
    // 4E race-fix: set a sessionStorage flag so App.js can render the
    // onboarding modal BEFORE the Supabase profile fetch completes. Without
    // this, ~43% of recent signups were bouncing during the few-hundred-ms
    // window where `user` is set but `profile` is still null — meaning the
    // modal never mounted and they never fired `onboarding_started`.
    try { sessionStorage.setItem('rinkd_pending_onboarding', '1'); } catch (_) { /* private mode */ }
    navigate(returnTo);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: `radial-gradient(ellipse at 20% 50%, ${C.blue}22 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, ${C.red}15 0%, transparent 50%), ${C.dark}`,
      display: 'flex', alignItems: 'stretch',
      fontFamily: "'Barlow', sans-serif",
    }}>
      {/* Left panel — hero */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '60px 80px',
        borderRight: `1px solid ${C.border}`,
      }} className="auth-hero">
        {/* Wordmark — much bigger now that the R has moved to the form side */}
        <div style={{ marginBottom: 32 }}>
          <Wordmark height={140} />
        </div>
        <h1 style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 900, fontStyle: 'italic',
          fontSize: 72, lineHeight: 0.92,
          textTransform: 'uppercase', color: C.ice,
          marginBottom: 24, letterSpacing: '-1px',
        }}>
          THE PLATFORM<br/>
          <span style={{ color: C.red }}>BUILT FOR</span><br/>
          HOCKEY.
        </h1>
        <p style={{ fontSize: 18, color: C.steel, lineHeight: 1.6, maxWidth: 380, marginBottom: 40 }}>
          All ages. All levels. One community.
          The social platform exclusively for the hockey world.
        </p>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 32 }}>
          {[
            { n: '1.18M+', l: 'Registered Players' },
            { n: '23M+', l: 'NHL Tickets Sold' },
            { n: '+30%', l: 'Women & Girls Growth' },
          ].map(stat => (
            <div key={stat.n}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 900, fontStyle: 'italic',
                fontSize: 28, color: C.ice,
              }}>{stat.n}</div>
              <div style={{ fontSize: 11, color: C.steel, letterSpacing: '0.06em' }}>{stat.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{
        width: 460, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '60px 48px',
        background: C.navy,
      }} className="auth-form">
        <InAppBrowserNudge />
        {/* COPPA blocked */}
        {mode === 'coppa' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏒</div>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 900, fontStyle: 'italic',
              fontSize: 28, color: C.ice, marginBottom: 12, textTransform: 'uppercase',
            }}>Keep Skating!</h2>
            <p style={{ color: C.steel, lineHeight: 1.6, marginBottom: 24 }}>
              Rinkd requires users to be 13 or older to create an account.
              Check back when you're ready to hit the ice!
            </p>
            <button onClick={() => setMode('login')} style={{
              padding: '12px 32px', borderRadius: 10,
              background: C.red, color: 'white', border: 'none',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}>Back to Login</button>
          </div>
        ) : mode === 'check-email' ? (
          // Shown when Supabase has email confirmation enabled — signUp returns
          // a user but no session, so we can't drop the user onto /feed yet.
          // The profile row will be created on first sign-in via
          // ensureProfileForUser (App.js wires it into fetchProfileWithRetry).
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 900, fontStyle: 'italic',
              fontSize: 28, color: C.ice, marginBottom: 12, textTransform: 'uppercase',
            }}>Check your email</h2>
            <p style={{ color: C.steel, lineHeight: 1.6, marginBottom: 8 }}>
              We sent a confirmation link to{' '}
              <strong style={{ color: C.ice }}>{confirmEmail || 'your inbox'}</strong>.
            </p>
            <p style={{ color: C.steel, lineHeight: 1.6, marginBottom: 24, fontSize: 13 }}>
              Click the link to finish creating your account. If you don't see it within a minute, check your spam folder.
            </p>
            <button onClick={() => { setMode('login'); setError(''); }} style={{
              padding: '12px 32px', borderRadius: 10,
              background: C.red, color: 'white', border: 'none',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700, fontSize: 16, cursor: 'pointer',
            }}>Back to Sign In</button>
          </div>
        ) : mode === 'forgot' ? (
          <>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 900, fontStyle: 'italic',
              fontSize: 32, color: C.ice, marginBottom: 8, textTransform: 'uppercase',
            }}>Reset Password</h2>
            <p style={{ color: C.steel, marginBottom: 24, fontSize: 14 }}>
              {forgotSent
                ? "If an account exists for that email, a reset link is on the way. Check your inbox (and spam folder)."
                : "Enter your email and we'll send you a link to reset your password."}
            </p>
            {!forgotSent ? (
              <form onSubmit={handleForgot}>
                <Input label="Email" type="email" value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" required />
                {/* Same Turnstile gate as login + signup. /auth/v1/recover
                    also requires a token under the global CAPTCHA Protection
                    setting. */}
                <TurnstileWidget
                  key={`forgot-${turnstileResetKey}`}
                  onToken={(t) => { setCaptchaToken(t); if (error?.startsWith('Finish the quick check')) setError(''); }}
                  onError={() => setCaptchaToken(null)}
                />
                {error && <p style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</p>}
                <button type="submit" disabled={forgotBusy || !forgotEmail.trim()} style={{
                  width: '100%', padding: '14px', borderRadius: 10,
                  background: forgotBusy ? C.border : C.red, color: 'white', border: 'none',
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 700, fontStyle: 'italic', fontSize: 18, textTransform: 'uppercase',
                  cursor: forgotBusy ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
                }}>
                  {forgotBusy ? 'Sending…' : 'Send Reset Link →'}
                </button>
              </form>
            ) : (
              <button onClick={() => { setMode('login'); setError(''); }} style={{
                width: '100%', padding: '13px', borderRadius: 10,
                background: C.red, color: 'white', border: 'none',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontStyle: 'italic', fontSize: 16, textTransform: 'uppercase',
                cursor: 'pointer', letterSpacing: '0.05em',
              }}>
                Back to Sign In
              </button>
            )}
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <button onClick={() => { setMode('login'); setError(''); }}
                style={{ background: 'none', border: 'none', color: C.steel, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>
                ← Back to login
              </button>
            </div>
          </>
        ) : mode === 'login' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <RinkdLogo size={72} />
              <div>
                <h2 style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 900, fontStyle: 'italic',
                  fontSize: 36, color: C.ice, textTransform: 'uppercase',
                  margin: 0, lineHeight: 1,
                }}>Welcome Back</h2>
                <p style={{ color: C.steel, fontSize: 14, margin: '6px 0 0' }}>
                  Sign in to your Rinkd account
                </p>
              </div>
            </div>
            <div style={{ marginBottom: 24 }} />
            <form onSubmit={handleLogin}>
              <Input label="Email" type="email" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="you@example.com" required />
              <Input label="Password" type="password" value={form.password}
                onChange={e => set('password', e.target.value)} placeholder="••••••••" required />
              {/* Turnstile bot-protection challenge. Renders nothing when
                  REACT_APP_TURNSTILE_SITE_KEY isn't set (dev / preview).
                  Most users see no visible challenge — Managed mode
                  only shows the puzzle when bot heuristics fire.
                  `key={turnstileResetKey}` lets handleLogin force a fresh
                  challenge after a failed sign-in (Supabase consumed the
                  previous token so we need a new one). */}
              <TurnstileWidget
                key={`login-${turnstileResetKey}`}
                onToken={(t) => { setCaptchaToken(t); if (error?.startsWith('Finish the quick check')) setError(''); }}
                onError={() => setCaptchaToken(null)}
              />
              {error && <p style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</p>}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: loading ? C.border : C.red, color: 'white', border: 'none',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontStyle: 'italic', fontSize: 18, textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
                transition: 'all 0.15s',
              }}>
                {loading ? 'Signing In...' : 'Sign In →'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button type="button"
                  onClick={() => { track('forgot_password_clicked'); setMode('forgot'); setForgotEmail(form.email); setForgotSent(false); setError(''); }}
                  style={{ background: 'none', border: 'none', color: C.steel, fontSize: 13, cursor: 'pointer', fontFamily: "'Barlow', sans-serif", textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Forgot password?
                </button>
              </div>
            </form>

            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <a href="https://rinkd.app/survey" target="_blank" rel="noopener noreferrer" style={{
                display: 'inline-block', padding: '10px 28px', borderRadius: 10,
                background: 'transparent', border: `1.5px solid ${C.border}`,
                color: C.steel, textDecoration: 'none',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}>📋 Take Our Community Survey →</a>
            </div>

            <DownloadCTA />
            <p style={{ textAlign: 'center', marginTop: 24, color: C.steel, fontSize: 14 }}>
              New to Rinkd?{' '}
              <button onClick={() => { setMode('signup'); setError(''); }}
                style={{ color: C.ice, background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: 600, textDecoration: 'underline', fontSize: 14 }}>
                Create Account
              </button>
            </p>
          </>
        ) : (
          // Signup — single step (ONBOARD-1, May 28, 2026).
          // Three required inputs (email / password / DOB) + Turnstile + a
          // single marketing-opt-in checkbox (default UNCHECKED, CAN-SPAM /
          // GDPR safe). Everything else (handle, name, persona, position,
          // level, gender, avatar) is collected progressively in the
          // OnboardingModal + the dismissible Feed banner after sign-in.
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <RinkdLogo size={72} />
              <div>
                <h2 style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 900, fontStyle: 'italic',
                  fontSize: 32, color: C.ice, textTransform: 'uppercase',
                  margin: 0, lineHeight: 1,
                }}>Lace &apos;Em Up</h2>
                <p style={{ color: C.steel, fontSize: 14, margin: '6px 0 0' }}>
                  Create your account — 30 seconds, then you&apos;re in.
                </p>
              </div>
            </div>
            <div style={{ marginBottom: 24 }} />

            <form onSubmit={handleSignup}>
              <Input label="Email" type="email" value={form.email}
                onChange={e => set('email', e.target.value)} required placeholder="you@example.com" />
              <Input label="Password" type="password" value={form.password}
                onChange={e => set('password', e.target.value)} required placeholder="Min 8 characters" minLength={8} />
              <Input label="Date of Birth" type="date" value={form.dob}
                onChange={e => set('dob', e.target.value)} required
                max={new Date().toISOString().slice(0, 10)} />
              <p style={{ fontSize: 11, color: C.steel, marginTop: -8, marginBottom: 16 }}>
                Must be 13+ to create an account (COPPA). You can&apos;t change this later.
              </p>

              {/* Turnstile bot check — renders nothing unless
                  REACT_APP_TURNSTILE_SITE_KEY is set. */}
              <TurnstileWidget
                key={`signup-${turnstileResetKey}`}
                onToken={(t) => { setCaptchaToken(t); if (error?.startsWith('Finish the quick check')) setError(''); }}
                onError={() => setCaptchaToken(null)}
              />

              {/* Marketing opt-in — default UNCHECKED (explicit opt-in for
                  promo email per CAN-SPAM / GDPR). Transactional email
                  (receipts, password reset, registration confirmations) is
                  always sent regardless of this checkbox. */}
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 0', cursor: 'pointer', userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={form.marketingOptIn}
                  onChange={e => set('marketingOptIn', e.target.checked)}
                  style={{ marginTop: 3, accentColor: C.red, width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 12, color: C.steel, lineHeight: 1.5 }}>
                  Send me Rinkd news + product updates. You can change this
                  anytime in Settings. (Receipts and account emails always
                  send regardless.)
                </span>
              </label>

              {error && <p style={{ color: C.red, fontSize: 13, margin: '8px 0 12px' }}>{error}</p>}

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: loading ? C.border : C.red, color: 'white', border: 'none',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontStyle: 'italic', fontSize: 18, textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
                marginTop: 8,
              }}>
                {loading ? 'Creating…' : 'Hit the Ice →'}
              </button>

              <p style={{ fontSize: 11, color: C.steel, marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>
                By creating an account you agree to our{' '}
                <a href="/terms" style={{ color: C.steel, textDecoration: 'underline' }}>Terms</a>
                {' '}and{' '}
                <a href="/privacy" style={{ color: C.steel, textDecoration: 'underline' }}>Privacy Policy</a>.
              </p>
            </form>

            <p style={{ textAlign: 'center', marginTop: 24, color: C.steel, fontSize: 14 }}>
              Already have an account?{' '}
              <button onClick={() => { setMode('login'); setError(''); }}
                style={{ color: C.ice, background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: 600, textDecoration: 'underline', fontSize: 14 }}>
                Sign In
              </button>
            </p>
          </>
        )}

      <div style={{ textAlign: 'center', padding: '20px', borderTop: `1px solid ${C.border}`, marginTop: 24 }}>
        <a href="/privacy" style={{ color: C.steel, fontSize: 12, textDecoration: 'none', marginRight: 16 }}>Privacy Policy</a>
        <a href="/terms" style={{ color: C.steel, fontSize: 12, textDecoration: 'none', marginRight: 16 }}>Terms of Service</a>
        <span style={{ color: C.border, fontSize: 12 }}>© 2026 Rinkd LLC</span>
      </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .auth-hero { display: none !important; }
          .auth-form { width: 100% !important; padding: 40px 28px !important; }
        }
      `}</style>

      {/* Floating help+feedback button — visible on the auth screen too, so users
          who can't sign in for some reason still have a way to reach us. */}
      <HelpButton />
    </div>
  );
}
