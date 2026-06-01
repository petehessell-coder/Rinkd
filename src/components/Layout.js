import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RinkdLogo, Avatar, ProfileNavIcon, ChirpNavIcon } from './Logos';
import { signOut } from '../lib/auth';
import NotificationBell from './NotificationBell';
import MessagesIcon from './MessagesIcon';
import HelpButton from './HelpButton';
import MoreDrawer from './MoreDrawer';
import IOSInstallBanner from './IOSInstallBanner';

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

// Mobile bottom bar drops Notifications — on mobile it already lives in the
// top-right bar next to Messages, so a second copy down here was redundant.
// Desktop has no top bar, so the sidebar keeps the full NAV (incl. the bell).
const MOBILE_NAV = NAV.filter(item => item.path !== '/notifications');

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

// Paths where a global "back" button doesn't make sense — these are
// top-level destinations from the nav itself. Pressing back from /feed
// to a previous detail page is confusing, not helpful. Everywhere else
// gets a back button automatically.
const TOP_LEVEL_PATHS = new Set([
  '/', '/feed', '/teams', '/notifications', '/messages', '/profile',
  '/login', '/landing',
]);

function shouldShowBack(pathname) {
  if (TOP_LEVEL_PATHS.has(pathname)) return false;
  // /profile (own) is a top-level destination; /profile/:id (someone else)
  // is a detail view that warrants a back button.
  if (pathname === '/profile') return false;
  return true;
}

function BackButton({ inline = false }) {
  const navigate = useNavigate();
  const onBack = () => {
    // Use browser history if available; otherwise fall back to the feed.
    if (window.history.length > 1) navigate(-1);
    else navigate('/feed');
  };
  return (
    <button
      onClick={onBack}
      aria-label="Back"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', color: B.ice,
        cursor: 'pointer', padding: inline ? '6px 10px' : '6px 8px',
        borderRadius: 8, fontFamily: "'Barlow', sans-serif",
        fontSize: 14, fontWeight: 600, lineHeight: 1,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = B.border + '66'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }}>←</span>
      <span>Back</span>
    </button>
  );
}

export default function Layout({ children, profile }) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const showBack = shouldShowBack(location.pathname);

  // Close drawer on route change
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('[signOut] errored, forcing reload anyway:', err?.message || err);
    }
    // Full reload, not navigate(). A hard reload rebuilds auth state from
    // scratch — a stale session can't linger and bounce the user back in.
    window.location.href = '/';
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
        {/* Desktop back row — appears above every detail page. Hidden on
            top-level nav destinations (Feed, Teams, Notifications, Profile,
            Landing, Login). */}
        {showBack && (
          <div className="desktop-back-row" style={{ padding: '14px 16px 0' }}>
            <BackButton inline />
          </div>
        )}
        {children}
      </main>

      {/* ─── MOBILE TOP BAR ─── */}
      <div style={{ display: 'none', position: 'fixed', top: 0, left: 0, right: 0, height: 52, background: B.navy, borderBottom: `1px solid ${B.border}`, zIndex: 200, alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }} className="mobile-topbar">
        {showBack ? (
          <BackButton />
        ) : (
          <Link to="/feed" style={{ textDecoration: 'none' }}>
            <RinkdLogo size={32} showText />
          </Link>
        )}
        {profile?.id && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <MessagesIcon userId={profile.id} size={22} />
            <NotificationBell userId={profile.id} size={22} />
          </div>
        )}
      </div>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      {/* Same 5 items as desktop. No more hamburger — "More" drawer covers everything. */}
      <nav style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: B.navy, borderTop: `1px solid ${B.border}`, zIndex: 200, padding: '8px 0 max(8px, env(safe-area-inset-bottom))' }} className="mobile-nav">
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          {MOBILE_NAV.map(item => (
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
          /* Bottom nav is ~50px tall + safe-area inset on iOS. Reserve enough
             room below the content so the last row never sits under the nav.
             88px covers the nav, its 8px top padding, and a small breathing
             gap; safe-area inset is added on top so the home-indicator area
             on iOS still clears. */
          .main-content {
            margin-left: 0 !important;
            padding-top: 52px;
            padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          }
          .mobile-topbar { display: flex !important; }
          .mobile-nav { display: block !important; }
          /* Mobile shows the back button in the top bar, so hide the
             desktop "back row" above content to avoid showing it twice. */
          .desktop-back-row { display: none !important; }
        }
      `}</style>

      {/* iOS PWA install nudge (GS-7) — self-gates: renders only for iOS
          Safari that hasn't installed, on the 3rd app-open or a Follow-tap. */}
      <IOSInstallBanner />

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
    if (!userId) return undefined;
    let cancelled = false;
    let interval = null;
    let unsub = null;
    (async () => {
      try {
        const { getUnreadCount, subscribe } = await import('../lib/notifications');
        if (cancelled) return;
        const refresh = async () => {
          // getUnreadCount throws on a query error. This runs from setInterval
          // and the realtime callback too, so it needs its own try/catch —
          // the outer one only guards the initial import + setup.
          try {
            const c = await getUnreadCount(userId);
            if (!cancelled) setCount(c);
          } catch { /* swallow — badge holds its last known count */ }
        };
        refresh();
        interval = setInterval(refresh, 45_000);
        unsub = subscribe(userId, refresh);
      } catch { /* swallow */ }
    })();
    // Synchronous cleanup — actually reaches React (the old version returned
    // its cleanup to the async IIFE's promise, so the timer + realtime channel
    // leaked on every navigation). Tears down even if the import is still pending.
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (unsub) unsub();
    };
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
