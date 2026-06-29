import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { RinkdLogo, Wordmark } from '../components/Logos';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', border: 'rgba(46,91,140,0.4)',
};

/**
 * Password reset landing page.
 *
 * Supabase sends a magic-link email pointing here. When the page loads, the
 * Supabase client auto-detects the recovery token in the URL hash and fires a
 * PASSWORD_RECOVERY auth event. We use that signal to flip the page into
 * "set a new password" mode. If we don't see the event, we show a friendly
 * "link expired or invalid" message instead of a blank screen.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('loading'); // loading | ready | success | error
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let resolved = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        resolved = true;
        setStage('ready');
        track('password_reset_link_opened');
      }
    });
    // Give Supabase time to detect the token in the URL hash. Slow mobile
    // connections can take several seconds — 10s avoids a false "expired" on
    // a link that's actually valid.
    const t = setTimeout(() => {
      if (!resolved) setStage('error');
    }, 10000);
    return () => { clearTimeout(t); subscription.unsubscribe(); };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (pw1.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw1 !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { track('password_reset_failed', { reason: error.message?.slice(0, 80) }); setErr(error.message); return; }
    track('password_reset_success');
    setStage('success');
    setTimeout(() => navigate('/home'), 1600);
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '12px 14px', background: '#080F1C',
    border: `1.5px solid ${C.border}`, borderRadius: 10,
    color: C.ice, fontSize: 15, fontFamily: 'Barlow, sans-serif',
    outline: 'none', marginBottom: 12,
  };

  return (
    <div style={{
      minHeight: '100vh', background: `radial-gradient(ellipse at 20% 50%, ${C.blue}22 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, ${C.red}15 0%, transparent 50%), ${C.dark}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'Barlow', sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 420, background: C.navy,
        border: `1px solid ${C.border}`, borderRadius: 16, padding: '36px 32px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <RinkdLogo size={56} />
          <Wordmark height={36} />
        </div>

        {stage === 'loading' && (
          <div style={{ color: C.steel, textAlign: 'center', padding: '20px 0' }}>Verifying your reset link…</div>
        )}

        {stage === 'error' && (
          <>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
              fontWeight: 900, fontSize: 26, color: C.ice, margin: 0, marginBottom: 8,
              textTransform: 'uppercase',
            }}>Link expired</h2>
            <p style={{ color: C.steel, fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              That reset link is no longer valid. Head back to the login screen and request a fresh one.
            </p>
            <button onClick={() => navigate('/')} style={{
              width: '100%', padding: '13px', borderRadius: 10,
              background: C.red, color: '#fff', border: 'none',
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
              fontStyle: 'italic', fontSize: 16, cursor: 'pointer', textTransform: 'uppercase',
            }}>
              Back to Sign In
            </button>
          </>
        )}

        {stage === 'ready' && (
          <>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
              fontWeight: 900, fontSize: 30, color: C.ice, margin: 0, marginBottom: 6,
              textTransform: 'uppercase',
            }}>Set a new password</h2>
            <p style={{ color: C.steel, fontSize: 13, marginBottom: 18 }}>
              At least 8 characters. Don't reuse one you've used elsewhere.
            </p>
            <form onSubmit={submit}>
              <input type="password" value={pw1} onChange={e => setPw1(e.target.value)}
                placeholder="New password" autoFocus required minLength={8} style={inputStyle} />
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                placeholder="Confirm new password" required minLength={8} style={inputStyle} />
              {err && <p style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{err}</p>}
              <button type="submit" disabled={busy} style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: busy ? C.border : C.red, color: '#fff', border: 'none',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontStyle: 'italic', fontSize: 18, textTransform: 'uppercase',
                cursor: busy ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
              }}>
                {busy ? 'Updating…' : 'Update Password →'}
              </button>
            </form>
          </>
        )}

        {stage === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
              fontWeight: 900, fontSize: 26, color: C.ice, margin: 0, marginBottom: 8,
              textTransform: 'uppercase',
            }}>Password updated</h2>
            <p style={{ color: C.steel, fontSize: 14, lineHeight: 1.55 }}>
              Hopping you over to your feed…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
