import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { supabase } from '../lib/supabase';
import { C, colors, type, radii, motion } from '../lib/tokens';
import { useUserRole } from '../lib/userRole';
import { SectionHeader, Button, Icon } from '../components/ui';
import { TeamLogo, Avatar } from '../components/Logos';
import RecapCard from '../components/RecapCard';
import PuckMark from '../components/PuckMark';
import { getGamePuck } from '../lib/gamePucks';
import MapLink from '../components/MapLink';
import { getHeadToHead } from '../lib/gameday';
import {
  loadHome, loadHomeLive, searchEverything, fmtGameWhen, fmtEventDate, getLiveHeroExtras, DEMO_LEAGUE_ID,
} from '../lib/home';

// Surface-elevated — the "card that matters" tone from the manifesto. The hero
// + live cards sit on this; standard rows stay on C.card.
const ELEV = colors.surfaceElevated;
const GOLD = C.gold;
// Authorized default arena photo (same owned image as the signup/landing hero).
// The Featured card draws this behind the brand tint when an event has no
// per-event cover_image_url, so the hero is photographic, not a flat gradient.
const DEFAULT_HERO_PHOTO = '/onboarding-ice.jpg';

// Period number → broadcast label. Clock (period_time) is unreliable, so we show
// the period only — real data, never a fabricated stat.
function fmtPeriod(p) {
  if (!p) return null;
  if (p === 1) return '1ST';
  if (p === 2) return '2ND';
  if (p === 3) return '3RD';
  return p >= 4 ? 'OT' : null;
}

// ===========================================================================
// Event-Centric Home — the signed-in front door.
//
// A persona-aware TILE BOARD (not a text feed). Featured XRHL hero on top, then
// Live now / Your hockey / This week / Discover. Each layer is its own bounded
// query (see lib/home.js); personalized layers rise for members and collapse
// cleanly for cold users so the page is NEVER empty. Realtime (not polling)
// drives the live tiles.
// ===========================================================================
export default function Home({ currentUser, profile }) {
  const navigate = useNavigate();
  const role = useUserRole(currentUser?.id);
  const isOperator = role === 'commissioner' || role === 'manager';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const d = await loadHome(currentUser.id);
      setData(d);
      setError(false);
    } catch (e) {
      console.warn('[Home] load failed:', e?.message || e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // ── Narrow live re-load: a goal/score ping refreshes ONLY the live tiles
  // (ticker, live/upcoming games, the hero's LIVE flag) and MERGES them into the
  // existing state — the rest of the board (your-hockey, this-week, discover,
  // standings) is untouched, so there is no skeleton flash on a live update.
  // The full loadHome() only runs on mount / user change (via refresh above).
  const refreshLive = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const d = await loadHomeLive(currentUser.id);
      setData((prev) => {
        if (!prev) return prev; // nothing to merge into yet; the mount load will land
        return {
          ...prev,
          live: d.live,
          upcoming: d.upcoming,
          ticker: d.ticker,
          featured: prev.featured && d.featuredIsLive !== undefined
            ? { ...prev.featured, isLive: d.featuredIsLive }
            : prev.featured,
        };
      });
    } catch (e) {
      // A failed live refresh must never blank the board — keep the last good state.
      console.warn('[Home] live refresh failed:', e?.message || e);
    }
  }, [currentUser?.id]);

  // ── Realtime: subscribe to the user's followed events; re-run the NARROW live
  // load on a (debounced) change. No polling. Unsubscribe on unmount / id change.
  const follow = data?.followIds;
  const followKey = follow ? `${follow.tournamentIds.join(',')}|${follow.leagueIds.join(',')}` : '';
  useEffect(() => {
    if (!follow || (!follow.tournamentIds.length && !follow.leagueIds.length)) return undefined;
    let timer = null;
    const ping = () => { clearTimeout(timer); timer = setTimeout(refreshLive, 800); };
    const ch = supabase.channel(`home-${currentUser?.id || 'anon'}`);
    follow.tournamentIds.slice(0, 20).forEach((tid) => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${tid}` }, ping);
    });
    follow.leagueIds.slice(0, 20).forEach((lid) => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'league_games', filter: `league_id=eq.${lid}` }, ping);
    });
    ch.subscribe();
    return () => { clearTimeout(timer); try { supabase.removeChannel(ch); } catch { /* best-effort */ } };
  }, [followKey, currentUser?.id, follow, refreshLive]);

  return (
    <Layout profile={profile}>
      <style>{HOME_CSS}</style>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 32px' }}>

        {/* Persistent search — the navigation guarantee (reach anything in one tap) */}
        <SearchBar navigate={navigate} />

        {loading ? (
          <HomeSkeleton />
        ) : error ? (
          <div style={{ marginTop: 18, background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📡</div>
            <div style={{ ...type.sectionHead, color: C.ice, marginBottom: 6 }}>Couldn't load your home</div>
            <div style={{ color: C.steel, fontSize: 14, marginBottom: 16 }}>Your connection dropped. Your data is safe — try again.</div>
            <Button variant="secondary" size="sm" onClick={() => { setLoading(true); refresh(); }}>Retry</Button>
          </div>
        ) : (
          <>
            {/* Live ticker — the ESPN score-bug strip. Platform-wide, always-on
                when any public game is live, so the front door reads "alive"
                even to a cold viewer. */}
            {data.ticker?.length > 0 && <div className="home-in">{<LiveTicker games={data.ticker} navigate={navigate} />}</div>}

            {/* Operator on-ramp — leads ABOVE Featured for commissioners/managers */}
            {isOperator && <div className="home-in">{<OperatorBar navigate={navigate} />}</div>}

            {/* ⭐ FEATURED HERO — top of page (Pete override vs the design image).
                S03: staged entrance (fade + rise, one per section) — the hero
                leads, everything below follows at 40ms steps. Content is already
                loaded when these mount, so motion never delays paint. */}
            <div className="home-in"><FeaturedHero featured={data.featured} navigate={navigate} /></div>

            {/* LIVE NOW — only when a followed/rostered game is live */}
            {data.live.length > 0 && <div className="home-in" style={{ animationDelay: '40ms' }}><LiveNow games={data.live} navigate={navigate} /></div>}

            {/* YOUR HOCKEY — members; collapses to an invitation for cold users */}
            <div className="home-in" style={{ animationDelay: '80ms' }}>
              {data.hasFollows && data.your.teamCount > 0 ? (
                <YourHockey your={data.your} leader={data.leader} navigate={navigate} />
              ) : (
                <PickYourTeam navigate={navigate} />
              )}
            </div>

            {/* THIS WEEK — the temporal backbone (never empty: public events carry it) */}
            <div className="home-in" style={{ animationDelay: '120ms' }}>
              <ThisWeek upcoming={data.upcoming} events={data.publicEvents} navigate={navigate} />
            </div>

            {/* DISCOVER — an entry, not a wall */}
            <div className="home-in" style={{ animationDelay: '160ms' }}>
              <DiscoverRow navigate={navigate} cold={!data.hasFollows || data.your.teamCount === 0} />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// ─── Persistent search ───────────────────────────────────────────────────────
function SearchBar({ navigate }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    const q = term.trim();
    if (q.length < 2) { setResults(null); setBusy(false); return undefined; }
    setBusy(true);
    debRef.current = setTimeout(async () => {
      const r = await searchEverything(q);
      setResults(r); setBusy(false); setOpen(true);
    }, 220);
    return () => clearTimeout(debRef.current);
  }, [term]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (path) => { setOpen(false); setTerm(''); setResults(null); navigate(path); };
  const total = results ? results.players.length + results.teams.length + results.leagues.length + results.tournaments.length : 0;

  return (
    <div ref={boxRef} style={{ position: 'relative', zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, padding: '0 14px', height: 46 }}>
        <Icon name="discover" size={18} color={C.steel} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => { if (total) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Search teams, events, players"
          aria-label="Search teams, events, players"
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: C.ice, fontSize: 15, fontFamily: "'Barlow', sans-serif" }}
        />
        {term && (
          <button onClick={() => { setTerm(''); setResults(null); setOpen(false); }} aria-label="Clear search"
            style={{ background: 'none', border: 'none', color: C.steel, cursor: 'pointer', fontSize: 18, lineHeight: 1, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        )}
      </div>

      {open && term.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, background: ELEV, border: `1px solid ${C.border}`, borderRadius: radii.card, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', maxHeight: '60vh', overflowY: 'auto', padding: 6 }}>
          {busy && !results && <div style={{ padding: 14, color: C.steel, fontSize: 13 }}>Searching…</div>}
          {results && total === 0 && !busy && (
            <div style={{ padding: 16, color: C.steel, fontSize: 13, textAlign: 'center' }}>
              No matches for “{term.trim()}”. Try a team, league, or player name.
            </div>
          )}
          {results && (
            <>
              <SearchGroup label="Players" items={results.players} render={(p) => (
                <button key={p.id} onClick={() => go(`/profile/${p.id}`)} style={searchRow}>
                  <Avatar profile={p} size={30} />
                  <span style={searchName}>{p.name || `@${p.handle}`}</span>
                  {p.handle && <span style={searchMeta}>@{p.handle}</span>}
                </button>
              )} />
              <SearchGroup label="Teams" items={results.teams} render={(t) => (
                <button key={t.id} onClick={() => go(`/team/${t.id}`)} style={searchRow}>
                  <TeamLogo team={t} size={30} />
                  <span style={searchName}>{t.name}</span>
                </button>
              )} />
              <SearchGroup label="Leagues" items={results.leagues} render={(l) => (
                <button key={l.id} onClick={() => go(`/league/${l.id}`)} style={searchRow}>
                  <TeamLogo team={l} size={30} />
                  <span style={searchName}>{l.name}</span>
                  {l.season && <span style={searchMeta}>{l.season}</span>}
                </button>
              )} />
              <SearchGroup label="Tournaments" items={results.tournaments} render={(t) => (
                <button key={t.id} onClick={() => go(`/tournament/${t.id}`)} style={searchRow}>
                  <TeamLogo team={{ name: t.name, logo_url: t.logo_url }} size={30} />
                  <span style={searchName}>{t.name}</span>
                  {t.start_date && <span style={searchMeta}>{fmtEventDate(t.start_date)}</span>}
                </button>
              )} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const searchRow = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: C.ice, padding: '9px 10px', borderRadius: 8, minHeight: 44, fontFamily: "'Barlow', sans-serif" };
const searchName = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const searchMeta = { flexShrink: 0, fontSize: 12, color: C.steel, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function SearchGroup({ label, items, render }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.steel, padding: '8px 10px 4px' }}>{label}</div>
      {items.map(render)}
    </div>
  );
}

// ─── Operator on-ramp ────────────────────────────────────────────────────────
function OperatorBar({ navigate }) {
  return (
    <section style={{ marginTop: 18 }}>
      <SectionHeader label="Manage your leagues & tournaments" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ManageCard label="Your leagues" sub="Run a season" onClick={() => navigate('/leagues')} icon="leagues" />
        <ManageCard label="Your tournaments" sub="Run an event" onClick={() => navigate('/tournaments')} icon="bracket" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Button variant="primary" size="sm" fullWidth onClick={() => navigate('/league/create')}>+ Create league</Button>
        <Button variant="secondary" size="sm" fullWidth onClick={() => navigate('/tournament/create')}>+ Create tournament</Button>
      </div>
    </section>
  );
}
function ManageCard({ label, sub, onClick, icon }) {
  return (
    <button onClick={onClick} className="home-tap" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '12px 14px', cursor: 'pointer', minHeight: 44, color: C.ice }}>
      <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: 'rgba(46,91,140,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon === 'leagues' ? 'analytics' : 'gamePuck'} size={18} color={C.ice} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: C.steel }}>{sub}</span>
      </span>
    </button>
  );
}

// ─── Featured hero (XRHL) ────────────────────────────────────────────────────
function FeaturedHero({ featured, navigate }) {
  if (!featured) return null;
  const bg = featured.logo_color || C.blue;
  const photo = featured.cover_image_url || DEFAULT_HERO_PHOTO;
  return (
    <section style={{ marginTop: 18 }}>
      <SectionHeader label="Featured" live={featured.isLive} accessory={featured.isLive ? <span style={{ ...type.sectionHead, fontSize: 13, color: C.red }}>LIVE</span> : null} />
      <button
        onClick={() => navigate(featured.href)}
        className="home-tap"
        style={{
          position: 'relative', width: '100%', textAlign: 'left', cursor: 'pointer',
          border: featured.isLive ? `1px solid ${C.red}` : `1px solid ${C.border}`,
          boxShadow: featured.isLive ? '0 8px 32px rgba(215,38,56,0.2)' : '0 8px 24px rgba(46,91,140,0.35)',
          borderRadius: radii.hero, overflow: 'hidden', padding: 0, background: ELEV,
        }}
      >
        {/* Real arena photo behind the text ("gradients must be earned"). The
            brand-color container shows through if the image fails (onError hides
            it), so a cold viewer never sees a broken image. A dark scrim keeps
            the white type legible over any photo. */}
        <div style={{ position: 'relative', minHeight: 168, overflow: 'hidden', background: bg }}>
          <img
            src={photo} alt="" loading="eager"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          {/* Brand tint at top → dark scrim at bottom for legibility. */}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg}B3 0%, rgba(7,17,31,0.35) 45%, rgba(7,17,31,0.92) 100%)` }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 14, padding: 16, minHeight: 168 }}>
            <div style={{ flexShrink: 0 }}>
              <TeamLogo team={{ logo_url: featured.logo_url, logo_color: 'rgba(11,31,58,0.6)', logo_initials: featured.logo_initials || (featured.name || '?').slice(0, 4).toUpperCase(), name: featured.name }} size={64} radius={10} style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(244,247,250,0.85)', fontFamily: "'Barlow Condensed', sans-serif", textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {featured.type === 'league' ? 'Featured league' : 'Featured event'}
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1.02, color: '#fff', margin: '2px 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', textShadow: '0 2px 8px rgba(0,0,0,0.55)' }}>
                {featured.name}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{featured.subtitle}</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: ELEV }}>
          <span style={{ fontSize: 12, color: C.steel }}>{featured.isLive ? 'Game in progress — tap to watch it live' : 'Tap to follow the action'}</span>
          <span style={{ ...type.sectionHead, fontSize: 13, color: C.ice }}>OPEN →</span>
        </div>
      </button>
    </section>
  );
}

// ─── Live ticker (top score-bug strip) ───────────────────────────────────────
// Broadcast score-bug cards: 2–3 char team abbreviation + score, a red period
// pill, and a red accent spine on the left — the TV-bug read. Live games only
// (the "alive" signal); finals live in the surfaces below, not the ticker.
function LiveTicker({ games, navigate }) {
  return (
    <div className="home-rail" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '14px 0 2px', paddingBottom: 4 }}>
      {games.map((g) => {
        const per = fmtPeriod(g.period);
        const lead = (g.home?.score ?? 0) >= (g.away?.score ?? 0);
        return (
          <button key={`${g.source}-${g.id}`} onClick={() => navigate(g.url)} className="home-tap"
            style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', cursor: 'pointer', background: C.card, border: `1px solid ${C.red}55`, borderLeft: `3px solid ${C.red}`, borderRadius: 8, padding: '7px 11px 8px', minWidth: 124 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
              <span className="home-live-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: C.red, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic' }}>{per ? `LIVE · ${per}` : 'LIVE'}</span>
            </span>
            <TickerLine abbr={g.home?.abbr} score={g.home?.score} bold={lead} />
            <TickerLine abbr={g.away?.abbr} score={g.away?.score} bold={!lead && (g.away?.score ?? 0) > (g.home?.score ?? 0)} />
          </button>
        );
      })}
    </div>
  );
}
function TickerLine({ abbr, score, bold }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, minWidth: 0 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 14, letterSpacing: '0.03em', color: bold ? C.ice : 'rgba(244,247,250,0.78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{abbr || 'TBD'}</span>
      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: bold ? C.ice : 'rgba(244,247,250,0.78)', fontVariantNumeric: 'tabular-nums' }}>{score ?? 0}</span>
    </div>
  );
}

// ─── Live now ────────────────────────────────────────────────────────────────
function LiveNow({ games, navigate }) {
  const [hero, ...rest] = games;
  return (
    <section style={{ marginTop: 22 }}>
      <SectionHeader label="Live Now" live accessory={<span style={{ ...type.sectionHead, fontSize: 14, color: C.ice }}>{games.length}</span>} />
      <LiveHeroCard game={hero} navigate={navigate} />
      {rest.length > 0 && (
        <div className="home-rail" style={{ display: 'flex', gap: 10, overflowX: 'auto', marginTop: 10, paddingBottom: 4 }}>
          {rest.map((g) => <LiveChip key={`${g.source}-${g.id}`} game={g} navigate={navigate} />)}
        </div>
      )}
    </section>
  );
}

function ordinal(n) {
  if (n == null) return null;
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// "14-3-1 · 2nd in Empire" — record + division standing, from real standings.
function recordLine(rec) {
  if (!rec) return null;
  const wlt = `${rec.wins}-${rec.losses}-${rec.ties}${rec.otl ? `-${rec.otl}` : ''}`;
  const place = rec.rank ? `${ordinal(rec.rank)} in ${rec.division || 'division'}` : null;
  return place ? `${wlt} · ${place}` : wlt;
}

function LiveHeroCard({ game, navigate }) {
  // Progressive: paint the score instantly, hydrate records + last goal after.
  const [extras, setExtras] = useState(null);
  useEffect(() => {
    let alive = true;
    getLiveHeroExtras(game).then((x) => { if (alive) setExtras(x); }).catch(() => {});
    return () => { alive = false; };
  }, [game?.id, game?.source]);

  const lastGoal = extras?.lastGoal || null;
  // Show-only-when-present broadcast flourishes — Rinkd doesn't track these yet,
  // so they render ONLY if a real value is on the game row (never fabricated).
  const clock = game.clock || null;
  // Shot share only when there's real shot data AND a non-zero total (a 0–0
  // shot line is "unknown", not "even" — never render an empty 50/50 bar).
  const sog = (game.shotsHome != null && game.shotsAway != null && (game.shotsHome + game.shotsAway) > 0)
    ? { h: game.shotsHome, a: game.shotsAway } : null;
  const watching = (game.watching != null) ? game.watching : null;
  const per = fmtPeriod(game.period);

  return (
    <button onClick={() => navigate(game.gameUrl)} className="home-tap" style={{
      width: '100%', textAlign: 'left', cursor: 'pointer', background: ELEV,
      border: `1px solid ${C.red}`, borderRadius: radii.hero, padding: 16,
      boxShadow: '0 8px 32px rgba(215,38,56,0.2)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.steel, fontFamily: "'Barlow Condensed', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{game.eventName}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span className="home-live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: C.red, flexShrink: 0 }} />
          <span style={{ ...type.sectionHead, fontSize: 13, color: C.red }}>{per ? `${per} · LIVE` : 'LIVE'}{clock ? ` · ${clock}` : ''}</span>
        </span>
      </div>
      <TeamScoreRow logoUrl={game.home?.logoUrl} name={game.home?.name} record={recordLine(extras?.homeRecord)} score={game.homeScore} />
      <div style={{ height: 10 }} />
      <TeamScoreRow logoUrl={game.away?.logoUrl} name={game.away?.name} record={recordLine(extras?.awayRecord)} score={game.awayScore} />

      {sog && <ShotShareBar home={sog.h} away={sog.a} />}

      {(lastGoal || watching != null) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
          {lastGoal ? (
            <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 7, overflow: 'hidden' }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: C.red, fontFamily: "'Barlow Condensed', sans-serif", flexShrink: 0 }}>LAST GOAL</span>
              <span style={{ fontSize: 12.5, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900 }}>#{lastGoal.jersey}</b>
                {lastGoal.name ? ` ${lastGoal.name}` : ''}
                {(fmtPeriod(lastGoal.period) || lastGoal.time) ? ` · ${[fmtPeriod(lastGoal.period), lastGoal.time].filter(Boolean).join(' ')}` : ''}
                {lastGoal.en ? ' · EN' : ''}
              </span>
            </span>
          ) : <span />}
          {watching != null && (
            <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.steel }}>
              <span className="home-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: C.steel }} />{watching.toLocaleString()} watching
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// SOG split bar — red (home) vs blue (away). Only rendered when real shot data
// exists on the game (see LiveHeroCard); never shown on zeros-as-unknown.
function ShotShareBar({ home, away }) {
  const total = (home || 0) + (away || 0);
  const homePct = total > 0 ? Math.round((home / total) * 100) : 50;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.ice, fontFamily: "'Barlow Condensed', sans-serif" }}>SOG {home}</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>SHOT SHARE</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.ice, fontFamily: "'Barlow Condensed', sans-serif" }}>{away}</span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(7,17,31,0.6)' }}>
        <span style={{ width: `${homePct}%`, background: C.red }} />
        <span style={{ flex: 1, background: C.blue }} />
      </div>
    </div>
  );
}

function TeamScoreRow({ logoUrl, name, record, score }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <TeamLogo team={{ logo_url: logoUrl, name }} size={40} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Barlow', sans-serif", lineHeight: 1.1 }}>{name || 'TBD'}</span>
        {record && <span style={{ display: 'block', fontSize: 11.5, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{record}</span>}
      </span>
      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 38, lineHeight: 1, color: C.ice, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{score ?? 0}</span>
    </div>
  );
}

function LiveChip({ game, navigate }) {
  return (
    <button onClick={() => navigate(game.gameUrl)} className="home-tap" style={{ flexShrink: 0, width: 168, textAlign: 'left', cursor: 'pointer', background: C.card, border: `1px solid ${C.red}55`, borderRadius: radii.card, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span className="home-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: C.red }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.red, fontFamily: "'Barlow Condensed', sans-serif" }}>{fmtPeriod(game.period) ? `${fmtPeriod(game.period)} · LIVE` : 'LIVE'}</span>
      </div>
      <ChipTeam name={game.home?.name} score={game.homeScore} />
      <ChipTeam name={game.away?.name} score={game.awayScore} />
    </button>
  );
}
function ChipTeam({ name, score }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'TBD'}</span>
      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>{score ?? 0}</span>
    </div>
  );
}

// ─── Your hockey ─────────────────────────────────────────────────────────────
function YourHockey({ your, leader, navigate }) {
  const { next, recentFinals } = your;
  const nothing = !next.length && !recentFinals.length && !leader;
  return (
    <section style={{ marginTop: 22 }}>
      <SectionHeader label="Your Hockey" />
      {next.length > 0 && (
        <div>
          <RailLabel>Next up</RailLabel>
          {next.map((g) => <NextGameRow key={`${g._source}-${g.id}`} g={g} navigate={navigate} />)}
        </div>
      )}
      {/* Inline fan vote — only renders when the latest final has an open puck. */}
      {recentFinals[0] && <div style={{ marginTop: 12 }}><HomeGamePuck final={recentFinals[0]} navigate={navigate} /></div>}
      {/* Glance pair — the latest final result beside the league leader. */}
      {(leader || recentFinals[0]) && (
        <div style={{ marginTop: 12 }}>
          <GlanceRow leader={leader} final={recentFinals[0]} navigate={navigate} />
        </div>
      )}
      {recentFinals.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <RailLabel>Recent finals</RailLabel>
          {recentFinals.slice(1).map((f) => (
            f.hasRecap
              ? <div key={`${f.source}-${f.id}`} style={{ marginBottom: 10 }}><RecapCard gameId={f.id} source="league" /></div>
              : <FinalRow key={`${f.source}-${f.id}`} f={f} />
          ))}
        </div>
      )}
      {nothing && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: 18, color: C.steel, fontSize: 14 }}>
          No games on the board yet for your teams. New games show up here the moment they're scheduled.
        </div>
      )}
    </section>
  );
}

// Inline Game Puck "vote live" — top candidates with % bars for a recently-final
// game whose fan vote is still open. Self-guarding: renders nothing until the
// game has votes (so it never shows an empty board). Tapping opens the game to
// cast a vote. Names resolve from the game lineup (jersey-keyed).
function HomeGamePuck({ final, navigate }) {
  const kind = final.source === 'league' ? 'league' : 'tournament';
  const href = final.source === 'league' ? `/league-game/${final.id}?type=league` : `/game/${final.id}`;
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [tally, lu] = await Promise.all([
          getGamePuck(final.id, kind),
          supabase.from('game_lineups').select('team_id,jersey_number,invite_name').eq('game_id', final.id),
        ]);
        if (!alive) return;
        if (!tally.total) { setData({ total: 0, rows: [] }); return; }
        const nameOf = (tid, j) => (lu.data || []).find((x) => x.team_id === tid && x.jersey_number === j)?.invite_name || null;
        const rows = tally.rows.slice(0, 3).map((r) => ({ ...r, name: nameOf(r.team_id, r.jersey), pct: Math.round((r.votes / tally.total) * 100) }));
        setData({ total: tally.total, rows });
      } catch { if (alive) setData({ total: 0, rows: [] }); }
    })();
    return () => { alive = false; };
  }, [final.id, kind]);

  if (!data || !data.total) return null;

  return (
    <button onClick={() => navigate(href)} className="home-tap" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.red }}>
          <PuckMark size={16} /> Game Puck · Vote Live
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.steel }}>{data.total.toLocaleString()} votes</span>
      </div>
      {data.rows.map((r, i) => (
        <div key={`${r.team_id}-${r.jersey}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, overflow: 'hidden', marginBottom: i < data.rows.length - 1 ? 6 : 0, background: 'rgba(7,17,31,0.4)' }}>
          {/* % fill bar — leader in red, the rest in steel-blue. */}
          <span className="home-puck-fill" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r.pct}%`, background: i === 0 ? 'rgba(215,38,56,0.28)' : 'rgba(46,91,140,0.3)' }} />
          <span style={{ position: 'relative', flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: i === 0 ? C.red : 'rgba(46,91,140,0.5)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 12 }}>{r.jersey}</span>
          <span style={{ position: 'relative', minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || `#${r.jersey}`}</span>
            {i === 0 && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: C.red, fontFamily: "'Barlow Condensed', sans-serif" }}>LEADING</span>}
          </span>
          <span style={{ position: 'relative', flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice, fontVariantNumeric: 'tabular-nums' }}>{r.pct}<span style={{ fontSize: 11 }}>%</span></span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 9, fontSize: 11, color: C.steel }}>
        <Icon name="gameReminder" size={12} color={C.steel} /> Tap to vote · closes at the final whistle
      </div>
    </button>
  );
}

// Compact glance pair (mockup: a recent FINAL · RECAP beside the LEAGUE LEADER).
// Either side can stand alone; together they form a 2-up row.
function GlanceRow({ leader, final, navigate }) {
  if (!leader && !final) return null;
  const two = leader && final;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: two ? '1fr 1fr' : '1fr', gap: 10 }}>
      {final && <FinalMini f={final} navigate={navigate} />}
      {leader && <LeaderMini leader={leader} navigate={navigate} />}
    </div>
  );
}

function FinalMini({ f, navigate }) {
  const myScore = f.isHome ? f.homeScore : f.awayScore;
  const oppScore = f.isHome ? f.awayScore : f.homeScore;
  const win = (myScore ?? 0) > (oppScore ?? 0);
  const tie = (myScore ?? 0) === (oppScore ?? 0);
  const resColor = tie ? C.steel : win ? colors.success : C.red;
  const resLabel = tie ? 'T' : win ? 'W' : 'L';
  const href = f.source === 'league' ? `/league-game/${f.id}?type=league` : null;
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', color: C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>FINAL{f.hasRecap ? ' · RECAP' : ''}</span>
        <span style={{ width: 20, height: 20, borderRadius: 5, background: `${resColor}22`, color: resColor, fontWeight: 800, fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif" }}>{resLabel}</span>
      </div>
      <ScoreLine name={f.teamName} score={myScore} bold={win} />
      <ScoreLine name={f.opponent} score={oppScore} bold={!win && !tie} />
    </>
  );
  const style = { width: '100%', textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '12px 14px' };
  return href
    ? <button onClick={() => navigate(href)} className="home-tap" style={{ ...style, cursor: 'pointer' }}>{inner}</button>
    : <div style={style}>{inner}</div>;
}
function ScoreLine({ name, score, bold }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
      <span style={{ minWidth: 0, fontSize: 13, fontWeight: bold ? 700 : 500, color: bold ? C.ice : 'rgba(244,247,250,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'TBD'}</span>
      <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: bold ? C.ice : 'rgba(244,247,250,0.75)', fontVariantNumeric: 'tabular-nums' }}>{score ?? 0}</span>
    </div>
  );
}

function LeaderMini({ leader, navigate }) {
  return (
    <button onClick={() => navigate(`/league/${leader.leagueId}`)} className="home-tap" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'rgba(201,168,76,0.08)', border: `1px solid ${GOLD}66`, borderRadius: radii.card, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <Icon name="milestone" size={13} color={GOLD} />
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD, fontFamily: "'Barlow Condensed', sans-serif" }}>League leader</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, color: GOLD, lineHeight: 1 }}>{leader.pts}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: GOLD, fontFamily: "'Barlow Condensed', sans-serif" }}>PTS</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, minWidth: 0 }}>
        <TeamLogo team={leader.logo} size={22} />
        <span style={{ minWidth: 0, fontSize: 13, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leader.teamName}</span>
      </span>
    </button>
  );
}

// Relative day label for the upcoming-game chip ("TODAY" / "TOMORROW" / "IN 3 DAYS").
function relDayLabel(dt) {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d1 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const days = Math.round((d1 - d0) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMORROW';
  if (days <= 14) return `IN ${days} DAYS`;
  return null;
}

function NextGameRow({ g, navigate }) {
  const href = g._source === 'league' ? `/league-game/${g.id}?type=league` : `/team/${g._teamId}`;
  const dt = g.start_time ? new Date(g.start_time) : null;
  const day = dt ? dt.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() : '';
  const dnum = dt ? dt.getDate() : '';
  const time = dt ? dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M/i, (_, p) => p.toLowerCase()) : '';
  const rel = dt ? relDayLabel(dt) : null;
  const level = g._level || g._league_name || null;
  // D1 — GAME DAY elevation. When the next game is today, the row goes from a
  // schedule read to an urgency moment: red spine + "GAME DAY" label + puck-drop
  // line. Red = urgency/live per the manifesto (gold stays scarce). Static
  // treatment only — no animation to gate.
  const isGameDay = rel === 'TODAY';

  // D3 — season series, only for the game-day league row. team_games carry no
  // opponent team id, so head-to-head is only queryable for league games; and we
  // fetch lazily for the TODAY row alone to keep Home cheap. Non-blocking: renders
  // when it lands, and we reserve a fixed-height line so there's no layout shift.
  const canSeries = isGameDay && g._source === 'league' && g.home_team_id && g.away_team_id;
  const [series, setSeries] = useState(null);
  useEffect(() => {
    if (!canSeries) return;
    let alive = true;
    getHeadToHead({ source: 'league', home: { id: g.home_team_id }, away: { id: g.away_team_id } })
      .then((r) => { if (alive) setSeries(r); })
      .catch(() => { /* silent — a missing series just leaves the reserved line blank */ });
    return () => { alive = false; };
  }, [canSeries, g.home_team_id, g.away_team_id]);
  // From the viewer's team perspective: home_team_id is "home" in the record.
  const myWins = series ? (g.is_home ? series.homeWins : series.awayWins) : 0;
  const oppWins = series ? (g.is_home ? series.awayWins : series.homeWins) : 0;
  const seriesLabel = series && series.played > 0 ? `Season series ${myWins}–${oppWins}${series.ties ? ` · ${series.ties} T` : ''}` : null;

  return (
    <button onClick={() => navigate(href)} className="home-tap" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'stretch', gap: 0, background: C.card, border: isGameDay ? `1px solid ${C.red}66` : `1px solid ${C.border}`, borderLeft: isGameDay ? `3px solid ${C.red}` : `1px solid ${C.border}`, borderRadius: radii.card, padding: 0, marginBottom: 8, overflow: 'hidden' }}>
      {/* Big date block — the broadcast schedule read. */}
      <span style={{ flexShrink: 0, width: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, padding: '12px 6px', background: isGameDay ? `${C.red}1f` : 'rgba(46,91,140,0.18)', borderRight: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: isGameDay ? C.red : C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>{day}</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 26, lineHeight: 1, color: C.ice }}>{dnum}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.steel, fontFamily: "'Barlow Condensed', sans-serif" }}>{time}</span>
      </span>
      <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '11px 12px' }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', color: isGameDay ? C.red : C.steel, fontFamily: "'Barlow Condensed', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isGameDay ? 'GAME DAY' : 'NEXT GAME'}{level ? ` · ${level}` : ''}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {g._team?.name || 'My team'} <span style={{ color: C.steel, fontWeight: 400 }}>{g.is_home ? 'vs' : '@'}</span> {g.opponent || 'TBD'}
        </span>
        {canSeries && (
          <span style={{ minHeight: 15, fontSize: 12, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seriesLabel || ' '}</span>
        )}
        {g.location && (
          <MapLink text={g.location} icon="" style={{ fontSize: 12, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }} />
        )}
        {isGameDay ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', color: C.red, background: `${C.red}1a`, border: `1px solid ${C.red}59`, borderRadius: 5, padding: '2px 7px', fontFamily: "'Barlow Condensed', sans-serif" }}>
            <Icon name="gameReminder" size={11} color={C.red} />{time ? `PUCK DROPS ${time.toUpperCase()}` : 'PUCK DROPS SOON'}
          </span>
        ) : rel && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: C.steel, background: 'rgba(139,163,190,0.12)', border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 7px', fontFamily: "'Barlow Condensed', sans-serif" }}>
            <Icon name="gameReminder" size={11} color={C.steel} />{rel}
          </span>
        )}
      </span>
      <span style={{ flexShrink: 0, alignSelf: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 20, paddingRight: 12 }}>›</span>
    </button>
  );
}

function FinalRow({ f }) {
  const myScore = f.isHome ? f.homeScore : f.awayScore;
  const oppScore = f.isHome ? f.awayScore : f.homeScore;
  const win = (myScore ?? 0) > (oppScore ?? 0);
  const tie = (myScore ?? 0) === (oppScore ?? 0);
  const resColor = tie ? C.steel : win ? colors.success : C.red;
  const resLabel = tie ? 'T' : win ? 'W' : 'L';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '11px 14px', marginBottom: 8 }}>
      <TeamLogo team={f.teamLogo || { name: f.teamName }} size={34} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {f.teamName} <span style={{ color: C.steel, fontWeight: 400 }}>{f.isHome ? 'vs' : '@'}</span> {f.opponent}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: C.steel }}>Final{f.leagueName ? ` · ${f.leagueName}` : ''}</span>
      </span>
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice }}>{myScore ?? 0}–{oppScore ?? 0}</span>
        <span style={{ width: 22, height: 22, borderRadius: 5, background: `${resColor}22`, color: resColor, fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif" }}>{resLabel}</span>
      </span>
    </div>
  );
}

// ─── Pick your team (cold user) ──────────────────────────────────────────────
function PickYourTeam({ navigate }) {
  return (
    <section style={{ marginTop: 22 }}>
      <SectionHeader label="Your Hockey" />
      <div style={{ background: ELEV, border: `1px solid ${C.border}`, borderRadius: radii.hero, padding: '26px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🏒</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 24, color: C.ice, lineHeight: 1.05 }}>Pick your team.<br />The arena fills in.</div>
        <div style={{ fontSize: 14, color: C.steel, margin: '8px auto 18px', maxWidth: 320, lineHeight: 1.5 }}>Follow your team, league, or event and your live games, scores, and recaps all land right here.</div>
        <Button variant="primary" size="md" onClick={() => navigate('/discover')}>Find your team</Button>
        <div style={{ marginTop: 14 }}>
          <button onClick={() => navigate(`/league/${DEMO_LEAGUE_ID}`)} style={{ background: 'none', border: 'none', color: C.steel, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', fontFamily: "'Barlow', sans-serif" }}>
            Or take a look around a live league →
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── This week ───────────────────────────────────────────────────────────────
function ThisWeek({ upcoming, events, navigate }) {
  const tiles = [];
  (upcoming || []).forEach((g) => tiles.push({ kind: 'game', g }));
  // De-dupe public events that the user already sees via their own upcoming games.
  const seen = new Set((upcoming || []).map((g) => g.eventId));
  (events || []).forEach((e) => { if (!seen.has(e.id)) tiles.push({ kind: 'event', e }); });
  if (!tiles.length) return null;

  return (
    <section style={{ marginTop: 22 }}>
      <SectionHeader label="This Week" />
      <div className="home-rail" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
        {tiles.slice(0, 12).map((t) => t.kind === 'game'
          ? <GameTile key={`g-${t.g.source}-${t.g.id}`} g={t.g} navigate={navigate} />
          : <EventTile key={`e-${t.e.id}`} e={t.e} navigate={navigate} />)}
      </div>
    </section>
  );
}

// Tile-art gradients encode the EVENT CATEGORY (this is meaning, not decoration —
// a fan reads "tournament" vs "game" at a glance): game = rink-navy, tournament =
// deep green, community = teal. Dark, on-tone, and confined to the tile header.
const TILE_GRADIENT = {
  tournament: 'linear-gradient(135deg, #15543b 0%, #0b3326 100%)',
  community:  'linear-gradient(135deg, #14464f 0%, #0a2a33 100%)',
  game:       'linear-gradient(135deg, #16365e 0%, #0c2747 100%)',
};
// Gradient "art" header for a schedule tile — category tone + a faint watermark,
// with the time/date chip floated over it. Pure CSS (no data).
function TileArt({ variant, chip }) {
  const grad = TILE_GRADIENT[variant] || TILE_GRADIENT.game;
  return (
    <div style={{ position: 'relative', height: 70, background: grad, overflow: 'hidden' }}>
      {/* Face-off-dot / bracket watermark — concentric rings via radial gradients. */}
      <div style={{ position: 'absolute', right: -18, bottom: -18, width: 92, height: 92, borderRadius: '50%', background: 'radial-gradient(circle, transparent 30%, rgba(244,247,250,0.08) 31%, rgba(244,247,250,0.08) 34%, transparent 35%, transparent 52%, rgba(244,247,250,0.06) 53%, rgba(244,247,250,0.06) 56%, transparent 57%)' }} />
      {variant === 'tournament' && <Icon name="build" size={26} color="rgba(244,247,250,0.18)" style={{ position: 'absolute', left: 12, bottom: 10 }} />}
      {chip && (
        <span style={{ position: 'absolute', top: 8, left: 8, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 11, letterSpacing: '0.04em', color: '#fff', background: 'rgba(7,17,31,0.55)', borderRadius: 5, padding: '3px 8px', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{chip}</span>
      )}
    </div>
  );
}

function GameTile({ g, navigate }) {
  return (
    <button onClick={() => navigate(g.gameUrl)} className="home-tap" style={tileStyle}>
      <TileArt variant="game" chip={fmtGameWhen(g.startTime)} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 12 }}>
        <TileTeam name={g.home?.name} />
        <div style={{ fontSize: 11, color: C.steel, margin: '1px 0' }}>vs</div>
        <TileTeam name={g.away?.name} />
        <div style={{ marginTop: 'auto', paddingTop: 10, fontSize: 11, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.eventName}</div>
      </div>
    </button>
  );
}
function TileTeam({ name }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'TBD'}</div>;
}

function EventTile({ e, navigate }) {
  return (
    <button onClick={() => navigate(e.href)} className="home-tap" style={tileStyle}>
      <TileArt variant="tournament" chip={e.startDate ? fmtEventDate(e.startDate) : 'SOON'} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ice, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.25 }}>{e.name}</div>
        <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 11, color: C.steel }}>Tournament</div>
      </div>
    </button>
  );
}

const tileStyle = { flexShrink: 0, width: 176, minHeight: 158, display: 'flex', flexDirection: 'column', textAlign: 'left', cursor: 'pointer', background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: 0, overflow: 'hidden' };

function RailLabel({ children }) {
  return <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.steel, marginBottom: 8 }}>{children}</div>;
}

// ─── Discover ────────────────────────────────────────────────────────────────
function DiscoverRow({ navigate, cold }) {
  return (
    <section style={{ marginTop: 22 }}>
      <SectionHeader label="Discover" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <DiscoverCard label="Browse leagues" onClick={() => navigate('/leagues')} icon="analytics" />
        <DiscoverCard label="Browse tournaments" onClick={() => navigate('/tournaments')} icon="gamePuck" />
        <DiscoverCard label="Find players & teams" onClick={() => navigate('/discover')} icon="discover" />
        <DiscoverCard label="Around hockey" sub="The global feed" onClick={() => navigate('/feed')} icon="fan" />
      </div>
      {cold && (
        <button onClick={() => navigate(`/league/${DEMO_LEAGUE_ID}`)} className="home-tap" style={{ width: '100%', marginTop: 10, textAlign: 'left', cursor: 'pointer', background: 'rgba(46,91,140,0.18)', border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '12px 14px', color: C.ice, fontSize: 14, fontWeight: 600 }}>
          New here? Tour a live league to see Rinkd in action →
        </button>
      )}
    </section>
  );
}
function DiscoverCard({ label, sub, onClick, icon }) {
  return (
    <button onClick={onClick} className="home-tap" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: radii.card, padding: '12px 14px', cursor: 'pointer', minHeight: 44, color: C.ice }}>
      <span style={{ flexShrink: 0 }}><Icon name={icon} size={18} color={C.steel} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: C.steel }}>{sub}</span>}
      </span>
    </button>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
// Mirrors the real first fold EXACTLY (S03 perceived-speed rule: zero layout
// shift on hydrate): Featured header stub + hero (168px photo + 44px footer bar),
// then Your Hockey header + two next-game rows (86px incl. margin), then the
// This Week rail at true tile size. Copy lives in the header stubs — brand
// loading language, never "Loading…".
function HomeSkeleton() {
  return (
    <div aria-hidden>
      <SkHeader text="Getting the ice ready." top={18} />
      <div style={{ borderRadius: radii.hero, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <Sk h={168} r={0} />
        <div style={{ height: 1 }} />
        <Sk h={43} r={0} />
      </div>
      <SkHeader text="Warming up." top={22} />
      <Sk h={78} /><div style={{ height: 8 }} /><Sk h={78} />
      <SkHeader text="Dropping the puck." top={22} />
      <div style={{ display: 'flex', gap: 12, overflow: 'hidden' }}>
        <Sk h={158} w={176} /><Sk h={158} w={176} /><Sk h={158} w={176} />
      </div>
    </div>
  );
}
// Header stub at SectionHeader's real height, carrying the intermission copy.
function SkHeader({ text, top }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: `${top}px 0 10px` }}>
      <Sk h={18} w={110} r={4} />
      <span style={{ fontSize: 11, color: C.steel, fontFamily: "'Barlow', sans-serif", opacity: 0.7 }}>{text}</span>
    </div>
  );
}
function Sk({ h, w, r }) {
  return <div className="home-sk" style={{ height: h, width: w || '100%', borderRadius: r != null ? r : radii.card, background: C.card, flexShrink: 0 }} />;
}

const HOME_CSS = `
@keyframes home-enter { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
.home-in { animation: home-enter ${motion.duration.entrance}ms ${motion.easing.out} both; }
.home-tap { transition: transform 0.1s ease, box-shadow 0.15s ease; }
.home-tap:active { transform: scale(0.98); }
.home-rail { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.home-rail::-webkit-scrollbar { display: none; }
@keyframes home-live-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.85); } }
.home-live-dot { animation: home-live-pulse 1.5s ease-in-out infinite; }
@keyframes home-sk-shimmer { 0% { opacity: 0.55; } 50% { opacity: 0.85; } 100% { opacity: 0.55; } }
.home-sk { animation: home-sk-shimmer 1.4s ease-in-out infinite; }
.home-puck-fill { transition: width 0.4s ease; }
@media (prefers-reduced-motion: reduce) {
  .home-in { animation: none; }
  .home-tap:active { transform: none; }
  .home-live-dot, .home-sk { animation: none !important; }
  .home-puck-fill { transition: none !important; }
}
`;
