import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RinkdLogo } from '../components/Logos';
import { signIn, signUp } from '../lib/auth';
import DownloadCTA from '../components/DownloadCTA';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
};

const POSITIONS = ['Forward', 'Defense', 'Goalie', 'Coach', 'Parent', 'Official', 'Fan'];
const LEVELS = ['Youth (Mite-Bantam)', 'Youth (Midget)', 'High School', 'Junior (Tier I)', 'Junior (Tier II/III)', 'College', 'Minor Pro', 'Beer League', 'Adult Rec', 'Fan'];

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

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | signup | coppa
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // signup steps 1,2,3

  const [form, setForm] = useState({
    email: '', password: '', name: '', handle: '',
    position: 'Fan', level: 'Beer League', dob: '',
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    const { error: err } = await signIn({ email: form.email, password: form.password });
    setLoading(false);
    if (err) setError(err.message);
    else navigate('/feed');
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (step < 3) { setStep(s => s + 1); return; }
    setLoading(true); setError('');
    const { error: err } = await signUp(form);
    setLoading(false);
    if (err) {
      if (err.message?.includes('13')) setMode('coppa');
      else setError(err.message);
    } else navigate('/feed');
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
        <div style={{ marginBottom: 48 }}>
          <RinkdLogo size={100} />
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
        ) : mode === 'login' ? (
          <>
            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 900, fontStyle: 'italic',
              fontSize: 36, color: C.ice, marginBottom: 8, textTransform: 'uppercase',
            }}>Welcome Back</h2>
            <p style={{ color: C.steel, marginBottom: 32, fontSize: 14 }}>
              Sign in to your Rinkd account
            </p>
            <form onSubmit={handleLogin}>
              <Input label="Email" type="email" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="you@example.com" required />
              <Input label="Password" type="password" value={form.password}
                onChange={e => set('password', e.target.value)} placeholder="••••••••" required />
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
              <button onClick={() => { setMode('signup'); setStep(1); setError(''); }}
                style={{ color: C.ice, background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: 600, textDecoration: 'underline', fontSize: 14 }}>
                Create Account
              </button>
            </p>
          </>
        ) : (
          // Signup
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
              {[1,2,3].map(s => (
                <React.Fragment key={s}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: step >= s ? C.red : C.border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'white',
                    transition: 'all 0.2s',
                  }}>{s}</div>
                  {s < 3 && <div style={{ flex: 1, height: 2, background: step > s ? C.red : C.border, transition: 'all 0.2s' }}/>}
                </React.Fragment>
              ))}
            </div>

            <h2 style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 900, fontStyle: 'italic',
              fontSize: 32, color: C.ice, marginBottom: 6, textTransform: 'uppercase',
            }}>
              {step === 1 ? 'Join the Ice' : step === 2 ? 'Your Identity' : 'Your Hockey'}
            </h2>
            <p style={{ color: C.steel, marginBottom: 24, fontSize: 13 }}>
              {step === 1 ? 'Create your account' : step === 2 ? 'How you\'ll appear on Rinkd' : 'Tell us about your game'}
            </p>

            <form onSubmit={handleSignup}>
              {step === 1 && (
                <>
                  <Input label="Email" type="email" value={form.email}
                    onChange={e => set('email', e.target.value)} required placeholder="you@example.com" />
                  <Input label="Password" type="password" value={form.password}
                    onChange={e => set('password', e.target.value)} required placeholder="Min 6 characters" minLength={6} />
                  <Input label="Date of Birth" type="date" value={form.dob}
                    onChange={e => set('dob', e.target.value)} required />
                  <p style={{ fontSize: 11, color: C.steel, marginTop: -8, marginBottom: 16 }}>
                    Must be 13+ to create an account (COPPA compliance)
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <Input label="Full Name" type="text" value={form.name}
                    onChange={e => set('name', e.target.value)} required placeholder="Connor McDavid" />
                  <Input label="Username" type="text" value={form.handle}
                    onChange={e => set('handle', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    required placeholder="@yourusername" />
                </>
              )}
              {step === 3 && (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{
                      display: 'block', fontSize: 12, fontWeight: 600, color: C.steel,
                      marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase',
                      fontFamily: "'Barlow Condensed', sans-serif",
                    }}>Position / Role</label>
                    <select value={form.position} onChange={e => set('position', e.target.value)}
                      style={{
                        width: '100%', padding: '12px 14px', borderRadius: 10,
                        background: '#080F1C', border: `1.5px solid ${C.border}`,
                        color: C.ice, fontSize: 15, outline: 'none',
                        fontFamily: "'Barlow', sans-serif",
                      }}>
                      {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{
                      display: 'block', fontSize: 12, fontWeight: 600, color: C.steel,
                      marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase',
                      fontFamily: "'Barlow Condensed', sans-serif",
                    }}>Level</label>
                    <select value={form.level} onChange={e => set('level', e.target.value)}
                      style={{
                        width: '100%', padding: '12px 14px', borderRadius: 10,
                        background: '#080F1C', border: `1.5px solid ${C.border}`,
                        color: C.ice, fontSize: 15, outline: 'none',
                        fontFamily: "'Barlow', sans-serif",
                      }}>
                      {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </>
              )}

              {error && <p style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                {step > 1 && (
                  <button type="button" onClick={() => setStep(s => s - 1)} style={{
                    padding: '14px 24px', borderRadius: 10,
                    background: 'transparent', color: C.steel,
                    border: `1.5px solid ${C.border}`,
                    fontFamily: "'Barlow', sans-serif", fontSize: 15, cursor: 'pointer',
                  }}>← Back</button>
                )}
                <button type="submit" disabled={loading} style={{
                  flex: 1, padding: '14px', borderRadius: 10,
                  background: loading ? C.border : C.red, color: 'white', border: 'none',
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 700, fontStyle: 'italic', fontSize: 18, textTransform: 'uppercase',
                  cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '0.05em',
                }}>
                  {loading ? 'Creating...' : step < 3 ? 'Next →' : 'Hit the Ice →'}
                </button>
              </div>
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
    </div>
  );
}
