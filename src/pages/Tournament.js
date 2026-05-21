import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LedR } from '../components/Logos';
import { getLiveBarnUrl } from '../lib/livebarn';
import { teamInitials } from '../lib/teamInitials';
import { followTournament, unfollowTournament, isFollowingTournament } from '../lib/tournamentSubscriptions';
import { subscribeToPush, isPushSubscribed } from '../lib/push';
import { iosCanInstallButHasnt } from '../lib/platform';
import { IOS_INSTALL_EVENT } from '../components/IOSInstallBanner';
import { getTournamentPosts, createPost, uploadMedia, timeAgo } from '../lib/posts';
import { isExtraDirector as isDirectorRole } from '../lib/tournamentDirectors';
import { track } from '../lib/analytics';
import PostActionMenu from '../components/PostActionMenu';


const TABS = ['Standings','Schedule','Bracket','Feed','Info'];

// Bracket rounds get visual weight on the schedule and a championship hero on
// the bracket tab. Pool play is the catch-all everything else.
const ROUND_LABEL = {
  pool: 'Pool', quarterfinal: 'Quarterfinal', qf: 'Quarterfinal',
  semifinal: 'Semifinal', sf: 'Semifinal',
  final: 'Championship', championship: 'Championship',
  consolation: 'Bronze Medal', bronze: 'Bronze Medal',
};

// Re-sort a single pool's rows by the tournament's tiebreaker list. The view
// already sorts by the BLPA default (pts → GQ → period_pts → goal_diff →
// gf), so this only matters for DEX-style formats that want lowest PIM as
// the secondary key. Returns a new array; never mutates.
function sortByTiebreakers(rows, tiebreakers) {
  if (!Array.isArray(tiebreakers) || tiebreakers.length === 0) return rows;
  const cmp = {
    points:         (a, b) => (b.pts ?? 0) - (a.pts ?? 0),
    goal_quotient:  (a, b) => (b.goal_quotient ?? 0) - (a.goal_quotient ?? 0),
    period_points:  (a, b) => (b.period_pts ?? 0) - (a.period_pts ?? 0),
    lowest_pim:     (a, b) => (a.pim ?? 0) - (b.pim ?? 0),    // ASC: lower PIM ranks higher
    penalty_minutes:(a, b) => (a.pim ?? 0) - (b.pim ?? 0),    // alias
    goal_diff:      (a, b) => (b.goal_diff ?? 0) - (a.goal_diff ?? 0),
    goals_for:      (a, b) => (b.gf ?? 0) - (a.gf ?? 0),
    goals_against:  (a, b) => (a.ga ?? 0) - (b.ga ?? 0),       // ASC: fewer goals allowed ranks higher
    head_to_head:   () => 0,                                    // computed separately if ever wired
    coin_toss:      () => 0,
  };
  // Always start with points if the tiebreaker list doesn't lead with it
  // — every format ranks by points first.
  const ordered = tiebreakers[0] === 'points' ? tiebreakers : ['points', ...tiebreakers];
  return [...rows].sort((a, b) => {
    for (const tb of ordered) {
      const fn = cmp[tb];
      if (!fn) continue;
      const v = fn(a, b);
      if (v !== 0) return v;
    }
    return 0;
  });
}

function fmtGameTime(iso) {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDayHeading(iso) {
  if (!iso) return 'Date TBD';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function dayKey(iso) {
  if (!iso) return 'tbd';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function TournamentPage({ currentUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Standings');
  const [tournament, setTournament] = useState(null);
  const [games, setGames] = useState([]);
  const [standings, setStandings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Whether the current user has a 'scorer' role on this tournament. Assigned
  // scorers should see the "Open Scorer View" button on each game card — not
  // just the director. Loaded once after the tournament resolves.
  const [isAssignedScorer, setIsAssignedScorer] = useState(false);
  // "🔔 Follow tournament" — controls whether the user gets a push when
  // any game in this tournament finalizes (per send-recap-push Edge
  // Function targeting). Loaded once on mount.
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // Additional directors granted via tournament_roles — Tournament.js needs
  // this to gate the Manage button, canScore, and Follow-button-hiding the
  // same way the original tournaments.director_id does.
  const [isExtraDirector, setIsExtraDirector] = useState(false);
  // Tournament-scoped Feed tab — auto-recaps land here when a game finalizes
  // (see createGameRecapPost). Lazy-loaded the first time the Feed tab opens
  // so the standings/schedule landing stays fast.
  const [feedPosts, setFeedPosts] = useState(null); // null = not loaded yet
  const [feedLoading, setFeedLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load tournament
      const { data: t, error: te } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', id)
        .single();
      if (te) { setError(te.message); setLoading(false); return; }
      setTournament(t);

      // Load games — surface error instead of silently rendering the empty state.
      const { data: g, error: ge } = await supabase
        .from('games')
        .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool), away_team:tournament_teams!away_team_id(id,team_name,pool), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
        .eq('tournament_id', id)
        .order('start_time', { ascending: true });
      if (ge) { setError(ge.message); setLoading(false); return; }
      setGames(g || []);

      // Load standings — same treatment so a failed query doesn't masquerade
      // as "no games played yet."
      const { data: s, error: se } = await supabase
        .from('tournament_standings')
        .select('*')
        .eq('tournament_id', id)
        .order('pool', { ascending: true })
        .order('pool_rank', { ascending: true });
      if (se) { setError(se.message); setLoading(false); return; }
      const grouped = (s || []).reduce((acc, row) => {
        if (!acc[row.pool]) acc[row.pool] = [];
        acc[row.pool].push(row);
        return acc;
      }, {});
      setStandings(grouped);

    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // One view event per page load for EVERY visitor (not just logged-out),
  // tagged with an `anonymous` flag — lets us measure total interest in a
  // shared event page and still isolate share-driven anon traffic. Ref-guarded
  // so it fires once. (Previously this lived only in the anon
  // PublicTournamentLanding branch, so logged-in views — the bulk of our
  // traffic — went completely uncounted.)
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (!tournament?.id || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track('tournament_public_view', { tournament_id: tournament.id, anonymous: !currentUser });
  }, [tournament?.id, currentUser]);

  // Realtime subscription — spectators see standings and scores update live as
  // games finish. Channel name carries a per-call random suffix so a remount
  // (StrictMode in dev, route revisit) doesn't collide with the prior channel.
  // The notifications module uses the same pattern; mirror it for consistency.
  //
  // Note: we subscribe only to the `games` table — `tournament_standings` is
  // a VIEW, which Postgres logical replication does not stream. Standings
  // refresh automatically because load() re-fetches both games and standings
  // whenever a games row changes.
  useEffect(() => {
    if (!id) return;
    let channel = null;
    // Coalesce bursts of games changes (a scorer entering several goals in a
    // row, or multiple games finalizing at once) into one reload per ~1.5s
    // window. Without this, every goal tap by any scorer re-ran the full
    // load() — including the tournament_standings view recompute — for every
    // spectator with the page open. The debounce keeps updates feeling live
    // while cutting redundant reloads (and view recomputes) under load.
    let reloadTimer = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { try { load(); } catch { /* swallow */ } }, 1500);
    };
    try {
      const name = `tournament:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase.channel(name)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${id}` },
          scheduleReload)
        .subscribe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[tournament] realtime subscribe failed; spectators will see stale data until they refresh:', err);
    }
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ }
    };
  }, [id, load]);

  // Resolve whether the signed-in user has a scorer role on THIS tournament.
  // RLS on tournament_roles allows users to read their own rows, so this is
  // a single cheap query. Re-runs when the tournament id or current user
  // changes — not on every standings update.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsAssignedScorer(false); return; }
    (async () => {
      const { data } = await supabase
        .from('tournament_roles')
        .select('role')
        .eq('tournament_id', id)
        .eq('user_id', currentUser.id)
        .eq('role', 'scorer')
        .maybeSingle();
      if (!cancelled) setIsAssignedScorer(!!data);
    })();
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  // Same cheap-query pattern for the follow state.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsFollowing(false); return; }
    isFollowingTournament(currentUser.id, id).then((v) => { if (!cancelled) setIsFollowing(v); });
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  // And for the additional-director check.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsExtraDirector(false); return; }
    isDirectorRole(currentUser.id, id).then((v) => { if (!cancelled) setIsExtraDirector(v); });
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  // Lazy-load the tournament-scoped feed the first time the Feed tab opens.
  // Avoids paying for the query on every visit when most users land on
  // Standings/Schedule and never click Feed.
  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'Feed' || !id || feedPosts !== null) return;
    setFeedLoading(true);
    getTournamentPosts(id, 50).then(({ data }) => {
      if (cancelled) return;
      setFeedPosts(data || []);
      setFeedLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeTab, id, feedPosts]);

  const handleFollowToggle = async () => {
    if (!currentUser?.id || !id || followBusy) return;
    setFollowBusy(true);
    if (isFollowing) {
      const { error } = await unfollowTournament(currentUser.id, id);
      setFollowBusy(false);
      if (!error) setIsFollowing(false);
      return;
    }
    // First-time follow: make sure push notifications are actually wired up.
    // Without an existing browser subscription the DB row is created but no
    // push ever reaches the device. subscribeToPush() prompts for permission
    // and stashes the push_subscriptions row. Skip the prompt if already on.
    const alreadyOn = await isPushSubscribed();
    if (!alreadyOn) {
      const sub = await subscribeToPush(currentUser.id);
      if (!sub) {
        setFollowBusy(false);
        if (iosCanInstallButHasnt()) {
          // On iOS Safari push is blocked until the PWA is on the home screen
          // — surface the install banner (which shows how) at this high-intent
          // moment instead of a dead-end alert that points to a Profile toggle
          // that also can't work until they install.
          window.dispatchEvent(new CustomEvent(IOS_INSTALL_EVENT));
        } else {
          // eslint-disable-next-line no-alert
          window.alert("Push notifications are off for this device, so following won't deliver pushes yet. You can still enable them later from your Profile.");
        }
        // Continue with the DB follow anyway — once they enable push, future
        // recaps will deliver.
      }
    }
    const { error } = await followTournament(currentUser.id, id);
    setFollowBusy(false);
    if (!error) setIsFollowing(true);
  };

  if (loading) return (
    <div style={{background:'#07111F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#F4F7FA',fontFamily:'Barlow,sans-serif',fontSize:14}}>
      Loading tournament...
    </div>
  );

  if (error || !tournament) {
    // Anonymous visitors hitting a draft tournament URL get filtered out by
    // tournaments_public_read RLS (status must be active/complete) — so the
    // friendly framing is "sign in to view", not "retry."
    const isAnon = !currentUser;
    return (
      <div style={{background:'#07111F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#F4F7FA',fontFamily:'Barlow,sans-serif',fontSize:14,padding:20,textAlign:'center'}}>
        <div style={{maxWidth:380}}>
          <div style={{fontSize:32,marginBottom:10}}>{isAnon ? '🔒' : '⚠️'}</div>
          <div style={{color:isAnon ? '#F4F7FA' : '#D72638',marginBottom:4,fontWeight:600}}>
            {isAnon ? 'This tournament is private' : "Couldn't load this tournament"}
          </div>
          <div style={{color:'rgba(244,247,250,0.5)',fontSize:12,marginBottom:16,lineHeight:1.5}}>
            {isAnon
              ? 'Sign in to view standings, schedule, and bracket — or it may not be published yet.'
              : (error || 'Tournament not found.')}
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
            {isAnon
              ? <>
                  <button onClick={() => navigate('/login')} style={{background:'#D72638',color:'#fff',border:'none',borderRadius:8,padding:'9px 20px',cursor:'pointer',fontFamily:'Barlow,sans-serif',fontWeight:700}}>Sign in / Sign up</button>
                  <button onClick={() => navigate('/tournaments')} style={{background:'#2E5B8C',color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>Browse tournaments</button>
                </>
              : <>
                  <button onClick={load} style={{background:'#D72638',color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',cursor:'pointer',fontFamily:'Barlow,sans-serif',fontWeight:700}}>Retry</button>
                  <button onClick={() => navigate('/feed')} style={{background:'#2E5B8C',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>Back to Feed</button>
                </>}
          </div>
        </div>
      </div>
    );
  }

  // Anonymous spectators: render a teaser landing page with tournament
  // metadata + teams. Standings, schedule, bracket, and scoresheet stay
  // gated to drive sign-up. After auth they can navigate back here for
  // the full experience.
  if (!currentUser) {
    return <PublicTournamentLanding tournament={tournament} games={games} navigate={navigate} />;
  }

  const liveGames = games.filter(g => g.status === 'live');
  const finalGames = games.filter(g => g.status === 'final');
  const scheduledGames = games.filter(g => g.status === 'scheduled');
  const bracketGames = games.filter(g => g.round && g.round !== 'pool');
  const adv = tournament?.settings?.advancement_per_pool ?? 2;
  // Tiebreaker config drives which standings columns to show. Default to
  // BLPA Bash order so older tournaments without an explicit list render
  // the same way; DEX puts lowest_pim second instead of goal_quotient.
  const tiebreakers = tournament?.settings?.tiebreakers || ['points', 'goal_quotient', 'period_points'];
  const showGQ = tiebreakers.includes('goal_quotient');
  const showPIM = tiebreakers.includes('lowest_pim') || tiebreakers.includes('penalty_minutes');
  const showPeriodPts = tiebreakers.includes('period_points');
  // Champion = the team that won the championship/final game when it's
  // marked final. Used by the Bracket tab to show a podium banner for
  // small brackets (1-per-pool advancement = single final).
  const champion = (() => {
    const finalRound = bracketGames.find(g => (g.round === 'final' || g.round === 'championship') && g.status === 'final');
    if (!finalRound) return null;
    // SO-decided championship: shootout_winner wins regardless of regulation tie.
    if (finalRound.shootout_winner === 'home') return finalRound.home_team;
    if (finalRound.shootout_winner === 'away') return finalRound.away_team;
    const homeWon = (finalRound.home_score ?? 0) > (finalRound.away_score ?? 0);
    return homeWon ? finalRound.home_team : finalRound.away_team;
  })();
  // Organizer branding — falls back to Rinkd red when the tournament isn't branded.
  const accent = tournament?.accent_color || '#D72638';
  // Directors AND assigned scorers see the in-card "Open Scorer View"
  // shortcut. ScorerView itself enforces the actual access check, so this is
  // purely about which users see the button — spectators don't.
  // True for the founding director, any added director (tournament_roles
  // role='director'), or any assigned scorer.
  const isDirector = !!(currentUser && tournament && (
    tournament.director_id === currentUser.id || isExtraDirector
  ));
  const canScore = !!(currentUser && tournament && (isDirector || isAssignedScorer));

  return (
    <div style={{background:'#07111F',minHeight:'100vh',fontFamily:'Barlow,sans-serif',color:'#F4F7FA'}}>

      {/* HEADER */}
      <div style={{background:'#0B1F3A',padding:'14px 16px 0',borderTop:`3px solid ${accent}`,borderBottom:'0.5px solid rgba(46,91,140,0.4)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8,flexWrap:'wrap'}}>
          <button onClick={() => navigate(-1)} style={{color:'rgba(244,247,250,0.6)',fontSize:13,background:'none',border:'none',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>← Events</button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {liveGames.length > 0 && <span style={{background:accent+'26',color:accent,fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20}}>● Live now</span>}
            {tournament && tournament.is_activated === false && (
              <span title="Live scoring + push notifications are locked until a Rinkd admin activates this tournament."
                style={{background:'rgba(245,158,11,0.18)',color:'#F59E0B',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,letterSpacing:'0.04em'}}>
                🔒 Activation pending
              </span>
            )}
            {/* Follow toggle — opt-in for tournament push notifications. Fires
                a one-time push permission prompt the first time (handled
                inside handleFollowToggle). Director gets the Manage button
                instead since they're already getting events from their own
                writes. */}
            {tournament && currentUser && !isDirector && (
              <button onClick={handleFollowToggle} disabled={followBusy}
                style={{
                  background: isFollowing ? 'rgba(46,91,140,0.25)' : accent,
                  color: isFollowing ? '#F4F7FA' : '#fff',
                  border: isFollowing ? '1px solid rgba(46,91,140,0.5)' : 'none',
                  borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 700,
                  cursor: followBusy ? 'wait' : 'pointer',
                  fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  opacity: followBusy ? 0.6 : 1,
                }}>
                {followBusy ? '...' : isFollowing ? '🔕 Following' : '🔔 Follow'}
              </button>
            )}
            {tournament && currentUser && isDirector && (
              <button onClick={() => navigate(`/tournament/${id}/manage`)}
                style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',letterSpacing:'0.05em',textTransform:'uppercase'}}>
                ⚙ Manage
              </button>
            )}
          </div>
        </div>
        {tournament?.logo_url && (
          <img src={tournament.logo_url} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}
            style={{height:38,width:'auto',display:'block',marginBottom:8,borderRadius:6}} />
        )}
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:22}}>
          {(tournament?.name || '').toUpperCase()} · {tournament?.division}
        </div>
        <div style={{fontSize:12,color:'rgba(244,247,250,0.4)',margin:'3px 0 12px'}}>
          {tournament?.start_date} – {tournament?.end_date}
        </div>
        <div style={{display:'flex',overflowX:'auto',borderBottom:'2px solid rgba(46,91,140,0.3)'}}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{fontSize:13,fontWeight:700,padding:'10px 16px',background:'transparent',border:'none',
                borderBottom: activeTab===tab ? `3px solid ${accent}` : '3px solid transparent',
                marginBottom:-2,cursor:'pointer',fontFamily:'Barlow,sans-serif',whiteSpace:'nowrap',
                color:'#FFFFFF', opacity: activeTab===tab ? 1 : 0.5}}
              onMouseEnter={e=>{e.currentTarget.style.background='#FFFFFF';e.currentTarget.style.color='#0B1F3A';e.currentTarget.style.opacity='1';}}
              onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#FFFFFF';e.currentTarget.style.opacity=activeTab===tab?'1':'0.5';}}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{padding:16}}>

        {activeTab === 'Standings' && (
          Object.keys(standings).length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>No games played yet</div>
            : Object.entries(standings).map(([pool, rawRows]) => {
              // Re-sort and re-rank client-side per the format's tiebreaker order.
              // The view ships a default sort that matches BLPA Bash exactly;
              // DEX needs lowest_pim as the secondary key so we recompute here.
              const sorted = sortByTiebreakers(rawRows, tiebreakers).map((r, i) => ({ ...r, pool_rank: i + 1 }));
              // Pick which extra tiebreaker columns to show. The base columns
              // (GP/W/L/T/GF/GA) are always in the middle scroll area; PTS is
              // the right-frozen column. GQ/PIM/PeriodPts each appear only when
              // listed in settings.tiebreakers.
              const tbCols = [];
              if (showGQ)        tbCols.push({ key: 'gq',  label: 'GQ',   render: (r) => (Number(r.goal_quotient) || 0).toFixed(2) });
              if (showPeriodPts) tbCols.push({ key: 'pp',  label: 'P.PT', render: (r) => r.period_pts ?? 0 });
              if (showPIM)       tbCols.push({ key: 'pim', label: 'PIM',  render: (r) => r.pim ?? 0 });
              // Always show DIFF as the final fallback column when no GQ is
              // shown — otherwise the GQ column carries the same signal.
              if (!showGQ)       tbCols.push({ key: 'd',   label: 'DIFF', render: (r) => (r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff), color: (r) => r.goal_diff > 0 ? '#22C55E' : r.goal_diff < 0 ? '#D72638' : 'rgba(244,247,250,0.5)' });
              // Middle (scrollable) columns: GP, W, L, T, GF, GA, then any
              // tiebreaker cols. TEAM and PTS are sticky and not in this list.
              const midCols = [
                { key: 'gp',  label: 'GP',  render: (r) => r.gp,     color: 'rgba(244,247,250,0.5)' },
                { key: 'w',   label: 'W',   render: (r) => r.wins,   color: 'rgba(244,247,250,0.65)' },
                { key: 'l',   label: 'L',   render: (r) => r.losses, color: 'rgba(244,247,250,0.65)' },
                { key: 't',   label: 'T',   render: (r) => r.ties,   color: 'rgba(244,247,250,0.65)' },
                { key: 'gf',  label: 'GF',  render: (r) => r.gf,     color: 'rgba(244,247,250,0.65)' },
                { key: 'ga',  label: 'GA',  render: (r) => r.ga,     color: 'rgba(244,247,250,0.65)' },
                ...tbCols,
              ];
              // Sticky column visuals: solid bg color matching the card so
              // scrolled middle content doesn't bleed through. Subtle shadow
              // hints at horizontal scrollability without being intrusive.
              const stickyBg = '#0f2847';
              const stickyHdrBg = '#152e54'; // header tint of stickyBg
              const stickyLeft = { position: 'sticky', left: 0, zIndex: 2, background: stickyBg, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)' };
              const stickyRight = { position: 'sticky', right: 0, zIndex: 2, background: stickyBg, boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.4)' };
              const stickyLeftHdr = { ...stickyLeft, background: stickyHdrBg };
              const stickyRightHdr = { ...stickyRight, background: stickyHdrBg };
              const midCellW = 36; // px per scrollable column
              return (
              <div key={pool} style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.1em',color:'rgba(244,247,250,0.3)',textTransform:'uppercase',marginBottom:8}}>{pool}</div>
                <div style={{background:stickyBg,border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
                  <div style={{overflowX:'auto', WebkitOverflowScrolling:'touch'}}>
                  <table style={{borderCollapse:'collapse', width:'100%', minWidth: 'max-content', tableLayout:'auto'}}>
                    <thead>
                      <tr style={{background:'rgba(46,91,140,0.2)',fontSize:10,fontWeight:700,color:'rgba(244,247,250,0.35)',textTransform:'uppercase'}}>
                        <th style={{...stickyLeftHdr,textAlign:'left',padding:'8px 10px',minWidth:130,maxWidth:160}}>TEAM</th>
                        {midCols.map(c => (
                          <th key={c.key} style={{textAlign:'center',padding:'8px 4px',width:midCellW,minWidth:midCellW}}>{c.label}</th>
                        ))}
                        <th style={{...stickyRightHdr,textAlign:'center',padding:'8px 10px',minWidth:44}}>PTS</th>
                      </tr>
                    </thead>
                    <tbody>
                    {sorted.map((row, i) => (
                      <React.Fragment key={row.team_id}>
                        {i === adv && (
                          <tr>
                            <td colSpan={2 + midCols.length} style={{padding:0}}>
                              <div style={{height:2,background:'rgba(215,38,56,0.4)',margin:'0 12px'}}/>
                              <div style={{fontSize:10,color:'rgba(215,38,56,0.55)',padding:'4px 12px'}}>↑ ADVANCES TO BRACKET</div>
                            </td>
                          </tr>
                        )}
                        <tr style={{borderTop:'0.5px solid rgba(244,247,250,0.06)'}}>
                          <td style={{...stickyLeft,padding:'10px',minWidth:130,maxWidth:160}}>
                            <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                              <span style={{width:18,height:18,borderRadius:'50%',background:row.pool_rank===1?'#D72638':row.pool_rank===2?'#2E5B8C':'rgba(244,247,250,0.1)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,flexShrink:0}}>{row.pool_rank}</span>
                              <span style={{fontSize:12,fontWeight:600,color:'#F4F7FA',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.team_name}</span>
                            </div>
                          </td>
                          {midCols.map(c => (
                            <td key={c.key} style={{fontSize:11,textAlign:'center',color:c.color ? (typeof c.color === 'function' ? c.color(row) : c.color) : 'rgba(244,247,250,0.65)',padding:'10px 4px',width:midCellW,minWidth:midCellW}}>
                              {c.render(row)}
                            </td>
                          ))}
                          <td style={{...stickyRight,fontSize:13,fontWeight:700,textAlign:'center',color:row.pool_rank===1?'#D72638':'#F4F7FA',padding:'10px',minWidth:44}}>{row.pts}</td>
                        </tr>
                      </React.Fragment>
                    ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
              );
            })
        )}

        {activeTab === 'Schedule' && (
          games.length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>No games scheduled yet</div>
            : <ScheduleByDay games={games} navigate={navigate} canScore={canScore} />
        )}

        {activeTab === 'Bracket' && (
          bracketGames.length === 0
            ? <div style={{textAlign:'center',color:'rgba(244,247,250,0.3)',fontSize:13,paddingTop:40}}>Bracket seeds lock when pool play ends</div>
            : <>
                {champion && (
                  <div style={{background:'linear-gradient(135deg,#1a1208 0%,#3d2a0c 50%,#1a1208 100%)',border:'1px solid rgba(245,158,11,0.5)',borderRadius:14,padding:'22px 18px',marginBottom:18,textAlign:'center'}}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.2em',color:'#F59E0B',textTransform:'uppercase',marginBottom:8}}>🏆 Tournament Champion</div>
                    <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:28,color:'#F4F7FA',textTransform:'uppercase',letterSpacing:'0.02em'}}>{champion.team_name}</div>
                    {tournament?.name && <div style={{fontSize:11,color:'rgba(244,247,250,0.5)',marginTop:6}}>{tournament.name}</div>}
                  </div>
                )}
                {bracketGames.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} />)}
              </>
        )}

        {activeTab === 'Feed' && (
          <FeedTab
            posts={feedPosts}
            setPosts={setFeedPosts}
            loading={feedLoading}
            navigate={navigate}
            currentUser={currentUser}
            tournamentId={id}
          />
        )}

        {activeTab === 'Info' && <InfoTab tournament={tournament} />}

      </div>
    </div>
  );
}

// Tournament-scoped feed. Surfaces auto-recap posts AND user-authored posts
// scoped to this tournament. Render is intentionally minimal — extract a
// shared PostCard later when there's enough reuse to justify the refactor.
// User posts do NOT trigger pushes (only recaps do) to keep notification
// volume sane.
function FeedTab({ posts, setPosts, loading, navigate, currentUser, tournamentId }) {
  const [draft, setDraft] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState(null);

  const handleSubmit = async () => {
    if (!currentUser?.id || !tournamentId || submitting) return;
    const content = draft.trim();
    if (!content && !mediaFile) return;
    setSubmitting(true);
    setComposerError(null);
    try {
      let mediaUrl = null;
      let mediaType = null;
      if (mediaFile) {
        const up = await uploadMedia(mediaFile, currentUser.id);
        if (up.error) { setComposerError('Upload failed'); setSubmitting(false); return; }
        mediaUrl = up.url;
        mediaType = up.mediaType;
      }
      const { data, error } = await createPost(currentUser.id, { content, mediaUrl, mediaType, tournamentId });
      if (error) { setComposerError(error.message || 'Post failed'); setSubmitting(false); return; }
      // Optimistic: prepend the new post to the feed so the author sees it
      // immediately. The next refetch picks up the same row by id.
      if (data) {
        const newPost = { ...data, profiles: currentUser.profile || null };
        setPosts((prev) => [newPost, ...(prev || [])]);
      }
      setDraft('');
      setMediaFile(null);
    } catch (e) {
      setComposerError(e?.message || 'Post failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHidden = (postId) => setPosts((prev) => (prev || []).filter((p) => p.id !== postId));
  const handleAuthorBlocked = (authorId) => setPosts((prev) => (prev || []).filter((p) => p.author_id !== authorId));

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:'0 12px'}}>
      {currentUser && (
        <div style={{background:'#11253E',borderRadius:10,padding:'10px 12px'}}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 500))}
            placeholder="Post to the tournament feed…"
            rows={2}
            style={{width:'100%',background:'#07111F',color:'#F4F7FA',border:'1px solid #1F3553',borderRadius:6,padding:'8px 10px',fontFamily:'Barlow,sans-serif',fontSize:13,resize:'vertical',outline:'none'}}
          />
          {mediaFile && (
            <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:'#9BB5D6',marginTop:6}}>
              <span>📎 {mediaFile.name}</span>
              <button onClick={() => setMediaFile(null)} style={{background:'transparent',border:'none',color:'#E26B6B',fontSize:11,cursor:'pointer'}}>Remove</button>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
            <label style={{cursor:'pointer',fontSize:12,color:'#9BB5D6'}}>
              📷 Photo
              <input
                type="file"
                accept="image/*,video/*"
                style={{display:'none'}}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setMediaFile(f); }}
              />
            </label>
            <button
              onClick={handleSubmit}
              disabled={submitting || (!draft.trim() && !mediaFile)}
              style={{background:submitting||(!draft.trim()&&!mediaFile)?'#1F3553':'#5B9FE2',color:'#F4F7FA',border:'none',borderRadius:6,padding:'6px 14px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:submitting?'wait':'pointer'}}
            >
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </div>
          {composerError && <div style={{color:'#E26B6B',fontSize:11,marginTop:6}}>{composerError}</div>}
          <div style={{fontSize:10,color:'#7C8B9F',marginTop:4,textAlign:'right'}}>{draft.length}/500</div>
        </div>
      )}

      {loading || posts === null ? (
        <div style={{textAlign:'center',color:'#7C8B9F',fontSize:13,padding:'24px 16px'}}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{textAlign:'center',color:'#7C8B9F',fontSize:13,padding:'40px 16px',lineHeight:1.6}}>
          <div style={{fontSize:32,marginBottom:8}}>📰</div>
          No updates yet.<br />
          Recaps appear here when games finalize. You can post too.
        </div>
      ) : (
        posts.map((p) => {
          const lines = String(p.content || '').split('\n').filter(Boolean);
          const headline = lines[0] || 'Update';
          const body = lines.slice(1).join(' · ');
          const author = p.profiles?.name || p.profiles?.handle || '';
          return (
            <div key={p.id} style={{background:'#11253E',borderRadius:10,padding:'12px 14px',color:'#F4F7FA',fontFamily:'Barlow,sans-serif'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  {p.tag && (
                    <div style={{display:'inline-block',background:(p.tag_color||'#2E5B8C')+'40',color:p.tag_color||'#9BB5D6',fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:'uppercase',padding:'2px 8px',borderRadius:4,marginBottom:6}}>
                      {p.tag}
                    </div>
                  )}
                  <div style={{fontWeight:p.recap_for_game_id?700:500,fontSize:p.recap_for_game_id?15:13,lineHeight:1.3,marginBottom:body?4:0}}>{headline}</div>
                  {body && <div style={{fontSize:13,color:'#C5D2E1',lineHeight:1.4,marginBottom:8}}>{body}</div>}
                </div>
                {currentUser && p.author_id !== currentUser.id && (
                  <PostActionMenu
                    kind="post"
                    targetId={p.id}
                    authorId={p.author_id}
                    authorHandle={p.profiles?.handle}
                    currentUserId={currentUser.id}
                    onReported={() => handleHidden(p.id)}
                    onBlocked={() => handleAuthorBlocked(p.author_id)}
                  />
                )}
              </div>
              {p.media_url && (
                <div style={{marginTop:6,marginBottom:6,borderRadius:6,overflow:'hidden'}}>
                  {p.media_type === 'video' ? (
                    <video src={p.media_url} controls style={{width:'100%',display:'block'}} />
                  ) : (
                    <img src={p.media_url} alt="" style={{width:'100%',display:'block'}} />
                  )}
                </div>
              )}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,color:'#7C8B9F',marginTop:6}}>
                <span>{author ? `${author} · ` : ''}{timeAgo(p.created_at)} ago</span>
                {p.recap_for_game_id && (
                  <button
                    onClick={() => navigate(`/game/${p.recap_for_game_id}`)}
                    style={{background:'transparent',border:'none',color:'#5B9FE2',fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}
                  >
                    View game →
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// Anonymous-spectator landing. Shows tournament metadata + teams + a clear
// "sign up to view live" CTA. Live data (standings, scores, bracket details)
// stays gated — the value prop of the sign-up is "see live scores."
// Tournament details (name/dates/venue/division/logo) are intentionally
// public to make the URL shareable + Google-indexable.
function PublicTournamentLanding({ tournament, games, navigate }) {
  const accent = tournament?.accent_color || '#D72638';
  const s = tournament?.settings ?? {};
  const venueLine = [s.venue_name, s.venue_address].filter(Boolean).join(' · ');
  // Derive team list from the games join — saves a second query and keeps
  // ordering by pool consistent with the rest of the app.
  const teamsByPool = useMemo(() => {
    const seen = new Map();
    games.forEach(g => {
      [g.home_team, g.away_team].forEach(t => {
        if (t?.id && !seen.has(t.id)) seen.set(t.id, t);
      });
    });
    const all = Array.from(seen.values());
    const byPool = all.reduce((acc, t) => {
      const k = t.pool || '—';
      if (!acc[k]) acc[k] = [];
      acc[k].push(t);
      return acc;
    }, {});
    return Object.entries(byPool).sort(([a], [b]) => a.localeCompare(b));
  }, [games]);
  const totalTeams = teamsByPool.reduce((n, [, list]) => n + list.length, 0);
  const totalGames = games.length;
  const returnTo = encodeURIComponent(`/tournament/${tournament.id}`);
  return (
    <div style={{background:'#07111F',minHeight:'100vh',fontFamily:'Barlow,sans-serif',color:'#F4F7FA'}}>
      <div style={{background:'#0B1F3A',padding:'16px 18px 0',borderTop:`3px solid ${accent}`,borderBottom:'0.5px solid rgba(46,91,140,0.4)'}}>
        <button onClick={() => navigate('/tournaments')} style={{color:'rgba(244,247,250,0.6)',fontSize:13,background:'none',border:'none',cursor:'pointer',fontFamily:'Barlow,sans-serif',marginBottom:8}}>← All tournaments</button>
        {tournament?.logo_url && (
          <img src={tournament.logo_url} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}
            style={{height:48,width:'auto',display:'block',marginBottom:10,borderRadius:6}} />
        )}
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:28,lineHeight:1.05}}>
          {(tournament?.name || '').toUpperCase()}
        </div>
        {tournament?.division && (
          <div style={{fontSize:13,color:'rgba(244,247,250,0.6)',marginTop:4}}>{tournament.division}</div>
        )}
        <div style={{fontSize:13,color:'rgba(244,247,250,0.5)',margin:'8px 0 16px'}}>
          {tournament?.start_date} – {tournament?.end_date}
          {venueLine ? ` · ${venueLine}` : ''}
        </div>
      </div>

      <div style={{padding:'20px 18px',maxWidth:560,margin:'0 auto'}}>
        {/* Sign-up hero — the main conversion surface */}
        <div style={{background:`linear-gradient(135deg,${accent}33 0%,#0f2847 100%)`,border:`1px solid ${accent}66`,borderRadius:14,padding:'20px 18px',marginBottom:18,textAlign:'center'}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:20,marginBottom:6,textTransform:'uppercase'}}>Follow live</div>
          <div style={{fontSize:13,color:'rgba(244,247,250,0.75)',marginBottom:16,lineHeight:1.55}}>
            Sign up free to see live scores, standings, full schedule, bracket, and game recaps as they happen.
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
            <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'12px 28px',fontFamily:'Barlow,sans-serif',fontSize:14,fontWeight:700,cursor:'pointer'}}>
              Sign up to view live →
            </button>
            <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} style={{background:'transparent',color:'#F4F7FA',border:'1px solid rgba(244,247,250,0.3)',borderRadius:999,padding:'12px 22px',fontFamily:'Barlow,sans-serif',fontSize:13,cursor:'pointer'}}>
              Sign in
            </button>
          </div>
        </div>

        {/* At-a-glance stats — safe data, builds anticipation */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18}}>
          <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:30,color:accent,lineHeight:1}}>{totalTeams}</div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:'rgba(244,247,250,0.5)',textTransform:'uppercase',marginTop:4}}>Teams</div>
          </div>
          <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:30,color:accent,lineHeight:1}}>{totalGames}</div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:'rgba(244,247,250,0.5)',textTransform:'uppercase',marginTop:4}}>Games</div>
          </div>
        </div>

        {/* Teams list per pool — names + initials only, no records. */}
        {teamsByPool.length > 0 && (
          <div style={{marginBottom:18}}>
            <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,marginBottom:10,textTransform:'uppercase'}}>
              Competing teams
            </div>
            {teamsByPool.map(([pool, list]) => (
              <div key={pool} style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.1em',color:'rgba(244,247,250,0.4)',textTransform:'uppercase',marginBottom:8}}>{pool}</div>
                <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
                  {list.map((t, i) => (
                    <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i ? '0.5px solid rgba(244,247,250,0.06)' : 'none'}}>
                      <div style={{width:30,height:30,borderRadius:'50%',background:'#1a4a7a',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:11,color:'#fff',flexShrink:0}}>
                        {teamInitials(t.team_name)}
                      </div>
                      <span style={{fontSize:14,fontWeight:600,color:'#F4F7FA'}}>{t.team_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Secondary CTA at the bottom for scrollers */}
        <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'18px 16px',textAlign:'center'}}>
          <div style={{fontSize:13,color:'rgba(244,247,250,0.65)',marginBottom:12,lineHeight:1.5}}>
            Live standings · real-time scores · bracket automation · game recaps. Free to join.
          </div>
          <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'10px 24px',fontFamily:'Barlow,sans-serif',fontSize:13,fontWeight:700,cursor:'pointer'}}>
            Sign up to follow →
          </button>
        </div>
      </div>
    </div>
  );
}

// Group a flat list of games into day buckets, ordered by start_time. Each
// bucket also resolves a label hint ("Pool Play" vs "Championship") for the
// day heading so spectators can scan the agenda fast.
function ScheduleByDay({ games, navigate, canScore }) {
  const grouped = useMemo(() => {
    const map = new Map();
    games.forEach(g => {
      const key = dayKey(g.start_time);
      if (!map.has(key)) map.set(key, { iso: g.start_time, games: [] });
      map.get(key).games.push(g);
    });
    return Array.from(map.entries()).map(([key, v]) => {
      const allBracket = v.games.every(g => g.round && g.round !== 'pool');
      const allPool = v.games.every(g => !g.round || g.round === 'pool');
      const subtitle = allBracket ? 'Bracket' : allPool ? 'Pool Play' : 'Pool & Bracket';
      return { key, iso: v.iso, subtitle, games: v.games };
    });
  }, [games]);
  return grouped.map(day => (
    <div key={day.key} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 15, color: '#F4F7FA', textTransform: 'uppercase' }}>{fmtDayHeading(day.iso)}</div>
        <div style={{ fontSize: 10, color: 'rgba(244,247,250,0.4)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>· {day.subtitle}</div>
      </div>
      {day.games.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} />)}
    </div>
  ));
}

function GameCard({ game, navigate, canScore }) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const url = getLiveBarnUrl(game.rink?.live_barn_venue_id);
  const hasStream = !!url;  // only "true" when the venue ID is real, not a placeholder
  // Round badge: "Pool A" reuses the value verbatim (DB already includes "Pool ").
  // Bracket rounds title-case via ROUND_LABEL.
  const isChampionship = game.round === 'final' || game.round === 'championship';
  const isBracketRound = !!game.round && game.round !== 'pool';
  const roundLabel = isBracketRound ? (ROUND_LABEL[game.round] || game.round) : (game.home_team?.pool || 'Pool');
  // Championship cards get a warm gold border + 🏆 chip so they pop on the
  // schedule and bracket lists. Pool/QF/SF stay on the standard navy treatment.
  const cardBorder = isChampionship ? '1px solid rgba(245,158,11,0.55)' : '0.5px solid rgba(46,91,140,0.4)';
  const cardHoverBorder = isChampionship ? '1px solid rgba(245,158,11,0.9)' : '0.5px solid rgba(46,91,140,0.8)';
  const cardBackground = isChampionship ? 'linear-gradient(135deg,#0f2847 0%,#1a1605 100%)' : '#0f2847';
  // Bold the winner's row when the game is final. Shootout winners (tied
  // regulation, SO decided it) get the bold too — game.shootout_winner is
  // the source of truth for bracket-round SO outcomes.
  const isShootoutDecided = isFinal && (game.shootout_winner === 'home' || game.shootout_winner === 'away');
  const homeWon = isFinal && ((game.home_score ?? 0) > (game.away_score ?? 0) || game.shootout_winner === 'home');
  const awayWon = isFinal && ((game.away_score ?? 0) > (game.home_score ?? 0) || game.shootout_winner === 'away');

  return (
    <div onClick={() => navigate('/game/' + game.id)} style={{background:cardBackground,border:cardBorder,borderRadius:12,padding:'14px 16px',marginBottom:10,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.border=cardHoverBorder} onMouseLeave={e=>e.currentTarget.style.border=cardBorder}>
      {/* Status row + round badge + start time. Date/time is now shown for
          every game state — not just scheduled — so spectators can find when
          a finalized game happened without opening the detail page. */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          {isLive && <span style={{background:'#D72638',color:'#fff',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>● LIVE</span>}
          {isFinal && <span style={{background:'rgba(244,247,250,0.08)',color:'rgba(244,247,250,0.4)',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>FINAL{isShootoutDecided ? ' / SO' : ''}</span>}
          {!isLive && !isFinal && <span style={{background:'#2E5B8C',color:'#F4F7FA',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>{fmtGameTime(game.start_time)}</span>}
          {(isLive || isFinal) && game.start_time && <span style={{fontSize:11,color:'rgba(244,247,250,0.45)'}}>{fmtGameTime(game.start_time)}</span>}
          <span style={{background:isChampionship?'rgba(245,158,11,0.18)':'rgba(46,91,140,0.25)',color:isChampionship?'#F59E0B':'rgba(244,247,250,0.65)',fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,letterSpacing:'0.06em',textTransform:'uppercase'}}>
            {isChampionship ? '🏆 ' : ''}{roundLabel}
          </span>
        </div>
        {hasStream && !isFinal && (
          <button onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }} style={{display:'inline-flex',alignItems:'center',gap:7,background:'#FFFFFF',color:'#0B1F3A',border:'none',borderRadius:999,padding:'8px 14px 8px 8px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
            <span style={{width:24,height:24,background:'#07111F',borderRadius:5,border:'1px solid rgba(215,38,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><LedR size={16}/></span>
            Watch with LiveBarn
          </button>
        )}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,opacity:isFinal && !homeWon ? 0.65 : 1}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'#1a4a7a',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:11,color:'#fff'}}>{teamInitials(game.home_team?.team_name)}</div>
          <span style={{fontSize:14,fontWeight:homeWon?800:600,color:'#F4F7FA'}}>{game.home_team?.team_name}</span>
        </div>
        {(isLive||isFinal) && <span style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:'#F4F7FA'}}>{game.home_score}</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,opacity:isFinal && !awayWon ? 0.65 : 1}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:32,height:32,borderRadius:'50%',background:'#6b1520',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:11,color:'#fff'}}>{teamInitials(game.away_team?.team_name)}</div>
          <span style={{fontSize:14,fontWeight:awayWon?800:600,color:'#F4F7FA'}}>{game.away_team?.team_name}</span>
        </div>
        {(isLive||isFinal) ? <span style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:'#F4F7FA'}}>{game.away_score}</span> : <span style={{fontSize:11,fontWeight:600,color:'rgba(244,247,250,0.3)'}}>VS</span>}
      </div>
      <div style={{fontSize:11,color:'rgba(244,247,250,0.4)'}}>📍 {[game.rink?.sub_rink, game.rink?.name].filter(Boolean).join(' · ') || 'Rink TBD'}</div>
      {canScore && (
        <button onClick={(e) => { e.stopPropagation(); navigate("/scorer/" + game.id); }} style={{marginTop:8,width:"100%",padding:"9px",background:"rgba(46,91,140,0.2)",border:"0.5px solid rgba(46,91,140,0.5)",borderRadius:8,color:"#F4F7FA",fontFamily:"Barlow,sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onMouseEnter={e=>{e.currentTarget.style.background="#F4F7FA";e.currentTarget.style.color="#0B1F3A";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(46,91,140,0.2)";e.currentTarget.style.color="#F4F7FA";}}>✏️ Open Scorer View</button>
      )}
      {hasStream && !isFinal && (
        <div style={{background:'rgba(215,38,56,0.08)',border:'0.5px solid rgba(215,38,56,0.3)',borderRadius:7,padding:'7px 11px',marginTop:9,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,color:'rgba(244,247,250,0.5)',lineHeight:1.6}}>Rinkd members save · ✓ Code <strong style={{color:'#D72638'}}>RINKD10</strong> auto-applied</div>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:14,color:'#D72638',marginLeft:10}}>10% off</div>
        </div>
      )}
    </div>
  );
}

function InfoTab({ tournament }) {
  const s = tournament?.settings ?? {};
  // Format optional settings as human-readable cells. Missing keys collapse
  // gracefully so older tournaments without these settings still render OK.
  const venueLine = [s.venue_name, s.venue_address].filter(Boolean).join(' · ');
  const tiebreakers = Array.isArray(s.tiebreakers) && s.tiebreakers.length
    ? s.tiebreakers.join(' → ')
    : null;
  const shootout = (() => {
    const inPool = s.shootout_pool ? 'pool' : null;
    const inBracket = s.shootout_bracket ? 'bracket' : null;
    const list = [inPool, inBracket].filter(Boolean);
    if (!list.length) return 'No shootouts';
    return `In ${list.join(' & ')}`;
  })();
  return (
    <div>
      {/* "Host your tournament on Rinkd" marketing banner — only shown on
          non-activated tournaments. Once an admin flips is_activated true
          this is a real paying customer's page; the lead-gen CTA belongs
          on demos + draft tournaments only. */}
      {tournament.is_activated === false && (
        <div style={{background:'linear-gradient(135deg,#0f2847 0%,#0B1F3A 100%)',border:'1px solid rgba(46,91,140,0.6)',borderRadius:14,padding:'20px 18px',marginBottom:16,textAlign:'center'}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:20,marginBottom:6}}>Host your tournament on Rinkd</div>
          <div style={{fontSize:12,color:'rgba(244,247,250,0.5)',marginBottom:14,lineHeight:1.6}}>Live standings · real-time scoring · LiveBarn integration · bracket automation.<br/>Email us for pricing and availability.</div>
          <a href="mailto:hello@rinkd.app?subject=Tournament Hosting Inquiry" style={{display:'inline-flex',alignItems:'center',gap:8,background:'#D72638',color:'#fff',border:'none',borderRadius:999,padding:'11px 22px',fontFamily:'Barlow,sans-serif',fontSize:13,fontWeight:700,textDecoration:'none'}}>✉️ hello@rinkd.app</a>
          <div style={{fontSize:11,color:'rgba(244,247,250,0.3)',marginTop:10}}>We'll respond within 24 hours</div>
        </div>
      )}

      {venueLine && (
        <div style={{marginBottom:18}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Venue</div>
          <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'12px 14px',fontSize:13,color:'#F4F7FA',lineHeight:1.5}}>{venueLine}</div>
        </div>
      )}

      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Format</div>
        <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
          {[
            ['Division', tournament?.division || '—'],
            ['Period length', `${s.period_length_minutes??15} min ${s.period_type==='running'?'running':'stop-time'}`],
            ['Periods per game', s.num_periods??3],
            ['Advancement', `Top ${s.advancement_per_pool??2} per pool → bracket`],
            s.max_goal_differential ? ['Mercy rule', `${s.max_goal_differential}-goal differential cap`] : null,
            ['Shootouts', shootout],
            s.allow_ties === false ? ['Ties allowed in pool', 'No'] : ['Ties allowed in pool', 'Yes'],
          ].filter(Boolean).map(([k,v]) => (
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderBottom:'0.5px solid rgba(244,247,250,0.06)'}}>
              <span style={{fontSize:13,color:'rgba(244,247,250,0.5)'}}>{k}</span>
              <span style={{fontSize:13,fontWeight:600,color:'#F4F7FA'}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Point System</div>
        <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,overflow:'hidden'}}>
          {[
            ['Win',`${s.points_win??2} pts`,'#D72638'],
            ['Tie',`${s.points_tie??1} pt`,'#F4F7FA'],
            ['Loss',`${s.points_loss??0} pts`,'rgba(244,247,250,0.3)'],
            s.shootout_win_points != null ? ['OT/SO win',`${s.shootout_win_points} pts`,'#F59E0B'] : null,
          ].filter(Boolean).map(([k,v,c]) => (
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',borderBottom:'0.5px solid rgba(244,247,250,0.06)'}}>
              <span style={{fontSize:13,color:'rgba(244,247,250,0.5)'}}>{k}</span>
              <span style={{fontSize:13,fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {tiebreakers && (
        <div style={{marginBottom:18}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:'#F4F7FA',marginBottom:8}}>Tiebreakers</div>
          <div style={{background:'#0f2847',border:'0.5px solid rgba(46,91,140,0.4)',borderRadius:12,padding:'12px 14px',fontSize:12,color:'rgba(244,247,250,0.75)',lineHeight:1.6}}>{tiebreakers}</div>
        </div>
      )}
    </div>
  );
}
