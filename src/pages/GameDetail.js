import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { captureDataError } from '../lib/sentry';
import { isExtraCommissioner } from '../lib/leagueCommissioners';
import { Icon, BounceNumber, ErrorState, Skeleton } from '../components/ui';
import Layout from '../components/Layout';
import RsvpBlock from '../components/RsvpBlock';
import MapLink from '../components/MapLink';
import CalendarButton from '../components/CalendarButton';
import { LedR, TeamLogo } from '../components/Logos';
import { getLiveBarnUrl } from '../lib/livebarn';
import { teamInitials } from '../lib/teamInitials';
import GamePuckCard from '../components/GamePuckCard';
import ShareButton from '../components/ShareButton';
import { loadGameCardData } from '../lib/gameCardData';
import { useOnline } from '../lib/useOnline';
import { C, colors, shadows } from '../lib/tokens';
import { resolveStreamUrl, streamButtonLabel, detectStreamPlatform } from '../lib/streamUrl';
import LiveLowerThird, { periodDisplay } from '../components/LiveLowerThird';
import { getHeadToHead } from '../lib/gameday';
import { areScorersHidden } from '../lib/publicShare';
import { useGoalMoment, GoalSweep, usePeriodChange } from '../lib/goalMoment';
import { haptics } from '../lib/haptics';
import SoundToggle from '../components/SoundToggle';
import { subscribeGame } from '../lib/gameRealtime';

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

// S06 · Bundle L — one-time keyframe for the period-change border pulse. The
// goal glow class (.rinkd-goal-glow) is injected by GoalSweep/ensureGoalKeyframes
// on its own; this only adds the period pulse. No-op under reduced motion.
let gdAnimInjected = false;
function ensureGdAnim() {
  if (gdAnimInjected || typeof document === 'undefined') return;
  gdAnimInjected = true;
  const el = document.createElement('style');
  el.id = 'rinkd-gd-anim';
  el.textContent =
    '@keyframes gdPeriodPulse{0%{box-shadow:inset 0 0 0 0 rgba(46,91,140,0)}30%{box-shadow:inset 0 0 0 2px rgba(46,91,140,0.9)}100%{box-shadow:inset 0 0 0 0 rgba(46,91,140,0)}}'
    + '.gd-period-pulse{animation:gdPeriodPulse 900ms ease-out}'
    + '@media (prefers-reduced-motion: reduce){.gd-period-pulse{animation:none}}';
  document.head.appendChild(el);
}

// S08 — "PUCK DROPS IN 2H 14M" countdown. Returns a formatted label when
// start_time is in the future (≥1h → "2H 14M", <1h → "43M"), else null so the
// caller keeps the static SCHEDULED pill (past-due-scheduled included).
// Client-only 60s tick, cleaned up on unmount, no fetch.
function usePuckDropCountdown(startTime, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [active]);
  if (!active || !startTime) return null;
  const ms = new Date(startTime).getTime() - now;
  if (!(ms > 0)) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h >= 1 ? `PUCK DROPS IN ${h}H ${m}M` : `PUCK DROPS IN ${Math.max(m, 1)}M`;
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
  const [error, setError] = useState(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  // YOUTH-PRIVACY (S06 P0): youth events render every player name jersey-only
  // on this page's Game Puck surfaces, mirroring the public page's rule.
  const [scorersHidden, setScorersHidden] = useState(false);
  // jersey # → player name lookup, keyed by team_id. Populated from
  // game_lineups (and only for tournament/league games where lineups exist).
  // Built once on load and consulted by the goal & penalty renderers.
  const [lineupByTeam, setLineupByTeam] = useState({});
  const [recordByLt, setRecordByLt] = useState({}); // league_team id → W-L-T (league games)
  const online = useOnline();

  const load = useCallback(async () => {
    try {
      setError(null);
      let g = null;
      if (isLeague) {
        const r = await supabase.from('league_games')
          .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, logo_url, team:teams(id,name,logo_color,logo_initials,logo_url)), rink:rinks(name,sub_rink,live_barn_venue_id,youtube_url), league:leagues(name)')
          .eq('id', gameId).single();
        g = r.data;
      } else if (isTeamGame) {
        const r = await supabase.from('team_games')
          .select('*, team:teams(id,name,logo_color,logo_initials,logo_url,manager_id)')
          .eq('id', gameId).single();
        g = r.data;
      } else {
        const r = await supabase.from('games')
          .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,seed,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,seed,logo_url), rink:rinks(name,sub_rink,live_barn_venue_id), tournament:tournaments(id,name,division)')
          .eq('id', gameId).single();
        g = r.data;
      }

      if (!g) { setLoading(false); return; }
      setGame(g);

      // Parent event youth flag (fail-closed on error) — one bounded read.
      if (!isTeamGame) {
        try {
          const evId = isLeague ? (g.league_id || g.home_lt?.league_id) : g.tournament_id;
          const { data: ev, error: evErr } = isLeague
            ? await supabase.from('leagues').select('settings').eq('id', evId).maybeSingle()
            : await supabase.from('tournaments').select('settings, is_youth').eq('id', evId).maybeSingle();
          setScorersHidden(evErr ? true : (areScorersHidden(ev?.settings) || ev?.is_youth === true));
        } catch { setScorersHidden(true); }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (isLeague) {
          const lgId = g.league_id || g.home_lt?.league_id;
          const { data: league } = await supabase.from('leagues').select('commissioner_id').eq('id', lgId).maybeSingle();
          // Honor multi-commissioner (league_roles), not just the founder field,
          // so added commissioners see the "Open Scorer View" button + Reopen.
          const isComm = league?.commissioner_id === user.id || await isExtraCommissioner(user.id, lgId);
          setIsOrganizer(isComm);
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
        // Records for the broadcast scoreboard (league games only). Best-effort.
        if (isLeague && g.league_id) {
          supabase.from('league_standings').select('lt_id,wins,losses,ties,otl').eq('league_id', g.league_id)
            .then(({ data }) => setRecordByLt((data || []).reduce((m, r) => { m[r.lt_id] = r; return m; }, {})))
            .catch(() => {});
        }
        const lookup = {};
        (lu || []).forEach(row => {
          if (row.jersey_number == null) return;
          if (!lookup[row.team_id]) lookup[row.team_id] = {};
          lookup[row.team_id][row.jersey_number] = row.invite_name || null;
        });
        setLineupByTeam(lookup);
      }
    } catch(e) { console.error('[GameDetail] load failed', e); captureDataError(e, { where: 'GameDetail.load', gameId }); setError(e); }
    setLoading(false);
  }, [gameId, isLeague, isTeamGame]);

  useEffect(() => { load(); }, [load]);

  // Realtime — keep a spectator's single-game view fresh. This page is what
  // fans open from a shared link; without this the score/goals stay frozen
  // until they manually reload. Re-run load() (debounced 400ms) on any change
  // to this game's row / goals / penalties. Read-only page, so a full reload is
  // fine. Uses the shared subscribeGame() so this surface rides the same
  // (env-gated) broadcast path as PublicGame when it's flipped on — no drifted
  // per-game channel of its own. The 400ms debounce is the caller's job
  // (subscribeGame just relays the ping), mirroring PublicGame.
  useEffect(() => {
    if (!gameId) return undefined;
    const kind = isLeague ? 'league' : isTeamGame ? 'team' : 'tournament';
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => { load(); }, 400); };
    const unsub = subscribeGame({ kind, gameId, onChange: bump });
    return () => { if (t) clearTimeout(t); unsub(); };
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

  // S06 · Bundle L — the live-moment stack (mirrors PublicGame). Hooks sit above
  // the early returns (rules of hooks).
  //
  // myTeamSide: GameDetail has no cheap already-loaded rooting signal — the team
  // ids here are event-scoped (league_teams / tournament_teams) and `profile`
  // carries no favorite-team field — so we pass null (neutral viewer). That keeps
  // behavior identical to the anon share link; wiring a real side would need an
  // extra membership lookup, out of scope for a cheap hint.
  const goal = useGoalMoment(game?.home_score, game?.away_score, {
    ready: !loading && !!game,
    enabled: game?.status === 'live',
    myTeamSide: null,
  });
  const periodPulse = usePeriodChange(game?.period, {
    ready: !loading && !!game && game?.status === 'live',
  });

  // L3 — the final beat: one success buzz on the live→final transition. Skips
  // the first ready read as the baseline (change-only discipline).
  const finalBeat = useRef({ status: game?.status, init: false });
  useEffect(() => {
    const st = game?.status;
    const ready = !loading && !!game;
    if (!ready) { finalBeat.current = { status: st, init: false }; return; }
    const p = finalBeat.current;
    if (!p.init) { finalBeat.current = { status: st, init: true }; return; }
    if (p.status !== 'final' && st === 'final') haptics.success();
    finalBeat.current = { status: st, init: true };
  }, [game?.status, loading, game]);

  // S08 — season series (lazy head-to-head). Wired for league AND tournament
  // games: both carry usable event-scoped team ids on home_team_id/away_team_id
  // (league_team ids / tournament_team ids), which is exactly what getHeadToHead
  // queries by. team_games carry no opponent team id, so they're skipped.
  // Non-blocking, alive-guarded; renders under the S06 state line when played>0.
  const seriesSource = isLeague ? 'league' : (!isTeamGame && game?.tournament_id) ? 'tournament' : null;
  const seriesHomeId = game?.home_team_id || null;
  const seriesAwayId = game?.away_team_id || null;
  const canSeries = !loading && !!game && !!seriesSource && !!seriesHomeId && !!seriesAwayId;
  const [series, setSeries] = useState(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  useEffect(() => {
    if (!canSeries) { setSeries(null); setSeriesLoading(false); return undefined; }
    let alive = true;
    setSeriesLoading(true);
    getHeadToHead({ source: seriesSource, home: { id: seriesHomeId }, away: { id: seriesAwayId } })
      .then((r) => { if (alive) { setSeries(r); setSeriesLoading(false); } })
      .catch(() => { if (alive) { setSeries(null); setSeriesLoading(false); } });
    return () => { alive = false; };
  }, [canSeries, seriesSource, seriesHomeId, seriesAwayId]);

  // S08 — puck-drop countdown for scheduled games (hook above early returns).
  const puckDrop = usePuckDropCountdown(game?.start_time, !loading && !!game && game?.status === 'scheduled');

  if (loading) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh' }}>
        {/* Score-box-shaped skeleton — mirrors the hydrated SCORE BOX layout
            below (two team columns flanking a center score) so there's no
            layout shift when the real game loads. */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#112236 100%)', padding: '24px 16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <Skeleton width={52} height={52} radius={10} style={{ margin: '0 auto 8px' }} />
              <Skeleton width="70%" height={13} style={{ margin: '0 auto' }} />
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Skeleton width={44} height={62} />
                <span style={{ fontSize: 24, color: 'rgba(244,247,250,0.3)', fontWeight: 300 }}>–</span>
                <Skeleton width={44} height={62} />
              </div>
              <Skeleton width={64} height={16} radius={20} style={{ margin: '10px auto 0' }} />
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <Skeleton width={52} height={52} radius={10} style={{ margin: '0 auto 8px' }} />
              <Skeleton width="70%" height={13} style={{ margin: '0 auto' }} />
            </div>
          </div>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Skeleton width="40%" height={11} />
          <Skeleton width="100%" height={54} radius={12} />
          <Skeleton width="100%" height={54} radius={12} />
        </div>
      </div>
    </Layout>
  );

  // A real fetch error (flaky rink wifi, etc.) is not the same as a deleted
  // game — give it a retry + offline copy instead of the dead-end "not found".
  if (error && !game) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', padding: '32px 16px' }}>
        <ErrorState
          title="Couldn’t load this game"
          offline={!online}
          onRetry={() => { setLoading(true); load(); }}
          retrying={loading}
        />
      </div>
    </Layout>
  );

  if (!game) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Game not found</div>
    </Layout>
  );

  // Normalize team data across league, team-only, and tournament shapes.
  const ourTeam = isTeamGame
    ? { id: game.team?.id, name: game.team?.name, logo_color: game.team?.logo_color || '#1a4a7a', logo_initials: game.team?.logo_initials || teamInitials(game.team?.name, 2), logo_url: game.team?.logo_url }
    : null;
  const opponentBubble = isTeamGame
    ? { id: null, name: game.opponent, logo_color: '#6b1520', logo_initials: teamInitials(game.opponent, 2) }
    : null;

  const homeTeam = isLeague
    ? { id: game.home_lt?.id, name: game.home_lt?.team?.name || game.home_lt?.team_name, logo_color: game.home_lt?.team?.logo_color || game.home_lt?.logo_color, logo_initials: game.home_lt?.team?.logo_initials || game.home_lt?.logo_initials, logo_url: game.home_lt?.team?.logo_url || game.home_lt?.logo_url }
    : isTeamGame
      ? (game.is_home ? ourTeam : opponentBubble)
      : { id: game.home_team?.id, name: game.home_team?.team_name, logo_color: '#1a4a7a', logo_initials: teamInitials(game.home_team?.team_name), logo_url: game.home_team?.logo_url };

  const awayTeam = isLeague
    ? { id: game.away_lt?.id, name: game.away_lt?.team?.name || game.away_lt?.team_name, logo_color: game.away_lt?.team?.logo_color || game.away_lt?.logo_color, logo_initials: game.away_lt?.team?.logo_initials || game.away_lt?.logo_initials, logo_url: game.away_lt?.team?.logo_url || game.away_lt?.logo_url }
    : isTeamGame
      ? (game.is_home ? opponentBubble : ourTeam)
      : { id: game.away_team?.id, name: game.away_team?.team_name, logo_color: '#6b1520', logo_initials: teamInitials(game.away_team?.team_name), logo_url: game.away_team?.logo_url };

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
  // Broadcast detail — records (league) + show-only-when-present flourishes.
  // Shot share prefers the real per-shot log; falls back to the game's columns.
  const recStr = (ltId) => { const r = recordByLt[ltId]; return r ? `${r.wins ?? 0}-${r.losses ?? 0}-${r.ties ?? 0}${r.otl ? `-${r.otl}` : ''}` : null; };
  const homeRecord = isLeague ? recStr(homeTeam.id) : null;
  const awayRecord = isLeague ? recStr(awayTeam.id) : null;
  const liveClock = game.clock_display || null;
  const watching = game.live_watching != null ? game.live_watching : null;
  const teamName = (id) => id === homeTeam.id ? homeTeam.name : awayTeam.name;
  const teamColor = (id) => id === homeTeam.id ? (homeTeam.logo_color || '#1a4a7a') : (awayTeam.logo_color || '#6b1520');
  const severityColor = (s) => s?.includes('Major') || s?.includes('Match') ? C.red : colors.warning;
  const severityLabel = (s) => s?.includes('Major') || s?.includes('Match') ? 'MAJOR' : s?.includes('Double') ? 'DBL MIN' : 'MINOR';
  // "#11" → "Gus Beck (#11)" when we know the player from the game lineup;
  // falls back to just the number when the lineup row is missing or unnamed.
  const playerLabel = (teamId, num) => {
    if (num == null) return 'Unknown';
    const name = lineupByTeam[teamId]?.[num];
    return name ? `${name} (#${num})` : `#${num}`;
  };

  // Shots totals per team
  // Shots prefer the real per-shot log; fall back to the game's broadcast columns
  // (shots_home/away) when no per-shot rows exist, so the count + shot-share still
  // render. Null columns → 0, and the displays already hide on a 0/0 total.
  const realHomeShots = shots.filter(s => s.team_id === homeTeam.id).reduce((a, s) => a + (s.count || 0), 0);
  const realAwayShots = shots.filter(s => s.team_id === awayTeam.id).reduce((a, s) => a + (s.count || 0), 0);
  const homeShots = (realHomeShots + realAwayShots > 0) ? realHomeShots : (game.shots_home ?? 0);
  const awayShots = (realHomeShots + realAwayShots > 0) ? realAwayShots : (game.shots_away ?? 0);
  const maxShots = Math.max(homeShots, awayShots, 1);

  // L3 — contextual state line, derived ONLY from real fields (scores + status).
  // No clock exists, so we never fabricate a "final minute" / time remaining.
  ensureGdAnim();
  const hScore = game.home_score ?? 0;
  const aScore = game.away_score ?? 0;
  const stateLine = (() => {
    if (isFinal) {
      if (hScore === aScore) return 'FINAL · TIE';
      const winner = hScore > aScore ? homeTeam.name : awayTeam.name;
      return `FINAL · ${winner || (hScore > aScore ? 'Home' : 'Away')} wins`;
    }
    if (isLive && hScore === aScore) return `TIED ${hScore}–${aScore}`;
    return null;
  })();

  // S08 — season-series line. home_team_id is "home" in the head-to-head record,
  // which maps to homeTeam here. Rendered only when played>0; while the fetch is
  // in flight we reserve the line height (no layout shift), then collapse if the
  // result is empty (played===0).
  const seriesLabel = (series && series.played > 0)
    ? `Season series ${series.homeWins}–${series.awayWins}${series.ties ? ` · ${series.ties} T` : ''}`
    : null;
  const showSeriesLine = canSeries && (seriesLoading || !!seriesLabel);

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
                <Icon name="directions" size={12} /> Directions
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
        <div className={`${goal ? 'rinkd-goal-glow' : ''}${periodPulse ? ' gd-period-pulse' : ''}`.trim() || undefined} style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg,#0B1F3A 0%,#112236 100%)', padding: '24px 16px 0', boxShadow: isLive ? shadows.live : undefined }}>
          {goal && <GoalSweep key={goal.key} side={goal.side} label={goal.label} muted={goal.muted} />}
          {/* Opt-in goal horn — the live surface (mirrors PublicGame). Anchored
              top-right so it never collides with the round-label chip. */}
          {isLive && (
            <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 5 }}>
              <SoundToggle />
            </div>
          )}
          {/* S08 — shared live lower-third: red slab + ring-expand dot +
              "<PERIOD> · LIVE" (+ clock/watching when present). Replaces the old
              inline "● LIVE · 1st" pill; the horn stays top-right above. */}
          {isLive && (
            <div style={{ margin: '0 0 16px' }}>
              <LiveLowerThird
                bleed="-24px -16px 0"
                period={game.period}
                label={`${periodDisplay(game.period)} · Live${liveClock ? ` · ${liveClock}` : ''}`}
                accent={watching != null
                  ? <span style={{ flexShrink: 0, fontSize: 12, color: 'rgba(244,247,250,0.75)', marginRight: 4, whiteSpace: 'nowrap' }}>{watching.toLocaleString()} watching</span>
                  : null}
              />
            </div>
          )}
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
              <TeamLogo team={homeTeam} size={52} radius={10} style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{homeTeam.name}</div>
              {homeRecord && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 11, color: C.steel, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{homeRecord}</div>}
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
                <BounceNumber value={game.home_score ?? 0} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 72, color: C.ice, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }} />
                <span style={{ fontSize: 24, color: 'rgba(244,247,250,0.3)', fontWeight: 300 }}>–</span>
                <BounceNumber value={game.away_score ?? 0} style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 72, color: C.ice, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              {/* S08 — live status now lives in the LiveLowerThird slab at the
                  top of the score box; here we keep only the FINAL / scheduled
                  state. Future scheduled games show the puck-drop countdown
                  (condensed italic, muted); past-due scheduled falls back. */}
              {(isFinal || (!isLive && !isFinal)) && (
                <div style={{ textAlign: 'center', marginTop: 6 }}>
                  {isFinal && <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>FINAL</span>}
                  {!isLive && !isFinal && (puckDrop
                    ? <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.steel }}>{puckDrop}</span>
                    : <span style={{ background: C.border, color: C.steel, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>SCHEDULED</span>
                  )}
                </div>
              )}
              {/* GS-5 — pre-game roster check attestation (verify_game_rosters).
                  Team-level signal only: it says the lineups were checked
                  against the suspension list, never who was on it. */}
              {isTournamentGame && game.rosters_verified_at && (
                <div style={{ textAlign: 'center', marginTop: 6 }}>
                  <span style={{ background: 'rgba(34,197,94,0.12)', border: '0.5px solid rgba(34,197,94,0.4)', color: colors.success, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                    ✓ Rosters verified
                  </span>
                </div>
              )}
              {game.start_time && <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 6 }}>{new Date(game.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
            </div>

            {/* Away team */}
            <div style={{ flex: 1, textAlign: 'center' }}>
              <TeamLogo team={awayTeam} size={52} radius={10} style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>{awayTeam.name}</div>
              {awayRecord && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 11, color: C.steel, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{awayRecord}</div>}
              {isTournamentGame && (game.away_team?.pool || game.away_team?.seed) && (
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.45)', marginTop: 4, fontFamily: "'Barlow Condensed', sans-serif", textTransform: 'uppercase' }}>
                  {game.away_team?.pool || ''}
                  {game.away_team?.pool && game.away_team?.seed ? ' · ' : ''}
                  {game.away_team?.seed ? `Seed ${game.away_team.seed}` : ''}
                </div>
              )}
            </div>
          </div>

          {/* L3 — contextual state line (real fields only; no fabricated clock). */}
          {stateLine && (
            <div style={{ textAlign: 'center', marginBottom: 16, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: isFinal ? C.steel : C.ice }}>
              {stateLine}
            </div>
          )}

          {/* S08 — season series. Reserved-height muted line under the state line
              while the head-to-head fetch is in flight (no layout shift), then
              collapses entirely if the two teams have never met (played===0). */}
          {showSeriesLine && (
            <div style={{ textAlign: 'center', marginBottom: 16, minHeight: 15, fontSize: 12, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {seriesLabel || ' '}
            </div>
          )}

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

          {/* S08 — Watch button: YouTube / Twitch / Facebook / Vimeo broadcast
              for this game (game then rink). Platform-colored, above the fold,
              shown whenever a resolved URL exists (pre-game, live, final — the
              archive usually lives on at the same URL). The LiveBarn block below
              is untouched. Mirrors PublicGame. team_games have no stream URL. */}
          {(() => {
            if (isTeamGame) return null;
            const streamUrl = resolveStreamUrl(game);
            if (!streamUrl) return null;
            const p = detectStreamPlatform(streamUrl);
            const col = p === 'youtube' ? '#FF0000' : p === 'twitch' ? '#9146FF' : p === 'facebook' ? '#1877F2' : p === 'vimeo' ? '#1AB7EA' : C.blue;
            return (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <a href={streamUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: col, color: '#fff', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, padding: '11px 22px', borderRadius: 999, textDecoration: 'none' }}>
                  <span style={{ fontSize: 12 }}>▶</span> {streamButtonLabel(streamUrl) || 'Watch live'}
                </a>
              </div>
            );
          })()}

          {/* Share the recap — final league/tournament games (team games have no public page) */}
          {isFinal && !isTeamGame && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <ShareButton gameId={gameId} isLeague={isLeague} variant="solid" label="Share recap"
                getCard={() => loadGameCardData(gameId, isLeague)} />
            </div>
          )}

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
              hideNames={scorersHidden}
            />
          )}

          {/* LIVEBARN */}
          {hasStream && (
            <>
              <button onClick={() => window.open(liveBarnUrl, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: C.navy, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', transition: 'all 0.15s', marginBottom: 8 }}
                onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.querySelector('.watch-text').style.color = C.navy; e.currentTarget.querySelector('.led-wrap').style.borderColor = 'rgba(215,38,56,0.5)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.navy; e.currentTarget.querySelector('.watch-text').style.color = C.ice; }}>
                <span className="led-wrap" style={{ width: 28, height: 28, background: C.dark, borderRadius: 6, border: `1px solid rgba(215,38,56,0.5)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
              <RsvpBlock gameId={gameId} compact={false} source={isLeague ? 'league' : isTeamGame ? 'team' : 'tournament'} />
            </div>
          )}

          {/* SCORER VIEW BUTTON — team-only games don't have a scoresheet */}
          {isOrganizer && !isFinal && !isTeamGame && (
            <button onClick={() => navigate(isLeague ? `/league-scorer/${gameId}?type=league` : `/scorer/${gameId}`)}
              style={{ width: '100%', padding: '11px', minHeight: 44, background: 'rgba(46,91,140,0.2)', border: `0.5px solid ${C.border}`, borderRadius: 10, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.2)'; e.currentTarget.style.color = C.ice; }}>
              <Icon name="scorer" size={16} /> Open Scorer View
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
                        {g.empty_net ? ' (EN)' : ''}
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
