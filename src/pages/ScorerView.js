import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
// Lazy-loaded: Scoresheet pulls in jsPDF + autotable + signature-canvas
// (hundreds of KB) that only a scorer exporting a PDF ever needs — keep it out
// of the main bundle so it doesn't slow first paint for every player.
const Scoresheet = React.lazy(() => import('../components/Scoresheet'));
import { supabase } from '../lib/supabase';
import { useWakeLock } from '../lib/useWakeLock';
import { createGameRecapPost } from '../lib/posts';
import { resolveBracketSlotsFromSemis } from '../lib/tournamentManage';
import { triggerTournamentRecapPush, triggerLeagueRecapPush } from '../lib/push';
import { isExtraCommissioner } from '../lib/leagueCommissioners';

const C = {
  dark: '#07111F', navy: '#0B1F3A', blue: '#2E5B8C',
  red: '#D72638', ice: '#F4F7FA', card: '#0f2847',
  border: 'rgba(46,91,140,0.4)',
};

const inputStyle = { width: '100%', background: '#07111F', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 8, padding: '10px 12px', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none' };
const selectStyle = { ...inputStyle };

// Headline for auto-recap posts. Bracket games get the round + 🏆 framing;
// pool play gets the pool letter. Stays under 280 chars so it doesn't get
// truncated in the Feed card preview.
function buildRecapContent({ home, away, round, tournamentName, leagueName }) {
  const winner = home.score > away.score ? 'home' : away.score > home.score ? 'away' : null;
  const headline = `🏒 FINAL · ${home.name || 'Home'} ${home.score ?? 0}, ${away.name || 'Away'} ${away.score ?? 0}`;
  const isBracket = round && round !== 'pool';
  // League games don't use the tournament round concept — the round-label
  // branch below is a no-op for them (round is null), so the context line
  // collapses to just the league name. Phase 3 will introduce
  // league_games.phase for playoffs and this can plug in the same way.
  const roundLabel = (() => {
    if (leagueName && !round) return 'Regular season';
    if (!round || round === 'pool') return 'Pool play';
    const r = String(round).toLowerCase();
    if (r === 'final' || r === 'championship') return '🏆 Championship';
    if (r === 'semifinal' || r === 'sf') return 'Semifinal';
    if (r === 'quarterfinal' || r === 'qf') return 'Quarterfinal';
    if (r === 'consolation') return 'Consolation';
    if (r === 'bronze') return 'Bronze Medal';
    return r.replace(/\b\w/g, c => c.toUpperCase());
  })();
  const competitionName = leagueName || tournamentName;
  const context = [roundLabel, competitionName].filter(Boolean).join(' · ');
  const winnerLine = isBracket && winner && (round === 'final' || round === 'championship')
    ? `\n${winner === 'home' ? home.name : away.name} are the champions.`
    : '';
  return `${headline}\n${context}${winnerLine}`;
}

const PENALTIES = {
  'Minor (2 min)': ['Boarding','Charging','Cross-Checking','Elbowing','High-Sticking','Holding','Hooking','Interference','Roughing','Slashing','Tripping','Too Many Men','Delay of Game'],
  'Double Minor (4 min)': ['High-Sticking (draw blood)'],
  'Major (5 min)': ['Fighting','Checking from Behind','Spearing','Butt-Ending','Attempt to Injure'],
  'Game Misconduct': ['Game Misconduct'],
  'Match Penalty': ['Match Penalty'],
};
const PENALTY_DURATIONS = { 'Minor (2 min)': 2, 'Double Minor (4 min)': 4, 'Major (5 min)': 5, 'Game Misconduct': 5, 'Match Penalty': 5 };

function SecLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

function AddBtn({ onClick, children }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', padding: 10, background: 'rgba(46,91,140,0.15)', border: '0.5px dashed rgba(46,91,140,0.5)', borderRadius: 8, color: '#F4F7FA', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.borderStyle = 'solid'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.15)'; e.currentTarget.style.color = '#F4F7FA'; e.currentTarget.style.borderStyle = 'dashed'; }}>
      {children}
    </button>
  );
}

function ScoreBtn({ onClick, children, variant = 'minus' }) {
  const bg = variant === 'plus' ? C.red : 'rgba(244,247,250,0.08)';
  return (
    <button onClick={onClick}
      style={{ width: 44, height: 44, background: bg, border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 22, cursor: 'pointer', fontWeight: 700, transition: 'all 0.15s', flexShrink: 0 }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.color = '#F4F7FA'; }}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, onSave, saveLabel = 'Save', busy = false, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: C.navy, borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480, borderTop: '0.5px solid rgba(46,91,140,0.4)' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 18, color: '#F4F7FA', marginBottom: 16 }}>{title}</div>
        {children}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: 12, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 999, color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,247,250,0.08)'; e.currentTarget.style.color = '#F4F7FA'; }}>Cancel</button>
          <button onClick={busy ? undefined : onSave} disabled={busy}
            style={{ flex: 2, padding: 12, background: busy ? C.border : C.red, border: 'none', borderRadius: 999, color: '#fff', fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = busy ? C.border : C.red; e.currentTarget.style.color = '#fff'; }}>{busy ? 'Saving…' : saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

function MField({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Row2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

export default function ScorerView() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLeague = searchParams.get('type') === 'league';

  // Keep the screen awake while a scorer is running the game. `supported`
  // tells us whether the device actually supports the Wake Lock API — older
  // iOS Safari (<16.4) and some in-app browsers don't, so we surface a
  // warning to the scorer instead of silently letting the screen sleep.
  const { supported: wakeLockSupported } = useWakeLock(true);
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Distinguishes a director (tournament) / commissioner (league) from a
  // plain assigned scorer. Only directors can Reopen a finalized game so
  // mistakes can be corrected without bouncing back to the manage UI.
  const [isDirector, setIsDirector] = useState(false);
  const [saving, setSaving] = useState(false);
  // Synchronous mirror of `saving` for re-entry guards — state updates are
  // async, so a double-tap can slip through before `saving` re-renders.
  const savingRef = useRef(false);
  // In-flight lock for the goal/penalty/goalie modals so a double-tap on Save
  // can't insert the same event twice.
  const [modalBusy, setModalBusy] = useState(false);
  const modalBusyRef = useRef(false);
  // Latest home/away team ids, read inside the realtime handler (whose closure
  // would otherwise capture a stale null `game` from first mount).
  const teamIdsRef = useRef({ home: null, away: null });
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [period, setPeriod] = useState(1);
  const [status, setStatus] = useState('scheduled');
  // For bracket games that end tied with shootout-bracket on, the scorer
  // must pick the shootout winner before Finalize is enabled. Persisted to
  // games.shootout_winner. Reset on game load.
  const [shootoutWinner, setShootoutWinner] = useState(null);
  // LEAGUE-DIV-1 M3 — how a LEAGUE game was decided (drives the OTL standings
  // column). 'regulation' | 'ot' | 'so'. shootoutWinner ('home'/'away') names
  // the SO winner when 'so'. Tournament games keep their existing path.
  const [leagueResult, setLeagueResult] = useState('regulation');
  const [goals, setGoals] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [shotRows, setShotRows] = useState([]);
  const [goalieChanges, setGoalieChanges] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [goalModal, setGoalModal] = useState(false);
  const [penaltyModal, setPenaltyModal] = useState(false);
  const [goalieModal, setGoalieModal] = useState(null);
  const [showScoresheet, setShowScoresheet] = useState(false);
  const [goalForm, setGoalForm] = useState({ team_id: '', scorer_number: '', assist1_number: '', assist2_number: '', period: 1, time_in_period: '', is_shootout: false });
  const [penaltyForm, setPenaltyForm] = useState({ team_id: '', player_number: '', severity: 'Minor (2 min)', penalty_type: 'Hooking', period: 1, time_in_period: '' });
  const [goalieForm, setGoalieForm] = useState({ goalie_out_number: '', goalie_in_number: '', period: 1, time_in_period: '' });

  const load = useCallback(async () => {
    setLoadError(false);
    const { data: g, error: gErr } = isLeague
      ? await supabase.from('league_games')
          .select('*, home_team:league_teams!home_team_id(id, team_name, team:teams(id,name)), away_team:league_teams!away_team_id(id, team_name, team:teams(id,name)), rink:rinks(name,sub_rink), league:leagues(name,commissioner_id,is_activated)')
          .eq('id', gameId).single()
      : await supabase.from('games')
          // Pull tournament settings so the period selector can hide OT/SO
          // when the format says they're not allowed (e.g., BLPA Bash is
          // regulation → shootout, no OT). is_activated drives the monetization
          // gate — show the activation-pending wall instead of the scorer UI.
          .select('*, home_team:tournament_teams!home_team_id(id,team_name), away_team:tournament_teams!away_team_id(id,team_name), rink:rinks(name,sub_rink), tournament:tournaments(name,director_id,settings,is_activated)')
          .eq('id', gameId).single();
    // A transient fetch failure (flaky rink wifi) must NOT eject the scorer
    // mid-game. Distinguish a real error (show retry) from a genuine not-found.
    if (gErr) { setLoadError(true); setLoading(false); return; }
    if (!g) { navigate(-1); return; }

    // Authorization — only the director / assigned scorer (tournament) or the
    // commissioner / assigned scorekeeper (league) may open the live scorer.
    // Also resolve `director` so the Reopen control on finalized games can
    // be limited to directors/commissioners (scorers cannot un-finalize).
    const { data: { user } } = await supabase.auth.getUser();
    let ok = false;
    let director = false;
    if (user) {
      if (isLeague) {
        director = user.id === g.league?.commissioner_id;
        // Multi-commissioner support: added commissioners live in league_roles,
        // not leagues.commissioner_id (which is only the founder). Mirror the
        // tournament_roles path below so they can run the scorer too. The league
        // RLS already authorizes their writes via is_league_commissioner().
        if (!director && g.league_id) {
          director = await isExtraCommissioner(user.id, g.league_id);
        }
        ok = director || user.id === g.scorekeeper_id;
      } else {
        director = user.id === g.tournament?.director_id;
        ok = director || user.id === g.scorekeeper_id;
        if (g.tournament_id) {
          // Also check tournament_roles — added directors get full director
          // powers (Reopen, OT toggle, etc.) and scorers get scorekeeper access.
          const { data: roleRows } = await supabase.from('tournament_roles')
            .select('role').eq('tournament_id', g.tournament_id).eq('user_id', user.id).limit(1);
          if (roleRows && roleRows.length) {
            ok = true;
            if (roleRows[0].role === 'director') director = true;
          }
        }
      }
    }
    if (!ok) { setAuthorized(false); setLoading(false); return; }
    setIsDirector(director);

    setGame(g);
    teamIdsRef.current = { home: g.home_team?.id || null, away: g.away_team?.id || null };
    setHomeScore(g.home_score || 0);
    setAwayScore(g.away_score || 0);
    setPeriod(g.period || 1);
    setStatus(g.status || 'scheduled');
    if (isLeague) {
      // league_games.shootout_winner is a league_teams UUID; map it back to a side.
      setShootoutWinner(g.shootout_winner === g.home_team_id ? 'home' : g.shootout_winner === g.away_team_id ? 'away' : null);
      setLeagueResult(g.decided_in || 'regulation');
    } else {
      setShootoutWinner(g.shootout_winner || null);
    }
    setGoalForm(prev => ({ ...prev, team_id: g.home_team?.id || '', period: g.period || 1 }));
    setPenaltyForm(prev => ({ ...prev, team_id: g.home_team?.id || '', period: g.period || 1 }));
    const [{ data: gl }, { data: pl }, { data: sl }, { data: gc }] = await Promise.all([
      supabase.from('game_goals').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
      supabase.from('game_penalties').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
      supabase.from('game_shots').select('*').eq('game_id', gameId),
      supabase.from('game_goalie_changes').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
    ]);
    setGoals(gl || []);
    setPenalties(pl || []);
    setShotRows(sl || []);
    setGoalieChanges(gc || []);
    setLoading(false);
  }, [gameId, navigate]);

  useEffect(() => { load(); }, [load]);

  // Realtime — if two scorekeepers (or a director watching alongside the
  // scorer) are entering events on the same game (the common BLPA case),
  // reload the events lists whenever game_goals or game_penalties changes, and
  // re-derive the displayed score from the authoritative goal log so both
  // screens agree (otherwise the log grows but the score stays stale, and
  // whoever finalizes writes the wrong score to standings). Manual +/- score
  // overrides (which don't touch game_goals) are still owned by whoever taps
  // them and converge via the DB write.
  useEffect(() => {
    if (!gameId) return;
    let channel = null;
    try {
      const name = `scorer:${gameId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const refresh = async () => {
        const [{ data: gl }, { data: pl }] = await Promise.all([
          supabase.from('game_goals').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
          supabase.from('game_penalties').select('*').eq('game_id', gameId).order('created_at', { ascending: false }),
        ]);
        if (gl) {
          setGoals(gl);
          // Re-derive the score from the goal log (the canonical count). Local
          // state only — no DB write here, which would echo back to the other
          // scorer. Skip while our own write is in flight so we don't stomp an
          // optimistic local change mid-flight.
          const { home: homeId, away: awayId } = teamIdsRef.current;
          if (homeId && awayId && !savingRef.current) {
            setHomeScore(gl.filter(x => x.team_id === homeId && !x.is_shootout).length);
            setAwayScore(gl.filter(x => x.team_id === awayId && !x.is_shootout).length);
          }
        }
        if (pl) setPenalties(pl);
      };
      channel = supabase.channel(name)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_goals', filter: `game_id=eq.${gameId}` },
          () => { refresh().catch(() => {}); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'game_penalties', filter: `game_id=eq.${gameId}` },
          () => { refresh().catch(() => {}); })
        .subscribe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[scorer] realtime subscribe failed; co-scorers will need to reload to see each other:', err);
    }
    return () => { try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ } };
  }, [gameId]);

  // Once status='final', the scorer tool is read-only. Every mutator below
  // early-returns when locked, and the UI controls hide or disable so a
  // scorer can't change the official record after the director (or they
  // themselves) finalized. Directors get a Reopen affordance below.
  const isLocked = status === 'final';

  const updateScore = async (hs, as, p, st, opts = {}) => {
    savingRef.current = true;
    setSaving(true);
    // shootout_winner only applies to tournament games (column doesn't exist
    // on league_games). Pass `undefined` to skip the field rather than
    // sending a NULL that would clobber an existing value on every save.
    const patch = { home_score: hs, away_score: as, period: p, status: st };
    if (!isLeague && Object.prototype.hasOwnProperty.call(opts, 'shootoutWinner')) {
      patch.shootout_winner = opts.shootoutWinner;
    }
    // League OTL capture (LEAGUE-DIV-1 M3): on finalize we set decided_in +
    // shootout_winner (a league_teams UUID, or null). Always written together so
    // a Reopen → re-finalize in regulation clears any stale OT/SO marker.
    if (isLeague && Object.prototype.hasOwnProperty.call(opts, 'leagueDecidedIn')) {
      patch.decided_in = opts.leagueDecidedIn;
      patch.shootout_winner = opts.leagueShootoutWinner ?? null;
    }
    const { error } = await supabase.from(isLeague ? 'league_games' : 'games').update(patch).eq('id', gameId);
    savingRef.current = false;
    setSaving(false);
    if (error) setErrorMsg('Could not save the score — check your connection and try again.');
    return { error };
  };

  const reopenGame = async () => {
    if (!isDirector) return;
    setErrorMsg('');
    const ok = window.confirm('Reopen this game for editing?\n\nStandings already reflect the current score. Any new edits will overwrite them when you finalize again.');
    if (!ok) return;
    const prevStatus = status;
    setStatus('live');
    const { error } = await updateScore(homeScore, awayScore, period, 'live');
    if (error) setStatus(prevStatus);
  };

  const changeScore = (team, delta) => {
    if (isLocked) return;
    setErrorMsg('');
    const prevHome = homeScore, prevAway = awayScore, prevStatus = status;
    const hs = team === 'home' ? Math.max(0, homeScore + delta) : homeScore;
    const as = team === 'away' ? Math.max(0, awayScore + delta) : awayScore;
    setHomeScore(hs); setAwayScore(as);
    // Functional updater so rapid taps always read the freshest status when
    // deciding whether to flip scheduled→live. Captured here so updateScore
    // writes the same value we just committed locally.
    let newStatus = status;
    setStatus(prev => { newStatus = prev === 'scheduled' ? 'live' : prev; return newStatus; });
    // Roll back the optimistic local state if the DB write fails — otherwise
    // the scorer's local score keeps drifting from the server with every
    // failed tap and the next finalize writes the drifted value.
    updateScore(hs, as, period, newStatus).then(({ error }) => {
      if (error) {
        setHomeScore(prevHome);
        setAwayScore(prevAway);
        setStatus(prevStatus);
      }
    });
  };

  // Tap a team's name or its big score to log a goal for that side — the
  // primary, stupid-proof path for non-technical timekeepers (Nick's BLPA
  // crew ranges 10-to-70 yrs old). Opening the form writes NOTHING; Save is
  // the confirm and every goal row has a ✕ undo, so a stray tap is harmless
  // (just Cancel). Team id is read from `game` (in scope here) rather than the
  // render-scoped homeTeam/awayTeam to avoid any declaration-order surprise.
  const openGoalForTeam = (side) => {
    if (isLocked) return;
    setErrorMsg('');
    const teamId = side === 'home' ? game?.home_team?.id : game?.away_team?.id;
    if (!teamId) return;
    setGoalForm(prev => ({ ...prev, team_id: teamId, period, scorer_number: '', assist1_number: '', assist2_number: '', time_in_period: '', is_shootout: false }));
    setGoalModal(true);
  };

  // Score is the goal-log count per team — derived, not stored separately.
  // The +/- buttons (changeScore above) still write a manual override for
  // cases where the scorer wants to bump the score without logging a goal,
  // but every saveGoal / deleteGoal will sync the score back to the canonical
  // goal-log count. Finalize then validates these match before locking in.
  const syncScoreFromGoals = (nextGoals) => {
    const homeId = game?.home_team?.id;
    const awayId = game?.away_team?.id;
    if (!homeId || !awayId) return;
    const hs = nextGoals.filter(g => g.team_id === homeId && !g.is_shootout).length;
    const as = nextGoals.filter(g => g.team_id === awayId && !g.is_shootout).length;
    setHomeScore(hs);
    setAwayScore(as);
    let newStatus = status;
    setStatus(prev => { newStatus = prev === 'scheduled' ? 'live' : prev; return newStatus; });
    updateScore(hs, as, period, newStatus);
  };

  const changePeriod = async (p) => {
    // Block all period changes after finalize — even the no-op of clicking
    // the current period would re-write status='live' via updateScore below
    // and silently un-lock the game. Directors must use the Reopen button.
    if (isLocked) return;
    // Re-entry guard: a double-tap on Finalize (or a tap during an in-flight
    // score write) would otherwise double-post the recap, double-fire the push
    // to every subscriber, and re-run bracket auto-fill. updateScore flips
    // savingRef for the duration of its write, so the second tap bails here.
    if (savingRef.current) return;
    setErrorMsg('');
    // Pre-finalize sanity check — make sure the goal log matches the score.
    // Score is derived from goals on every saveGoal/deleteGoal, but the
    // manual +/- buttons can still push them out of sync (e.g., scorer
    // bumped the score for a missed goal). Catch the mismatch here BEFORE
    // standings lock in.
    if (p === 'final' && game?.home_team?.id && game?.away_team?.id) {
      const homeGoalCount = goals.filter(g => g.team_id === game.home_team.id && !g.is_shootout).length;
      const awayGoalCount = goals.filter(g => g.team_id === game.away_team.id && !g.is_shootout).length;
      if (homeGoalCount !== homeScore || awayGoalCount !== awayScore) {
        const ok = window.confirm(
          `Heads up — your score and goal log disagree:\n\n` +
          `  Score: ${homeScore}–${awayScore}\n` +
          `  Goal log: ${homeGoalCount}–${awayGoalCount}\n\n` +
          `Standings will use the score (${homeScore}–${awayScore}). The official scoresheet uses the goal log.\n\n` +
          `Finalize anyway?`
        );
        if (!ok) return;
      }
    }
    const newStatus = p === 'final' ? 'final' : 'live';
    const newPeriod = p === 'final' ? period : parseInt(p);
    setPeriod(newPeriod); setStatus(newStatus);
    // On finalize: only persist shootout_winner when this is actually a
    // tied bracket game with SO allowed. Otherwise clear it (a Reopen → fix
    // score → re-finalize that ended in regulation must not leave a stale
    // shootout_winner attached to the row).
    let opts = {};
    if (p === 'final') {
      if (!isLeague) {
        opts = { shootoutWinner: requiresShootoutResolution ? (shootoutWinner || null) : null };
      } else {
        // League OTL capture: equal score → 'so' (if picked) else regulation/tie;
        // unequal score → 'ot' (if picked) else regulation. Map the SO side to a
        // league_teams UUID for league_games.shootout_winner.
        const decided = isTied
          ? (leagueResult === 'so' ? 'so' : 'regulation')
          : (leagueResult === 'ot' ? 'ot' : 'regulation');
        const soWinnerId = decided === 'so'
          ? (shootoutWinner === 'home' ? game.home_team_id : shootoutWinner === 'away' ? game.away_team_id : null)
          : null;
        opts = { leagueDecidedIn: decided, leagueShootoutWinner: soWinnerId };
      }
    }
    const { error } = await updateScore(homeScore, awayScore, newPeriod, newStatus, opts);

    // Auto-recap post — fire once the score save succeeds and we just
    // transitioned to 'final'. Failure to post the recap should never block
    // the finalize itself; the game is finalized regardless. Tournament
    // path also runs bracket auto-fill on semifinals; league path skips
    // that (no bracket games in Phase 2 — Phase 3 brings playoff support).
    if (!error && newStatus === 'final' && !isLeague && game?.tournament_id) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const content = buildRecapContent({
          home: { name: homeTeam?.team_name, score: homeScore },
          away: { name: awayTeam?.team_name, score: awayScore },
          round: game.round,
          tournamentName: game.tournament?.name,
        });
        const { data: recapPost } = await createGameRecapPost({ scorerId: user?.id, gameId, content, tournamentId: game.tournament_id });
        // Fire push notifications to tournament subscribers. The Edge
        // Function (send-recap-push) handles all targeting and payload
        // building from the post id — client just passes the id. Errors
        // are swallowed by triggerTournamentRecapPush so a push failure
        // never blocks the finalize.
        if (recapPost?.id) {
          triggerTournamentRecapPush(recapPost.id);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[scorer] recap post failed; game still finalized:', e?.message || e);
      }

      // If this was a semifinal, try to advance the bracket — fill the
      // gold game (winners) and bronze game (losers) with the resolved
      // teams. Idempotent and pool-scoped so it only touches the bracket
      // that includes this semi. Failure logs but never blocks the
      // finalize itself.
      if (game.round === 'semifinal' && game.pool) {
        try {
          const { error: resolveErr } = await resolveBracketSlotsFromSemis(game.tournament_id, game.pool);
          if (resolveErr) console.warn('[scorer] bracket auto-fill failed:', resolveErr.message);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[scorer] bracket auto-fill threw:', e?.message || e);
        }
      }
    } else if (!error && newStatus === 'final' && isLeague && game?.league_id) {
      // League auto-recap (Phase 2 of league-parity build). Direct mirror
      // of the tournament branch above — different Edge Function target
      // (send-league-recap-push) and different content context (league
      // name instead of tournament). Failure non-fatal: the game is
      // finalized regardless.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const content = buildRecapContent({
          home: { name: homeTeam?.team_name, score: homeScore },
          away: { name: awayTeam?.team_name, score: awayScore },
          round: null,                  // Phase 3 will plug in league_games.phase for playoffs
          leagueName: game.league?.name,
        });
        const { data: recapPost } = await createGameRecapPost({ scorerId: user?.id, gameId, content, leagueId: game.league_id });
        if (recapPost?.id) {
          triggerLeagueRecapPush(recapPost.id);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[scorer] league recap post failed; game still finalized:', e?.message || e);
      }
    }
  };

  const changeShots = async (teamId, delta) => {
    if (isLocked) return;
    setErrorMsg('');
    // Shots are tracked per period. Read THIS period's row only — never the
    // cross-period total — so we don't write an inflated count into one row.
    const existing = shotRows.find(s => s.team_id === teamId && s.period === period);
    const newCount = Math.max(0, (existing ? existing.count : 0) + delta);
    const { data, error } = await supabase.from('game_shots')
      .upsert({ game_id: gameId, team_id: teamId, period, count: newCount }, { onConflict: 'game_id,team_id,period' })
      .select().single();
    if (error || !data) { setErrorMsg('Could not save shots — check your connection and try again.'); return; }
    setShotRows(prev => [...prev.filter(s => !(s.team_id === teamId && s.period === period)), data]);
  };

  const saveGoal = async () => {
    if (isLocked) return;
    if (!goalForm.team_id) return;
    if (modalBusyRef.current) return;   // ignore double-taps while the insert is in flight
    modalBusyRef.current = true; setModalBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.from('game_goals').insert({
        game_id: gameId, team_id: goalForm.team_id,
        scorer_number: goalForm.scorer_number ? parseInt(goalForm.scorer_number) : null,
        assist1_number: goalForm.assist1_number ? parseInt(goalForm.assist1_number) : null,
        assist2_number: goalForm.assist2_number ? parseInt(goalForm.assist2_number) : null,
        period: goalForm.period, time_in_period: goalForm.time_in_period || null,
        is_shootout: goalForm.is_shootout,
      }).select().single();
      // Keep the modal open and the score untouched if the write failed — the
      // goal was NOT recorded, and the scorer needs to know so they can retry.
      if (error || !data) { setErrorMsg('Could not save the goal — check your connection and try again. The goal was NOT recorded.'); return; }
      // Append optimistically, then derive score from the new goal list so the
      // score on the games table stays in lock-step with the goal log. Eliminates
      // the drift that could happen when the goal insert succeeded but the
      // separate score update failed (the pre-refactor pattern).
      const nextGoals = [data, ...goals];
      setGoals(nextGoals);
      syncScoreFromGoals(nextGoals);
      setGoalModal(false);
      setGoalForm(prev => ({ ...prev, scorer_number: '', assist1_number: '', assist2_number: '', time_in_period: '' }));
    } finally {
      modalBusyRef.current = false; setModalBusy(false);
    }
  };

  const savePenalty = async () => {
    if (isLocked) return;
    if (!penaltyForm.team_id) return;
    if (modalBusyRef.current) return;   // ignore double-taps while the insert is in flight
    modalBusyRef.current = true; setModalBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.from('game_penalties').insert({
        game_id: gameId, team_id: penaltyForm.team_id,
        player_number: penaltyForm.player_number ? parseInt(penaltyForm.player_number) : null,
        penalty_type: penaltyForm.penalty_type, severity: penaltyForm.severity,
        duration_minutes: PENALTY_DURATIONS[penaltyForm.severity] || 2,
        period: penaltyForm.period, time_in_period: penaltyForm.time_in_period || null,
      }).select().single();
      if (error || !data) { setErrorMsg('Could not save the penalty — check your connection and try again. It was NOT recorded.'); return; }
      setPenalties(prev => [data, ...prev]);
      setPenaltyModal(false);
      setPenaltyForm(prev => ({ ...prev, player_number: '', time_in_period: '' }));
    } finally {
      modalBusyRef.current = false; setModalBusy(false);
    }
  };

  const saveGoalie = async () => {
    if (isLocked) return;
    if (!goalieModal) return;
    if (modalBusyRef.current) return;   // ignore double-taps while the insert is in flight
    modalBusyRef.current = true; setModalBusy(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.from('game_goalie_changes').insert({
        game_id: gameId, team_id: goalieModal,
        goalie_out_number: goalieForm.goalie_out_number ? parseInt(goalieForm.goalie_out_number) : null,
        goalie_in_number: goalieForm.goalie_in_number ? parseInt(goalieForm.goalie_in_number) : null,
        period: goalieForm.period, time_in_period: goalieForm.time_in_period || null,
      }).select().single();
      if (error || !data) { setErrorMsg('Could not save the goalie change — check your connection and try again.'); return; }
      setGoalieChanges(prev => [data, ...prev]);
      setGoalieModal(null);
      setGoalieForm({ goalie_out_number: '', goalie_in_number: '', period, time_in_period: '' });
    } finally {
      modalBusyRef.current = false; setModalBusy(false);
    }
  };

  const deleteGoal = async (id) => {
    if (isLocked) return;
    setErrorMsg('');
    const { error } = await supabase.from('game_goals').delete().eq('id', id);
    if (error) { setErrorMsg('Could not delete the goal — check your connection and try again.'); return; }
    const nextGoals = goals.filter(g => g.id !== id);
    setGoals(nextGoals);
    syncScoreFromGoals(nextGoals);
  };

  const deletePenalty = async (id) => {
    if (isLocked) return;
    setErrorMsg('');
    const { error } = await supabase.from('game_penalties').delete().eq('id', id);
    if (error) { setErrorMsg('Could not delete the penalty — check your connection and try again.'); return; }
    setPenalties(prev => prev.filter(p => p.id !== id));
  };

  if (loadError) return (
    <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📶</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 8 }}>Couldn't load the game</div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)', marginBottom: 18, lineHeight: 1.5 }}>Check your connection — any scoring already saved is safe on the server.</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => { setLoading(true); load(); }} style={{ background: C.red, border: 'none', borderRadius: 999, color: '#fff', padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>↻ Retry</button>
          <button onClick={() => navigate(-1)} style={{ background: C.blue, border: 'none', borderRadius: 999, color: '#fff', padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Back</button>
        </div>
      </div>
    </div>
  );

  if (loading) return <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif' }}>Loading game...</div>;

  if (!authorized) return (
    <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 8 }}>Scorer access only</div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)', marginBottom: 18, lineHeight: 1.5 }}>
          Only the {isLeague ? 'league commissioner or assigned scorekeeper' : 'tournament director or an assigned scorer'} can run live scoring for this game.
        </div>
        <button onClick={() => navigate(-1)} style={{ background: C.blue, border: 'none', borderRadius: 999, color: '#fff', padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Back</button>
      </div>
    </div>
  );

  // Activation gate. RLS already blocks any UPDATE / goal insert / penalty
  // insert when is_activated=false; this wall just keeps users from staring
  // at a scorer UI that silently refuses every write.
  const parentActivated = isLeague
    ? (game?.league?.is_activated !== false)
    : (game?.tournament?.is_activated !== false);
  if (!parentActivated) return (
    <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 8 }}>Activation pending</div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.65)', marginBottom: 18, lineHeight: 1.6 }}>
          Live scoring is locked until Rinkd activates this {isLeague ? 'league' : 'tournament'}.
          Email <a href={`mailto:hello@rinkd.app?subject=${encodeURIComponent((isLeague ? 'League' : 'Tournament') + ' Activation Request')}`} style={{ color: '#F59E0B' }}>hello@rinkd.app</a> to activate.
        </div>
        <button onClick={() => navigate(-1)} style={{ background: C.blue, border: 'none', borderRadius: 999, color: '#fff', padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Back</button>
      </div>
    </div>
  );

  // League games nest team under league_team
  const homeTeam = isLeague
    ? { id: game.home_team?.id, team_name: game.home_team?.team?.name || game.home_team?.team_name }
    : game.home_team;
  const awayTeamRaw = isLeague
    ? { id: game.away_team?.id, team_name: game.away_team?.team?.name || game.away_team?.team_name }
    : game.away_team;
  const awayTeam = isLeague ? awayTeamRaw : game.away_team;
  const periodLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : 'SO';
  const severityColor = (s) => s.includes('Major') || s.includes('Match') ? C.red : '#F59E0B';
  const teamName = (id) => id === homeTeam?.id ? homeTeam?.team_name : awayTeam?.team_name;
  // Total shots per team, summed across periods — derived from the per-period rows.
  const shotTotals = {};
  shotRows.forEach(s => { shotTotals[s.team_id] = (shotTotals[s.team_id] || 0) + (s.count || 0); });

  // Build the period selector dynamically off the tournament's format settings
  // and the game's round. League games (no tournament) keep OT+SO on so the
  // commissioner has the full toolset by default. BLPA-style formats with
  // overtime_allowed=false skip OT entirely; pool/bracket-specific shootout
  // flags decide whether SO shows.
  const settings = isLeague ? {} : (game?.tournament?.settings || {});
  const isBracketRound = !isLeague && !!game?.round && game.round !== 'pool';
  const allowOT = isLeague ? true : (settings.overtime_allowed !== false);
  const allowSO = isLeague ? true : (isBracketRound ? settings.shootout_bracket !== false : !!settings.shootout_pool);
  // For bracket games where the format says no ties (shootout_bracket), the
  // scorer must pick a SO winner before Finalize unlocks. Pool games can end
  // tied so this never gates them.
  const isTied = homeScore === awayScore;
  const requiresShootoutResolution = isBracketRound && allowSO && isTied;
  const needsShootoutPick = requiresShootoutResolution && !shootoutWinner;
  // League: if the scorer marked a tied game as shootout-decided, they must pick the winner.
  const leagueNeedsSoPick = isLeague && isTied && leagueResult === 'so' && !shootoutWinner;
  const finalizeBlocked = needsShootoutPick || leagueNeedsSoPick;
  const resultBtn = (on) => ({ padding: 12, border: `1px solid ${on ? C.red : C.border}`, background: on ? 'rgba(215,38,56,0.18)' : 'rgba(46,91,140,0.15)', color: C.ice, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' });
  const numPeriods = settings.num_periods ?? 3;
  const periodOptions = [
    ['1', '1st'],
    ...(numPeriods >= 2 ? [['2', '2nd']] : []),
    ...(numPeriods >= 3 ? [['3', '3rd']] : []),
    ...(allowOT ? [['4', 'OT']] : []),
    ...(allowSO ? [['5', 'SO']] : []),
    ['final', 'Final'],
  ];
  // Same trim for the in-modal "Period" dropdowns. Keep parallel with the
  // top-of-page selector so a goal can never be logged in a hidden period.
  const modalPeriods = [1, ...(numPeriods >= 2 ? [2] : []), ...(numPeriods >= 3 ? [3] : []), ...(allowOT ? [4] : []), ...(allowSO ? [5] : [])];
  const modalPeriodLabel = (n) => n === 4 ? 'OT' : n === 5 ? 'SO' : n === 1 ? '1st' : n === 2 ? '2nd' : '3rd';

  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: '#F4F7FA', maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>

      {/* HEADER */}
      <div style={{ background: C.navy, padding: '14px 16px', borderBottom: '0.5px solid rgba(46,91,140,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Games</button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 15, color: '#F4F7FA' }}>{homeTeam?.team_name} vs {awayTeam?.team_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{game.rink?.sub_rink} · {isLeague ? game.league?.name : game.tournament?.name}</div>
        </div>
        <span style={{ background: status === 'live' ? 'rgba(215,38,56,0.15)' : status === 'final' ? 'rgba(244,247,250,0.08)' : 'rgba(46,91,140,0.3)', color: status === 'live' ? C.red : status === 'final' ? 'rgba(244,247,250,0.5)' : '#F4F7FA', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
          {status === 'live' ? '● LIVE' : status === 'final' ? 'FINAL' : 'SCHEDULED'}
        </span>
      </div>

      {errorMsg && (
        <div onClick={() => setErrorMsg('')}
          style={{ background: 'rgba(215,38,56,0.18)', borderBottom: '0.5px solid rgba(215,38,56,0.6)', color: '#F4F7FA', padding: '11px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center' }}>
          ⚠ {errorMsg} <span style={{ opacity: 0.6, fontWeight: 400 }}>· tap to dismiss</span>
        </div>
      )}

      {/* LOCKED banner — visible whenever the game is finalized. Tells the
          scorer the tool is read-only and points the director at Reopen. */}
      {isLocked && (
        <div style={{ background: 'rgba(46,91,140,0.18)', borderBottom: '0.5px solid rgba(46,91,140,0.6)', color: C.ice, padding: '11px 16px', fontSize: 13, lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span>🔒 Game is finalized — scoring is locked.</span>
          {isDirector
            ? <button onClick={reopenGame} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>🔓 Reopen Game</button>
            : <span style={{ color: 'rgba(244,247,250,0.55)', fontSize: 12 }}>Only the {isLeague ? 'commissioner' : 'director'} can reopen.</span>}
        </div>
      )}

      {/* Wake Lock unsupported (older iOS Safari, in-app browsers) — warn
          scorekeepers so they know their phone screen may sleep mid-game. */}
      {!wakeLockSupported && (
        <div style={{ background: 'rgba(245,158,11,0.12)', borderBottom: '0.5px solid rgba(245,158,11,0.4)', color: '#F4F7FA', padding: '10px 16px', fontSize: 12, lineHeight: 1.45, textAlign: 'center' }}>
          ⚠ Your browser may dim or sleep the screen during play. Tap the screen every few minutes, or open in Safari 16.4+ / Chrome to keep it awake automatically.
        </div>
      )}

      <div style={{ padding: 16 }}>

        {/* SCORE + GOAL LOG — combined card */}
        <SecLabel>Score & Goals {saving && <span style={{ color: 'rgba(244,247,250,0.3)', fontWeight: 400, textTransform: 'none', fontSize: 10 }}>saving...</span>}</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>

          {/* Score section */}
          <div style={{ padding: '14px 16px', borderBottom: '0.5px solid rgba(46,91,140,0.3)' }}>
            {[[homeTeam, homeScore, 'home'], [awayTeam, awayScore, 'away']].map(([team, score, side], i) => (
              <div key={side} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '0.5px solid rgba(244,247,250,0.07)' : 'none', marginTop: i > 0 ? 6 : 0, paddingTop: i > 0 ? 12 : 6 }}>
                {/* Tap the team name (or the big score) to open the goal form for that side. */}
                <div
                  role={!isLocked ? 'button' : undefined}
                  tabIndex={!isLocked ? 0 : undefined}
                  onClick={!isLocked ? () => openGoalForTeam(side) : undefined}
                  onKeyDown={!isLocked ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGoalForTeam(side); } } : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minHeight: 44, cursor: !isLocked ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F4F7FA' }}>{team?.team_name}</div>
                  {!isLocked && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.blue, border: `0.5px solid ${C.blue}`, borderRadius: 6, padding: '2px 6px', flexShrink: 0 }}>+ Goal</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {!isLocked && <ScoreBtn onClick={() => changeScore(side, -1)} variant="minus">−</ScoreBtn>}
                  <div
                    onClick={!isLocked ? () => openGoalForTeam(side) : undefined}
                    title={!isLocked ? 'Tap to log a goal' : undefined}
                    style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 44, color: '#F4F7FA', width: 56, textAlign: 'center', lineHeight: 1, cursor: !isLocked ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}>{score}</div>
                  {!isLocked && <ScoreBtn onClick={() => openGoalForTeam(side)} variant="plus">+</ScoreBtn>}
                </div>
              </div>
            ))}
            {!isLocked && <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.25)', textAlign: 'center', marginTop: 8 }}>Tap a team, its score, or + to log a goal · use − to fix the score</div>}
          </div>

          {/* Goal log section */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>Goal Log ({goals.length})</div>
            {goals.length === 0 && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center', padding: '8px 0' }}>No goals logged yet</div>}
            {goals.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: g.team_id === homeTeam?.id ? '#1a4a7a' : '#6b1520', flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>
                    {g.scorer_number ? `#${g.scorer_number}` : 'Unknown'}
                    {g.assist1_number ? ` — assist: #${g.assist1_number}` : ' — unassisted'}
                    {g.assist2_number ? `, #${g.assist2_number}` : ''}
                    {g.is_shootout ? ' (SO)' : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{teamName(g.team_id)} · {periodLabel(g.period)}{g.time_in_period ? ` · ${g.time_in_period}` : ''}</div>
                </div>
                {!isLocked && (
                  <button onClick={() => deleteGoal(g.id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 14 }}
                    onMouseEnter={e => e.currentTarget.style.color = C.red}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
                )}
              </div>
            ))}
            {!isLocked && <AddBtn onClick={() => { setGoalForm(prev => ({ ...prev, period })); setGoalModal(true); }}>+ Log Goal</AddBtn>}
          </div>
        </div>

        {/* PERIOD — hidden when locked. The selector's only purpose is to
            advance period state during a live game, so it's noise after
            finalize. The current period is still visible in the goal log
            rows ("3rd · 10:42") for reference. */}
        {!isLocked && <SecLabel>Period</SecLabel>}
        {!isLocked && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${periodOptions.length},1fr)`, gap: 6, marginBottom: 16 }}>
          {periodOptions.map(([val, label]) => {
            const isActive = val === 'final' ? status === 'final' : parseInt(val) === period && status !== 'final';
            const isFinal = val === 'final';
            return (
              <button key={val} onClick={() => changePeriod(val)}
                style={{ padding: '9px 0', border: `0.5px solid ${isActive ? (isFinal ? 'rgba(215,38,56,0.35)' : C.blue) : C.border}`, borderRadius: 8, background: isActive ? (isFinal ? 'rgba(215,38,56,0.15)' : C.blue) : 'rgba(46,91,140,0.1)', color: isActive ? (isFinal ? C.red : '#F4F7FA') : '#F4F7FA', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', opacity: isActive ? 1 : 0.5, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? (isFinal ? 'rgba(215,38,56,0.15)' : C.blue) : 'rgba(46,91,140,0.1)'; e.currentTarget.style.color = isActive ? (isFinal ? C.red : '#F4F7FA') : '#F4F7FA'; e.currentTarget.style.opacity = isActive ? '1' : '0.5'; }}>
                {label}
              </button>
            );
          })}
        </div>}

        {/* SHOTS */}
        <SecLabel>Shots on Goal</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {[homeTeam, awayTeam].map((team, i) => (
            <div key={team?.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i > 0 ? '0.5px solid rgba(244,247,250,0.07)' : 'none' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#F4F7FA', flex: 1 }}>{team?.team_name}</span>
              {!isLocked && <button onClick={() => changeShots(team?.id, -1)} style={{ width: 36, height: 36, background: 'rgba(244,247,250,0.08)', border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 18, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,247,250,0.08)'; e.currentTarget.style.color = '#F4F7FA'; }}>−</button>}
              <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 32, color: '#F4F7FA', width: 48, textAlign: 'center' }}>{shotTotals[team?.id] || 0}</span>
              {!isLocked && <button onClick={() => changeShots(team?.id, 1)} style={{ width: 44, height: 44, background: C.blue, border: 'none', borderRadius: 8, color: '#F4F7FA', fontSize: 22, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.blue; e.currentTarget.style.color = '#F4F7FA'; }}>+</button>}
            </div>
          ))}
        </div>

        {/* PENALTIES */}
        <SecLabel>Penalties ({penalties.length})</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {penalties.length === 0 && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center', padding: '8px 0' }}>No penalties logged yet</div>}
          {penalties.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap', marginTop: 2, background: `${severityColor(p.severity)}22`, color: severityColor(p.severity) }}>
                {p.severity.includes('Major') || p.severity.includes('Match') ? 'MAJOR' : p.severity.includes('Double') ? 'DBL MIN' : 'MINOR'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{p.player_number ? `#${p.player_number} ` : ''}{teamName(p.team_id)} — {p.penalty_type}</div>
                <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{periodLabel(p.period)}{p.time_in_period ? ` · ${p.time_in_period}` : ''} · {p.duration_minutes} min</div>
              </div>
              {!isLocked && (
                <button onClick={() => deletePenalty(p.id)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.2)', cursor: 'pointer', fontSize: 14 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.red}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(244,247,250,0.2)'}>✕</button>
              )}
            </div>
          ))}
          {!isLocked && <AddBtn onClick={() => { setPenaltyForm(prev => ({ ...prev, period })); setPenaltyModal(true); }}>+ Add Penalty</AddBtn>}
        </div>

        {/* GOALIE CHANGES */}
        <SecLabel>Goalie Changes</SecLabel>
        <div style={{ background: C.card, border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          {[homeTeam, awayTeam].map((team, ti) => (
            <div key={team?.id}>
              {ti > 0 && <div style={{ height: '0.5px', background: 'rgba(244,247,250,0.06)', margin: '12px 0' }} />}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(244,247,250,0.35)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{team?.team_name}</div>
              {goalieChanges.filter(g => g.team_id === team?.id).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F4F7FA' }}>{c.goalie_out_number ? `#${c.goalie_out_number}` : '?'} → {c.goalie_in_number ? `#${c.goalie_in_number}` : '?'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{periodLabel(c.period)}{c.time_in_period ? ` · ${c.time_in_period}` : ''}</div>
                  </div>
                </div>
              ))}
              {!isLocked && <AddBtn onClick={() => { setGoalieForm({ goalie_out_number: '', goalie_in_number: '', period, time_in_period: '' }); setGoalieModal(team?.id); }}>+ Log Change — {team?.team_name}</AddBtn>}
            </div>
          ))}
        </div>

        {/* FINALIZE */}
        {status === 'final' && (
          <button onClick={() => setShowScoresheet(true)}
            style={{ width: '100%', padding: 14, background: '#2E5B8C', border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 10, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2E5B8C'; e.currentTarget.style.color = '#fff'; }}>
            📄 Generate Official Scoresheet
          </button>
        )}
        {/* Shootout-winner picker — bracket games can't end in a tie when
            shootout_bracket is on, so we make the scorer explicitly pick
            who won the SO before Finalize unlocks. Standings + champion
            resolution read games.shootout_winner from here. */}
        {needsShootoutPick && !isLocked && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F59E0B', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Shootout winner</div>
            <div style={{ fontSize: 13, color: C.ice, marginBottom: 12, lineHeight: 1.45 }}>
              Tied {homeScore}–{awayScore} after regulation. {isBracketRound ? 'Bracket games' : 'This game'} can't end tied — tap whoever took the shootout.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['home', homeTeam?.team_name],
                ['away', awayTeam?.team_name],
              ].map(([side, name]) => (
                <button key={side} onClick={() => setShootoutWinner(side)}
                  style={{
                    padding: 12,
                    border: `1px solid ${shootoutWinner === side ? '#F59E0B' : C.border}`,
                    background: shootoutWinner === side ? 'rgba(245,158,11,0.22)' : 'rgba(46,91,140,0.15)',
                    color: C.ice, borderRadius: 10,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Barlow, sans-serif',
                  }}>
                  {shootoutWinner === side ? '✓ ' : ''}{name}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* League OTL capture (LEAGUE-DIV-1 M3) — how did this game end? Drives
            the OTL standings column. Tournament games use their own SO flow above. */}
        {isLeague && !isLocked && status !== 'final' && (
          !isTied ? (
            <div style={{ background: 'rgba(46,91,140,0.12)', border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>How did it end?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['regulation', 'Regulation'], ['ot', 'Overtime']].map(([v, label]) => (
                  <button key={v} onClick={() => setLeagueResult(v)} style={resultBtn(leagueResult === v)}>{leagueResult === v ? '✓ ' : ''}{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 8 }}>Overtime gives the losing team an OTL (1 pt).</div>
            </div>
          ) : (
            <div style={{ background: 'rgba(46,91,140,0.12)', border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Tied {homeScore}–{awayScore} — result?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: leagueResult === 'so' ? 10 : 0 }}>
                {[['regulation', 'Tie'], ['so', 'Shootout']].map(([v, label]) => (
                  <button key={v} onClick={() => setLeagueResult(v)} style={resultBtn(leagueResult === v)}>{leagueResult === v ? '✓ ' : ''}{label}</button>
                ))}
              </div>
              {leagueResult === 'so' && (
                <>
                  <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.5)', marginBottom: 8 }}>Who won the shootout? (loser gets an OTL)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[['home', homeTeam?.team_name], ['away', awayTeam?.team_name]].map(([side, name]) => (
                      <button key={side} onClick={() => setShootoutWinner(side)} style={resultBtn(shootoutWinner === side)}>{shootoutWinner === side ? '✓ ' : ''}{name}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        )}
        {status !== 'final'
          ? <button onClick={() => changePeriod('final')} disabled={finalizeBlocked || saving}
              style={{ width: '100%', padding: 14, background: (finalizeBlocked || saving) ? C.border : C.red, border: 'none', borderRadius: 999, color: '#fff', fontSize: 15, fontWeight: 700, cursor: (finalizeBlocked || saving) ? 'not-allowed' : 'pointer', fontFamily: 'Barlow, sans-serif', marginTop: 4, transition: 'all 0.15s', opacity: (finalizeBlocked || saving) ? 0.6 : 1 }}
              onMouseEnter={e => { if (!(finalizeBlocked || saving)) { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
              {saving ? '⏳ Finalizing…' : '🏒 Finalize Game'}
            </button>
          : <div style={{ textAlign: 'center', padding: 14, background: 'rgba(215,38,56,0.1)', border: '0.5px solid rgba(215,38,56,0.3)', borderRadius: 999, fontSize: 14, fontWeight: 700, color: C.red }}>✓ Game Finalized — Standings Updated</div>
        }
      </div>

      {showScoresheet && (
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F4F7FA', fontFamily: 'Barlow, sans-serif' }}>Preparing scoresheet…</div>}>
          <Scoresheet
            game={{ ...game, home_score: homeScore, away_score: awayScore }}
            goals={goals}
            penalties={penalties}
            shots={shotTotals}
            goalieChanges={goalieChanges}
            isLeague={isLeague}
            onClose={() => setShowScoresheet(false)}
          />
        </Suspense>
      )}

      {/* GOAL MODAL */}
      {goalModal && (
        <Modal title="Log Goal" onClose={() => setGoalModal(false)} onSave={saveGoal} saveLabel="Save Goal" busy={modalBusy}>
          <MField label="Team">
            <select style={selectStyle} value={goalForm.team_id} onChange={e => setGoalForm(p => ({ ...p, team_id: e.target.value }))}>
              <option value={homeTeam?.id}>{homeTeam?.team_name}</option>
              <option value={awayTeam?.id}>{awayTeam?.team_name}</option>
            </select>
          </MField>
          <Row2>
            <MField label="Scorer #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalForm.scorer_number} onChange={e => setGoalForm(p => ({ ...p, scorer_number: e.target.value }))} /></MField>
            <MField label="Assist 1 #"><input style={inputStyle} type="number" placeholder="Optional" value={goalForm.assist1_number} onChange={e => setGoalForm(p => ({ ...p, assist1_number: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Assist 2 #"><input style={inputStyle} type="number" placeholder="Optional" value={goalForm.assist2_number} onChange={e => setGoalForm(p => ({ ...p, assist2_number: e.target.value }))} /></MField>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 8:42" value={goalForm.time_in_period} onChange={e => setGoalForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Period">
              <select style={selectStyle} value={goalForm.period} onChange={e => setGoalForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
                {modalPeriods.map(n => <option key={n} value={n}>{modalPeriodLabel(n)}</option>)}
              </select>
            </MField>
            <MField label="Shootout?">
              <select style={selectStyle} value={goalForm.is_shootout ? 'yes' : 'no'} onChange={e => setGoalForm(p => ({ ...p, is_shootout: e.target.value === 'yes' }))}>
                <option value="no">No</option>
                <option value="yes">Yes (SO)</option>
              </select>
            </MField>
          </Row2>
        </Modal>
      )}

      {/* PENALTY MODAL */}
      {penaltyModal && (
        <Modal title="Add Penalty" onClose={() => setPenaltyModal(false)} onSave={savePenalty} saveLabel="Save Penalty" busy={modalBusy}>
          <MField label="Team">
            <select style={selectStyle} value={penaltyForm.team_id} onChange={e => setPenaltyForm(p => ({ ...p, team_id: e.target.value }))}>
              <option value={homeTeam?.id}>{homeTeam?.team_name}</option>
              <option value={awayTeam?.id}>{awayTeam?.team_name}</option>
            </select>
          </MField>
          <Row2>
            <MField label="Player #"><input style={inputStyle} type="number" placeholder="Jersey #" value={penaltyForm.player_number} onChange={e => setPenaltyForm(p => ({ ...p, player_number: e.target.value }))} /></MField>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 11:20" value={penaltyForm.time_in_period} onChange={e => setPenaltyForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
          </Row2>
          <MField label="Severity">
            <select style={selectStyle} value={penaltyForm.severity} onChange={e => setPenaltyForm(p => ({ ...p, severity: e.target.value, penalty_type: PENALTIES[e.target.value]?.[0] || '' }))}>
              {Object.keys(PENALTIES).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </MField>
          <MField label="Penalty">
            <select style={selectStyle} value={penaltyForm.penalty_type} onChange={e => setPenaltyForm(p => ({ ...p, penalty_type: e.target.value }))}>
              {(PENALTIES[penaltyForm.severity] || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
            </select>
          </MField>
          <MField label="Period">
            <select style={selectStyle} value={penaltyForm.period} onChange={e => setPenaltyForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
              {modalPeriods.map(n => <option key={n} value={n}>{modalPeriodLabel(n)}</option>)}
            </select>
          </MField>
        </Modal>
      )}

      {/* GOALIE MODAL */}
      {goalieModal && (
        <Modal title={`Goalie Change — ${teamName(goalieModal)}`} onClose={() => setGoalieModal(null)} onSave={saveGoalie} saveLabel="Save Change" busy={modalBusy}>
          <Row2>
            <MField label="Out #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalieForm.goalie_out_number} onChange={e => setGoalieForm(p => ({ ...p, goalie_out_number: e.target.value }))} /></MField>
            <MField label="In #"><input style={inputStyle} type="number" placeholder="Jersey #" value={goalieForm.goalie_in_number} onChange={e => setGoalieForm(p => ({ ...p, goalie_in_number: e.target.value }))} /></MField>
          </Row2>
          <Row2>
            <MField label="Time (mm:ss)"><input style={inputStyle} placeholder="e.g. 10:00" value={goalieForm.time_in_period} onChange={e => setGoalieForm(p => ({ ...p, time_in_period: e.target.value }))} /></MField>
            <MField label="Period">
              <select style={selectStyle} value={goalieForm.period} onChange={e => setGoalieForm(p => ({ ...p, period: parseInt(e.target.value) }))}>
                {modalPeriods.map(n => <option key={n} value={n}>{modalPeriodLabel(n)}</option>)}
              </select>
            </MField>
          </Row2>
        </Modal>
      )}

    </div>
  );
}
