import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { getProfile } from './lib/auth';
import Auth from './pages/Auth';
import Feed from './pages/Feed';
import Profile from './pages/Profile';
import Rinkside from './pages/Rinkside';
import Crease from './pages/Crease';
import Leagues from './pages/Leagues';
import Store from './pages/Store';
import Legal from './pages/Legal';
import Discover from './pages/Discover';
import Survey from './pages/Survey';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

// ── PWA INSTALL HELPERS ──────────────────────────────────────────────────────

const PWA_KEY = 'rinkd_pwa_dismissed';

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

// ── DROP IN COMPONENT ────────────────────────────────────────────────────────

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

function LedR({ size = 56 }) {
  const on = [[4,4],[9,4],[14,4],[19,4],[24,4],[4,9],[29,9],[4,14],[29,14],[4,19],[9,19],[14,19],[19,19],[24,19],[4,24],[19,24],[4,29],[24,29],[4,34],[29,34],[4,39],[34,39]];
  const all = [];
  for (let x = 4; x <= 34; x += 5) for (let y = 4; y <= 39; y += 5) all.push([x, y]);
  const onSet = new Set(on.map(([x,y]) => `${x},${y}`));
  return (
    <svg viewBox="0 0 38 43" width={size} height={size} fill="none">
      <defs>
        <filter id="lg" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {all.map(([x,y]) => (
        onSet.has(`${x},${y}`)
          ? <circle key={`on${x}${y}`} cx={x} cy={y} r="2" fill={C.red} filter="url(#lg)"/>
          : <circle key={`off${x}${y}`} cx={x} cy={y} r="1.6" fill="#1a3050"/>
      ))}
    </svg>
  );
}

function DropIn({ onDismiss }) {
  const [phase, setPhase] = useState('intro');
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const ios = isIOS();

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    setTimeout(() => setVisible(true), 80);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const advance = () => {
    if (phase === 'intro') { setPhase('instructions'); return; }
    if (isAndroid() && deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        setPhase('done');
        setTimeout(handleDismiss, 2200);
      });
    } else {
      setPhase('done');
      setTimeout(handleDismiss, 2200);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 400);
  };

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: C.dark,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '32px 28px',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.4s ease',
  };

  if (phase === 'done') return (
    <div style={overlay}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 24 }}>🏒</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontStyle: 'italic', fontSize: 36, color: C.ice,
          textTransform: 'uppercase', lineHeight: 1.05, marginBottom: 12 }}>
          You're locked in.
        </div>
        <div style={{ color: C.steel, fontSize: 15 }}>Welcome to Rinkd.</div>
      </div>
    </div>
  );

  if (phase === 'instructions') return (
    <div style={overlay}>
      <style>{`
        @keyframes bounce-up {
          0%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}
        }
        @keyframes drop-in-anim {
          0%,100%{transform:translateY(-3px);opacity:0.6}50%{transform:translateY(2px);opacity:1}
        }
      `}</style>
      <div style={{ textAlign: 'center', maxWidth: 340, width: '100%' }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontStyle: 'italic', fontSize: 13, letterSpacing: '0.2em',
          color: C.red, textTransform: 'uppercase', marginBottom: 12 }}>
          {ios ? 'Two taps. That\'s it.' : 'One tap.'}
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontSize: 30, color: C.ice, textTransform: 'uppercase',
          marginBottom: 32, lineHeight: 1.1 }}>
          {ios ? 'Add to Home Screen' : 'Install Rinkd'}
        </div>

        {ios ? (
          <>
            {[
              { num: 1, color: C.red, title: 'Tap the Share button', sub: 'The box with an arrow at the bottom of Safari' },
              { num: 2, color: C.blue, title: 'Tap "Add to Home Screen"', sub: 'Scroll down in the share sheet until you see it' },
            ].map(({ num, color, title, sub }) => (
              <div key={num} style={{ background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: '18px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 900, color: '#fff', fontSize: 18 }}>{num}</div>
                <div>
                  <div style={{ color: C.ice, fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{title}</div>
                  <div style={{ color: C.steel, fontSize: 13 }}>{sub}</div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div style={{ background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '28px 20px', marginBottom: 32, textAlign: 'center' }}>
            <svg viewBox="0 0 44 44" width="44" height="44" fill="none" style={{ display: 'block', margin: '0 auto 16px' }}>
              <rect x="2" y="2" width="40" height="40" rx="10" stroke={C.steel} strokeWidth="2"/>
              <g style={{ animation: 'drop-in-anim 1.2s ease-in-out infinite' }}>
                <line x1="22" y1="10" x2="22" y2="28" stroke={C.ice} strokeWidth="2.5" strokeLinecap="round"/>
                <polyline points="14,21 22,29 30,21" stroke={C.ice} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </g>
              <line x1="12" y1="34" x2="32" y2="34" stroke={C.steel} strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div style={{ color: C.steel, fontSize: 14 }}>
              Tap <span style={{ color: C.ice, fontWeight: 600 }}>"Install"</span> when your browser prompts you
            </div>
          </div>
        )}

        <div style={{ marginTop: ios ? 20 : 0 }}>
          <button onClick={advance} style={{ width: '100%', padding: '16px',
            background: C.red, border: 'none', borderRadius: 10,
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
            fontStyle: 'italic', fontSize: 18, letterSpacing: '0.06em',
            color: '#fff', textTransform: 'uppercase', cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(215,38,56,0.4)', marginBottom: 12 }}>
            {ios ? 'Done — I Added It ✓' : 'Install Rinkd'}
          </button>
          <button onClick={handleDismiss} style={{ background: 'none', border: 'none',
            color: C.steel, fontSize: 13, cursor: 'pointer', padding: '8px',
            fontFamily: "'Barlow', sans-serif" }}>Skip for now</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={overlay}>
      <style>{`
        @keyframes pulse-glow {
          0%,100%{box-shadow:0 0 40px rgba(215,38,56,0.3),0 0 80px rgba(215,38,56,0.1)}
          50%{box-shadow:0 0 60px rgba(215,38,56,0.5),0 0 100px rgba(215,38,56,0.2)}
        }
      `}</style>
      <div style={{ textAlign: 'center', maxWidth: 340, width: '100%' }}>
        <div style={{ width: 88, height: 88, borderRadius: 20,
          background: '#06101e', border: `2px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 32px', animation: 'pulse-glow 2.4s ease-in-out infinite' }}>
          <LedR size={60} />
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontStyle: 'italic', fontSize: 13, letterSpacing: '0.2em',
          color: C.red, textTransform: 'uppercase', marginBottom: 12 }}>
          You're on the roster.
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontStyle: 'italic', fontSize: 38, lineHeight: 1.05, color: C.ice,
          textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.02em' }}>
          One last<br />thing.
        </div>
        <div style={{ color: C.steel, fontSize: 15, lineHeight: 1.6, marginBottom: 40 }}>
          Add Rinkd to your home screen for the full experience — no App Store required.
        </div>
        <button onClick={advance} style={{ width: '100%', padding: '16px',
          background: C.red, border: 'none', borderRadius: 10,
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900,
          fontStyle: 'italic', fontSize: 18, letterSpacing: '0.06em',
          color: '#fff', textTransform: 'uppercase', cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(215,38,56,0.4)', marginBottom: 16 }}>
          Let's Do It →
        </button>
        <button onClick={handleDismiss} style={{ background: 'none', border: 'none',
          color: C.steel, fontSize: 13, cursor: 'pointer', padding: '8px',
          fontFamily: "'Barlow', sans-serif" }}>Skip for now</button>
      </div>
    </div>
  );
}

// ── PWA BANNER ───────────────────────────────────────────────────────────────

function PWABanner({ onInstall, onDismiss }) {
  return (
    <div style={{ position: 'fixed', bottom: 72, left: 12, right: 12, zIndex: 999,
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.red}`, borderRadius: 10,
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'slide-up 0.35s cubic-bezier(0.34,1.3,0.64,1)' }}>
      <style>{`
        @keyframes slide-up {
          from{transform:translateY(20px);opacity:0}
          to{transform:translateY(0);opacity:1}
        }
      `}</style>
      <div style={{ width: 32, height: 32, borderRadius: 7, background: '#06101e',
        border: '1px solid #1a3050', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
        boxShadow: '0 0 10px rgba(215,38,56,0.3)' }}>
        <LedR size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          fontSize: 13, color: C.ice, letterSpacing: 0.3 }}>Get the app</div>
        <div style={{ color: C.steel, fontSize: 12 }}>Add Rinkd to your home screen</div>
      </div>
      <button onClick={onInstall} style={{ background: C.red, border: 'none',
        borderRadius: 6, padding: '7px 14px',
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
        fontSize: 13, color: '#fff', cursor: 'pointer',
        letterSpacing: 0.5, flexShrink: 0, textTransform: 'uppercase' }}>
        Install
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none',
        color: C.steel, fontSize: 18, cursor: 'pointer', padding: '4px',
        lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  );
}

// ── PROTECTED ROUTE ──────────────────────────────────────────────────────────

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#07111F',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Barlow', sans-serif", color: '#8BA3BE', fontSize: 15 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏒</div>
        <div>Loading Rinkd...</div>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/" replace />;
}

// ── APP ROUTES ───────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user, profile, setProfile } = useAuth();
  const [showDropIn, setShowDropIn] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (isInstalled()) return;
    const dismissed = localStorage.getItem(PWA_KEY);
    if (!dismissed) {
      setTimeout(() => setShowDropIn(true), 1500);
    } else {
      setShowBanner(true);
    }
  }, [user]);

  const dismissDropIn = () => {
    localStorage.setItem(PWA_KEY, 'true');
    setShowDropIn(false);
    setShowBanner(true);
  };

  const dismissBanner = () => setShowBanner(false);
  const reopenDropIn = () => { setShowBanner(false); setShowDropIn(true); };

  return (
    <>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/feed" replace /> : <Auth />} />
        <Route path="/login" element={user ? <Navigate to="/feed" replace /> : <Auth />} />

        <Route path="/feed" element={
          <ProtectedRoute>
            <Feed currentUser={user} profile={profile} />
          </ProtectedRoute>
        } />

        <Route path="/profile/:userId" element={
          <ProtectedRoute>
            <Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} />
          </ProtectedRoute>
        } />
        <Route path="/profile" element={
          <ProtectedRoute>
            <Profile currentUser={user} profile={profile} onProfileUpdate={setProfile} />
          </ProtectedRoute>
        } />

        <Route path="/rinkside" element={
          <ProtectedRoute><Rinkside profile={profile} /></ProtectedRoute>
        } />
        <Route path="/crease" element={
          <ProtectedRoute><Crease profile={profile} /></ProtectedRoute>
        } />
        <Route path="/leagues" element={
          <ProtectedRoute><Leagues profile={profile} /></ProtectedRoute>
        } />
        <Route path="/store" element={
          <ProtectedRoute><Store profile={profile} /></ProtectedRoute>
        } />

        <Route path="/survey" element={<Survey />} />
        <Route path="/privacy" element={<Legal />} />
        <Route path="/terms" element={<Legal />} />
        <Route path="/discover" element={
          <ProtectedRoute><Discover currentUser={user} profile={profile} /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>

      {showDropIn && <DropIn onDismiss={dismissDropIn} />}
      {showBanner && <PWABanner onInstall={reopenDropIn} onDismiss={dismissBanner} />}
    </>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const u = session?.user || null;
      setUser(u);
      if (u) {
        const { data } = await getProfile(u.id);
        setProfile(data);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user || null;
      setUser(u);
      if (u) {
        const { data } = await getProfile(u.id);
        setProfile(data);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, setProfile, loading }}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}