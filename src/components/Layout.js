import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RinkdLogo, Avatar } from './Logos';
import { signOut } from '../lib/auth';

const NAV = [
  { path: '/feed',      icon: '🏒', label: 'Feed',      active: true },
  { path: '/rinkside',  icon: '📰', label: 'Rinkside',  badge: 'CONTENT' },
  { path: '/crease',    icon: '🎬', label: 'Crease',    badge: 'PREMIUM' },
  { path: '/leagues',   icon: '🏆', label: 'Leagues',   badge: 'COMMUNITY' },
  { path: '/store',     icon: '🛒', label: 'Store',     badge: 'MERCH' },
  { path: '/discover',  icon: '🔍', label: 'Discover' },
  { path: '/profile',   icon: '👤', label: 'Profile' },
];

const BRAND_COLORS = {
  navy: '#0B1F3A',
  blue: '#2E5B8C',
  red: '#D72638',
  ice: '#F4F7FA',
  steel: '#8BA3BE',
  dark: '#07111F',
  card: '#112236',
  border: '#1E3A5C',
};

export default function Layout({ children, profile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: BRAND_COLORS.dark,
      fontFamily: "'Barlow', sans-serif",
      color: BRAND_COLORS.ice,
    }}>
      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside style={{
        width: 240,
        background: BRAND_COLORS.navy,
        borderRight: `1px solid ${BRAND_COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        zIndex: 100,
        '@media (max-width: 768px)': { display: 'none' }
      }} className="sidebar-desktop">
        {/* Logo */}
        <div style={{
          padding: '24px 20px 20px',
          borderBottom: `1px solid ${BRAND_COLORS.border}`,
        }}>
          <Link to="/feed" style={{ textDecoration: 'none' }}>
            <RinkdLogo size={44} showText />
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV.map(item => {
            const active = location.pathname === item.path ||
              (item.path === '/feed' && location.pathname === '/');
            return (
              <Link key={item.path} to={item.path}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 12px', borderRadius: 10, marginBottom: 2,
                  textDecoration: 'none',
                  background: active ? BRAND_COLORS.blue + '33' : 'transparent',
                  color: active ? BRAND_COLORS.ice : BRAND_COLORS.steel,
                  fontWeight: active ? 600 : 400,
                  fontSize: 15,
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = BRAND_COLORS.border + '66'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                {active && (
                  <div style={{
                    position: 'absolute', left: 0, top: '20%', bottom: '20%',
                    width: 3, background: BRAND_COLORS.red, borderRadius: '0 3px 3px 0'
                  }}/>
                )}
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 9, fontWeight: 700,
                    fontFamily: "'Barlow Condensed', sans-serif",
                    letterSpacing: '0.08em',
                    background: BRAND_COLORS.border,
                    color: BRAND_COLORS.steel,
                    padding: '2px 5px', borderRadius: 3,
                  }}>{item.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Profile + signout */}
        {profile && (
          <div style={{
            padding: '16px', borderTop: `1px solid ${BRAND_COLORS.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Avatar profile={profile} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: BRAND_COLORS.ice,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {profile.name}
                </div>
                <div style={{ fontSize: 11, color: BRAND_COLORS.steel }}>
                  @{profile.handle}
                </div>
              </div>
            </div>
            <button onClick={handleSignOut} style={{
              width: '100%', padding: '8px', borderRadius: 8,
              background: 'transparent', border: `1px solid ${BRAND_COLORS.border}`,
              color: BRAND_COLORS.steel, fontSize: 13, cursor: 'pointer',
              fontFamily: "'Barlow', sans-serif",
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = BRAND_COLORS.red; e.currentTarget.style.color = BRAND_COLORS.red; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = BRAND_COLORS.border; e.currentTarget.style.color = BRAND_COLORS.steel; }}
            >Sign Out</button>
            
            {/* Legal footer */}
            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/privacy" style={{ fontSize: 10, color: BRAND_COLORS.border, textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.color = BRAND_COLORS.steel}
                onMouseLeave={e => e.currentTarget.style.color = BRAND_COLORS.border}
              >Privacy</Link>
              <Link to="/terms" style={{ fontSize: 10, color: BRAND_COLORS.border, textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.color = BRAND_COLORS.steel}
                onMouseLeave={e => e.currentTarget.style.color = BRAND_COLORS.border}
              >Terms</Link>
              <span style={{ fontSize: 10, color: BRAND_COLORS.border }}>© 2026 Rinkd LLC</span>
            </div>
          </div>
        )}
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main style={{
        flex: 1,
        marginLeft: 240,
        maxWidth: '100%',
      }} className="main-content">
        {children}
      </main>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      <nav style={{
        display: 'none',
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: BRAND_COLORS.navy,
        borderTop: `1px solid ${BRAND_COLORS.border}`,
        zIndex: 200,
        padding: '8px 0 max(8px, env(safe-area-inset-bottom))',
      }} className="mobile-nav">
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {NAV.slice(0, 5).map(item => {
            const active = location.pathname === item.path ||
              (item.path === '/feed' && location.pathname === '/');
            return (
              <Link key={item.path} to={item.path}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 3, padding: '4px 8px', textDecoration: 'none',
                  color: active ? BRAND_COLORS.ice : BRAND_COLORS.steel,
                  minWidth: 50,
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>
                  {item.label}
                </span>
                {active && (
                  <div style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: BRAND_COLORS.red,
                  }}/>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .main-content { margin-left: 0 !important; padding-bottom: 72px; }
          .mobile-nav { display: block !important; }
        }
      `}</style>
    </div>
  );
}

export { BRAND_COLORS };
