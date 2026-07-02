import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { TeamLogo } from '../components/Logos';
import { C, colors, type, space, radii, shadows, motion } from '../lib/tokens';
import { SectionHeader, Card, Button, Skeleton, EmptyState, ErrorState } from '../components/ui';
import { useReducedMotion } from '../lib/motion';
import { fmtEventDate } from '../lib/home';
import { track, seedPilotRef } from '../lib/analytics';
import LiveGameCard from '../components/Gameday/LiveGameCard';
import {
  getOperatorBySlug, getOperatorLiveGames, subscribeOperatorLive,
} from '../lib/operators';

// =============================================================================
// C12 · Operator Front Door — /o/:slug.
//
// The branded landing page we forward a partner platform or big operator instead
// of the cold app: THEIR brand, THEIR events, THEIR live games — framed
// everywhere as "the engagement layer on top of the platform you already run,"
// never a replacement. Generalizes the demo-league deep link + the Home Featured
// hero into a per-operator, admin-curated, never-empty surface.
//
// Anatomy (spec §1c): full-bleed brand hero (clones League.js:643-670) → quiet
// co-brand line → swipeable "THEIR EVENTS" chip strip (live first) → LIVE NOW
// (shared LiveGameCard, only when live) → events grid → footer CTA to /pricing.
// States: skeleton / not-on-the-ice-yet invitation / error-retry. No polling —
// one Realtime channel scoped to the pinned events, unsubscribed on unmount.
// =============================================================================

// The demo league — the never-empty fallback destination on empty/unknown slugs.
const DEMO_LEAGUE_ID = '934dd511-e15e-4a07-94ff-1edd6ff31dfc';

// The partner-safe positioning line — the copy law for this surface. Every
// string on the page frames Rinkd as the engagement layer ON TOP of the
// operator's platform.
function defaultTagline(name) {
  return `The fan & community layer for ${name} — on top of the platform you already run.`;
}

let heroKfInjected = false;
function ensureHeroKeyframes() {
  if (heroKfInjected || typeof document === 'undefined') return;
  heroKfInjected = true;
  const el = document.createElement('style');
  el.textContent =
    '@keyframes rinkdOpEnter{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}' +
    `.rinkd-op-in{animation:rinkdOpEnter ${motion.duration.entrance}ms ${motion.easing.out} both}` +
    '@keyframes rinkdOpLivePulse{0%{opacity:0.9;transform:scale(1)}100%{opacity:0;transform:scale(2.6)}}' +
    '.rinkd-op-livering{animation:rinkdOpLivePulse 1.5s ease-out infinite}' +
    '.rinkd-op-rail{scrollbar-width:none;-webkit-overflow-scrolling:touch}' +
    '.rinkd-op-rail::-webkit-scrollbar{display:none}' +
    '@media (prefers-reduced-motion: reduce){.rinkd-op-in{animation:none}.rinkd-op-livering{animation:none;opacity:0}}';
  document.head.appendChild(el);
}

export default function Operator({ profile }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState('loading'); // loading | ready | notfound | error
  const [operator, setOperator] = useState(null);
  const [events, setEvents] = useState([]);
  const [liveGames, setLiveGames] = useState([]);
  const eventsRef = useRef([]);
  const slugRef = useRef(slug);
  slugRef.current = slug;

  ensureHeroKeyframes();

  // Refresh live games over the pinned events (bounded, Realtime-driven).
  const refreshLive = useCallback(async () => {
    const evs = eventsRef.current;
    if (!evs.length) { setLiveGames([]); return; }
    try {
      const games = await getOperatorLiveGames(evs);
      setLiveGames(games);
    } catch { /* live is additive — a hiccup never blanks the page */ }
  }, []);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const { operator: op, events: evs } = await getOperatorBySlug(slugRef.current);
      // Unknown slug OR an active operator whose events all drifted away →
      // the never-empty invitation, never a 404 or a blank.
      if (!op || !evs.length) {
        setOperator(op || null);
        setEvents([]);
        eventsRef.current = [];
        setPhase('notfound');
        return;
      }
      setOperator(op);
      setEvents(evs);
      eventsRef.current = evs;
      setPhase('ready');
      refreshLive();
    } catch (e) {
      console.warn('[operator] load failed:', e?.message || e);
      setPhase('error');
    }
  }, [refreshLive]);

  // Load on slug change.
  useEffect(() => { load(); }, [load, slug]);

  // Analytics on mount / slug change: the operator-page funnel + first-touch
  // attribution seed (respects an already-captured ref — first touch wins).
  useEffect(() => {
    if (!slug) return;
    track('operator_page_view', { slug });
    seedPilotRef(slug);
  }, [slug]);

  // Realtime subscription over the pinned events (no polling). Re-subscribes
  // whenever the event set changes; always unsubscribes on unmount.
  useEffect(() => {
    if (phase !== 'ready' || !events.length) return undefined;
    const unsub = subscribeOperatorLive(slug, events, refreshLive);
    return unsub;
  }, [phase, events, slug, refreshLive]);

  if (phase === 'loading') return <Layout profile={profile}><OperatorSkeleton /></Layout>;

  if (phase === 'error') {
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', padding: space.md }}>
          <ErrorState
            title="Couldn't open this front door"
            body="A hiccup on our end or your connection. Give it another shot."
            onRetry={load}
          />
        </div>
      </Layout>
    );
  }

  if (phase === 'notfound') {
    // A designed invitation — never a dead end. If we DID find an operator row
    // (active but events drifted), greet it by name; otherwise a generic warm
    // welcome. Both route to Home + the give-first demo league.
    const name = operator?.name;
    return (
      <Layout profile={profile}>
        <SEO
          title={name ? `${name} on Rinkd` : 'Operator · Rinkd'}
          description="The fan & community layer that sits on top of the platform you already run."
          url={`https://rinkd.app/o/${slug}`}
          noIndex
        />
        <div style={{ background: C.dark, minHeight: '100vh', padding: space.md, maxWidth: 640, margin: '0 auto' }}>
          <EmptyState
            title={name ? `${name} isn't on the ice yet` : "This rink isn't on the ice yet"}
            body="We haven't lit up this front door yet. Take a lap around Rinkd — or drop into a live league to see the engagement layer that rides on top of the platform you already run."
            cta={{ label: 'Explore Rinkd', onClick: () => navigate('/home') }}
          />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: space.md }}>
            <Button variant="secondary" onClick={() => navigate(`/league/${DEMO_LEAGUE_ID}`)}>
              See a live league demo
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  // ── READY ──────────────────────────────────────────────────────────────────
  const heroBg = operator.brand_color || C.navy;
  const accent = operator.accent_color || C.red;
  const tagline = operator.tagline || defaultTagline(operator.name);
  const hasLive = liveGames.length > 0;
  const inClass = reduced ? '' : 'rinkd-op-in';

  // Live events sort first in the chip strip; a chip is "live" iff one of its
  // games is in the live set (by eventId).
  const liveEventIds = new Set(liveGames.map((g) => g.eventId).filter(Boolean));
  const chips = [...events].sort((a, b) => {
    const al = liveEventIds.has(a.id) ? 0 : 1;
    const bl = liveEventIds.has(b.id) ? 0 : 1;
    return al - bl || (a.sort_order - b.sort_order);
  });

  return (
    <Layout profile={profile}>
      <SEO
        title={`${operator.name} on Rinkd`}
        description={tagline}
        image={operator.cover_image_url || undefined}
        url={`https://rinkd.app/o/${operator.slug}`}
      />
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* ── HERO (clones League cover-hero recipe: League.js:643-670) ── */}
        <div className={inClass} style={{ position: 'relative', overflow: 'hidden', background: heroBg }}>
          {operator.cover_image_url && (
            <img src={operator.cover_image_url} alt="" loading="eager"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          {operator.cover_image_url && (
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${heroBg}D9 0%, rgba(7,17,31,0.45) 45%, rgba(7,17,31,0.94) 100%)` }} />
          )}
          <div style={{ position: 'relative', padding: '22px 16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', rowGap: 10 }}>
              <TeamLogo
                team={{ name: operator.name, logo_url: operator.logo_url, logo_color: operator.brand_color || C.blue, logo_initials: operator.logo_initials }}
                size={64} radius={12}
                style={{ boxShadow: '0 4px 18px rgba(0,0,0,0.55)', flexShrink: 0 }} />
              <div style={{ flex: '1 1 auto', minWidth: 180 }}>
                {/* 2-line clamp + ellipsis so a 60-char partner name never blows
                    out the hero. */}
                <div style={{
                  fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900,
                  fontSize: 'clamp(24px, 6.4vw, 36px)', color: C.ice, lineHeight: 1.04,
                  textTransform: 'uppercase', letterSpacing: '0.01em',
                  overflowWrap: 'anywhere', textShadow: '0 2px 10px rgba(0,0,0,0.6)',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{operator.name}</div>
                {hasLive && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: C.red, color: colors.onAccent, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 11px', borderRadius: radii.button }}>
                      <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                        <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: colors.onAccent }} />
                        <span className="rinkd-op-livering" style={{ position: 'absolute', inset: 0, borderRadius: 999, boxShadow: `0 0 0 2px ${colors.onAccent}` }} />
                      </span>
                      LIVE
                    </span>
                  </div>
                )}
              </div>
            </div>
            {/* Partner-safe sub-line — 2-line clamp handles a 5-sentence tagline. */}
            <div style={{
              marginTop: 12, maxWidth: 560, fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 500,
              lineHeight: 1.5, color: 'rgba(244,247,250,0.86)', textShadow: '0 1px 6px rgba(0,0,0,0.6)',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{tagline}</div>
          </div>
        </div>

        <div style={{ padding: '16px 16px 40px', maxWidth: 720, margin: '0 auto' }}>

          {/* ── CO-BRAND LINE — only when platform_label is set ── */}
          {operator.platform_label && (
            <div className={inClass} style={{ ...type.meta, color: colors.muted, marginBottom: space.md, lineHeight: 1.5 }}>
              Results sync in from {operator.platform_label} · {operator.name} stays the source of truth
              {operator.website_url && (
                <>
                  {' · '}
                  <a href={operator.website_url} target="_blank" rel="noopener noreferrer"
                    style={{ color: accent, textDecoration: 'none', fontWeight: 700 }}>
                    Visit {operator.name}
                  </a>
                </>
              )}
            </div>
          )}

          {/* ── CHIP STRIP — "THEIR EVENTS" — a navigation rail; pointless for a
              single event, so it only renders when there are 2+ events. ── */}
          {events.length >= 2 && (
          <div className={inClass}>
            <SectionHeader label="Events" live={hasLive} />
            <div className="rinkd-op-rail" style={{
              display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4,
              scrollSnapType: 'x mandatory',
              // right-edge peek: the next chip pokes in so "more" is obvious.
              paddingRight: 32, marginRight: -16,
            }}>
              {chips.map((ev) => {
                const isLive = liveEventIds.has(ev.id);
                return (
                  <button key={`${ev.kind}:${ev.id}`} onClick={() => navigate(ev.href)}
                    className="rinkd-pressable"
                    style={{
                      flexShrink: 0, scrollSnapAlign: 'start',
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      minHeight: 44, maxWidth: 240, padding: '6px 12px 6px 8px',
                      background: colors.surface, border: `1px solid ${isLive ? 'rgba(215,38,56,0.6)' : C.border}`,
                      borderRadius: radii.chip, cursor: 'pointer',
                      boxShadow: isLive ? shadows.live : 'none',
                    }}>
                    {isLive && (
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: C.red, flexShrink: 0 }} />
                    )}
                    <TeamLogo team={{ name: ev.name, logo_url: ev.logo_url, logo_color: ev.logo_color || ev.accent_color || C.blue, logo_initials: ev.logo_initials }} size={24} radius={6} />
                    <span style={{
                      fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic',
                      fontSize: 14, letterSpacing: '0.03em', textTransform: 'uppercase', color: C.ice,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                    }}>{ev.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* ── LIVE NOW — only when live games exist ── */}
          {hasLive && (
            <div className={inClass} style={{ marginTop: space.lg }}>
              <SectionHeader label="Live Now" live />
              {liveGames.map((g) => (
                <LiveGameCard key={`${g.source}:${g.id}`} game={g} navigate={navigate} />
              ))}
            </div>
          )}

          {/* ── EVENTS GRID — the page's meat when nothing is live ── */}
          <div className={inClass} style={{ marginTop: space.lg }}>
            <SectionHeader label="The Events" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {events.map((ev) => (
                <Card key={`grid:${ev.kind}:${ev.id}`} onClick={() => navigate(ev.href)} padding={14}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <TeamLogo team={{ name: ev.name, logo_url: ev.logo_url, logo_color: ev.logo_color || ev.accent_color || C.blue, logo_initials: ev.logo_initials }} size={44} radius={10} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
                        fontSize: 16, letterSpacing: '0.01em', textTransform: 'uppercase', color: C.ice, lineHeight: 1.1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{ev.name}</div>
                      <div style={{ ...type.meta, color: colors.muted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {eventMeta(ev)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* ── FOOTER CTA — quiet secondary (the primary action is a tap into an event) ── */}
          <div className={inClass} style={{ marginTop: space.xl, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ ...type.meta, color: colors.muted, textAlign: 'center', maxWidth: 420, lineHeight: 1.5 }}>
              Rinkd is the engagement layer on top of the platform you already run.
            </div>
            <Button variant="secondary" onClick={() => navigate('/pricing')}>
              Run your events on Rinkd
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// Meta line for an event card — league season/location, tournament dates.
function eventMeta(ev) {
  if (ev.kind === 'league') {
    return [ev.season, ev.location || ev.venueName].filter(Boolean).join(' · ') || 'League';
  }
  const start = ev.startDate ? fmtEventDate(ev.startDate) : null;
  const end = ev.endDate ? fmtEventDate(ev.endDate) : null;
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || 'Tournament';
}

// ── Geometric skeleton — matches hero + chip strip + two event cards exactly ──
function OperatorSkeleton() {
  return (
    <div style={{ background: C.dark, minHeight: '100vh' }}>
      {/* hero */}
      <div style={{ background: colors.surface, padding: '22px 16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton width={64} height={64} radius={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Skeleton width="70%" height={30} radius={6} />
            <div style={{ height: 8 }} />
            <Skeleton width="45%" height={12} />
          </div>
        </div>
        <div style={{ height: 14 }} />
        <Skeleton width="88%" height={12} />
        <div style={{ height: 5 }} />
        <Skeleton width="62%" height={12} />
      </div>

      <div style={{ padding: '16px 16px 40px', maxWidth: 720, margin: '0 auto' }}>
        {/* section head + chip strip */}
        <Skeleton width={130} height={30} radius={4} style={{ marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[220, 180, 140].map((w, i) => (
            <Skeleton key={i} width={w} height={44} radius={radii.chip} style={{ flexShrink: 0 }} />
          ))}
        </div>
        {/* two event cards */}
        <Skeleton width={110} height={30} radius={4} style={{ marginBottom: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ background: colors.surface, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Skeleton width={44} height={44} radius={10} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width="70%" height={16} radius={4} />
                <div style={{ height: 6 }} />
                <Skeleton width="45%" height={11} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
