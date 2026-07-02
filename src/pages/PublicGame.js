import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { teamInitials } from '../lib/teamInitials';
import SEO from '../components/SEO';
import ShareButton from '../components/ShareButton';
import SoundToggle from '../components/SoundToggle';
import GamePuckCard from '../components/GamePuckCard';
import { ErrorState } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { resolveStreamUrl, streamButtonLabel, detectStreamPlatform } from '../lib/streamUrl';
import { subscribeGame } from '../lib/gameRealtime';
import { useGoalMoment, GoalSweep, usePeriodChange } from '../lib/goalMoment';
import { haptics } from '../lib/haptics';
import { loadGameCardData } from '../lib/gameCardData';
import {
  isPublicSharingEnabled, areScorersHidden, isParentPublic, gameAppUrl, getRecapSponsor,
} from '../lib/publicShare';
import { C as tokensC } from '../lib/tokens';

// GROWTH-SHARE-1 · M1 — the login-less public game/recap page. NO <Layout>, no
// auth, no writes. Reads game + box score as the anon role (RLS verified open:
// games/league_games/game_goals/game_penalties/game_lineups are all qual=true).
// Tournament games mount at /g/:id, league games at /lg/:id (league prop).
//
// Deliberately a SEPARATE component from the protected GameDetail — that page is
// auth-chromed and adjacent to the frozen pilot surface. This one is additive.

// Local-only key: `ink` (#030C15) has no shared-token match — spread shared C
// and add it locally rather than collapsing/guessing at a token.
const C = { ...tokensC, ink: '#030C15' };

// One-time keyframe inject (this page renders outside <Layout>, styles inline).
//  · pgLiveRing  — the manifesto live indicator: red ring expands 0→16px and
//    fades to transparent, 1.5s infinite ("red light on, siren").
//  · pgScorePop  — goal pop: scale(1.2)→(1.0), 200ms, hard like a puck hitting
//    the post. Both disabled under prefers-reduced-motion.
if (typeof document !== 'undefined' && !document.getElementById('rinkd-pg-anim')) {
  const el = document.createElement('style');
  el.id = 'rinkd-pg-anim';
  el.textContent =
    '@keyframes pgLiveRing{0%{box-shadow:0 0 0 0 rgba(215,38,56,0.7)}75%{box-shadow:0 0 0 16px rgba(215,38,56,0)}100%{box-shadow:0 0 0 0 rgba(215,38,56,0)}}'
    + '@keyframes pgScorePop{0%{transform:scale(1.2)}100%{transform:scale(1)}}'
    + '@keyframes pgShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}'
    // pgPeriodPulse — a single border flash when the period ticks over.
    + '@keyframes pgPeriodPulse{0%{box-shadow:0 0 0 0 rgba(46,91,140,0)}30%{box-shadow:0 0 0 2px rgba(46,91,140,0.9)}100%{box-shadow:0 0 0 0 rgba(46,91,140,0)}}'
    + '.pg-live-ring{animation:pgLiveRing 1.5s ease-out infinite}'
    + '.pg-score-pop{animation:pgScorePop 200ms cubic-bezier(0.34,1.56,0.64,1)}'
    + '.pg-period-pulse{animation:pgPeriodPulse 900ms ease-out}'
    + '.pg-shimmer{background:linear-gradient(90deg,rgba(46,91,140,0.18) 0%,rgba(46,91,140,0.32) 50%,rgba(46,91,140,0.18) 100%);background-size:800px 100%;animation:pgShimmer 1.4s linear infinite;border-radius:6px}'
    + '@media (prefers-reduced-motion: reduce){.pg-live-ring{animation:none}.pg-score-pop{animation:none}.pg-shimmer{animation:none}.pg-period-pulse{animation:none}}';
  document.head.appendChild(el);
}

const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';

// Broadcast period label — "2nd Period" / "Overtime" / "Shootout" (caps applied
// in CSS). Tolerates null/0 (live game before the scorer sets a period).
const periodDisplay = (p) => {
  const n = p || 1;
  if (n === 4) return 'Overtime';
  if (n >= 5) return 'Shootout';
  const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  return `${ord} Period`;
};

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

  const [state, setState] = useState({ loading: true, game: null, parent: null, blocked: false, error: false });
  const [goals, setGoals] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [lineupByTeam, setLineupByTeam] = useState({});
  const [recordByLt, setRecordByLt] = useState({}); // league_team id → W-L-T (league games)

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

      const [{ data: gl }, { data: pl }, { data: lu }, { data: st }] = await Promise.all([
        supabase.from('game_goals').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
        supabase.from('game_penalties').select('*').eq('game_id', gameId).order('period').order('time_in_period'),
        supabase.from('game_lineups').select('team_id, jersey_number, invite_name').eq('game_id', gameId),
        // Records for the broadcast scoreboard (league games only; tournament
        // teams are nameplate-only and carry no standings record).
        (isLeague && parent?.id)
          ? supabase.from('league_standings').select('lt_id,wins,losses,ties,otl').eq('league_id', parent.id)
          : Promise.resolve({ data: [] }),
      ]);
      setGoals(gl || []);
      setPenalties(pl || []);
      setRecordByLt((st || []).reduce((m, r) => { m[r.lt_id] = r; return m; }, {}));
      const lookup = {};
      (lu || []).forEach(row => {
        if (row.jersey_number == null) return;
        (lookup[row.team_id] = lookup[row.team_id] || {})[row.jersey_number] = row.invite_name || null;
      });
      setLineupByTeam(lookup);
      setState({ loading: false, game: g, parent, blocked: false });
      track('public_game_viewed', { game_id: gameId, kind: isLeague ? 'league' : 'tournament' });
    } catch (e) {
      // A thrown error is a network / server failure (distinct from a game that
      // genuinely isn't found) — surface a retry, not the dead-end "not found".
      console.error('[PublicGame] load failed', e);
      setState({ loading: false, game: null, parent: null, blocked: false, error: true });
    }
  }, [gameId, isLeague]);

  useEffect(() => { load(); }, [load]);

  // Keep a spectator's view fresh for live games — this is the page fans open
  // from a shared link. Read-only, so a debounced full reload is fine. The
  // subscription goes through lib/gameRealtime so the whole app shares ONE
  // implementation and flips to the scaled per-game broadcast topic with a single
  // env flag once that migration is live. (Today's postgres_changes path is
  // O(viewers) — the previous "one socket per game" comment here was wrong.)
  useEffect(() => {
    if (!gameId || state.blocked) return undefined;
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(load, 400); };
    const unsub = subscribeGame({ kind: isLeague ? 'league' : 'tournament', gameId, onChange: bump });
    return () => { if (t) clearTimeout(t); unsub(); };
  }, [gameId, isLeague, state.blocked, load]);

  const { loading, game, parent, blocked, error } = state;
  const online = useOnline();

  // SHARE-GOAL-1 — the goal moment for spectators who opened a shared live link.
  // `ready` gates out the loading→hydrate jump; `enabled` keeps a final game from
  // celebrating on a re-render. Hook sits above the early returns (rules of hooks).
  // Neutral spectator surface: no rooting side, so myTeamSide stays null and the
  // moment behaves exactly as it always has (full horn, full sweep, no muting).
  const goal = useGoalMoment(game?.home_score, game?.away_score, {
    ready: !loading && !!game && !blocked,
    enabled: game?.status === 'live',
    myTeamSide: null,
  });

  // L4 — period-change pulse (only counts a real forward tick; skips hydration).
  const periodPulse = usePeriodChange(game?.period, {
    ready: !loading && !!game && !blocked && game?.status === 'live',
  });

  // L3 — the final beat: one success buzz the moment a live game goes final.
  // Mirrors the change-only discipline (skip the first ready read as baseline).
  const finalBeat = useRef({ status: game?.status, init: false });
  useEffect(() => {
    const st = game?.status;
    const ready = !loading && !!game && !blocked;
    if (!ready) { finalBeat.current = { status: st, init: false }; return; }
    const p = finalBeat.current;
    if (!p.init) { finalBeat.current = { status: st, init: true }; return; }
    if (p.status !== 'final' && st === 'final') haptics.success();
    finalBeat.current = { status: st, init: true };
  }, [game?.status, loading, game, blocked]);

  if (loading) return (
    <Shell>
      <SEO title="Rinkd" noIndex />
      <GameSkeleton />
    </Shell>
  );
  if (error) return (
    <Shell>
      <SEO title="Rinkd" noIndex />
      <Center>
        <ErrorState offline={!online} onRetry={load} title="Couldn’t load this game" style={{ maxWidth: 400, background: 'transparent', border: 'none' }} />
      </Center>
    </Shell>
  );
  if (!game) return (
    <Shell>
      <SEO title="Rinkd" noIndex />
      <Center>
        {/* Rizzo the Rinkd Rat — the mascot makes the dead-end a brand moment.
            WebP with PNG fallback for legacy Safari/IE (mirrors NotFound). */}
        <picture>
          <source srcSet="/mascot-rizzo.webp" type="image/webp" />
          <img src="/mascot-rizzo.png" alt="Rinkd Rat" width="140" height="140" style={{ display: 'block', margin: '0 auto 16px', maxWidth: '45%', height: 'auto' }} />
        </picture>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 24, color: C.ice, textTransform: 'uppercase', marginBottom: 8 }}>This game’s not on the board</div>
        <div style={{ maxWidth: 340, lineHeight: 1.5 }}>The link may be off, or the game hasn’t dropped the puck yet. Live scores, stats, and recaps for every game live on <Link to="/" style={{ color: '#9ec3ec', fontWeight: 700 }}>Rinkd →</Link></div>
      </Center>
    </Shell>
  );
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

  // L3 — contextual state line, derived ONLY from real fields (scores + status).
  // No clock exists, so we never fabricate "FINAL MINUTE" or a time remaining.
  //   · live + tied  → 'TIED 2–2'
  //   · final        → 'FINAL · [winner] wins'  (or 'FINAL · TIE')
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

  // Broadcast detail — records (league only) + show-only-when-present flourishes.
  const recStr = (ltId) => { const r = recordByLt[ltId]; return r ? `${r.wins ?? 0}-${r.losses ?? 0}-${r.ties ?? 0}${r.otl ? `-${r.otl}` : ''}` : null; };
  const homeRecord = isLeague ? recStr(game.home_team_id) : null;
  const awayRecord = isLeague ? recStr(game.away_team_id) : null;
  const sog = (game.shots_home != null && game.shots_away != null && (game.shots_home + game.shots_away) > 0) ? { h: game.shots_home, a: game.shots_away } : null;
  const watching = game.live_watching != null ? game.live_watching : null;
  const clock = game.clock_display || null;

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

  // Split jersey number from name so the box-score rows can render the number
  // as a team-colored mark (no bullets) with the name beside it.
  const goalScorerParts = (g) => {
    if (scorersHidden || g.scorer_number == null) return { num: null, name: 'Goal' };
    return { num: g.scorer_number, name: lineupByTeam[g.team_id]?.[g.scorer_number] || null };
  };
  const penaltyPlayerParts = (p) => {
    if (scorersHidden || p.player_number == null) return { num: null, name: null };
    return { num: p.player_number, name: lineupByTeam[p.team_id]?.[p.player_number] || null };
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
        <div className={`${goal ? 'rinkd-goal-glow' : ''}${periodPulse ? ' pg-period-pulse' : ''}`.trim() || undefined} style={{ position: 'relative', background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: '22px 18px', marginBottom: 16, overflow: 'hidden' }}>
          {goal && <GoalSweep key={goal.key} side={goal.side} label={goal.label} muted={goal.muted} />}
          {isLive ? (
            /* Live broadcast lower-third: red-accent slab bleeding to the card
               edges, pulsing ring, "2ND PERIOD - LIVE". You feel it before you
               read it. The opt-in goal horn lives here — the live surface. */
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '-22px -18px 18px', padding: '7px 8px 7px 18px', background: C.navy, borderLeft: `4px solid ${C.red}` }}>
              <span className="pg-live-ring" style={{ width: 10, height: 10, borderRadius: 999, background: C.red, flex: '0 0 auto' }} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.ice, fontSize: 17, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {periodDisplay(game.period)} · Live{clock ? ` · ${clock}` : ''}
              </span>
              {watching != null && (
                <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(244,247,250,0.75)', marginRight: 4 }}>
                  <span className="pg-live-ring" style={{ width: 6, height: 6, borderRadius: 999, background: C.red }} />{watching.toLocaleString()}
                </span>
              )}
              <SoundToggle />
            </div>
          ) : (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <span style={{ display: 'inline-block', background: isFinal ? 'rgba(244,247,250,0.12)' : 'rgba(46,91,140,0.3)', color: C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 13, letterSpacing: '0.08em', padding: '4px 14px', borderRadius: 999 }}>
                {isFinal ? 'FINAL' : 'UPCOMING'}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 12 }}>
            <TeamSide team={homeTeam} score={game.home_score} record={homeRecord} scorerLine={scorerLine(homeTeam.id)} hideScore={!isFinal && !isLive} />
            <TeamSide team={awayTeam} score={game.away_score} record={awayRecord} scorerLine={scorerLine(awayTeam.id)} hideScore={!isFinal && !isLive} />
          </div>
          {/* L3 — contextual state line (real fields only; no fabricated clock). */}
          {stateLine && (
            <div style={{ textAlign: 'center', marginTop: 14, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: isFinal ? C.steel : C.ice }}>
              {stateLine}
            </div>
          )}
          {sog && <PgShotShare home={sog.h} away={sog.a} />}
          {venue && <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: C.steel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {venue}</div>}
        </div>

        {/* Watch button — YouTube / Twitch / Facebook / Vimeo broadcast for this
            game (resolved from the game then the rink). Platform-colored; shown
            pre-game + during the live broadcast (archives usually live on at the
            same URL post-final). */}
        {(() => {
          const streamUrl = resolveStreamUrl(game);
          if (!streamUrl) return null;
          const p = detectStreamPlatform(streamUrl);
          const col = p === 'youtube' ? '#FF0000' : p === 'twitch' ? '#9146FF' : p === 'facebook' ? '#1877F2' : p === 'vimeo' ? '#1AB7EA' : accent;
          return (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <a href={streamUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: col, color: '#fff', fontFamily: "'Barlow', sans-serif", fontWeight: 700, fontSize: 14, padding: '11px 22px', borderRadius: 999, textDecoration: 'none' }}>
                <span style={{ fontSize: 12 }}>▶</span> {streamButtonLabel(streamUrl) || 'Watch live'}
              </a>
            </div>
          );
        })()}

        {/* sponsor lockup — the recap "presented by" (GROWTH-SHARE-1 × ADS-1) */}
        <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: C.steel, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ letterSpacing: '0.04em' }}>Recap presented by</span>
          {sponsor ? (
            sponsor.url
              ? <a href={sponsor.url} target="_blank" rel="noopener noreferrer nofollow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ice, fontWeight: 700 }}>{sponsor.logo_url && <img src={sponsor.logo_url} alt="" height={18} style={{ borderRadius: 3, maxHeight: 18 }} />}{sponsor.name} ↗</a>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ice, fontWeight: 700 }}>{sponsor.logo_url && <img src={sponsor.logo_url} alt="" height={18} style={{ borderRadius: 3, maxHeight: 18 }} />}{sponsor.name}</span>
          ) : <span style={{ color: C.ice, fontWeight: 700 }}>Rinkd</span>}
        </div>

        {/* box score — goals. Dense log: team-colored jersey #, scorer name in
            Barlow Condensed, muted time. No bullets, no borders. */}
        {goals.length > 0 && (
          <Section title="Scoring">
            {goals.map(g => {
              const { num, name } = goalScorerParts(g);
              const col = teamColorFor(g.team_id);
              const team = teamNameFor(g.team_id) || '';
              return (
                <div key={g.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 16px' }}>
                  {num != null && <span style={{ flex: '0 0 auto', minWidth: 32, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: col }}>#{num}</span>}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                    {name && <b style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: C.ice }}>{name}</b>}
                    <span style={{ color: C.steel, fontSize: 13 }}>{name ? ` · ${team}` : team}</span>
                  </span>
                  <span style={{ flex: '0 0 auto', color: C.steel, fontSize: 12, whiteSpace: 'nowrap' }}>{periodLabel(g.period)}{g.time_in_period ? ` ${g.time_in_period}` : ''}</span>
                </div>
              );
            })}
          </Section>
        )}

        {/* box score — penalties (same dense, borderless treatment) */}
        {penalties.length > 0 && (
          <Section title="Penalties">
            {penalties.map(p => {
              const { num, name } = penaltyPlayerParts(p);
              const col = teamColorFor(p.team_id);
              const team = teamNameFor(p.team_id) || '';
              const mins = p.duration_minutes ? ` ${p.duration_minutes}m` : '';
              const inf = `${p.penalty_type || p.severity || 'Penalty'}${mins}`;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 16px' }}>
                  {num != null && <span style={{ flex: '0 0 auto', minWidth: 32, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: col }}>#{num}</span>}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                    {name && <b style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, color: C.ice }}>{name} </b>}
                    <span style={{ color: name ? C.steel : C.ice, fontSize: name ? 13 : 14 }}>{inf}</span>
                    <span style={{ color: C.steel, fontSize: 13 }}> · {team}</span>
                  </span>
                  <span style={{ flex: '0 0 auto', color: C.steel, fontSize: 12, whiteSpace: 'nowrap' }}>{periodLabel(p.period)}{p.time_in_period ? ` ${p.time_in_period}` : ''}</span>
                </div>
              );
            })}
          </Section>
        )}

        {/* Game Puck — the fan "Fans' Pick" vote. Read-only here (voting needs a
            login); anon spectators still see the live tally + who's leading, the
            give-first hook. Self-guards every phase (open / sealed / settled). */}
        {isFinal && (
          <GamePuckCard
            gameId={gameId}
            kind={isLeague ? 'league' : 'tournament'}
            homeTeam={{ id: homeTeam.id, name: homeTeam.name, logo_color: homeTeam.color, logo_initials: homeTeam.logo_initials }}
            awayTeam={{ id: awayTeam.id, name: awayTeam.name, logo_color: awayTeam.color, logo_initials: awayTeam.logo_initials }}
            lineupByTeam={lineupByTeam}
            goals={goals}
            canVote={false}
            accent={accent}
            hideNames={scorersHidden}
          />
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

// SOG split bar for the live scoreboard — red (home) vs blue (away). Only ever
// rendered when real shot data is present on the game (see render).
function PgShotShare({ home, away }) {
  const total = (home || 0) + (away || 0);
  const homePct = total > 0 ? Math.round((home / total) * 100) : 50;
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 13, color: C.ice }}>SOG {home}</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: '0.12em', color: C.steel }}>SHOT SHARE</span>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 13, color: C.ice }}>{away}</span>
      </div>
      <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'rgba(3,12,21,0.7)' }}>
        <span style={{ width: `${homePct}%`, background: C.red }} />
        <span style={{ flex: 1, background: C.blue }} />
      </div>
    </div>
  );
}

function TeamSide({ team, score, record, scorerLine, hideScore }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}><TeamMark team={team} /></div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 800, fontSize: 17, color: C.ice, lineHeight: 1.1, marginBottom: 2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(team.name || 'TBD').toUpperCase()}</div>
      {record && <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 11.5, color: C.steel, marginBottom: 2, fontVariantNumeric: 'tabular-nums' }}>{record}</div>}
      {/* TV score bug — Barlow Condensed 900 italic, 72px. key={score} remounts
          on every score change so pgScorePop fires the hard puck-off-the-post
          bounce. */}
      {!hideScore && <div key={score ?? 0} className="pg-score-pop" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 72, color: C.ice, lineHeight: 1 }}>{score ?? 0}</div>}
      {scorerLine && <div style={{ fontSize: 12, color: C.steel, marginTop: 6, lineHeight: 1.4 }}>{scorerLine}</div>}
    </div>
  );
}

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
function Shell({ children }) { return <div style={{ minHeight: '100vh', background: C.ink, color: C.ice, fontFamily: "'Barlow', sans-serif" }}>{children}</div>; }
function Center({ children }) { return <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: C.steel, padding: 24 }}>{children}</div>; }
function Section({ title, children }) {
  return (
    <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', color: 'rgba(244,247,250,0.55)', textTransform: 'uppercase', padding: '11px 16px 5px' }}>{title}</div>
      <div style={{ paddingBottom: 6 }}>{children}</div>
    </div>
  );
}

// Geometric loading state matching the real game layout (event chip → scoreboard
// → box score) — no spinner, no layout shift when the data lands.
function GameSkeleton() {
  const sk = (style) => <div className="pg-shimmer" style={style} />;
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {sk({ width: 32, height: 32, borderRadius: 8, flexShrink: 0 })}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sk({ width: '55%', height: 15 })}
          <div style={{ height: 7 }} />
          {sk({ width: '35%', height: 11 })}
        </div>
      </div>
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 16, padding: '22px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 28 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ flex: 1, maxWidth: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {sk({ width: 76, height: 76, borderRadius: '50%' })}
              {sk({ width: '70%', height: 14 })}
              {sk({ width: 48, height: 48, borderRadius: 8 })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
            {sk({ width: 28, height: 16 })}
            {sk({ width: `${55 - i * 8}%`, height: 13 })}
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 22, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(244,247,250,0.4)' }}>Dropping the puck.</div>
    </div>
  );
}
