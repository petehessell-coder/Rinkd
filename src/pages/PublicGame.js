import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { teamInitials } from '../lib/teamInitials';
import SEO from '../components/SEO';
import ShareButton from '../components/ShareButton';
import { loadGameCardData } from '../lib/gameCardData';
import {
  isPublicSharingEnabled, areScorersHidden, isParentPublic, gameAppUrl, getRecapSponsor,
} from '../lib/publicShare';

// GROWTH-SHARE-1 · M1 — the login-less public game/recap page. NO <Layout>, no
// auth, no writes. Reads game + box score as the anon role (RLS verified open:
// games/league_games/game_goals/game_penalties/game_lineups are all qual=true).
// Tournament games mount at /g/:id, league games at /lg/:id (league prop).
//
// Deliberately a SEPARATE component from the protected GameDetail — that page is
// auth-chromed and adjacent to the frozen pilot surface. This one is additive.

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', ink:'#030C15', card:'#0f2847', border:'rgba(46,91,140,0.4)' };

const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';

function TeamMark({ team, size = 76 }) {
  const initials = (team.logo_initials || teamInitials(team.name, 2) || '?').slice(0, 3).toUpperCase();
  // logo_url is same-origin (/team-logos/*) or Supabase — safe in an <img>.
  if (team.logo_url) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: '#fff', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.4)', flexShrink: 0 }}>
        <img src={team.logo_url} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: team.color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.4, color: '#fff', flexShrink: 0, border: '2px solid rgba(255,255,255,0.16)' }}>
      {initials}
    </div>
  );
}

export default function PublicGame({ league }) {
  const { gameId } = useParams();
  const isLeague = !!league;

  const [state, setState] = useState({ loading: true, game: null, parent: null, blocked: false });
  const [goals, setGoals] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [lineupByTeam, setLineupByTeam] = useState({});

  const load = useCallback(async () => {
    try {
      let g = null, parent = null;
      if (isLeague) {
        const { data } = await supabase.from('league_games')
          .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), rink:rinks(name,sub_rink), league:leagues(id,name,logo_url,accent_color,is_public,settings)')
          .eq('id', gameId).maybeSingle();
        g = data; parent = data?.league || null;
      } else {
        const { data } = await supabase.from('games')
          .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,seed,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,seed,logo_url), rink:rinks(name,sub_rink), tournament:tournaments(id,name,division,logo_url,accent_color,status,settings)')
          .eq('id', gameId).maybeSingle();
        g = data; parent = data?.tournament || null;
      }

      if (!g) { setState({ loading: false, game: null, parent: null, blocked: false }); return; }

      // Guard: parent event must be public AND sharing not disabled (youth default-off).
      const visible = isParentPublic({ isLeague, league: parent, tournament: parent }) && isPublicSharingEnabled(parent?.settings);
      if (!visible) { setState({ loading: false, game: g, parent, blocked: true }); return; }

      const [{ data: gl }, { data: pl }, { data: lu }] = await Promise.all([
        supabase.from('game_goals').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
        supabase.from('game_penalties').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
        supabase.from('game_lineups').select('team_id, jersey_number, invite_name').eq('game_id', gameId),
      ]);
      setGoals(gl || []);
      setPenalties(pl || []);
      const lookup = {};
      (lu || []).forEach(row => {
        if (row.jersey_number == null) return;
        (lookup[row.team_id] = lookup[row.team_id] || {})[row.jersey_number] = row.invite_name || null;
      });
      setLineupByTeam(lookup);
      setState({ loading: false, game: g, parent, blocked: false });
      track('public_game_viewed', { game_id: gameId, kind: isLeague ? 'league' : 'tournament' });
    } catch (e) {
      console.error('[PublicGame] load failed', e);
      setState({ loading: false, game: null, parent: null, blocked: false });
    }
  }, [gameId, isLeague]);

  useEffect(() => { load(); }, [load]);

  // Keep a spectator's view fresh for live games — this is the page fans open
  // from a shared link. Read-only, so a debounced full reload is fine.
  useEffect(() => {
    if (!gameId || state.blocked) return;
    const rowTable = isLeague ? 'league_games' : 'games';
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(load, 400); };
    let channel = null;
    try {
      channel = supabase.channel(`publicgame:${gameId}:${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: rowTable, filter: `id=eq.${gameId}` }, bump)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_goals', filter: `game_id=eq.${gameId}` }, bump)
        .subscribe();
    } catch { /* realtime best-effort */ }
    return () => { if (t) clearTimeout(t); try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
  }, [gameId, isLeague, state.blocked, load]);

  const { loading, game, parent, blocked } = state;

  if (loading) return <Shell><Center>Loading…</Center></Shell>;
  if (!game) return <Shell><Center>This game couldn’t be found.</Center></Shell>;
  if (blocked) return (
    <Shell>
      <SEO title="Rinkd" noIndex />
      <Center>
        <div style={{ fontSize: 30, marginBottom: 12 }}>🔒</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.ice, marginBottom: 8 }}>This game isn’t public</div>
        <div style={{ maxWidth: 320, lineHeight: 1.5 }}>The organizer hasn’t made this event shareable. <Link to="/" style={{ color: '#9ec3ec' }}>Explore Rinkd →</Link></div>
      </Center>
    </Shell>
  );

  // Normalize teams across league / tournament shapes (mirrors GameDetail).
  const homeTeam = isLeague
    ? { name: game.home_lt?.team?.name || game.home_lt?.team_name, color: game.home_lt?.team?.logo_color || game.home_lt?.logo_color, logo_initials: game.home_lt?.team?.logo_initials || game.home_lt?.logo_initials, logo_url: game.home_lt?.team?.logo_url || game.home_lt?.logo_url, id: game.home_team_id }
    : { name: game.home_team?.team_name, color: C.blue, logo_url: game.home_team?.logo_url, id: game.home_team_id };
  const awayTeam = isLeague
    ? { name: game.away_lt?.team?.name || game.away_lt?.team_name, color: game.away_lt?.team?.logo_color || game.away_lt?.logo_color, logo_initials: game.away_lt?.team?.logo_initials || game.away_lt?.logo_initials, logo_url: game.away_lt?.team?.logo_url || game.away_lt?.logo_url, id: game.away_team_id }
    : { name: game.away_team?.team_name, color: C.red, logo_url: game.away_team?.logo_url, id: game.away_team_id };

  const scorersHidden = areScorersHidden(parent?.settings);
  const sponsor = getRecapSponsor(parent?.settings);
  const competition = isLeague ? parent?.name : parent?.name;
  const accent = parent?.accent_color || C.blue;
  const status = game.status;
  const isFinal = status === 'final';
  const isLive = status === 'live';
  const dateStr = game.start_time ? new Date(game.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const venue = [game.rink?.name, game.rink?.sub_rink].filter(Boolean).join(' · ');

  const roundLabel = (() => {
    if (isLeague) return game.round && game.round !== 'pool' ? titleCase(game.round) : 'Regular season';
    const r = (game.round || '').toLowerCase();
    if (r === 'pool' || r === '') { const hp = game.home_team?.pool, ap = game.away_team?.pool; return hp && ap && hp === ap ? hp : (hp || ap ? `${hp || 'Pool ?'} vs ${ap || 'Pool ?'}` : 'Pool play'); }
    if (r === 'final' || r === 'championship') return '🏆 Championship';
    if (r === 'semifinal' || r === 'sf') return 'Semifinal';
    if (r === 'quarterfinal' || r === 'qf') return 'Quarterfinal';
    return titleCase(r);
  })();

  // [{ name, goals }] per team, suppressed for youth. Feeds both the on-page
  // scorer line and the share-card.
  const scorersArrayFor = (teamId) => {
    if (scorersHidden) return [];
    const counts = {};
    goals.filter(g => g.team_id === teamId && !g.is_shootout).forEach(g => { const k = g.scorer_number; if (k == null) return; counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts)
      .map(([num, n]) => ({ name: lineupByTeam[teamId]?.[num] || `#${num}`, goals: n }))
      .sort((a, b) => b.goals - a.goals);
  };
  const scorerLine = (teamId) => {
    const arr = scorersArrayFor(teamId);
    return arr.length ? arr.map(s => s.goals > 1 ? `${s.name} (${s.goals})` : s.name).join('  ·  ') : null;
  };

  const goalScorer = (g) => {
    if (scorersHidden) return 'Goal';
    if (g.scorer_number == null) return 'Goal';
    const name = lineupByTeam[g.team_id]?.[g.scorer_number];
    return name ? `${name} (#${g.scorer_number})` : `#${g.scorer_number}`;
  };
  const penaltyPlayer = (p) => {
    if (scorersHidden || p.player_number == null) return null;
    const name = lineupByTeam[p.team_id]?.[p.player_number];
    return name ? `${name} (#${p.player_number})` : `#${p.player_number}`;
  };
  const teamColorFor = (id) => id === homeTeam.id ? (homeTeam.color || C.blue) : (awayTeam.color || C.red);
  const teamNameFor = (id) => id === homeTeam.id ? homeTeam.name : awayTeam.name;

  const ogTitle = `${homeTeam.name || 'Home'} ${game.home_score ?? 0}, ${awayTeam.name || 'Away'} ${game.away_score ?? 0}`;
  const ogDesc = [isFinal ? 'FINAL' : isLive ? 'LIVE' : null, roundLabel, competition].filter(Boolean).join(' · ');

  // Share-card data — built lazily on tap via the shared loader (single source
  // of truth with the feed Share buttons; re-fetches so the card reflects the
  // latest score).
  const getCard = () => loadGameCardData(gameId, isLeague);

  return (
    <Shell>
      <SEO title={ogTitle} description={ogDesc} />
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 40px' }}>

        {/* event chip + share */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {parent?.logo_url
            ? <img src={parent.logo_url} alt="" width={32} height={32} style={{ borderRadius: 8, objectFit: 'cover' }} />
            : <div style={{ width: 32, height: 32, borderRadius: 8, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, color: '#fff', fontSize: 15, flexShrink: 0 }}>{(competition || 'R').slice(0, 1).toUpperCase()}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 17, color: C.ice, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{competition || 'Rinkd'}</div>
            <div style={{ fontSize: 12, color: C.steel }}>{roundLabel}{dateStr ? `  ·  ${dateStr}` : ''}</div>
          </div>
          {isFinal && <ShareButton getCard={getCard} isLeague={isLeague} gameId={gameId} variant="ghost" />}
        </div>

        {/* scoreboard */}
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: '22px 18px', marginBottom: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <span style={{ display: 'inline-block', background: isLive ? C.red : isFinal ? 'rgba(244,247,250,0.12)' : 'rgba(46,91,140,0.3)', color: isLive ? '#fff' : C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, letterSpacing: '0.08em', padding: '4px 14px', borderRadius: 999 }}>
              {isLive ? '● LIVE' : isFinal ? 'FINAL' : 'UPCOMING'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <TeamSide team={homeTeam} score={game.home_score} scorerLine={scorerLine(homeTeam.id)} hideScore={!isFinal && !isLive} />
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: C.steel, alignSelf: 'flex-start', marginTop: 26 }}>–</div>
            <TeamSide team={awayTeam} score={game.away_score} scorerLine={scorerLine(awayTeam.id)} hideScore={!isFinal && !isLive} />
          </div>
          {venue && <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: C.steel }}>📍 {venue}</div>}
        </div>

        {/* sponsor lockup — the recap "presented by" (GROWTH-SHARE-1 × ADS-1) */}
        <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: C.steel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ letterSpacing: '0.04em' }}>Recap presented by</span>
          {sponsor ? (
            sponsor.url
              ? <a href={sponsor.url} target="_blank" rel="noopener noreferrer nofollow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ice, fontWeight: 700 }}>{sponsor.logo_url && <img src={sponsor.logo_url} alt="" height={18} style={{ borderRadius: 3, maxHeight: 18 }} />}{sponsor.name} ↗</a>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ice, fontWeight: 700 }}>{sponsor.logo_url && <img src={sponsor.logo_url} alt="" height={18} style={{ borderRadius: 3, maxHeight: 18 }} />}{sponsor.name}</span>
          ) : <span style={{ color: C.ice, fontWeight: 700 }}>Rinkd</span>}
        </div>

        {/* box score — goals */}
        {goals.length > 0 && (
          <Section title="Scoring">
            {goals.map(g => (
              <Row key={g.id}>
                <Dot color={teamColorFor(g.team_id)} />
                <span style={{ flex: 1 }}><b style={{ color: C.ice }}>{goalScorer(g)}</b> <span style={{ color: C.steel }}>· {teamNameFor(g.team_id)}</span></span>
                <span style={{ color: C.steel, fontSize: 12 }}>{periodLabel(g.period)}{g.time_in_period ? ` ${g.time_in_period}` : ''}</span>
              </Row>
            ))}
          </Section>
        )}

        {/* box score — penalties */}
        {penalties.length > 0 && (
          <Section title="Penalties">
            {penalties.map(p => {
              const who = penaltyPlayer(p);
              const mins = p.duration_minutes ? ` (${p.duration_minutes}m)` : '';
              return (
                <Row key={p.id}>
                  <Dot color={teamColorFor(p.team_id)} />
                  <span style={{ flex: 1, color: C.ice }}>{who ? <b>{who} </b> : null}{p.penalty_type || p.severity || 'Penalty'}{mins} <span style={{ color: C.steel }}>· {teamNameFor(p.team_id)}</span></span>
                  <span style={{ color: C.steel, fontSize: 12 }}>{periodLabel(p.period)}{p.time_in_period ? ` ${p.time_in_period}` : ''}</span>
                </Row>
              );
            })}
          </Section>
        )}

        {/* soft conversion */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to={gameAppUrl(isLeague, gameId)} style={{ display: 'inline-block', background: accent, color: '#fff', fontWeight: 800, fontFamily: "'Barlow', sans-serif", fontSize: 15, padding: '12px 28px', borderRadius: 999, textDecoration: 'none' }}>
            Open in Rinkd
          </Link>
          <div style={{ marginTop: 14, fontSize: 13, color: C.steel }}>
            Every game lives on <Link to="/" style={{ color: '#9ec3ec', fontWeight: 700 }}>Rinkd</Link> — scores, stats, and the chirps.
          </div>
        </div>
      </div>
    </Shell>
  );
}

function TeamSide({ team, score, scorerLine, hideScore }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><TeamMark team={team} /></div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 17, color: '#F4F7FA', lineHeight: 1.1, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{(team.name || 'TBD').toUpperCase()}</div>
      {!hideScore && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 52, color: '#F4F7FA', lineHeight: 1 }}>{score ?? 0}</div>}
      {scorerLine && <div style={{ fontSize: 12, color: '#8BA3BE', marginTop: 6, lineHeight: 1.4 }}>{scorerLine}</div>}
    </div>
  );
}

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
function Shell({ children }) { return <div style={{ minHeight: '100vh', background: C.ink, color: C.ice, fontFamily: "'Barlow', sans-serif" }}>{children}</div>; }
function Center({ children }) { return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: C.steel, padding: 24 }}>{children}</div>; }
function Section({ title, children }) {
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.4)', textTransform: 'uppercase', padding: '12px 16px 8px' }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}
function Row({ children }) { return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: '0.5px solid rgba(46,91,140,0.18)', fontSize: 14 }}>{children}</div>; }
function Dot({ color }) { return <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />; }
