import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import Layout from '../components/Layout';
import RsvpBlock from '../components/RsvpBlock';
import MapLink from '../components/MapLink';
import CalendarButton from '../components/CalendarButton';
import { LedR } from '../components/Logos';
import { getLiveBarnUrl } from '../lib/livebarn';
import { teamInitials } from '../lib/teamInitials';
import GamePuckCard from '../components/GamePuckCard';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };

function LiveBarnWordmark({ dark = false }) {
  const liveColor = dark ? '#2E6DB4' : '#5a9fd4';
  const barnColor = dark ? '#7a8fa8' : '#a0b4c8';
  return (
    <svg height="14" viewBox="0 0 90 22" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <path d="M3 14 Q6 6 11 4" stroke={liveColor} strokeWidth="1.8" fill="none" strokeLinecap="round"/>
      <path d="M1 17 Q5 5 12 2" stroke={liveColor} strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5"/>
      <text x="14" y="17" fontFamily="Arial Black,sans-serif" fontWeight="900" fontSize="14" fill={liveColor}>Live</text>
      <text x="48" y="17" fontFamily="Arial Black,sans-serif" fontWeight="900" fontSize="14" fill={barnColor}>Barn</text>
    </svg>
  );
}

function SecLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

function Card({ children }) {
  return <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>{children}</div>;
}

export default function GameDetail({ profile }) {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gameType = searchParams.get('type'); // 'league' | 'team' | null (= tournament)
  const isLeague = gameType === 'league';
  const isTeamGame = gameType === 'team';

  const [game, setGame] = useState(null);
  const [goals, setGoals] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [shots, setShots] = useState([]);
  const [goalieChanges, setGoalieChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOrganizer, setIsOrganizer] = useState(false);
  // jersey # → player name lookup, keyed by team_id. Populated from
  // game_lineups (and only for tournament/league games where lineups exist).
  // Built once on load and consulted by the goal & penalty renderers.
  const [lineupByTeam, setLineupByTeam] = useState({});

  const load = useCallback(async () => {
    try {
      let g = null;
      if (isLeague) {
        const r = await supabase.from('league_games')
          .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name,logo_color,logo_initials)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name,logo_color,logo_initials)), rink:rinks(name,sub_rink,live_barn_venue_id), league:leagues(name)')
          .eq('id', gameId).single();
        g = r.data;
      } else if (isTeamGame) {
        const r = await supabase.from('team_games')
          .select('*, team:teams(id,name,logo_color,logo_initials,manager_id)')
          .eq('id', gameId).single();
        g = r.data;
      } else {
        const r = await supabase.from('games')
          .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,seed), away_team:tournament_teams!away_team_id(id,team_name,pool,seed), rink:rinks(name,sub_rink,live_barn_venue_id), tournament:tournaments(id,name,division)')
          .eq('id', gameId).single();
        g = r.data;
      }

      if (!g) { setLoading(false); return; }
      setGame(g);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (isLeague) {
          const { data: league } = await supabase.from('leagues').select('commissioner_id').eq('id', g.league_id || g.home_lt?.league_id).maybeSingle();
          setIsOrganizer(league?.commissioner_id === user.id);
        } else if (isTeamGame) {
          setIsOrganizer(g.team?.manager_id === user.id);
        } else {
          // Tournament games: organizer = original director OR any user with
          // role='director' in tournament_roles for this tournament.
          const { data: tourn } = await supabase.from('tournaments').select('director_id').eq('id', g.tournament_id).maybeSingle();
          if (tourn?.director_id === user.id) {
            setIsOrganizer(true);
          } else {
            const { data: extra } = await supabase
              .from('tournament_roles')
              .select('id')
              .eq('tournament_id', g.tournament_id)
              .eq('user_id', user.id)
              .eq('role', 'director')
              .limit(1);
            setIsOrganizer(!!(extra && extra.length));
          }
        }
      }

      // team_games don't have nested scoring tables — skip those lookups
      if (!isTeamGame) {
        const [{ data: gl }, { data: pl }, { data: sl }, { data: gc }, { data: lu }] = await Promise.all([
          supabase.from('game_goals').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
          supabase.from('game_penalties').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
          supabase.from('game_shots').select('*').eq('game_id', gameId),
          supabase.from('game_goalie_changes').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
          // Pull lineups so the goal & penalty rows can say "Gus Beck (#11)" instead
          // of just "#11". invite_name is the source of truth while the players table
          // is unpopulated (see RINKD_STATE_OF_PLAY).
          supabase.from('game_lineups').select('team_id, jersey_number, invite_name').eq('game_id', gameId),
        ]);
        setGoals(gl || []);
        setPenalties(pl || []);
        setShots(sl || []);
        setGoalieChanges(gc || []);
        const lookup = {};
        (lu || []).forEach(row => {
          if (row.jersey_number == null) return;
          if (!lookup[row.team_id]) lookup[row.team_id] = {};
          lookup[row.team_id][row.jersey_number] = row.invite_name || null;
        });
        setLineupByTeam(lookup);
      }
    } catch(e) { console.error('[GameDetail] load failed', e); }
    setLoading(false);
  }, [gameId, isLeague, isTeamGame]);

  useEffect(() => { load(); }, [load]);

  // Realtime — keep a spectator's single-game view fresh. This page is what
  // fans open from a shared link; without this the score/goals stay frozen
  // until they manually reload. Re-run load() (debounced) on any change to this
  // game's row or its goals/penalties. Read-only page, so a full reload is fine.
  useEffect(() => {
    if (!gameId) return;
    const rowTable = isLeague ? 'league_games' : isTeamGame ? 'team_games' : 'games';
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => { load(); }, 400); };
    let channel = null;
    try {
      const name = `gamedetail:${gameId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      let ch = supabase.channel(name)
        .on('postgres_changes', { event: '*', schema: 'public', table: rowTable, filter: `id=eq.${gameId}` }, bump);
      if (!isTeamGame) {
        ch = ch
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_goals', filter: `game_id=eq.${gameId}` }, bump)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_penalties', filter: `game_id=eq.${gameId}` }, bump);
      }
      ch.subscribe();
      channel = ch;
    } catch { /* realtime is best-effort; manual reload still works */ }
    return () => { if (t) clearTimeout(t); try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
  }, [gameId, isLeague, isTeamGame, load]);

  // Activation analytics (pre-pilot P1-3): record the first time this spectator
  // sees the game live — a core "did they engage with the pilot" signal.
  const liveTrackedRef = useRef(false);
  useEffect(() => {
    if (game?.status === 'live' && !liveTrackedRef.current) {
      liveTrackedRef.current = true;
      track('live_game_viewed', { game_id: gameId, kind: isLeague ? 'league' : isTeamGame ? 'team' : 'tournament' });
    }
  }, [game?.status, gameId, isLeague, isTeamGame]);

  if (loading) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div>
    </Layout>
  );

  if (!game) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Game not found</div>
    </Layout>
  );

  // Normalize team data across league, team-only, and tournament shapes.
  const ourTeam = isTeamGame
    ? { id: game.team?.id, name: game.team?.name, logo_color: game.team?.logo_color || '#1a4a7a', logo_initials: game.team?.logo_initials || teamInitials(game.team?.name, 2) }
    : null;
  const opponentBubble = isTeamGame
    ? { id: null, name: game.opponent, logo_color: '#6b1520', logo_initials: teamInitials(game.opponent, 2) }
    : null;

  const homeTeam = isLeague
    ? { id: game.home_lt?.id, name: game.home_lt?.team?.name || game.home_lt?.team_name, logo_color: game.home_lt?.team?.logo_color || game.home_lt?.logo_color, logo_initials: game.home_lt?.team?.logo_initials || game.home_lt?.logo_initials }
    : isTeamGame
      ? (game.is_home ? ourTeam : opponentBubble)
      : { id: game.home_team?.id, name: game.home_team?.team_name, logo_color: '#1a4a7a', logo_initials: teamInitials(game.home_team?.team_name) };

  const awayTeam = isLeague
    ? { id: game.away_lt?.id, name: game.away_lt?.team?.name || game.away_lt?.team_name, logo_color: game.away_lt?.team?.logo_color || game.away_lt?.logo_color, logo_initials: game.away_lt?.team?.logo_initials || game.away_lt?.logo_initials }
    : isTeamGame
      ? (game.is_home ? opponentBubble : ourTeam)
      : { id: game.away_team?.id, name: game.away_team?.team_name, logo_color: '#6b1520', logo_initials: teamInitials(game.away_team?.team_name) };

  const context = isLeague ? game.league?.name : isTeamGame ? (game.team?.name || 'Team game') : game.tournament?.name;

  // Tournament-specific framing — pulled out so it only computes for tournament games.
  const isTournamentGame = !isLeague && !isTeamGame && !!game.tournament_id;
  const tournamentRoundLabel = (() => {
    if (!isTournamentGame) return null;
    const r = (game.round || '').toLowerCase();
    if (r === 'pool' || r === '') {
      // Pool play: show "Pool A" if both teams are in the same pool, else "Pool A vs Pool B".
      // The DB column already stores the full "Pool X" string, so don't prepend "Pool " again.
      const hp = game.home_team?.pool, ap = game.away_team?.pool;
      if (hp && ap && hp === ap) return hp;
      if (hp || ap)               return `${hp || 'Pool ?'} vs ${ap || 'Pool ?'}`;
      return 'Pool play';
    }
    if (r === 'quarterfinal' || r === 'qf') return 'Quarterfinal';
    if (r === 'semifinal'    || r === 'sf') return 'Semifinal';
    if (r === 'final'        || r === 'championship') return 'Championship';
    // Unknown round → title-case it
    return r.replace(/\b\w/g, c => c.toUpperCase());
  })();
  const venueId = game.live_barn_venue_id || game.rink?.live_barn_venue_id;
  const liveBarnUrl = getLiveBarnUrl(venueId);
  const hasStream = !!liveBarnUrl && game.status !== 'final';  // only real, non-placeholder IDs
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';

  const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';
  const teamName = (id) => id === homeTeam.id ? homeTeam.name : awayTeam.name;
  const teamColor = (id) => id === homeTeam.id ? (homeTeam.logo_color || '#1a4a7a') : (awayTeam.logo_color || '#6b1520');
  const severityColor = (s) => s?.includes('Major') || s?.includes('Match') ? C.red : '#F59E0B';
  const severityLabel = (s) => s?.includes('Major') || s?.includes('Match') ? 'MAJOR' : s?.includes('Double') ? 'DBL MIN' : 'MINOR';
  // "#11" → "Gus Beck (#11)" when we know the player from the game lineup;
  // falls back to just the number when the lineup row is missing or unnamed.
  const playerLabel = (teamId, num) => {
    if (num == null) return 'Unknown';
    const name = lineupByTeam[teamId]?.[num];
    return name ? `${name} (#${num})` : `#${num}`;
  };

  // Shots totals per team
  const homeShots = shots.filter(s => s.team_id === homeTeam.id).reduce((a, s) => a + (s.count || 0), 0);
  const awayShots = shots.filter(s => s.team_id === awayTeam.id).reduce((a, s) => a + (s.count || 0), 0);
  const maxShots = Math.max(homeShots, awayShots, 1);

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice, maxWidth: 600, margin: '0 auto', paddingBottom: 40 }}>

        {/* HEADER */}
        <div style={{ background: C.navy, padding: '14px 16px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => isTournamentGame && game.tournament?.id ? navigate(`/tournament/${game.tournament.id}`) : navigate(-1)}
            style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap' }}>
            ← {isTournamentGame && game.tournament?.name ? game.tournament.name : 'Back'}
          </button>
          <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', textAlign: 'center', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>
              {/* Tournament name already shows on the left as the back-link, so
                  skip it in the right-side venue label to avoid printing it twice. */}
              {!isTournamentGame && context}
              {game.rink ? `${!isTournamentGame ? ' · ' : ''}${[game.rink.sub_rink, game.rink.name].filter(Boolean).join(' · ')}` : ''}
              {isTeamGame && game.location ? ` · ${game.location}` : ''}
            </span>
            {(game.rink || (isTeamGame && game.location)) && (
              <MapLink rink={game.rink} text={isTeamGame ? game.location : undefined} icon=""
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  padding: '3px 9px', borderRadius: 999,
                  background: 'rgba(46,91,140,0.25)',
                  border: '0.5px solid rgba(46,91,140,0.6)',
                  color: C.ice, textDecoration: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  whiteSpace: 'nowrap',
                  fontFamily: "'Barlow', sans-serif",
                }}>
                📍 Directions
              </MapLink>
            )}
            {!isFinal && (
              <CalendarButton game={game}
                homeName={homeTeam?.name} awayName={awayTeam?.name} />
            )}
          </div>
          <div style={{ width: 60 }} />
        </div>

        {/* SCORE BOX */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#112236 100%)', padding: '24px 16px 0' }}>
          {tournamentRoundLabel && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <span style={{
                display: 'inline-block', padding: '4px 14px', borderRadius: 20,
                background: 'rgba(215,38,56,0.12)', border: '0.5px solid rgba(215,38,56,0.4)',
                color: C.red, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif",
              }}>
                {tournamentRoundLabel}
                {game.tournament?.division ? ` · ${game.tournament.division}` : ''}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
            {/* Home team */}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 10, background: homeTeam.logo_color || C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: '#fff', margin: '0 auto 8px' }}>
                {homeTeam.logo_initials || '?'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{homeTeam.name}</div>
              {isTournamentGame && (game.home_team?.pool || game.home_team?.seed) && (
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.45)', marginTop: 4, fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase' }}>
                  {game.home_team?.pool || ''}
                  {game.home_team?.pool && game.home_team?.seed ? ' · ' : ''}
                  {game.home_team?.seed ? `Seed ${game.home_team.seed}` : ''}
                </div>
              )}
            </div>

            {/* Score */}
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 56, color: C.ice, lineHeight: 1 }}>{game.home_score ?? 0}</span>
                <span style={{ fontSize: 24, color: 'rgba(244,247,250,0.3)', fontWeight: 300 }}>–</span>
                <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 56, color: C.ice, lineHeight: 1 }}>{game.away_score ?? 0}</span>
              </div>
              <div style={{ textAlign: 'center', marginTop: 6 }}>
                {isLive && <span style={{ background: C.red, color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, letterSpacing: '0.06em' }}>● LIVE · {periodLabel(game.period)}</span>}
                {isFinal && <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>FINAL</span>}
                {!isLive && !isFinal && <span style={{ background: 'rgba(46,91,140,0.4)', color: C.steel, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>SCHEDULED</span>}
              </div>
              {game.start_time && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 6 }}>{new Date(game.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
            </div>

            {/* Away team */}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 10, background: awayTeam.logo_color || '#6b1520', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: '#fff', margin: '0 auto 8px' }}>
                {awayTeam.logo_initials || '?'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{awayTeam.name}</div>
              {isTournamentGame && (game.away_team?.pool || game.away_team?.seed) && (
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.45)', marginTop: 4, fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase' }}>
                  {game.away_team?.pool || ''}
                  {game.away_team?.pool && game.away_team?.seed ? ' · ' : ''}
                  {game.away_team?.seed ? `Seed ${game.away_team.seed}` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Stats bar — only shown for league/tournament games where we track shots+goals */}
          {!isTeamGame && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderTop: `0.5px solid rgba(46,91,140,0.3)`, background: C.navy }}>
              {[
                { num: homeShots, label: `${homeTeam.logo_initials || 'HM'} Shots` },
                { num: goals.length, label: 'Goals' },
                { num: awayShots, label: `${awayTeam.logo_initials || 'AW'} Shots` },
              ].map((s, i) => (
                <div key={i} style={{ padding: '10px 0', textAlign: 'center', borderRight: i < 2 ? '0.5px solid rgba(46,91,140,0.2)' : 'none' }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: C.ice }}>{s.num}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(244,247,250,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 16 }}>

          {/* GAME PUCK — fan vote, final league/tournament games only */}
          {isFinal && !isTeamGame && (
            <GamePuckCard
              gameId={gameId}
              kind={isLeague ? 'league' : 'tournament'}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              lineupByTeam={lineupByTeam}
              goals={goals}
              canVote={!!profile}
              accent={C.red}
            />
          )}

          {/* LIVEBARN */}
          {hasStream && (
            <>
              <button onClick={() => window.open(liveBarnUrl, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: C.navy, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 8 }}
                onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.querySelector('.watch-text').style.color = C.navy; e.currentTarget.querySelector('.led-wrap').style.borderColor = 'rgba(215,38,56,0.5)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.navy; e.currentTarget.querySelector('.watch-text').style.color = C.ice; }}>
                <span className="led-wrap" style={{ width: 28, height: 28, background: '#07111F', borderRadius: 6, border: `1px solid rgba(215,38,56,0.5)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <LedR size={16} />
                </span>
                <span className="watch-text" style={{ fontSize: 13, fontWeight: 700, color: C.ice, transition: 'color 0.15s' }}>Watch with</span>
                <LiveBarnWordmark />
              </button>
              <div style={{ background: 'rgba(215,38,56,0.08)', border: '0.5px solid rgba(215,38,56,0.3)', borderRadius: 7, padding: '7px 11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.5)', lineHeight: 1.6 }}>Rinkd members save · ✓ Code <strong style={{ color: C.red }}>RINKD10</strong> auto-applied</div>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 14, color: C.red, marginLeft: 10 }}>10% off</div>
              </div>
            </>
          )}

          {/* PLAYER RSVP — scheduled games only */}
          {game.status === 'scheduled' && (
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '10px 14px 12px', marginBottom: 14 }}>
              <SecLabel>Are you in?</SecLabel>
              <RsvpBlock gameId={gameId} compact={false} />
            </div>
          )}

          {/* SCORER VIEW BUTTON — team-only games don't have a scoresheet */}
          {isOrganizer && !isFinal && !isTeamGame && (
            <button onClick={() => navigate(isLeague ? `/league-scorer/${gameId}?type=league` : `/scorer/${gameId}`)}
              style={{ width: '100%', padding: '11px', background: 'rgba(46,91,140,0.2)', border: `0.5px solid ${C.border}`, borderRadius: 10, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.2)'; e.currentTarget.style.color = C.ice; }}>
              ✏️ Open Scorer View
            </button>
          )}

          {/* GOAL LOG */}
          {goals.length > 0 && (
            <>
              <SecLabel>Goal Log ({goals.length})</SecLabel>
              <Card>
                {goals.map(g => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: teamColor(g.team_id), flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                        {playerLabel(g.team_id, g.scorer_number)}
                        {g.assist1_number ? ` — assist: ${playerLabel(g.team_id, g.assist1_number)}` : ' — unassisted'}
                        {g.assist2_number ? `, ${playerLabel(g.team_id, g.assist2_number)}` : ''}
                        {g.is_shootout ? ' (SO)' : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>
                        {teamName(g.team_id)} · {periodLabel(g.period)}{g.time_in_period ? ` · ${g.time_in_period}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}

          {/* PENALTIES */}
          {penalties.length > 0 && (
            <>
              <SecLabel>Penalties ({penalties.length})</SecLabel>
              <Card>
                {penalties.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap', marginTop: 2, background: `${severityColor(p.severity)}22`, color: severityColor(p.severity) }}>
                      {severityLabel(p.severity)}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                        {p.player_number ? `${playerLabel(p.team_id, p.player_number)} · ` : ''}{teamName(p.team_id)} — {p.penalty_type}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>
                        {periodLabel(p.period)}{p.time_in_period ? ` · ${p.time_in_period}` : ''} · {p.duration_minutes} min
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}

          {/* SHOTS */}
          {(homeShots > 0 || awayShots > 0) && (
            <>
              <SecLabel>Shots on Goal</SecLabel>
              <Card>
                {[[homeTeam, homeShots], [awayTeam, awayShots]].map(([team, count], i) => (
                  <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i > 0 ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, width: 140, flexShrink: 0 }}>{team.name}</span>
                    <div style={{ flex: 1, height: 6, background: 'rgba(244,247,250,0.08)', borderRadius: 3 }}>
                      <div style={{ width: `${(count / maxShots) * 100}%`, height: 6, background: C.blue, borderRadius: 3, transition: 'width 0.5s' }} />
                    </div>
                    <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice, width: 28, textAlign: 'right' }}>{count}</span>
                  </div>
                ))}
              </Card>
            </>
          )}

          {/* GOALIE CHANGES */}
          {goalieChanges.length > 0 && (
            <>
              <SecLabel>Goalie Changes</SecLabel>
              <Card>
                {goalieChanges.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>
                        {teamName(c.team_id)} — #{c.goalie_out_number || '?'} → #{c.goalie_in_number || '?'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>
                        {periodLabel(c.period)}{c.time_in_period ? ` · ${c.time_in_period}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}

          {/* Empty state */}
          {goals.length === 0 && penalties.length === 0 && homeShots === 0 && (
            <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏒</div>
              {isFinal ? 'No stats recorded for this game' : 'Stats will appear here once the game starts'}
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
