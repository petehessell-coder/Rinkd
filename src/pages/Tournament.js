import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LedR, TeamLogo } from '../components/Logos';
import AdSlot from '../components/AdSlot';
import PinToNavButton from '../components/PinToNavButton';
import { getLiveBarnUrl } from '../lib/livebarn';
import { captureDataError } from '../lib/sentry';
import { followTournament, unfollowTournament, isFollowingTournament } from '../lib/tournamentSubscriptions';
import { subscribeToPush, isPushSubscribed } from '../lib/push';
import { iosCanInstallButHasnt } from '../lib/platform';
import { IOS_INSTALL_EVENT } from '../components/IOSInstallBanner';
import { getTournamentPosts, createPost, uploadMedia, timeAgo, toggleLike, getLikedPosts } from '../lib/posts';
import { isExtraDirector as isDirectorRole } from '../lib/tournamentDirectors';
import { track } from '../lib/analytics';
import PostActionMenu from '../components/PostActionMenu';
import PostReactions from '../components/PostReactions';
import CommentThread from '../components/CommentThread';
import { getReactions } from '../lib/reactions';
import { haptics } from '../lib/haptics';
import { FeedSkeleton, ListRowSkeleton } from '../components/Skeletons';
import Gallery from '../components/Gallery';
import StatLeaderboards from '../components/StatLeaderboards';
import { getRecapSponsor, isPublicSharingEnabled, areScorersHidden } from '../lib/publicShare';
import SeasonGamePucks from '../components/SeasonGamePucks';
import { MentionInput, MentionText } from '../components/Mentions';
import { savePostMentions, mentionMapFromRows } from '../lib/mentions';
import ShareButton from '../components/ShareButton';
import RecapCard from '../components/RecapCard';
import { recapSourceFromPost, getRecapCardWithSponsor } from '../lib/recapCard';
import { loadGameCardData } from '../lib/gameCardData';
import { C, colors } from '../lib/tokens';
import { Icon, BounceNumber, useExpand, Img, ErrorState } from '../components/ui';
import { useOnline } from '../lib/useOnline';
import { prefetchGamePage, prefetchHandlers } from '../lib/prefetch';
import { staggerStyle, useReducedMotion } from '../lib/motion';
import { motion as motionTokens } from '../lib/tokens';
import { cached, invalidatePrefix } from '../lib/cache';


const TABS = ['Standings','Schedule','Bracket','Stats','Feed','Gallery','Info'];
// PR-B — tabs whose bodies read `games`/`standingsRaw`. Standings and Schedule
// both need games+standings (Schedule's suspension badge needs the flags too,
// which travel with the same load); Bracket needs games only but is cheap
// enough to share the same fetch rather than add a 3rd loader.
const GAMES_TABS = new Set(['Standings', 'Schedule', 'Bracket']);

// S04: tabs are deep-linkable. ?tab= is read once on mount (validated against
// TABS, case-insensitive) and written via replaceState on every switch — no
// history entry per tab, so Back still leaves the page in one tap. trackPage
// strips query strings, so the param never pollutes analytics.
function initialTabFromUrl(fallback) {
  try {
    const t = new URLSearchParams(window.location.search).get('tab') || '';
    return TABS.find((x) => x.toLowerCase() === t.toLowerCase()) || fallback;
  } catch { return fallback; }
}
function writeTabToUrl(tab) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab.toLowerCase());
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* old browser — tab still switches, just not shareable */ }
}


// MULTIDIV-1: standings come from the division-scoped view (carries a
// `division_id` column); single-division events seed a "Main" division so this
// view behaves identically to the legacy `tournament_standings`.
const STANDINGS_VIEW = 'tournament_standings_md';

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

// Broadcast lower-third section header — white Barlow Condensed 700 italic caps
// on solid navy (#0f2847), bleeding to the content column's left edge (the
// content padding is 16px) with a red accent slab. Optional muted `sub`.
function LowerThird({ label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, background: C.card, borderLeft: `4px solid ${C.red}`, marginLeft: -16, marginBottom: 12, padding: '8px 14px 8px 16px', borderTopRightRadius: 4, borderBottomRightRadius: 4 }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 18, lineHeight: 1, letterSpacing: '0.05em', color: C.ice, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
      {sub && <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', fontSize: 11, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.45)', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{sub}</span>}
    </div>
  );
}

// Designed empty state for tab content — an invitation, not a blank space.
function TabEmptyState({ icon = '🏒', title, body }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice, textTransform: 'uppercase', marginBottom: 6 }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)', lineHeight: 1.5, maxWidth: 320, margin: '0 auto' }}>{body}</div>}
    </div>
  );
}

export default function TournamentPage({ currentUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState(() => initialTabFromUrl('Standings'));
  // S09 M2 — single sliding tab indicator (see League.js for the full rationale).
  const tabStripRef = useRef(null);
  const tabBtnRefs = useRef({});
  const tabAnimReady = useRef(false);
  const [tabInd, setTabInd] = useState({ left: 0, width: 0, animate: false });
  const measureTab = useCallback(() => {
    const btn = tabBtnRefs.current[activeTab];
    if (!btn) return;
    setTabInd({ left: btn.offsetLeft, width: btn.offsetWidth, animate: tabAnimReady.current });
    tabAnimReady.current = true;
  }, [activeTab]);
  useEffect(() => { measureTab(); }, [measureTab]);
  useEffect(() => {
    const onResize = () => measureTab();
    window.addEventListener('resize', onResize);
    window.addEventListener('load', onResize);
    let ro;
    if (typeof ResizeObserver !== 'undefined' && tabStripRef.current) {
      ro = new ResizeObserver(onResize);
      ro.observe(tabStripRef.current);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize).catch(() => {});
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onResize);
      if (ro) ro.disconnect();
    };
  }, [measureTab]);
  const [tournament, setTournament] = useState(null);
  const [games, setGames] = useState([]);
  // MULTIDIV-1: raw standings rows for ALL divisions; the grouped, division-
  // filtered `standings` is derived below. Loading all divisions once keeps
  // `load` [id]-bound so a division switch doesn't tear down the realtime sub.
  const [standingsRaw, setStandingsRaw] = useState([]);
  // PR-B — games+standings (+ suspension flags, which ride along) are lazy:
  // load on first activation of Standings/Schedule/Bracket, mirroring the
  // League.js pattern. gamesLoaded also gates loadLive's realtime refresh.
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [gamesLoading, setGamesLoading] = useState(false);
  // Mirrors gamesLoaded in a ref so loadLive (below) can read its current
  // value without depending on it — keeps loadLive referentially stable
  // ([id] only, exactly like pre-PR-B) so the realtime subscription effect's
  // channel is untouched: it still only re-subscribes when `id` changes,
  // never when the Standings/Schedule/Bracket tab's first load flips the flag.
  const gamesLoadedRef = useRef(false);
  useEffect(() => { gamesLoadedRef.current = gamesLoaded; }, [gamesLoaded]);
  // Cheap eager live-game count (head:true, no row payload) for the header
  // hero LIVE pill + the Feed tab's LiveGameStrip — both need to know "is
  // anything live right now" before Standings/Schedule/Bracket has loaded.
  const [liveCount, setLiveCount] = useState(0);
  const [divisions, setDivisions] = useState([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState(null);
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
  const [feedError, setFeedError] = useState(false);
  // Connectivity — so the Feed tab can swap to its offline error copy instead
  // of spinning forever when the device drops off the network.
  const online = useOnline();
  // GS-2 — team_id → pending-suspension count, via the team-level-only RPC
  // (no names ever reach this page). Drives the ⚠️ badge on standings rows.
  const [suspendedTeams, setSuspendedTeams] = useState({});

  // PR-B — eager mount load is now just what the HEADER needs: the tournament
  // row (cached 60s inline via cached(), just below), divisions, and a cheap
  // eager live-game count (head:true) for the hero LIVE pill + LiveGameStrip.
  // games/standingsRaw/suspension flags (the expensive joined rows) load per-
  // tab — see loadGamesData + the tab-activation effect. Exception: an
  // anonymous, non-demo visitor lands on PublicTournamentLanding (no tabs at
  // all), which needs the real `games` array for its "competing teams" +
  // stats derivation — that path loads it eagerly, mirroring League.js.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load tournament — cached 60s (static config, hit on every mount +
      // back-nav). Wrapped inline since Tournament.js already fetches this
      // row itself rather than through a shared lib helper.
      const t = await cached(`tournament:${id}`, 60_000, async () => {
        const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
        if (error) throw error;
        return data;
      }).catch((te) => {
        captureDataError(te, { where: 'Tournament.load.tournament', tournamentId: id });
        setError(te.message);
        return null;
      });
      if (!t) { setLoading(false); return; }
      setTournament(t);

      // Load divisions (MULTIDIV-1). Single-division events have exactly one
      // ("Main", from the backfill/create); multi-division events drive the switcher.
      const { data: divs } = await supabase
        .from('tournament_divisions')
        .select('id, name, age_group, tier, sort_order, settings')
        .eq('tournament_id', id)
        .order('sort_order', { ascending: true });
      const divList = divs || [];
      setDivisions(divList);
      // Default to the first division; preserve the user's pick across realtime
      // reloads (don't snap back to division 1 when a score lands elsewhere).
      setSelectedDivisionId((cur) =>
        cur && divList.some((d) => d.id === cur) ? cur : (divList[0]?.id ?? null));

      // Cheap eager live-game count for the hero pill + LiveGameStrip — bounded
      // head:true query, no row payload, so it's safe to run on every mount
      // regardless of which tab (if any) actually needs the full games array.
      const { count } = await supabase.from('games').select('id', { count: 'exact', head: true }).eq('tournament_id', id).eq('status', 'live');
      setLiveCount(count || 0);

      // Anon + non-demo: no tabs render, so PublicTournamentLanding needs the
      // full games array right away (it's the whole page, not a deferred tab).
      if (!currentUser && t?.settings?.is_demo !== true) {
        const { data: g, error: ge } = await supabase
          .from('games')
          .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,logo_url), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
          .eq('tournament_id', id)
          .order('start_time', { ascending: false })
          .limit(1000);
        if (ge) { captureDataError(ge, { where: 'Tournament.load.games.anon', tournamentId: id }); setError(ge.message); setLoading(false); return; }
        setGames((g || []).reverse());
        setGamesLoaded(true);
      }
    } catch(e) {
      captureDataError(e, { where: 'Tournament.load', tournamentId: id });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id, currentUser]);

  // Standings/Schedule/Bracket share this one games+standings(+suspension
  // flags) fetch — mirrors League.js's loadGamesData/loadStandingsData split,
  // collapsed to one loader here since all three Tournament tabs need games.
  const loadGamesData = useCallback(async () => {
    if (gamesLoading) return;
    setGamesLoading(true);
    try {
      const { data: g, error: ge } = await supabase
        .from('games')
        .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,logo_url), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
        .eq('tournament_id', id)
        // perf(scale): most-recent 1000 by start_time (all upcoming + recent past),
        // returned ascending — a mega-event drops only ancient history, not live games.
        .order('start_time', { ascending: false })
        .limit(1000);
      if (ge) throw ge;
      setGames((g || []).reverse());

      // Load standings for ALL divisions from the staged view — same error
      // treatment so a failed query doesn't masquerade as "no games played yet."
      // Grouping/filtering by the selected division happens in the derived
      // `standings` memo below.
      const { data: s, error: se } = await supabase
        .from(STANDINGS_VIEW)
        .select('*')
        .eq('tournament_id', id)
        .order('pool', { ascending: true })
        .order('pool_rank', { ascending: true })
        .limit(500); // perf(scale): bounded by team count, capped for safety
      if (se) throw se;
      setStandingsRaw(s || []);

      // GS-2 — team-level suspension flags for the standings badge.
      // Best-effort: a failure here just means no ⚠️ shows (never block the
      // standings on it).
      try {
        const { data: flags } = await supabase.rpc('get_tournament_suspension_flags', { p_tournament_id: id });
        const flagMap = {};
        (flags || []).forEach(f => { flagMap[f.team_id] = f.pending_count; });
        setSuspendedTeams(flagMap);
      } catch { setSuspendedTeams({}); }

      setGamesLoaded(true);
    } catch (e) {
      captureDataError(e, { where: 'Tournament.loadGamesData', tournamentId: id });
      setError(e.message);
    } finally {
      setGamesLoading(false);
    }
  }, [id, gamesLoading]);

  // perf(scale): the realtime tick must NOT re-run the full load() (tournament
  // row + divisions) on every goal for every spectator — only games, standings,
  // and the suspension flags change when a game finalizes, and ONLY once that
  // data has actually been loaded (Standings/Schedule/Bracket visited, or the
  // anon teaser). Otherwise a spectator sitting on Stats/Feed/Gallery would pay
  // for a games+standings fetch they never asked for. Also sweeps the Stats-tab
  // cache (StatLeaderboards + SeasonGamePucks) so a goal refreshes leaderboards
  // within a tick — see PR-B item 3.
  const loadLive = useCallback(async () => {
    try {
      if (gamesLoadedRef.current) {
        const [{ data: g }, { data: s }] = await Promise.all([
          supabase.from('games')
            .select('*, home_team:tournament_teams!home_team_id(id,team_name,pool,logo_url), away_team:tournament_teams!away_team_id(id,team_name,pool,logo_url), rink:rinks(id,name,sub_rink,live_barn_venue_id)')
            .eq('tournament_id', id)
            .order('start_time', { ascending: false }) // perf(scale): most-recent window, reversed to asc below
            .limit(1000),
          supabase.from(STANDINGS_VIEW)
            .select('*')
            .eq('tournament_id', id)
            .order('pool', { ascending: true })
            .order('pool_rank', { ascending: true })
            .limit(500),
        ]);
        if (g) setGames(g.reverse());
        if (s) setStandingsRaw(s);
        try {
          const { data: flags } = await supabase.rpc('get_tournament_suspension_flags', { p_tournament_id: id });
          const flagMap = {};
          (flags || []).forEach(f => { flagMap[f.team_id] = f.pending_count; });
          setSuspendedTeams(flagMap);
        } catch { /* best-effort suspension flags */ }
      }
      invalidatePrefix(`stats:tournament:${id}`);
      // Cheap header live-count stays fresh regardless of which tab is open.
      supabase.from('games').select('id', { count: 'exact', head: true }).eq('tournament_id', id).eq('status', 'live')
        .then(({ count }) => setLiveCount(count || 0)).catch(() => {});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Tournament] live reload failed; spectators hold last data:', e?.message || e);
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
      reloadTimer = setTimeout(() => { loadLive(); }, 1500);
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
  }, [id, loadLive]);

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
  // Standings/Schedule and never click Feed. Surfaces an error/retry state on
  // a network drop instead of hanging the "Getting the ice ready." placeholder.
  const loadFeed = useCallback(async () => {
    if (!id) return;
    setFeedLoading(true);
    setFeedError(false);
    try {
      const { data, error } = await getTournamentPosts(id, 50);
      if (error) throw error;
      setFeedPosts(data || []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Tournament] feed load failed', e);
      setFeedError(true);
    } finally {
      setFeedLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab !== 'Feed' || feedPosts !== null) return;
    loadFeed();
  }, [activeTab, feedPosts, loadFeed]);

  // PR-B — per-tab deferral, mirroring the Feed pattern above. Standings,
  // Schedule, and Bracket all read games/standingsRaw, so they share one
  // loader guarded by gamesLoaded. This effect also covers the initial
  // deep-linked tab (?tab=schedule etc.) since `activeTab`'s initial value
  // already comes from initialTabFromUrl — the effect runs on mount with
  // whatever tab that resolved to (default landing tab is Standings).
  // Feed is included too: its LiveGameStrip needs real game rows (not just
  // the eager liveCount) to render the live-now cards.
  useEffect(() => {
    if (!id) return;
    if ((GAMES_TABS.has(activeTab) || activeTab === 'Feed') && !gamesLoaded) loadGamesData();
  }, [id, activeTab, gamesLoaded, loadGamesData]);

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
          window.alert("Push is off for this device, so following won't send alerts yet — turn it on anytime from your Profile.");
        }
        // Continue with the DB follow anyway — once they enable push, future
        // recaps will deliver.
      }
    }
    const { error } = await followTournament(currentUser.id, id);
    setFollowBusy(false);
    if (!error) { setIsFollowing(true); track('tournament_followed', { tournament_id: id }); }
  };

  // MULTIDIV-1: the selected division's settings override the tournament's
  // (points, tiebreakers, advancement). Falls back to tournament.settings, so
  // single-division events behave exactly as before the multi-division build.
  const selectedDivision = useMemo(
    () => divisions.find((d) => d.id === selectedDivisionId) || null,
    [divisions, selectedDivisionId]
  );
  const divSettings = useMemo(
    () => ({ ...(tournament?.settings || {}), ...(selectedDivision?.settings || {}) }),
    [tournament?.settings, selectedDivision]
  );
  // Standings for the selected division, grouped by pool — same shape the
  // render code already expects, so nothing downstream changes.
  const standings = useMemo(() => {
    return (standingsRaw || [])
      .filter((r) => !selectedDivisionId || r.division_id === selectedDivisionId)
      .reduce((acc, row) => {
        (acc[row.pool] = acc[row.pool] || []).push(row);
        return acc;
      }, {});
  }, [standingsRaw, selectedDivisionId]);

  if (loading) return <TournamentSkeleton />;

  if (error || !tournament) {
    // Anonymous visitors hitting a draft tournament URL get filtered out by
    // tournaments_public_read RLS (status must be active/complete) — so the
    // friendly framing is "sign in to view", not "retry."
    const isAnon = !currentUser;
    return (
      <div style={{background:C.dark,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.ice,fontFamily:'Barlow,sans-serif',fontSize:14,padding:20,textAlign:'center'}}>
        <div style={{maxWidth:380}}>
          <div style={{fontSize:32,marginBottom:10}}>{isAnon ? '🔒' : '⚠️'}</div>
          <div style={{color:isAnon ? C.ice : C.red,marginBottom:4,fontWeight:600}}>
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
                  <button onClick={() => navigate('/login')} style={{background:C.red,color:'#fff',border:'none',borderRadius:8,padding:'9px 20px',cursor:'pointer',fontFamily:'Barlow,sans-serif',fontWeight:700}}>Sign in / Sign up</button>
                  <button onClick={() => navigate('/tournaments')} style={{background:C.blue,color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>Browse tournaments</button>
                </>
              : <>
                  <button onClick={load} style={{background:C.red,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',cursor:'pointer',fontFamily:'Barlow,sans-serif',fontWeight:700}}>Retry</button>
                  <button onClick={() => navigate('/home')} style={{background:C.blue,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontFamily:'Barlow,sans-serif'}}>Back to Home</button>
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
  // Demo events are the give-first sales surface — anon visitors get the full
  // experience (standings/schedule/bracket/stats/feed), not the sign-up teaser.
  const isDemo = tournament?.settings?.is_demo === true;
  if (!currentUser && !isDemo) {
    return <PublicTournamentLanding tournament={tournament} games={games} navigate={navigate} />;
  }

  // MULTIDIV-1: scope the games-derived views to the selected division.
  // Single-division events: divisionGames === games (every game is in "Main"),
  // so behavior is byte-identical to before.
  const divisionGames = selectedDivisionId
    ? games.filter(g => g.division_id === selectedDivisionId)
    : games;
  // PR-B: games may not be loaded yet (Standings/Schedule/Bracket not visited)
  // — fall back to the cheap eager `liveCount` so the hero pill + Feed tab's
  // LiveGameStrip stay accurate on first paint regardless of landing tab.
  // Once games load, the real array (and the strip's actual game data) takes over.
  const liveGames = gamesLoaded ? games.filter(g => g.status === 'live') : []; // header badge stays event-wide
  const finalGames = divisionGames.filter(g => g.status === 'final');
  const scheduledGames = divisionGames.filter(g => g.status === 'scheduled');
  // Bracket games ordered by tree position (round_of_16 → QF → SF → Final →
  // 3rd place). New brackets carry bracket_round/slot; legacy ones fall back to
  // their natural (start_time) order since bracket_round is null.
  const bracketGames = divisionGames
    .filter(g => g.round && g.round !== 'pool')
    .slice()
    .sort((a, b) =>
      ((a.bracket_round ?? 999) - (b.bracket_round ?? 999)) ||
      ((a.bracket_slot ?? 0) - (b.bracket_slot ?? 0)));
  const adv = divSettings?.advancement_per_pool ?? 2;
  // Tiebreaker config drives which standings columns to show. Default to
  // BLPA Bash order so older tournaments without an explicit list render
  // the same way; DEX puts lowest_pim second instead of goal_quotient.
  // Reads the selected division's settings (falls back to the tournament's).
  const tiebreakers = divSettings?.tiebreakers || ['points', 'goal_quotient', 'period_points'];
  const showGQ = tiebreakers.includes('goal_quotient');
  const showPIM = tiebreakers.includes('lowest_pim') || tiebreakers.includes('penalty_minutes');
  const showPeriodPts = tiebreakers.includes('period_points');
  // Points percentage = earned / max possible (GP × points-per-win). Mirrors
  // GameSheet's P% column; cheap derived value, no extra data fetch.
  const pointsWin = divSettings?.points_win ?? 2;
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
  const accent = tournament?.accent_color || C.red;
  // Hero status chip: a red pill when something's live right now, otherwise
  // muted text (completed / upcoming). PR-B: before games load, fall back to
  // the cheap eager liveCount (see liveGames above).
  const statusActive = gamesLoaded ? liveGames.length > 0 : liveCount > 0;
  const isComplete = tournament?.status === 'complete' || tournament?.status === 'completed';
  const statusLabel = statusActive ? 'LIVE' : isComplete ? 'COMPLETED' : 'UPCOMING';
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
    <div style={{background:C.dark,minHeight:'100vh',fontFamily:'Barlow,sans-serif',color:C.ice}}>

      {/* ADS-1 event banner — renders only when this tournament has an active sponsor */}
      <AdSlot slot="event_banner" targetType="tournament" targetId={tournament.id} style={{ margin: '12px 16px 0' }} />

      {/* HEADER — photographic cover hero (mirrors the League header) when the
          event has a cover photo; falls back to solid navy otherwise. */}
      <div style={{position:'relative',overflow:'hidden',background:C.navy,borderTop:`3px solid ${accent}`,borderBottom:`0.5px solid ${C.border}`}}>
        {tournament?.cover_image_url && (
          <img src={tournament.cover_image_url} alt="" loading="eager" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',display:'block'}} onError={(e)=>{e.currentTarget.style.display='none';}} />
        )}
        {tournament?.cover_image_url && (
          <div style={{position:'absolute',inset:0,background:'linear-gradient(180deg, rgba(11,31,58,0.82) 0%, rgba(7,17,31,0.55) 50%, rgba(7,17,31,0.96) 100%)'}} />
        )}
        <div style={{position:'relative',padding:'14px 16px 0'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:8,flexWrap:'wrap'}}>
          <button onClick={() => navigate(-1)} style={{color:'rgba(244,247,250,0.6)',fontSize:13,background:'none',border:'none',cursor:'pointer',fontFamily:'Barlow,sans-serif',minHeight:44,display:'inline-flex',alignItems:'center',padding:'0 6px',marginLeft:-6}}>← Events</button>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {tournament && tournament.is_activated === false && (
              <span title="Live scoring + push notifications are locked until a Rinkd admin activates this tournament."
                style={{background:'rgba(245,158,11,0.18)',color:colors.warning,fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,letterSpacing:'0.04em'}}>
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
                  color: isFollowing ? C.ice : '#fff',
                  border: isFollowing ? '1px solid rgba(46,91,140,0.5)' : 'none',
                  borderRadius: 999, padding: '5px 12px', minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  cursor: followBusy ? 'default' : 'pointer',
                  fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  opacity: followBusy ? 0.7 : 1,
                }}>
                {followBusy ? <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name={isFollowing ? 'following' : 'bell'} size={13} />Following…</span> : <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name={isFollowing ? 'following' : 'bell'} size={13} />{isFollowing ? 'Following' : 'Follow'}</span>}
              </button>
            )}
            {tournament && currentUser && <PinToNavButton userId={currentUser.id} pinType="tournament" targetId={id} />}
            {tournament && currentUser && isDirector && (
              <button onClick={() => navigate(`/tournament/${id}/manage`)}
                style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'5px 12px',minHeight:44,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',letterSpacing:'0.05em',textTransform:'uppercase',display:'inline-flex',alignItems:'center',gap:6}}>
                <Icon name="manage" size={13} color="#fff" />Manage
              </button>
            )}
          </div>
        </div>
        {tournament?.logo_url && (
          <img src={tournament.logo_url} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}
            style={{height:38,width:'auto',display:'block',marginBottom:8,borderRadius:6}} />
        )}
        {/* Name always shows in FULL — wraps as needed, never ellipsized;
            responsive size keeps a long name tidy on a narrow phone. */}
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:'clamp(24px, 7vw, 40px)',lineHeight:1.04,color:C.ice,textTransform:'uppercase',letterSpacing:'0.01em',overflowWrap:'anywhere',textShadow:'0 2px 10px rgba(0,0,0,0.6)'}}>
          {(tournament?.name || '').toUpperCase()}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',margin:'7px 0 12px'}}>
          {statusActive
            ? <span style={{display:'inline-flex',alignItems:'center',gap:6,background:C.red,color:'#fff',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:700,fontSize:12,letterSpacing:'0.06em',textTransform:'uppercase',padding:'4px 12px',borderRadius:999}}>● {statusLabel}</span>
            : <span style={{fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:700,fontSize:12,letterSpacing:'0.08em',textTransform:'uppercase',color:'rgba(244,247,250,0.45)'}}>{statusLabel}</span>}
          <span style={{fontSize:12,color:'rgba(244,247,250,0.5)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>
            {[tournament?.division, [tournament?.start_date, tournament?.end_date].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
          </span>
        </div>
        {/* MULTIDIV-1: division switcher — only when the event has >1 division.
            Single-division events (incl. BLPA) render nothing here, unchanged. */}
        {divisions.length > 1 && (
          <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:12}}>
            {divisions.map(d => (
              <button key={d.id} onClick={() => setSelectedDivisionId(d.id)}
                style={{
                  flexShrink:0, padding:'5px 12px', minHeight:44, display:'inline-flex', alignItems:'center', borderRadius:999,
                  fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                  fontFamily:"'Barlow Condensed', sans-serif", fontStyle:'italic',
                  letterSpacing:'0.04em', textTransform:'uppercase',
                  border: selectedDivisionId===d.id ? 'none' : '1px solid rgba(46,91,140,0.5)',
                  background: selectedDivisionId===d.id ? accent : 'transparent',
                  color: selectedDivisionId===d.id ? '#fff' : 'rgba(244,247,250,0.7)',
                }}>
                {d.name}
              </button>
            ))}
          </div>
        )}
        {/* Scoreboard tab strip — red underline on the active tab, muted steel
            when inactive. No box shadow, no Material hover. */}
        <div ref={tabStripRef} style={{position:'relative',display:'flex',overflowX:'auto',borderBottom:'1px solid rgba(46,91,140,0.3)'}}>
          {TABS.map(tab => {
            const on = activeTab === tab;
            return (
              <button key={tab} ref={el => { tabBtnRefs.current[tab] = el; }} onClick={() => { setActiveTab(tab); writeTabToUrl(tab); }}
                style={{fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:700,fontSize:15,letterSpacing:'0.04em',textTransform:'uppercase',
                  padding:'10px 14px',minHeight:44,display:'inline-flex',alignItems:'center',background:'transparent',border:'none',
                  borderBottom:'3px solid transparent',
                  marginBottom:-1,cursor:'pointer',whiteSpace:'nowrap',
                  color: on ? C.ice : C.steel,transition:'color 0.15s'}}>
                {tab}
              </button>
            );
          })}
          {/* S09 M2 — single sliding indicator bar (transform+width only). */}
          <div aria-hidden style={{
            position:'absolute', left:0, bottom:-1, height:3, width:tabInd.width,
            background:accent, borderRadius:'3px 3px 0 0',
            transform:`translateX(${tabInd.left}px)`,
            transition:(reducedMotion || !tabInd.animate) ? 'none'
              : `transform ${motionTokens.duration.tab}ms ${motionTokens.easing.inOut}, width ${motionTokens.duration.tab}ms ${motionTokens.easing.inOut}`,
            pointerEvents:'none',
          }} />
        </div>
        </div>{/* /header content over cover */}
      </div>

      {/* CONTENT */}
      <div style={{padding:16}}>

        {/* PR-B: games+standings are lazy — geometric skeleton until the first load lands. */}
        {activeTab === 'Standings' && !gamesLoaded && (
          <ListRowSkeleton rows={6} />
        )}
        {activeTab === 'Standings' && gamesLoaded && (
          <>
            <AdSlot slot="standings_presented" targetType="tournament" targetId={tournament.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
            {Object.keys(standings).length === 0
            ? <TabEmptyState title="Standings drop after game one" body="The table fills in the moment the first game goes final. Check back after the puck drops." />
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
              // MULTIDIV-1 Phase 4 — configurable goal-quotient DISPLAY. The
              // view's goal_quotient (GF/GA) still drives the tiebreaker sort;
              // this only changes the shown value. 'gf_over_gf_plus_ga' (Nickel
              // City) = GF/(GF+GA) with a GF+GA=0 guard → 1.0. Ordering is
              // identical to GF/GA, so the tiebreaker is unaffected.
              if (showGQ) tbCols.push({ key: 'gq', label: 'GQ', render: (r) => {
                if ((divSettings?.gq_formula) === 'gf_over_gf_plus_ga') {
                  const gf = Number(r.gf) || 0, ga = Number(r.ga) || 0;
                  return (gf + ga === 0 ? 1 : gf / (gf + ga)).toFixed(3);
                }
                return (Number(r.goal_quotient) || 0).toFixed(2);
              } });
              if (showPeriodPts) tbCols.push({ key: 'pp',  label: 'P.PT', render: (r) => r.period_pts ?? 0 });
              if (showPIM)       tbCols.push({ key: 'pim', label: 'PIM',  render: (r) => r.pim ?? 0 });
              // Always show DIFF as the final fallback column when no GQ is
              // shown — otherwise the GQ column carries the same signal.
              if (!showGQ)       tbCols.push({ key: 'd',   label: 'DIFF', render: (r) => (r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff), color: (r) => r.goal_diff > 0 ? colors.success : r.goal_diff < 0 ? C.red : 'rgba(244,247,250,0.5)' });
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
                { key: 'ppct', label: 'P%', color: 'rgba(244,247,250,0.5)', render: (r) => {
                  const d = (r.gp || 0) * pointsWin;
                  if (!d) return '—';
                  const s = (r.pts / d).toFixed(3);
                  return s.startsWith('0') ? s.slice(1) : s;
                } },
              ];
              // Sticky column visuals: solid bg color matching the card so
              // scrolled middle content doesn't bleed through. Subtle shadow
              // hints at horizontal scrollability without being intrusive.
              const stickyBg = C.card;
              const stickyHdrBg = '#152e54'; // header tint of stickyBg
              const stickyLeft = { position: 'sticky', left: 0, zIndex: 2, background: stickyBg, boxShadow: '4px 0 6px -4px rgba(0,0,0,0.4)' };
              const stickyRight = { position: 'sticky', right: 0, zIndex: 2, background: stickyBg, boxShadow: '-4px 0 6px -4px rgba(0,0,0,0.4)' };
              const stickyLeftHdr = { ...stickyLeft, background: stickyHdrBg };
              const stickyRightHdr = { ...stickyRight, background: stickyHdrBg };
              const midCellW = 40; // px per scrollable column
              return (
              <div key={pool} style={{marginBottom:16}}>
                <LowerThird label={pool} />
                <div style={{background:stickyBg,border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                  <div style={{overflowX:'auto', WebkitOverflowScrolling:'touch'}}>
                  <table style={{borderCollapse:'collapse', width:'100%', minWidth: 'max-content', tableLayout:'auto'}}>
                    <thead>
                      <tr style={{background:'rgba(46,91,140,0.2)',fontSize:10,fontWeight:700,color:'rgba(244,247,250,0.35)',textTransform:'uppercase'}}>
                        <th style={{...stickyLeftHdr,textAlign:'left',padding:'8px 10px',minWidth:130,maxWidth:160}}>TEAM</th>
                        {midCols.map(c => (
                          <th key={c.key} style={{textAlign:'center',padding:'8px 4px',width:midCellW,minWidth:midCellW}}>{c.label}</th>
                        ))}
                        <th style={{...stickyRightHdr,textAlign:'center',padding:'8px 10px',minWidth:48}}>PTS</th>
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
                        <tr style={staggerStyle(i)}>
                          <td style={{...stickyLeft,padding:'10px',minWidth:130,maxWidth:160}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                              {/* Rank as a large muted number (gold for 1st), not a column or a badge. */}
                              <span style={{fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:900,fontSize:22,lineHeight:1,minWidth:20,textAlign:'center',fontVariantNumeric:'tabular-nums',color:row.pool_rank===1?C.gold:'rgba(244,247,250,0.35)',flexShrink:0}}>{row.pool_rank}</span>
                              <TeamLogo team={{ name: row.team_name, logo_url: row.logo_url, logo_color: '#1a4a7a' }} size={22} radius={11} />
                              <span style={{fontSize:14,fontWeight:600,color:C.ice,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{row.team_name}</span>
                              {/* GS-2 — TEAM-LEVEL suspension flag only. Opponents
                                  learn the lineup may differ; no player is ever
                                  named on this public surface. */}
                              {suspendedTeams[row.team_id] > 0 && (
                                <span title="Suspended player(s) — lineup may differ" aria-label="Team has suspended players"
                                  style={{fontSize:10,fontWeight:700,color:colors.warning,background:'rgba(245,158,11,0.14)',border:'0.5px solid rgba(245,158,11,0.45)',borderRadius:6,padding:'1px 5px',flexShrink:0,whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:3}}>
                                  <Icon name="alert" size={11} color={colors.warning} /> Susp.
                                </span>
                              )}
                            </div>
                          </td>
                          {midCols.map(c => (
                            <td key={c.key} style={{fontFamily:"'Barlow Condensed', sans-serif",fontWeight:700,fontSize:16,textAlign:'center',fontVariantNumeric:'tabular-nums',color:c.color ? (typeof c.color === 'function' ? c.color(row) : c.color) : 'rgba(244,247,250,0.75)',padding:'9px 4px',width:midCellW,minWidth:midCellW}}>
                              {c.render(row)}
                            </td>
                          ))}
                          {/* Gold PTS on the 1st-place row only — the one earned highlight. */}
                          <td style={{...stickyRight,fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:900,fontSize:18,textAlign:'center',fontVariantNumeric:'tabular-nums',color:row.pool_rank===1?C.gold:C.ice,padding:'9px 10px',minWidth:48}}>{row.pts}</td>
                        </tr>
                      </React.Fragment>
                    ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
              );
            })}
          </>
        )}

        {activeTab === 'Schedule' && !gamesLoaded && (
          <ListRowSkeleton rows={6} />
        )}
        {activeTab === 'Schedule' && gamesLoaded && (
          <>
            <AdSlot slot="schedule_presented" targetType="tournament" targetId={tournament.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
            {divisionGames.length === 0
            ? <TabEmptyState icon="🗓️" title="Schedule drops soon" body="No games on the board yet. The matchups land here as soon as the organizer posts them." />
            : <ScheduleByDay games={divisionGames} navigate={navigate} canScore={canScore} anon={!currentUser} />}
          </>
        )}

        {activeTab === 'Bracket' && !gamesLoaded && (
          <ListRowSkeleton rows={6} />
        )}
        {activeTab === 'Bracket' && gamesLoaded && (
          bracketGames.length === 0
            ? <TabEmptyState icon="🏆" title="Bracket locks after pools" body="Once pool play wraps, the seeds drop in and the road to the championship lights up here." />
            : <>
                {champion && (
                  <div style={{background:'linear-gradient(135deg,#1a1208 0%,#3d2a0c 50%,#1a1208 100%)',border:'1px solid rgba(245,158,11,0.5)',borderRadius:14,padding:'22px 18px',marginBottom:18,textAlign:'center'}}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.2em',color:colors.warning,textTransform:'uppercase',marginBottom:8}}>🏆 Tournament Champion</div>
                    <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:28,color:C.ice,textTransform:'uppercase',letterSpacing:'0.02em'}}>{champion.team_name}</div>
                    {tournament?.name && <div style={{fontSize:11,color:'rgba(244,247,250,0.5)',marginTop:6}}>{tournament.name}</div>}
                  </div>
                )}
                {(() => {
                  // Group the (already round-ordered) bracket games under round
                  // headers so the list reads like a bracket.
                  const PRETTY = { round_of_16: 'Round of 16', quarterfinal: 'Quarterfinals', semifinal: 'Semifinals', final: 'Final', championship: 'Final', consolation: '3rd place' };
                  const groups = [];
                  for (const g of bracketGames) {
                    const label = PRETTY[g.round] || g.round;
                    let grp = groups[groups.length - 1];
                    if (!grp || grp.label !== label) { grp = { label, games: [] }; groups.push(grp); }
                    grp.games.push(g);
                  }
                  return groups.map(grp => (
                    <div key={grp.label}>
                      <LowerThird label={grp.label} />
                      {grp.games.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} anon={!currentUser} />)}
                    </div>
                  ));
                })()}
              </>
        )}

        {activeTab === 'Stats' && (
          <>
            <AdSlot slot="stats_presented" targetType="tournament" targetId={tournament.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
            <SeasonGamePucks scope="tournament" id={id} accent={accent} />
            <StatLeaderboards source="tournament" id={id} divisionId={selectedDivisionId} accent={accent}
              gamesheetSeasonId={tournament?.scoring_source === 'external' ? (tournament?.settings?.gamesheet_season_id || null) : null}
              shareMeta={{
                leagueName: tournament?.name,
                sponsor: getRecapSponsor(tournament?.settings)?.name || null,
                youth: areScorersHidden(tournament?.settings),
                canShare: isPublicSharingEnabled(tournament?.settings),
                subtitle: selectedDivision?.name || null,
                shareUrl: typeof window !== 'undefined' ? `${window.location.origin}/tournament/${id}?tab=stats` : null,
              }} />
          </>
        )}

        {activeTab === 'Feed' && (
          <FeedTab
            posts={feedPosts}
            setPosts={setFeedPosts}
            loading={feedLoading}
            error={feedError}
            online={online}
            onRetry={loadFeed}
            navigate={navigate}
            currentUser={currentUser}
            tournamentId={id}
            liveGames={liveGames}
            accent={accent}
            canModerate={isDirector}
          />
        )}

        {activeTab === 'Gallery' && (
          <Gallery tournamentId={id} currentUser={currentUser} />
        )}

        {activeTab === 'Info' && <InfoTab tournament={tournament} />}

      </div>
    </div>
  );
}

// Live game strip — pinned to the top of the Feed tab while any game is in
// progress (status='live'). PERIOD ONLY: Rinkd has no running game clock
// (games.period_time is never written; the only time data is per-event
// time_in_period stamps on goals/penalties), so showing a ticking clock here
// would be silently-wrong data. We show the period label + live score, which
// updates in real time via the page's existing `games` realtime subscription.
function periodLabelShort(p) {
  return p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p === 4 ? 'OT' : p === 5 ? 'SO' : null;
}

function LiveScoreRow({ name, score, lead }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <span style={{ fontSize: 14, fontWeight: lead ? 800 : 600, color: C.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'TBD'}</span>
      <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: lead ? C.ice : 'rgba(244,247,250,0.7)' }}>{score}</span>
    </div>
  );
}

function LiveGameStrip({ games, accent, navigate }) {
  if (!games || games.length === 0) return null;
  const many = games.length > 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 0 3px ${accent}33`, display: 'inline-block' }} />
        <span style={{ color: accent, fontWeight: 800, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Live now</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: many ? 'auto' : 'visible', paddingBottom: many ? 2 : 0 }}>
        {games.map((g) => {
          const pl = periodLabelShort(g.period);
          const home = g.home_score ?? 0;
          const away = g.away_score ?? 0;
          const rink = g.rink?.name ? `${g.rink.name}${g.rink.sub_rink ? ` · ${g.rink.sub_rink}` : ''}` : null;
          return (
            <button
              key={g.id}
              {...prefetchHandlers(prefetchGamePage)}
              onClick={() => navigate(`/game/${g.id}`)}
              style={{
                flex: many ? '0 0 auto' : '1 1 auto', minWidth: many ? 200 : 'auto', textAlign: 'left',
                cursor: 'pointer', background: C.navy, border: `1px solid ${accent}55`, borderRadius: 10,
                padding: '10px 12px', fontFamily: 'Barlow, sans-serif', color: C.ice,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
                <span style={{ color: accent, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5, letterSpacing: '0.04em' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, display: 'inline-block' }} />
                  LIVE{pl ? ` · ${pl}` : ''}
                </span>
                {rink && <span style={{ color: 'rgba(244,247,250,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{rink}</span>}
              </div>
              <LiveScoreRow name={g.home_team?.team_name} score={home} lead={home > away} />
              <LiveScoreRow name={g.away_team?.team_name} score={away} lead={away > home} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Tournament-scoped feed. Surfaces auto-recap posts AND user-authored posts
// scoped to this tournament. Render is intentionally minimal — extract a
// shared PostCard later when there's enough reuse to justify the refactor.
// User posts do NOT trigger pushes (only recaps do) to keep notification
// volume sane.
function FeedTab({ posts, setPosts, loading, error = false, online = true, onRetry, navigate, currentUser, tournamentId, liveGames = [], accent = C.red, canModerate = false }) {
  const [draft, setDraft] = useState('');
  const [postMentionIds, setPostMentionIds] = useState([]);
  const [mediaFile, setMediaFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState(null);
  const [likedPosts, setLikedPosts] = useState([]);
  const [reactionMap, setReactionMap] = useState({});
  const [openComments, setOpenComments] = useState({});
  const likeInFlightRef = useRef(new Set());

  // Comment-thread parity (Step 5): the tournament feed now has the same shared
  // <CommentThread> as the global + team feeds. Toggle open per post; keep the
  // count chip in sync optimistically (the DB trigger is the source of truth).
  const toggleComments = (postId) => setOpenComments((m) => ({ ...m, [postId]: !m[postId] }));
  const bumpCommentCount = (postId, d) => setPosts((prev) => (prev || []).map((p) => p.id === postId
    ? { ...p, comment_count: Math.max(0, (p.comment_count || 0) + d) } : p));

  // Load which of the visible posts the current user has already liked.
  // Scoped to the loaded ids (same bounded pattern as TeamFeed/Feed). Keyed on
  // the id SET, not the posts objects — an optimistic like rewrites a post
  // object (new `likes` count) without changing which posts are visible, and we
  // must NOT refetch liked-state on every tap (it races the toggleLike write
  // and flickers the heart back to its pre-tap value).
  const likedFetchKeyRef = useRef('');
  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.id || !Array.isArray(posts) || posts.length === 0) { setLikedPosts([]); likedFetchKeyRef.current = ''; return; }
    const key = posts.map((p) => p.id).join(',');
    if (key === likedFetchKeyRef.current) return; // same visible posts — skip
    likedFetchKeyRef.current = key;
    getLikedPosts(currentUser.id, posts.map((p) => p.id)).then((liked) => {
      if (!cancelled) setLikedPosts(liked);
    });
    return () => { cancelled = true; };
  }, [posts, currentUser]);

  // Reaction counts are public — load them whenever the visible post set
  // changes (keyed on the id SET, same as the liked-state effect), regardless
  // of sign-in. PostReactions owns its own optimistic state from here.
  const reactionFetchKeyRef = useRef('');
  useEffect(() => {
    let cancelled = false;
    if (!Array.isArray(posts) || posts.length === 0) { setReactionMap({}); reactionFetchKeyRef.current = ''; return undefined; }
    const key = posts.map((p) => p.id).join(',');
    if (key === reactionFetchKeyRef.current) return undefined;
    reactionFetchKeyRef.current = key;
    getReactions(currentUser?.id, posts.map((p) => p.id)).then((m) => { if (!cancelled) setReactionMap(m); });
    return () => { cancelled = true; };
  }, [posts, currentUser]);

  // Race-safe optimistic like. Compute the target state SYNCHRONOUSLY from the
  // current render's liked set — do NOT mutate a shared var inside one updater
  // and read it in another. `posts`/`setPosts` is a parent-owned prop here, so
  // the parent's count updater can flush before the child's liked updater,
  // which left the count reading a stale value and never incrementing.
  const onLike = (postId) => {
    if (!currentUser?.id) return;
    const willLike = !likedPosts.includes(postId);
    if (willLike) haptics.like();
    setLikedPosts((prev) => willLike
      ? (prev.includes(postId) ? prev : [...prev, postId])
      : prev.filter((id) => id !== postId));
    setPosts((prev) => (prev || []).map((p) => p.id === postId
      ? { ...p, likes: willLike ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 0) - 1) }
      : p));

    if (likeInFlightRef.current.has(postId)) return;
    likeInFlightRef.current.add(postId);
    (async () => {
      try {
        const { liked, error } = await toggleLike(postId, currentUser.id);
        if (error) throw error;
        setLikedPosts((prev) => {
          const currentlyLiked = prev.includes(postId);
          if (currentlyLiked === liked) return prev;
          return liked ? [...prev, postId] : prev.filter((id) => id !== postId);
        });
      } catch (_e) {
        setLikedPosts((prev) => willLike ? prev.filter((id) => id !== postId) : [...prev, postId]);
        setPosts((prev) => (prev || []).map((p) => p.id === postId
          ? { ...p, likes: willLike ? Math.max(0, (p.likes || 0) - 1) : (p.likes || 0) + 1 }
          : p));
      } finally {
        likeInFlightRef.current.delete(postId);
      }
    })();
  };

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
        if (up.error) { setComposerError("That image didn't upload — check your connection and try again."); setSubmitting(false); return; }
        mediaUrl = up.url;
        mediaType = up.mediaType;
      }
      const { data, error } = await createPost(currentUser.id, { content, mediaUrl, mediaType, tournamentId });
      if (error) { setComposerError(error.message || "That post didn't go up — check your connection and try again."); setSubmitting(false); return; }
      // Optimistic: prepend the new post to the feed so the author sees it
      // immediately. The next refetch picks up the same row by id.
      if (data) {
        // Persist resolved @-mentions (best-effort; failure shouldn't block the post).
        if (postMentionIds.length) savePostMentions(data.id, postMentionIds);
        const newPost = { ...data, profiles: currentUser.profile || null };
        setPosts((prev) => [newPost, ...(prev || [])]);
      }
      setDraft('');
      setPostMentionIds([]);
      setMediaFile(null);
    } catch (e) {
      setComposerError(e?.message || "That post didn't go up — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHidden = (postId) => setPosts((prev) => (prev || []).filter((p) => p.id !== postId));
  const handleAuthorBlocked = (authorId) => setPosts((prev) => (prev || []).filter((p) => p.author_id !== authorId));

  // RESILIENCE — optimistic post delete. Removes the row now and returns a
  // restore fn; PostActionMenu wraps both in a 5-second Undo toast and only
  // fires the irreversible server delete once it expires.
  const removePostOptimistic = (post) => {
    const idx = (posts || []).findIndex((p) => p.id === post.id);
    setPosts((prev) => (prev || []).filter((p) => p.id !== post.id));
    return () => setPosts((prev) => (prev || []).some((p) => p.id === post.id)
      ? prev
      : (() => { const next = [...(prev || [])]; next.splice(idx < 0 ? next.length : Math.min(idx, next.length), 0, post); return next; })());
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:'0 12px'}}>
      <LiveGameStrip games={liveGames} accent={accent} navigate={navigate} />
      {currentUser && (
        <div style={{background:'#11253E',borderRadius:10,padding:'10px 12px'}}>
          <MentionInput
            value={draft}
            onChange={setDraft}
            onMentionsChange={setPostMentionIds}
            placeholder="Post to the tournament feed…"
            rows={2}
            maxLength={500}
            textareaStyle={{background:C.dark,color:C.ice,border:'1px solid #1F3553',borderRadius:6,padding:'8px 10px',fontFamily:'Barlow,sans-serif',fontSize:13}}
          />
          {mediaFile && (
            <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:'#9BB5D6',marginTop:6}}>
              <span>📎 {mediaFile.name}</span>
              <button onClick={() => setMediaFile(null)} style={{background:'transparent',border:'none',color:colors.redSoft,fontSize:11,cursor:'pointer'}}>Remove</button>
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
              style={{background:submitting||(!draft.trim()&&!mediaFile)?'#1F3553':'#5B9FE2',color:C.ice,border:'none',borderRadius:6,padding:'6px 14px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:submitting?'wait':'pointer'}}
            >
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </div>
          {composerError && <div style={{color:colors.redSoft,fontSize:11,marginTop:6}}>{composerError}</div>}
          <div style={{fontSize:11,color:C.steel,marginTop:4,textAlign:'right'}}>{draft.length}/500</div>
        </div>
      )}

      {loading ? (
        <FeedSkeleton count={2} />
      ) : error ? (
        <ErrorState
          title="Couldn’t load the feed"
          offline={!online}
          onRetry={onRetry}
          retrying={loading}
        />
      ) : posts === null ? (
        <FeedSkeleton count={2} />
      ) : posts.length === 0 ? (
        <div style={{textAlign:'center',color:'#7C8B9F',fontSize:13,padding:'40px 16px',lineHeight:1.6}}>
          <div style={{fontSize:32,marginBottom:8}}>📰</div>
          Be the first on the board.<br />
          Recaps land here the second a game goes final — or post one yourself.
        </div>
      ) : (
        posts.map((p) => {
          const lines = String(p.content || '').split('\n').filter(Boolean);
          const headline = lines[0] || 'Update';
          const body = lines.slice(1).join(' · ');
          const author = p.profiles?.name || p.profiles?.handle || '';
          const mentionMap = mentionMapFromRows(p.post_mentions);
          return (
            <div key={p.id} style={{background:'#11253E',borderRadius:10,padding:'12px 14px',color:C.ice,fontFamily:'Barlow,sans-serif'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  {p.tag && (
                    <div style={{display:'inline-block',background:(p.tag_color||C.blue)+'40',color:p.tag_color||'#9BB5D6',fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:'uppercase',padding:'2px 8px',borderRadius:4,marginBottom:6}}>
                      {p.tag}
                    </div>
                  )}
                  <div style={{fontWeight:p.recap_for_game_id?700:500,fontSize:p.recap_for_game_id?15:13,lineHeight:1.3,marginBottom:body?4:0}}><MentionText text={headline} mentions={mentionMap} /></div>
                  {body && <div style={{fontSize:13,color:'#C5D2E1',lineHeight:1.4,marginBottom:8}}><MentionText text={body} mentions={mentionMap} /></div>}
                </div>
                {currentUser && (
                  <PostActionMenu
                    kind="post"
                    targetId={p.id}
                    authorId={p.author_id}
                    authorHandle={p.profiles?.handle}
                    currentUserId={currentUser.id}
                    canModerate={canModerate}
                    onReported={() => handleHidden(p.id)}
                    onBlocked={() => handleAuthorBlocked(p.author_id)}
                    onDeleted={() => handleHidden(p.id)}
                    onDelete={() => removePostOptimistic(p)}
                    onModerated={() => handleHidden(p.id)}
                  />
                )}
              </div>
              {p.media_url && (
                p.media_type === 'video' ? (
                  // Reserved 16:9 box — the card never jumps while the poster
                  // frame loads on a slow rink connection.
                  <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 6, overflow: 'hidden', marginTop: 6, marginBottom: 6, background: '#000' }}>
                    <video src={p.media_url} controls playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  </div>
                ) : (
                  // Reserved 5:4 box + blur-up — no layout shift when the photo decodes.
                  <Img src={p.media_url} alt="" ratio={5 / 4} radius={6} loading="lazy" style={{ marginTop: 6, marginBottom: 6 }} />
                )
              )}
              {p.recap_for_game_id && (
                <div style={{margin:'8px 0'}}>
                  <RecapCard gameId={p.recap_for_game_id} source={recapSourceFromPost(p)} />
                </div>
              )}
              <div style={{marginTop:8}}>
                <PostReactions postId={p.id} currentUserId={currentUser?.id} initial={reactionMap[p.id]} />
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,color:'#7C8B9F',marginTop:6}}>
                <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                  <button
                    onClick={() => onLike(p.id)}
                    disabled={!currentUser}
                    style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'none',padding:0,cursor:currentUser?'pointer':'default',color:likedPosts.includes(p.id)?C.red:'#7C8B9F',fontFamily:'Barlow,sans-serif',fontSize:12}}
                  >
                    <span style={{fontSize:14}}>{likedPosts.includes(p.id)?'❤️':'🤍'}</span>
                    <span style={{fontWeight:likedPosts.includes(p.id)?700:400}}>{p.likes || 0}</span>
                  </button>
                  <button
                    onClick={() => toggleComments(p.id)}
                    aria-label="Comments" aria-expanded={!!openComments[p.id]}
                    style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'none',padding:0,cursor:'pointer',color:openComments[p.id]?C.ice:'#7C8B9F',fontFamily:'Barlow,sans-serif',fontSize:12}}
                  >
                    <Icon name="comment" size={14} /><span>{p.comment_count || 0}</span>
                  </button>
                  <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{author ? `${author} · ` : ''}{timeAgo(p.created_at)} ago</span>
                </div>
                {p.recap_for_game_id && (
                  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <button
                      {...prefetchHandlers(prefetchGamePage)}
                      onClick={() => navigate(`/game/${p.recap_for_game_id}`)}
                      style={{background:'transparent',border:'none',color:'#5B9FE2',fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}
                    >
                      View game →
                    </button>
                    <ShareButton gameId={p.recap_for_game_id} isLeague={false} variant="ghost" cardType="recapv2"
                      getCard={async () => (await getRecapCardWithSponsor(p.recap_for_game_id, recapSourceFromPost(p))).data} />
                  </div>
                )}
                {p.gamepuck_reveal_game_id && (
                  <button {...prefetchHandlers(prefetchGamePage)} onClick={() => navigate(`/game/${p.gamepuck_reveal_game_id}`)}
                    style={{display:'inline-flex',alignItems:'center',gap:6,background:'rgba(215,38,56,0.15)',border:`1px solid ${C.red}`,color:C.ice,fontSize:12,fontWeight:700,cursor:'pointer',padding:'6px 12px',borderRadius:999}}>
                    🏒 Peel to reveal →
                  </button>
                )}
              </div>
              <CommentThread
                open={!!openComments[p.id]}
                postId={p.id}
                currentUser={currentUser}
                viewerProfile={currentUser}
                onCountChange={(d) => bumpCommentCount(p.id, d)}
                onUserBlocked={handleAuthorBlocked}
              />
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
  const accent = tournament?.accent_color || C.red;
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
    <div style={{background:C.dark,minHeight:'100vh',fontFamily:'Barlow,sans-serif',color:C.ice}}>
      {/* ADS-1 M5 — sponsor banner also shows to anon spectators (null when no sponsor) */}
      <AdSlot slot="event_banner" targetType="tournament" targetId={tournament.id} style={{ margin: '12px 16px 0' }} />
      <div style={{background:C.navy,padding:'16px 18px 0',borderTop:`3px solid ${accent}`,borderBottom:`0.5px solid ${C.border}`}}>
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
        <div style={{background:`linear-gradient(135deg,${accent}33 0%,#0f2847 100%)`,border:`1px solid ${accent}66`,borderRadius:14,padding:'24px 18px',marginBottom:18,textAlign:'center'}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:24,marginBottom:8,textTransform:'uppercase'}}>Follow every game live</div>
          <div style={{fontSize:14,color:'rgba(244,247,250,0.75)',lineHeight:1.5,maxWidth:360,margin:'0 auto 20px'}}>
            Live scores and standings, free — the second each game ends.
          </div>
          <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} style={{background:accent,color:'#fff',border:'none',borderRadius:999,padding:'14px 34px',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:900,fontSize:16,letterSpacing:'0.04em',textTransform:'uppercase',cursor:'pointer'}}>
            Sign up free →
          </button>
          <div style={{marginTop:14}}>
            <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} style={{background:'transparent',color:'rgba(244,247,250,0.7)',border:'none',fontFamily:'Barlow,sans-serif',fontSize:13,cursor:'pointer',textDecoration:'underline'}}>
              Already have an account? Sign in
            </button>
          </div>
        </div>

        {/* At-a-glance stats — safe data, builds anticipation */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18}}>
          <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:30,color:accent,lineHeight:1}}>{totalTeams}</div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.08em',color:'rgba(244,247,250,0.5)',textTransform:'uppercase',marginTop:4}}>Teams</div>
          </div>
          <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'14px 16px',textAlign:'center'}}>
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
                <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                  {list.map((t, i) => (
                    <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i ? '0.5px solid rgba(244,247,250,0.06)' : 'none'}}>
                      <TeamLogo team={{ name: t.team_name, logo_url: t.logo_url, logo_color: '#1a4a7a' }} size={30} radius={15} />
                      <span style={{fontSize:14,fontWeight:600,color:C.ice,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.team_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Secondary CTA at the bottom for scrollers */}
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'18px 16px',textAlign:'center'}}>
          <div style={{fontSize:13,color:'rgba(244,247,250,0.65)',marginBottom:12,lineHeight:1.5}}>
            Live scores, standings, the full bracket, and a recap of every game — as it happens. Free to follow.
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
function ScheduleByDay({ games, navigate, canScore, anon = false }) {
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
      <LowerThird label={fmtDayHeading(day.iso)} sub={day.subtitle} />
      {day.games.map(g => <GameCard key={g.id} game={g} navigate={navigate} canScore={canScore} anon={anon} />)}
    </div>
  ));
}

// Geometric loading state — mirrors the real layout (hero, tab strip, cards) so
// there's no spinner and no layout shift when the data lands.
function TournamentSkeleton() {
  return (
    <div style={{ background: C.dark, minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#1a3a5c 100%)', borderTop: '3px solid rgba(46,91,140,0.6)', padding: '20px 16px 14px' }}>
        <div className="rinkd-shimmer" style={{ width: 38, height: 38, borderRadius: 8, marginBottom: 10 }} />
        <div className="rinkd-shimmer" style={{ width: '70%', height: 30, borderRadius: 6 }} />
        <div style={{ height: 8 }} />
        <div className="rinkd-shimmer" style={{ width: '45%', height: 12, borderRadius: 6 }} />
      </div>
      <div style={{ background: C.navy, display: 'flex', gap: 18, padding: '12px 14px', borderBottom: '1px solid rgba(46,91,140,0.3)' }}>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="rinkd-shimmer" style={{ width: 60, height: 14, borderRadius: 5 }} />)}
      </div>
      <div style={{ padding: 16 }}>
        <ListRowSkeleton rows={5} />
        <div style={{ textAlign: 'center', marginTop: 18, fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(244,247,250,0.4)' }}>Dropping the puck.</div>
      </div>
    </div>
  );
}

function GameCard({ game, navigate, canScore, anon = false }) {
  const expand = useExpand();
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const url = getLiveBarnUrl(game.rink?.live_barn_venue_id);
  const hasStream = !!url;  // only "true" when the venue ID is real, not a placeholder
  // Round badge: "Pool A" reuses the value verbatim (DB already includes "Pool ").
  // Bracket rounds title-case via ROUND_LABEL.
  const isChampionship = game.round === 'final' || game.round === 'championship';
  const isBracketRound = !!game.round && game.round !== 'pool';
  const roundLabel = isBracketRound ? (ROUND_LABEL[game.round] || game.round) : (game.home_team?.pool || 'Pool');
  // Live games get the card-hero treatment (elevated surface + red border glow
  // + red drop-shadow) so they float above the schedule. Championship cards get
  // a warm gold border. Everything else stays on the standard navy treatment.
  const cardBorder = isLive ? '1px solid rgba(215,38,56,0.6)' : isChampionship ? '1px solid rgba(245,158,11,0.55)' : `0.5px solid ${C.border}`;
  const cardHoverBorder = isLive ? '1px solid rgba(215,38,56,0.85)' : isChampionship ? '1px solid rgba(245,158,11,0.9)' : `0.5px solid ${colors.borderAccent}`;
  const cardBackground = isLive ? colors.surfaceElevated : isChampionship ? 'linear-gradient(135deg,#0f2847 0%,#1a1605 100%)' : C.card;
  const cardShadow = isLive ? '0 8px 32px rgba(215,38,56,0.2)' : 'none';
  // Bold the winner's row when the game is final. Shootout winners (tied
  // regulation, SO decided it) get the bold too — game.shootout_winner is
  // the source of truth for bracket-round SO outcomes.
  const isShootoutDecided = isFinal && (game.shootout_winner === 'home' || game.shootout_winner === 'away');
  const homeWon = isFinal && ((game.home_score ?? 0) > (game.away_score ?? 0) || game.shootout_winner === 'home');
  const awayWon = isFinal && ((game.away_score ?? 0) > (game.home_score ?? 0) || game.shootout_winner === 'away');

  return (
    <div {...prefetchHandlers(prefetchGamePage)} onClick={(e) => expand(e, () => navigate(anon ? '/g/' + game.id : '/game/' + game.id), { bg: cardBackground })} style={{background:cardBackground,border:cardBorder,boxShadow:cardShadow,borderRadius:12,padding:'14px 16px',marginBottom:10,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.border=cardHoverBorder} onMouseLeave={e=>e.currentTarget.style.border=cardBorder}>
      {/* Status row + round badge + start time. Date/time is now shown for
          every game state — not just scheduled — so spectators can find when
          a finalized game happened without opening the detail page. */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          {isLive && <span style={{background:C.red,color:'#fff',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>● LIVE</span>}
          {isFinal && <span style={{background:'rgba(244,247,250,0.08)',color:'rgba(244,247,250,0.4)',fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>FINAL{isShootoutDecided ? ' / SO' : ''}</span>}
          {!isLive && !isFinal && <span style={{background:C.blue,color:C.ice,fontSize:11,fontWeight:700,padding:'4px 11px',borderRadius:20}}>{fmtGameTime(game.start_time)}</span>}
          {(isLive || isFinal) && game.start_time && <span style={{fontSize:11,color:'rgba(244,247,250,0.45)'}}>{fmtGameTime(game.start_time)}</span>}
          <span style={{background:isChampionship?'rgba(245,158,11,0.18)':'rgba(46,91,140,0.25)',color:isChampionship?colors.warning:'rgba(244,247,250,0.65)',fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:20,letterSpacing:'0.06em',textTransform:'uppercase'}}>
            {isChampionship ? '🏆 ' : ''}{roundLabel}
          </span>
        </div>
        {hasStream && !isFinal && (
          <button onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }} style={{display:'inline-flex',alignItems:'center',gap:7,background:'#FFFFFF',color:C.navy,border:'none',borderRadius:999,padding:'8px 14px 8px 8px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
            <span style={{width:24,height:24,background:C.dark,borderRadius:5,border:'1px solid rgba(215,38,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><LedR size={16}/></span>
            Watch with LiveBarn
          </button>
        )}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10,opacity:isFinal && !homeWon ? 0.65 : 1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
          <TeamLogo team={{ name: game.home_team?.team_name, logo_url: game.home_team?.logo_url, logo_color: '#1a4a7a' }} size={32} radius={16} />
          <span style={{fontSize:14,fontWeight:homeWon?800:600,color:C.ice,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{game.home_team?.team_name}</span>
        </div>
        {(isLive||isFinal) && <BounceNumber value={game.home_score} style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:C.ice,flexShrink:0,fontVariantNumeric:'tabular-nums'}} />}
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10,opacity:isFinal && !awayWon ? 0.65 : 1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
          <TeamLogo team={{ name: game.away_team?.team_name, logo_url: game.away_team?.logo_url, logo_color: '#6b1520' }} size={32} radius={16} />
          <span style={{fontSize:14,fontWeight:awayWon?800:600,color:C.ice,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{game.away_team?.team_name}</span>
        </div>
        {(isLive||isFinal) ? <BounceNumber value={game.away_score} style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:26,color:C.ice,flexShrink:0,fontVariantNumeric:'tabular-nums'}} /> : <span style={{fontSize:11,fontWeight:600,color:'rgba(244,247,250,0.3)',flexShrink:0}}>VS</span>}
      </div>
      <div style={{fontSize:11,color:'rgba(244,247,250,0.4)'}}>📍 {[game.rink?.sub_rink, game.rink?.name].filter(Boolean).join(' · ') || 'Rink TBD'}</div>
      {canScore && (
        <button onClick={(e) => { e.stopPropagation(); navigate("/scorer/" + game.id); }} style={{marginTop:8,width:"100%",padding:"9px",background:"rgba(46,91,140,0.2)",border:"0.5px solid rgba(46,91,140,0.5)",borderRadius:8,color:C.ice,fontFamily:"Barlow,sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onMouseEnter={e=>{e.currentTarget.style.background=C.ice;e.currentTarget.style.color=C.navy;}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(46,91,140,0.2)";e.currentTarget.style.color=C.ice;}}>✏️ Open Scorer View</button>
      )}
      {hasStream && !isFinal && (
        <div style={{background:'rgba(215,38,56,0.08)',border:'0.5px solid rgba(215,38,56,0.3)',borderRadius:7,padding:'7px 11px',marginTop:9,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,color:'rgba(244,247,250,0.5)',lineHeight:1.6}}>Rinkd members save · ✓ Code <strong style={{color:C.red}}>RINKD10</strong> auto-applied</div>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:14,color:C.red,marginLeft:10}}>10% off</div>
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
        <div style={{background:`linear-gradient(135deg,${C.card} 0%,${C.navy} 100%)`,border:'1px solid rgba(46,91,140,0.6)',borderRadius:14,padding:'22px 18px',marginBottom:16,textAlign:'center'}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:22,textTransform:'uppercase',marginBottom:8}}>Run your tournament on Rinkd</div>
          <div style={{fontSize:14,color:'rgba(244,247,250,0.7)',lineHeight:1.5,maxWidth:340,margin:'0 auto 18px'}}>Live standings and scoring your whole rink can follow from their phone.</div>
          <a href="mailto:hello@rinkd.app?subject=Tournament Hosting Inquiry" style={{display:'inline-block',background:C.red,color:'#fff',borderRadius:999,padding:'13px 30px',fontFamily:"'Barlow Condensed', sans-serif",fontStyle:'italic',fontWeight:900,fontSize:15,letterSpacing:'0.04em',textTransform:'uppercase',textDecoration:'none'}}>Get pricing →</a>
        </div>
      )}

      {venueLine && (
        <div style={{marginBottom:18}}>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:C.ice,marginBottom:8}}>Venue</div>
          <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'12px 14px',fontSize:13,color:C.ice,lineHeight:1.5}}>{venueLine}</div>
        </div>
      )}

      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:C.ice,marginBottom:8}}>Format</div>
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
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
              <span style={{fontSize:13,fontWeight:600,color:C.ice}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:C.ice,marginBottom:8}}>Point System</div>
        <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          {[
            ['Win',`${s.points_win??2} pts`,C.red],
            ['Tie',`${s.points_tie??1} pt`,C.ice],
            ['Loss',`${s.points_loss??0} pts`,'rgba(244,247,250,0.3)'],
            s.shootout_win_points != null ? ['OT/SO win',`${s.shootout_win_points} pts`,colors.warning] : null,
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
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:15,color:C.ice,marginBottom:8}}>Tiebreakers</div>
          <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'12px 14px',fontSize:12,color:'rgba(244,247,250,0.75)',lineHeight:1.6}}>{tiebreakers}</div>
        </div>
      )}
    </div>
  );
}
