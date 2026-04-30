import React, { useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { RinkdLogo } from './Logos';
import { AuthContext } from '../App';
import { signOut } from '../lib/auth';
import { getTier } from '../lib/tiers';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  dark: '#07111F', card: '#112236',
  lgray: '#8BA3BE', mgray: '#4A6180', border: '#1E3A5C',
};

const NAV = [
  { path: '/feed',    label: 'Feed',    icon: '⬡' },
  { path: '/profile', label: 'Profile', icon: '👤' },
];

export function Avatar({ user, size = 36 }) {
  const tier = getTier(user?.points || 0);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: user?.avatar_color || C.blue,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Barlow Condensed', sans-serif",
      fontWeight: 800, fontSize: size * 0.36, color: '#fff',
      border: `2px solid ${tier.color}`,
      flexShrink: 0,
    }}>{user?.avatar_initials || '??'}</div>
  );
}

export default function Layout({ children }) {
  const { profile } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#030C15' }}>
      {/* Desktop sidebar */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: C.dark, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }} className="desktop-sidebar">
        <div style={{ padding: '22px 20px 16px', borderBottom: `2px solid ${C.red}` }}>
          <RinkdLogo size={26} />
        </div>

        <nav style={{ padding: '10px', flex: 1 }}>
          {NAV.map(item => (
            <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 8, marginBottom: 3,
              background: isActive ? `${C.blue}22` : 'transparent',
              borderLeft: `3px solid ${isActive ? C.red : 'transparent'}`,
              color: isActive ? '#fff' : C.lgray,
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700, fontSize: 14, letterSpacing: '0.06em',
              textDecoration: 'none', transition: 'all 0.15s',
            })}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
              {item.label.toUpperCase()}
            </NavLink>
          ))}
        </nav>

        {/* Brand tags */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[['RINKD','THE PLATFORM','#2E5B8C'],['RINKSIDE','THE CONTENT','#1A4A7A'],['CREASE','THE PREMIUM','#D72638']].map(([n,s,c]) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 3, height: 28, background: c, borderRadius: 2 }} />
              <div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 11, color: '#fff', letterSpacing: '0.1em' }}>{n}</div>
                <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 9, color: C.mgray, letterSpacing: '0.1em' }}>{s}</div>
              </div>
            </div>
          ))}
        </div>

        {/* User + sign out */}
        {profile && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px' }}>
            <NavLink to="/profile" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 10 }}>
              <Avatar user={profile} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</div>
                <div style={{ color: C.mgray, fontSize: 10 }}>@{profile.handle}</div>
              </div>
            </NavLink>
            <button onClick={handleSignOut} style={{
              width: '100%', padding: '7px', borderRadius: 6,
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.mgray, fontSize: 11,
              fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: '0.06em',
            }}>SIGN OUT</button>
          </div>
        )}
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mobile header */}
        <header style={{
          display: 'none', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: C.dark,
          borderBottom: `2px solid ${C.red}`,
          position: 'sticky', top: 0, zIndex: 50,
        }} className="mobile-header">
          <RinkdLogo size={22} />
          <button onClick={handleSignOut} style={{ color: C.mgray, fontSize: 11, fontFamily: "'Barlow Condensed'", fontWeight: 700 }}>SIGN OUT</button>
        </header>

        <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>

        {/* Mobile bottom nav */}
        <nav style={{
          display: 'none', justifyContent: 'space-around', alignItems: 'center',
          padding: '8px 0 14px',
          background: C.dark, borderTop: `1px solid ${C.border}`,
          position: 'sticky', bottom: 0, zIndex: 50,
        }} className="mobile-nav">
          {NAV.map(item => (
            <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '6px 20px', textDecoration: 'none',
              color: isActive ? C.red : C.lgray,
            })}>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>{item.label.toUpperCase()}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .desktop-sidebar { display: none !important; }
          .mobile-header   { display: flex !important; }
          .mobile-nav      { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
