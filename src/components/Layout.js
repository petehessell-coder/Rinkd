import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RinkdLogo, Avatar, ProfileNavIcon, ChirpNavIcon } from './Logos';
import { signOut } from '../lib/auth';
import NotificationBell from './NotificationBell';
import HelpButton from './HelpButton';
import MoreDrawer from './MoreDrawer';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

// ============================================================================
// Sprint 4D.5 — Complexity Diet
//
// Primary nav is now FIVE items on desktop sidebar AND mobile bottom bar:
//   Feed · Teams · Notifications · Profile · More
//
// Demoted destinations (Rinkside, Crease, Store, Discover, Tournaments,
// Leagues, Admin pages) live inside the More drawer. Their direct URLs still
// work — we just stopped front-loading them on day one.
// ============================================================================

const NAV = [
  { path: '/feed',          IconNode: ChirpNavIcon, iconProps: { inline: false }, label: 'Chirps' },
  { path: '/teams',         icon: '👥',  label: 'Teams' },
  { path: '/notifications', icon: '🔔',  label: 'Notifications', showBadge: true },
  { path: '/profile',       IconNode: ProfileNavIcon, label: 'Profile' },
  { path: '__more',         icon: '⋯',  label: 'More', isMore: true },
];

function NavIcon({ item, size }) {
  if (item.iconImg) {
    return (
      <img src={item.iconImg} alt="" width={size} height={size}
        style={{ width: size, height: size, borderRadius: size * 0.22, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
    );
  }
  if (item.IconNode) {
    const Icon = item.IconNode;
    // iconProps lets a nav entry pass component-specific options (e.g. the
    // Chirp icon supports an `inline` prop that toggles wordmark vs. square).
    return <Icon size={size} {...(item.iconProps || {})} />;
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{item.icon}</span>;
}

export default function Layout({ children, profile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const isActive = (item) =>
    location.pathname === item.path ||
    (item.path === '/feed' && location.pathname === '/') ||
    location.pathname.startsWith(item.path + '/');

  // Click handler for the More nav item — opens the drawer instead of navigating
  const renderNavLink = (item, opts) => {
    const { size, isVertical, active } = opts;
    if (item.isMore) {
      return (
        <button onClick={() => setMoreOpen(true)}
          style={{
            display: 'flex', alignItems: isVertical ? 'center' : 'center',
            flexDirection: isVertical ? 'column' : 'row',
            gap: isVertical ? 3 : 12,
            padding: isVertical ? '4px 8px' : '11px 12px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: B.steel, fontFamily: 'inherit',
            width: isVertical ? undefined : '100%',
            borderRadius: isVertical ? 0 : 10,
            fontSize: isVertical ? 10 : 15,
            position: 'relative',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!isVertical) e.currentTarget.style.background = B.border + '66'; }}
          onMouseLeave={e => { if (!isVertical) e.currentTarget.style.background = 'transparent'; }}>
          <span style={{ fontSize: isVertical ? 20 : size, lineHeight: 1, fontWeight: 700 }}>⋯</span>
          <span>More</span>
        </button>
      );
    }
    return (
      <Link to={item.path}
        style={{
          display: 'flex', alignItems: 'center',
          flexDirection: isVertical ? 'column' : 'row',
          gap: isVertical ? 3 : 12,
          padding: isVertical ? '4px 8px' : '11px 12px',
          borderRadius: isVertical ? 0 : 10,
          textDecoration: 'none',
          background: !isVertical && active ? B.blue + '33' : 'transparent',
          color: active ? B.ice : B.steel,
          fontWeight: active ? 600 : 400,
          fontSize: isVertical ? 10 : 15,
          transition: 'all 0.15s',
          position: 'relative',
          minWidth: isVertical ? 50 : undefined,
        }}
        onMouseEnter={e => { if (!isVertical && !active) e.currentTarget.style.background = B.border + '66'; }}
        onMouseLeave={e => { if (!isVertical && !active) e.currentTarget.style.background = 'transparent'; }}>
        {active && !isVertical && <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, background: B.red, borderRadius: '0 3px 3px 0' }} />}
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <NavIcon item={item} size={size} />
          {item.showBadge && profile?.id && (
            <BellBadge userId={profile.id} />
          )}
        </span>
        <span style={{ fontWeight: isVertical && active ? 600 : undefined }}>{item.label}</span>
        {active && isVertical && <div style={{ width: 4, height: 4, borderRadius: '50%', background: B.red }} />}
      </Link>
    );
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: B.dark, color: B.ice, fontFamily: "'Barlow', sans-serif" }}>

      {/* ─── DESKTOP SIDEBAR ─── */}
      <aside className="sidebar-desktop" style={{ width: 240, background: B.navy, borderRight: `1px solid ${B.border}`, padding: '24px 0 16px', position: 'fixed', top: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Brand */}
        <div style={{ padding: '0 18px 18px' }}>
          <Link to="/feed" style={{ textDecoration: 'none' }}>
            <RinkdLogo size={40} showText />
          </Link>
        </div>

        {/* Primary nav (5 items) */}
        <nav style={{ flex: 1, padding: '0 10px' }}>
          {NAV.map(item => (
            <div key={item.path} style={{ marginBottom: 2 }}>
              {renderNavLink(item, { size: 22, isVertical: false, active: !item.isMore && isActive(item) })}
            </div>
          ))}
        </nav>

        {/* Footer: simple avatar block. No role badge, no dropdown. */}
        {profile && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${B.border}` }}>
            <Link to="/profile" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
              <Avatar profile={profile} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: B.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                <div style={{ fontSize: 11, color: B.steel }}>@{profile.handle}</div>
              </div>
            </Link>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, fontSize: 10, color: B.border }}>
              <Link to="/privacy" style={{ color: B.border, textDecoration: 'none' }}>Privacy</Link>
              <Link to="/terms" style={{ color: B.border, textDecoration: 'none' }}>Terms</Link>
              <span style={{ marginLeft: 'auto' }}>© 2026</span>
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
        {profile?.id && <NotificationBell userId={profile.id} size={22} />}
      </div>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      {/* Same 5 items as desktop. No more hamburger — "More" drawer covers everything. */}
      <nav style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: B.navy, borderTop: `1px solid ${B.border}`, zIndex: 200, padding: '8px 0 max(8px, env(safe-area-inset-bottom))' }} className="mobile-nav">
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {NAV.map(item => (
            <div key={item.path}>
              {renderNavLink(item, { size: 22, isVertical: true, active: !item.isMore && isActive(item) })}
            </div>
          ))}
        </div>
      </nav>

      {/* More drawer */}
      <MoreDrawer open={moreOpen} onClose={() => setMoreOpen(false)} userId={profile?.id} onSignOut={handleSignOut} />

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .main-content { margin-left: 0 !important; padding-top: 52px; padding-bottom: 72px; }
          .mobile-topbar { display: flex !important; }
          .mobile-nav { display: block !important; }
        }
      `}</style>

      {/* Floating help+feedback button, visible on every page */}
      <HelpButton />
    </div>
  );
}

/**
 * Tiny inline component that shows the unread-count red dot on the
 * Notifications nav item. Mounted only when there's a logged-in user.
 */
function BellBadge({ userId }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getUnreadCount, subscribe } = await import('../lib/notifications');
        const refresh = async () => {
          const c = await getUnreadCount();
          if (!cancelled) setCount(c);
        };
        refresh();
        const interval = setInterval(refresh, 45_000);
        const unsub = subscribe(userId, refresh);
        return () => { clearInterval(interval); unsub(); };
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  if (!count) return null;
  return (
    <span style={{
      position: 'absolute', top: -4, right: -6,
      background: B.red, color: '#fff',
      minWidth: 14, height: 14, borderRadius: 999,
      padding: '0 3px', fontSize: 9, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `2px solid ${B.navy}`, lineHeight: 1,
    }}>{count > 99 ? '99+' : count}</span>
  );
}

const BRAND_COLORS = B;
export { BRAND_COLORS };
