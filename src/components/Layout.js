import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RinkdLogo, Avatar } from './Logos';
import { signOut } from '../lib/auth';
import { useUserRole, roleMenuSections } from '../lib/userRole';

const ROLE_BADGE_COLOR = {
  commissioner: '#D72638',
  manager:      '#F59E0B',
  player:       '#2E5B8C',
};

const NAV = [
  { path: '/feed',        icon: '🏒', label: 'Feed' },
  { path: '/rinkside',    icon: '📰', label: 'Rinkside',    badge: 'CONTENT' },
  { path: '/crease',      icon: '🎬', label: 'Crease',      badge: 'PREMIUM' },
  { path: '/leagues',     icon: '🏆', label: 'Leagues',     badge: 'COMMUNITY' },
  { path: '/store',       icon: '🛒', label: 'Store',       badge: 'MERCH' },
  { path: '/discover',    icon: '🔍', label: 'Discover' },
  { path: '/profile',     icon: '👤', label: 'Profile' },
  { path: '/tournaments', icon: '🥅', label: 'Tournaments' },
  { path: '/teams',       icon: '👥', label: 'Teams' },
];

// Bottom quick-nav — always visible on mobile
const BOTTOM_NAV = [
  { path: '/feed',     icon: '🏒', label: 'Feed' },
  { path: '/rinkside', icon: '📰', label: 'Rinkside' },
  { path: '/crease',   icon: '🎬', label: 'Crease' },
  { path: '/store',    icon: '🛒', label: 'Store' },
];

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

export default function Layout({ children, profile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const role = useUserRole(profile?.id);
  const roleSections = roleMenuSections(role);
  const roleMenuRef = useRef(null);

  // Close the role dropdown when clicking outside it
  useEffect(() => {
    if (!roleOpen) return undefined;
    const onDocClick = (e) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target)) {
        setRoleOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [roleOpen]);

  // Close on route change
  useEffect(() => {
    setRoleOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    setRoleOpen(false);
    setMenuOpen(false);
    navigate('/');
  };

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const roleColor = ROLE_BADGE_COLOR[role] || B.blue;

  const isActive = (item) =>
    location.pathname === item.path ||
    (item.path === '/feed' && location.pathname === '/') ||
    (item.path === '/tournaments' && location.pathname.startsWith('/tournament')) ||
    (item.path === '/teams' && location.pathname.startsWith('/team')) ||
    (item.path === '/leagues' && location.pathname.startsWith('/league'));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: B.dark, fontFamily: "'Barlow', sans-serif", color: B.ice }}>

      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside style={{ width: 240, background: B.navy, borderRight: `1px solid ${B.border}`, display: 'flex', flexDirection: 'column', position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }} className="sidebar-desktop">
        <div style={{ padding: '24px 20px 20px', borderBottom: `1px solid ${B.border}` }}>
          <Link to="/feed" style={{ textDecoration: 'none' }}>
            <RinkdLogo size={44} showText />
          </Link>
        </div>
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {NAV.map(item => {
            const active = isActive(item);
            return (
              <Link key={item.path} to={item.path}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 10, marginBottom: 2, textDecoration: 'none', background: active ? B.blue + '33' : 'transparent', color: active ? B.ice : B.steel, fontWeight: active ? 600 : 400, fontSize: 15, transition: 'all 0.15s', position: 'relative' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = B.border + '66'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                {active && <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, background: B.red, borderRadius: '0 3px 3px 0' }} />}
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && (
                  <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', background: B.border, color: B.steel, padding: '2px 5px', borderRadius: 3 }}>{item.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {profile && (
          <div ref={roleMenuRef} style={{ padding: '16px', borderTop: `1px solid ${B.border}`, position: 'relative' }}>
            {/* Avatar block doubles as the dropdown trigger */}
            <button
              onClick={() => setRoleOpen(v => !v)}
              aria-expanded={roleOpen}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
              <Avatar profile={profile} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: B.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', background: roleColor + '33', color: roleColor, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{roleLabel}</span>
                </div>
                <div style={{ fontSize: 11, color: B.steel }}>@{profile.handle}</div>
              </div>
              <span style={{ fontSize: 11, color: B.steel, transform: roleOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
            </button>

            {/* Dropdown opens upward so it doesn't get clipped at the bottom of the viewport */}
            {roleOpen && (
              <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(100% - 8px)', background: B.card, border: `1px solid ${B.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', overflow: 'hidden', zIndex: 110 }}>
                {roleSections.map((section, idx) => (
                  <div key={section.label} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${B.border}` }}>
                    <div style={{ padding: '8px 12px 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>{section.label}</div>
                    {section.items.map(item => (
                      <Link key={item.path} to={item.path}
                        onClick={() => setRoleOpen(false)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', textDecoration: 'none', color: B.ice, fontSize: 13, transition: 'background 0.12s' }}
                        onMouseEnter={e => e.currentTarget.style.background = B.border + '66'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ fontSize: 16 }}>{item.icon}</span>
                        <span>{item.label}</span>
                      </Link>
                    ))}
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${B.border}` }}>
                  <button onClick={handleSignOut}
                    style={{ width: '100%', padding: '10px 12px', textAlign: 'left', background: 'transparent', border: 'none', color: B.steel, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.12s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = B.border + '66'; e.currentTarget.style.color = B.red; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = B.steel; }}>
                    <span style={{ fontSize: 16 }}>⎋</span>
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link to="/privacy" style={{ fontSize: 10, color: B.border, textDecoration: 'none' }} onMouseEnter={e => e.currentTarget.style.color = B.steel} onMouseLeave={e => e.currentTarget.style.color = B.border}>Privacy</Link>
              <Link to="/terms" style={{ fontSize: 10, color: B.border, textDecoration: 'none' }} onMouseEnter={e => e.currentTarget.style.color = B.steel} onMouseLeave={e => e.currentTarget.style.color = B.border}>Terms</Link>
              <span style={{ fontSize: 10, color: B.border }}>© 2026 Rinkd LLC</span>
            </div>
          </div>
        )}
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <main style={{ flex: 1, marginLeft: 240, maxWidth: '100%' }} className="main-content">
        {children}
      </main>

      {/* ─── MOBILE TOP BAR ─── */}
      <div style={{ display: 'none', position: 'fixed', top: 0, left: 0, right: 0, height: 52, background: B.navy, borderBottom: `1px solid ${B.border}`, zIndex: 200, alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }} className="mobile-topbar">
        <Link to="/feed" style={{ textDecoration: 'none' }}>
          <RinkdLogo size={32} showText />
        </Link>
        <button onClick={() => setMenuOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ width: 22, height: 2, background: B.ice, borderRadius: 2 }} />
          <div style={{ width: 22, height: 2, background: B.ice, borderRadius: 2 }} />
          <div style={{ width: 22, height: 2, background: B.ice, borderRadius: 2 }} />
        </button>
      </div>

      {/* ─── MOBILE HAMBURGER MENU (full screen) ─── */}
      {menuOpen && (
        <div style={{ display: 'none', position: 'fixed', inset: 0, background: B.navy, zIndex: 300, flexDirection: 'column', overflowY: 'auto', paddingBottom: 80 }} className="mobile-menu-open">
          {/* Menu header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: `1px solid ${B.border}` }}>
            <RinkdLogo size={36} showText />
            <button onClick={() => setMenuOpen(false)} style={{ background: 'none', border: 'none', color: B.steel, fontSize: 24, cursor: 'pointer', padding: 4 }}>✕</button>
          </div>

          {/* Profile */}
          {profile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${B.border}` }}>
              <Avatar profile={profile} size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: B.ice }}>{profile.name}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase', background: roleColor + '33', color: roleColor, padding: '2px 6px', borderRadius: 4 }}>{roleLabel}</span>
                </div>
                <div style={{ fontSize: 12, color: B.steel }}>@{profile.handle}</div>
              </div>
            </div>
          )}

          {/* Role-based menu sections — same items as the desktop dropdown */}
          {profile && (
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${B.border}` }}>
              {roleSections.map(section => (
                <div key={section.label} style={{ marginBottom: 6 }}>
                  <div style={{ padding: '8px 12px 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>{section.label}</div>
                  {section.items.map(item => (
                    <Link key={item.path} to={item.path} onClick={() => setMenuOpen(false)}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 12px', borderRadius: 10, textDecoration: 'none', color: B.ice, fontSize: 15 }}>
                      <span style={{ fontSize: 18 }}>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* All nav items */}
          <nav style={{ padding: '8px 12px', flex: 1 }}>
            {NAV.map(item => {
              const active = isActive(item);
              return (
                <Link key={item.path} to={item.path}
                  onClick={() => setMenuOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 12px', borderRadius: 10, marginBottom: 2, textDecoration: 'none', background: active ? B.blue + '33' : 'transparent', color: active ? B.ice : B.steel, fontWeight: active ? 600 : 400, fontSize: 16, position: 'relative' }}>
                  {active && <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, background: B.red, borderRadius: '0 3px 3px 0' }} />}
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', background: B.border, color: B.steel, padding: '2px 6px', borderRadius: 3 }}>{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Sign out */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${B.border}` }}>
            <button onClick={handleSignOut} style={{ width: '100%', padding: '11px', borderRadius: 8, background: 'transparent', border: `1px solid ${B.border}`, color: B.steel, fontSize: 14, cursor: 'pointer', fontFamily: "'Barlow', sans-serif" }}>
              Sign Out
            </button>
            <div style={{ marginTop: 10, display: 'flex', gap: 12 }}>
              <Link to="/privacy" onClick={() => setMenuOpen(false)} style={{ fontSize: 11, color: B.border, textDecoration: 'none' }}>Privacy</Link>
              <Link to="/terms" onClick={() => setMenuOpen(false)} style={{ fontSize: 11, color: B.border, textDecoration: 'none' }}>Terms</Link>
              <span style={{ fontSize: 11, color: B.border }}>© 2026 Rinkd LLC</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── MOBILE BOTTOM NAV (quick access) ─── */}
      <nav style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: B.navy, borderTop: `1px solid ${B.border}`, zIndex: 200, padding: '8px 0 max(8px, env(safe-area-inset-bottom))' }} className="mobile-nav">
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {BOTTOM_NAV.map(item => {
            const active = isActive(item);
            return (
              <Link key={item.path} to={item.path}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '4px 8px', textDecoration: 'none', color: active ? B.ice : B.steel, minWidth: 50 }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{item.label}</span>
                {active && <div style={{ width: 4, height: 4, borderRadius: '50%', background: B.red }} />}
              </Link>
            );
          })}
          {/* Hamburger as 5th item */}
          <button onClick={() => setMenuOpen(true)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: B.steel, minWidth: 50 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', marginBottom: 2 }}>
              <div style={{ width: 18, height: 2, background: B.steel, borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: B.steel, borderRadius: 2 }} />
              <div style={{ width: 18, height: 2, background: B.steel, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 400 }}>More</span>
          </button>
        </div>
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .main-content { margin-left: 0 !important; padding-top: 52px; padding-bottom: 72px; }
          .mobile-topbar { display: flex !important; }
          .mobile-nav { display: block !important; }
          .mobile-menu-open { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

const BRAND_COLORS = B;
export { BRAND_COLORS };

