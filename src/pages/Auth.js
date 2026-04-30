import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RinkdIcon } from '../components/Logos';
import { signIn, signUp } from '../lib/auth';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', dark: '#07111F', card: '#112236',
  lgray: '#8BA3BE', mgray: '#4A6180', border: '#1E3A5C',
};

function Input({ label, type = 'text', value, onChange, placeholder, required }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: C.lgray, fontSize: 11, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: '0.1em' }}>{label.toUpperCase()}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        style={{
          background: C.dark, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => e.target.style.borderColor = C.blue}
        onBlur={e => e.target.style.borderColor = C.border}
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: C.lgray, fontSize: 11, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: '0.1em' }}>{label.toUpperCase()}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: C.dark, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '12px 14px', color: value ? '#fff' : C.mgray, fontSize: 14, outline: 'none',
      }}>
        <option value="">Select...</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | signup
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Signup extra fields
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [position, setPosition] = useState('');
  const [level, setLevel] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signIn({ email, password });
        navigate('/feed');
      } else {
        if (!name.trim()) throw new Error('Please enter your name');
        if (!handle.trim()) throw new Error('Please enter a username');
        await signUp({ email, password, name, handle, position, level });
        setSuccess('Account created! Check your email to confirm, then log in.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.dark,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, position: 'relative', overflow: 'hidden',
    }}>
      {/* rink bg */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.05 }} preserveAspectRatio="none">
        <line x1="0" y1="25%" x2="100%" y2="25%" stroke="#2E5B8C" strokeWidth="1" />
        <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#D72638" strokeWidth="1" />
        <line x1="0" y1="75%" x2="100%" y2="75%" stroke="#2E5B8C" strokeWidth="1" />
        <line x1="25%" y1="0" x2="25%" y2="100%" stroke="#2E5B8C" strokeWidth="1" />
        <line x1="50%" y1="0" x2="50%" y2="100%" stroke="#2E5B8C" strokeWidth="1" />
        <line x1="75%" y1="0" x2="75%" y2="100%" stroke="#2E5B8C" strokeWidth="1" />
        <circle cx="50%" cy="50%" r="200" stroke="#2E5B8C" strokeWidth="1" fill="none" />
      </svg>

      <div style={{
        width: '100%', maxWidth: 420,
        background: C.card, borderRadius: 16,
        border: `1px solid ${C.border}`,
        overflow: 'hidden', position: 'relative', zIndex: 2,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        {/* red top bar */}
        <div style={{ height: 5, background: 'linear-gradient(90deg,#D72638,#2E5B8C)' }} />

        <div style={{ padding: '32px 32px 36px' }}>
          {/* logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 32 }}>
            <RinkdIcon size={64} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, fontStyle: 'italic', fontSize: 32, color: '#fff', letterSpacing: '0.1em', lineHeight: 1 }}>RINKD</div>
              <div style={{ color: C.lgray, fontSize: 12, marginTop: 4 }}>The Platform Built for Hockey</div>
            </div>
          </div>

          {/* tabs */}
          <div style={{ display: 'flex', background: C.dark, borderRadius: 8, padding: 4, marginBottom: 24, gap: 4 }}>
            {['login', 'signup'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); setSuccess(''); }} style={{
                flex: 1, padding: '9px 0', borderRadius: 6,
                background: mode === m ? C.blue : 'transparent',
                color: mode === m ? '#fff' : C.lgray,
                fontFamily: "'Barlow Condensed'", fontWeight: 800,
                fontSize: 13, letterSpacing: '0.1em',
                transition: 'all 0.15s',
              }}>{m === 'login' ? 'LOG IN' : 'SIGN UP'}</button>
            ))}
          </div>

          {error && (
            <div style={{ background: '#D7263818', border: `1px solid #D7263855`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#F87171', fontSize: 13 }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ background: '#22C55E18', border: `1px solid #22C55E55`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#4Ade80', fontSize: 13 }}>
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mode === 'signup' && (
              <>
                <Input label="Full Name" value={name} onChange={setName} placeholder="Mike Torrance" required />
                <Input label="Username" value={handle} onChange={v => setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g,''))} placeholder="mktorrance" required />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Select label="Position" value={position} onChange={setPosition} options={[
                    { value: 'Forward', label: 'Forward' },
                    { value: 'Defense', label: 'Defense' },
                    { value: 'Goalie', label: 'Goalie' },
                    { value: 'Fan', label: 'Fan / Other' },
                  ]} />
                  <Select label="Level" value={level} onChange={setLevel} options={[
                    { value: 'Youth', label: 'Youth' },
                    { value: 'Beer League', label: 'Beer League' },
                    { value: 'Junior', label: 'Junior' },
                    { value: 'College', label: 'College' },
                    { value: 'Coach', label: 'Coach' },
                    { value: 'Fan', label: 'Fan' },
                  ]} />
                </div>
              </>
            )}

            <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" required />
            <Input label="Password" type="password" value={password} onChange={setPassword} placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'} required />

            <button type="submit" disabled={loading} style={{
              background: loading ? C.mgray : C.red,
              color: '#fff', borderRadius: 10, padding: '14px',
              fontFamily: "'Barlow Condensed'", fontWeight: 900,
              fontSize: 16, letterSpacing: '0.12em',
              marginTop: 4, transition: 'all 0.15s',
              boxShadow: loading ? 'none' : '0 4px 20px rgba(215,38,56,0.35)',
            }}>
              {loading ? 'LOADING...' : mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20, color: C.mgray, fontSize: 12 }}>
            {mode === 'login' ? (
              <>Don't have an account? <button onClick={() => setMode('signup')} style={{ color: C.blue, fontWeight: 700, fontSize: 12 }}>Sign up free</button></>
            ) : (
              <>Already have an account? <button onClick={() => setMode('login')} style={{ color: C.blue, fontWeight: 700, fontSize: 12 }}>Log in</button></>
            )}
          </div>
        </div>

        {/* brand trio footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 32px', display: 'flex', justifyContent: 'center', gap: 12, background: C.dark }}>
          {[['RINKD','#2E5B8C'],['RINKSIDE','#1A4A7A'],['CREASE','#D72638']].map(([n,c]) => (
            <span key={n} style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 10, color: c, letterSpacing: '0.1em' }}>{n}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
