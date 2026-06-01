import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUserRole, useIsRinkdAdmin, roleMenuSections } from '../lib/userRole';

const B = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

/**
 * "More" drawer — slides up from the bottom of the screen (mobile) or appears as
 * a centered modal sheet (desktop). Holds all the destinations we demoted out
 * of the primary nav during the complexity diet, organized by purpose so the
 * first-time user can find what they need without being overwhelmed up-front.
 *
 * Sections:
 *   • Explore — Discover, Rinkside, Crease, Leagues, Tournaments
 *   • Manage — role-specific items (Admin, Volunteer Coordinator, etc.) for
 *     commissioners + managers. Players see an empty Manage section that's
 *     just hidden.
 *   • Account — Settings, Help, Privacy, Terms, Sign Out
 */
export default function MoreDrawer({ open, onClose, userId, onSignOut }) {
  const role = useUserRole(userId);
  const isRinkdAdmin = useIsRinkdAdmin(userId);
  const roleSections = roleMenuSections(role);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  const exploreItems = [
    { path: '/messages',    icon: '💬',  label: 'Messages',    sub: 'Direct messages with players' },
    { path: '/discover',    icon: '🔍',  label: 'Discover',    sub: 'Search players, teams, leagues, articles' },
    { path: '/rinkside',    iconImg: '/rinkside-logo.png', label: 'Rinkside', sub: 'Daily hockey reporting' },
    { path: '/crease',      iconImg: '/crease-logo.png',   label: 'Crease',   sub: 'Original premium shows', badge: 'Early Access' },
    { path: '/store',       IconNode: 'duffle', label: 'Store',       sub: 'Hockey gear + Rinkd merch' },
    { path: '/leagues',     IconNode: 'leagues', label: 'Leagues',     sub: 'Find or create a league' },
    { path: '/tournaments', IconNode: 'bracket', label: 'Tournaments', sub: 'Browse + manage events' },
    { path: '/pricing',     icon: '💲', label: 'Pricing',     sub: 'Plans for leagues + tournaments' },
  ];

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: 'rgba(7,17,31,0.85)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        fontFamily: "'Barlow', sans-serif",
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: B.card, border: `1px solid ${B.border}`,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto',
          color: B.ice, boxShadow: '0 -20px 50px rgba(0,0,0,0.5)',
        }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${B.border}`, position: 'sticky', top: 0, background: B.card, zIndex: 2 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>
            More
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', color: B.steel, border: 'none', fontSize: 24, cursor: 'pointer', padding: 4, lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* EXPLORE */}
        <DrawerSection title="Explore">
          {exploreItems.map((it) => (
            <DrawerRow key={it.path} item={it} onClose={onClose} />
          ))}
        </DrawerSection>

        {/* MANAGE (role-based) */}
        {roleSections.some((s) => s.items?.length > 0) && (
          <DrawerSection title="Manage">
            {roleSections.flatMap((section) =>
              (section.items || []).map((it) => (
                <DrawerRow key={it.path} item={{ ...it, sub: section.label }} onClose={onClose} />
              ))
            )}
          </DrawerSection>
        )}

        {/* RINKD STAFF — platform-wide tools. Gate is profiles.is_admin=true,
            NOT league commissioner. Per-league commissioners see /admin via
            the role menu section above (it manages their own league only).
            Analytics, feedback, and moderation cross all leagues and so are
            staff-only. */}
        {isRinkdAdmin && (
          <DrawerSection title="Rinkd Admin">
            <DrawerRow item={{ path: '/admin/analytics', icon: '📈', label: 'Analytics', sub: 'DAU + events firehose' }} onClose={onClose} />
            <DrawerRow item={{ path: '/admin/activations', icon: '🔓', label: 'Activations', sub: 'Flip tournaments + leagues on' }} onClose={onClose} />
            <DrawerRow item={{ path: '/admin/feedback', icon: '📬', label: 'Bug reports', sub: 'Triage user reports' }} onClose={onClose} />
            <DrawerRow item={{ path: '/admin/moderation', icon: '🛡️', label: 'Moderation', sub: 'Flagged content + blocklist' }} onClose={onClose} />
          </DrawerSection>
        )}

        {/* ACCOUNT */}
        <DrawerSection title="Account">
          <DrawerRow item={{ path: '/settings', icon: '⚙️', label: 'Settings', sub: 'Data export, delete account' }} onClose={onClose} />
          <DrawerRow item={{ path: '/privacy', icon: '🔒', label: 'Privacy', sub: '' }} onClose={onClose} />
          <DrawerRow item={{ path: '/terms', icon: '📄', label: 'Terms of Service', sub: '' }} onClose={onClose} />
          {onSignOut && (
            <button onClick={() => { onClose(); onSignOut(); }}
              style={{ width: '100%', padding: '13px 18px', textAlign: 'left', background: 'transparent', border: 'none', color: B.red, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid rgba(46,91,140,0.15)` }}>
              <span style={{ fontSize: 18, width: 24 }}>⎋</span>
              <span>Sign Out</span>
            </button>
          )}
        </DrawerSection>

        {/* Footer */}
        <div style={{ padding: '14px 18px', textAlign: 'center', borderTop: `1px solid ${B.border}`, fontSize: 11, color: B.steel }}>
          © 2026 Rinkd LLC · <a href="mailto:hello@rinkd.app" style={{ color: B.ice, textDecoration: 'none' }}>hello@rinkd.app</a>
        </div>
      </div>
    </div>
  );
}

function DrawerSection({ title, children }) {
  return (
    <div>
      <div style={{ padding: '14px 18px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: B.steel, textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function DrawerRow({ item, onClose }) {
  return (
    <Link to={item.path} onClick={onClose}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 18px', textDecoration: 'none', color: B.ice,
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(46,91,140,0.15)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      {item.IconNode ? (
        <span style={{ width: 28, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}><DrawerIcon node={item.IconNode} /></span>
      ) : item.iconImg ? (
        <img src={item.iconImg} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{ fontSize: 22, width: 28, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{item.label}</span>
          {item.badge && (
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', background: B.red + '33', color: B.red, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>{item.badge}</span>
          )}
        </div>
        {item.sub && <div style={{ fontSize: 12, color: B.steel, marginTop: 2 }}>{item.sub}</div>}
      </div>
      <span style={{ color: B.steel, fontSize: 18 }}>›</span>
    </Link>
  );
}

// Inline line-icons for drawer rows that use IconNode — no good emoji exists
// for a tournament bracket or a hockey duffle. Monochrome to match the UI.
function DrawerIcon({ node }) {
  const svg = {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
    stroke: B.ice, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  if (node === 'duffle') {
    return (
      <svg {...svg}>
        <rect x="2.5" y="8.5" width="19" height="10.5" rx="3" />
        <path d="M8.5 8.5 C 8.5 5, 15.5 5, 15.5 8.5" />
        <line x1="2.5" y1="12" x2="21.5" y2="12" />
      </svg>
    );
  }
  if (node === 'bracket') {
    return (
      <svg {...svg}>
        <path d="M4 5 h4 a2 2 0 0 1 2 2 v3 a2 2 0 0 0 2 2 h2" />
        <path d="M4 19 h4 a2 2 0 0 0 2 -2 v-3 a2 2 0 0 1 2 -2 h2" />
        <path d="M14 12 h6" />
      </svg>
    );
  }
  if (node === 'leagues') {
    return (
      <svg {...svg}>
        <line x1="5" y1="20" x2="5" y2="13" />
        <line x1="12" y1="20" x2="12" y2="7" />
        <line x1="19" y1="20" x2="19" y2="11" />
      </svg>
    );
  }
  return null;
}
