import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import MapLink from '../components/MapLink';
import PinToNavButton from '../components/PinToNavButton';
import { getLeague, getLeagueTeams, getLeagueGames, getLeagueStandings, getUserLeagueRole } from '../lib/leagues';
import { listLeagueDivisions, getMyDivisionInLeague } from '../lib/leagueDivisions';
import DivisionPicker from '../components/DivisionPicker';
import AdSlot from '../components/AdSlot';
import { isExtraCommissioner as isExtraCommissionerLookup } from '../lib/leagueCommissioners';
import { followLeague, unfollowLeague, isFollowingLeague } from '../lib/leagueSubscriptions';
import { subscribeToPush, isPushSubscribed } from '../lib/push';
import { getLeaguePosts, createPost, uploadMedia, timeAgo, toggleLike, getLikedPosts } from '../lib/posts';
import PostActionMenu from '../components/PostActionMenu';
import PostReactions from '../components/PostReactions';
import { getReactions } from '../lib/reactions';
import Gallery from '../components/Gallery';
import { LedR } from '../components/Logos';
import { getLiveBarnUrl } from '../lib/livebarn';
import { resolveStreamUrl, streamButtonLabel, detectStreamPlatform } from '../lib/streamUrl';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import SubscribeCalendarSheet from '../components/SubscribeCalendarSheet';
import StatLeaderboards from '../components/StatLeaderboards';
import SeasonGamePucks from '../components/SeasonGamePucks';
import { MentionInput, MentionText } from '../components/Mentions';
import { savePostMentions, mentionMapFromRows } from '../lib/mentions';
import ShareButton from '../components/ShareButton';
import { loadGameCardData } from '../lib/gameCardData';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };
const TABS = ['Schedule', 'Standings', 'Stats', 'Teams', 'Feed', 'Gallery', 'Info'];

function TeamLogo({ team, size = 32 }) {
  const logoUrl = team?.logo_url;
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: logoUrl ? `url(${logoUrl}) center/cover, ${team?.logo_color || C.blue}` : (team?.logo_color || C.blue), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: size * 0.35, color: '#fff', flexShrink: 0 }}>
      {!logoUrl && (team?.logo_initials || (team?.name || '?').slice(0, 2).toUpperCase())}
    </div>
  );
}

function GameRow({ game, isCommissioner, navigate }) {
  const home = game.home_lt?.team || { name: game.home_lt?.team_name, logo_color: game.home_lt?.logo_color, logo_initials: game.home_lt?.logo_initials, logo_url: game.home_lt?.logo_url };
  const away = game.away_lt?.team || { name: game.away_lt?.team_name, logo_color: game.away_lt?.logo_color, logo_initials: game.away_lt?.logo_initials, logo_url: game.away_lt?.logo_url };
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const date = new Date(game.start_time);
  const venueId = game.live_barn_venue_id || game.rink?.live_barn_venue_id;
  const liveBarnUrl = getLiveBarnUrl(venueId);
  const hasStream = !!liveBarnUrl;  // only real, non-placeholder venue IDs count
  // KOHA + future YouTube/Twitch/Facebook-broadcast leagues. Resolved from
  // game.youtube_url with fallback to rink.youtube_url. Independent of
  // LiveBarn — a game can have both, neither, or one.
  const streamUrl = resolveStreamUrl(game);
  const streamLabel = streamUrl ? streamButtonLabel(streamUrl) : null;
  const streamPlatform = streamUrl ? detectStreamPlatform(streamUrl) : null;

  return (
    <div onClick={() => navigate('/league-game/' + game.id + '?type=league')} style={{ padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(46,91,140,0.08)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Date */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(244,247,250,0.4)', width: 44, flexShrink: 0, lineHeight: 1.5 }}>
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br/>
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        {/* Teams */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <TeamLogo team={home} size={20} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{home?.name || '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TeamLogo team={away} size={20} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ice, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{away?.name || '—'}</span>
          </div>
          {(game.location || game.rink) && (
            <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.35)', marginTop: 3 }}>
              {game.rink
                ? <MapLink rink={game.rink} style={{ color: 'inherit' }} />
                : <MapLink text={game.location} style={{ color: 'inherit' }} />}
            </div>
          )}
        </div>
        {/* Score / Time */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {isLive && <>
            <span style={{ background: C.red, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, display: 'block', marginBottom: 4 }}>● LIVE</span>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>{game.home_score} – {game.away_score}</span>
          </>}
          {isFinal && <>
            <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, display: 'block', marginBottom: 4 }}>FINAL</span>
            <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 16, color: C.ice }}>{game.home_score} – {game.away_score}</span>
          </>}
          {!isLive && !isFinal && (
            <span style={{ background: 'rgba(46,91,140,0.4)', color: C.steel, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>
              {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Watch with LiveBarn — matches tournament style */}
      {hasStream && !isFinal && (
        <button onClick={() => window.open(liveBarnUrl, '_blank')} style={{display:'inline-flex',alignItems:'center',gap:7,background:'#FFFFFF',color:'#0B1F3A',border:'none',borderRadius:999,padding:'8px 14px 8px 8px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',marginTop:10}}>
          <span style={{width:24,height:24,background:'#07111F',borderRadius:5,border:'1px solid rgba(215,38,56,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}><LedR size={16}/></span>
          Watch with LiveBarn
        </button>
      )}
      {hasStream && !isFinal && (
        <div style={{background:'rgba(215,38,56,0.08)',border:'0.5px solid rgba(215,38,56,0.3)',borderRadius:7,padding:'7px 11px',marginTop:9,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,color:'rgba(244,247,250,0.5)',lineHeight:1.6}}>Rinkd members save · ✓ Code <strong style={{color:'#D72638'}}>RINKD10</strong> auto-applied</div>
          <div style={{fontFamily:'Barlow Condensed,sans-serif',fontStyle:'italic',fontWeight:900,fontSize:14,color:'#D72638',marginLeft:10}}>10% off</div>
        </div>
      )}

      {/* Stream URL button — independent of LiveBarn. YouTube / Twitch /
          Facebook / Vimeo / other. Visible pre-game (live stream) AND
          post-final (most platforms archive the broadcast at the same URL).
          Color follows the platform: YouTube red, Twitch purple, Facebook
          blue, fallback navy. */}
      {streamUrl && (() => {
        const platformColor = streamPlatform === 'youtube'  ? '#FF0000'
                            : streamPlatform === 'twitch'   ? '#9146FF'
                            : streamPlatform === 'facebook' ? '#1877F2'
                            : streamPlatform === 'vimeo'    ? '#1AB7EA'
                            : '#0B1F3A';
        return (
          <button onClick={() => window.open(streamUrl, '_blank', 'noopener,noreferrer')}
            style={{display:'inline-flex',alignItems:'center',gap:7,background:platformColor,color:'#FFFFFF',border:'none',borderRadius:999,padding:'8px 16px',fontFamily:'Barlow,sans-serif',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',marginTop:10,marginLeft:hasStream ? 8 : 0}}>
            <span style={{fontSize:12}}>▶</span>
            {streamLabel || 'Watch live'}
          </button>
        );
      })()}

      {/* Scorer View */}
      {isCommissioner && !isFinal && (
        <button onClick={() => navigate('/league-scorer/' + game.id + '?type=league')}
          style={{ marginTop: 8, width: '100%', padding: '8px', background: 'rgba(46,91,140,0.2)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 8, color: '#F4F7FA', fontFamily: 'Barlow,sans-serif', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F4F7FA'; e.currentTarget.style.color = '#0B1F3A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.2)'; e.currentTarget.style.color = '#F4F7FA'; }}>
          ✏️ Open Scorer View
        </button>
      )}
    </div>
  );
}

export default function LeaguePage({ currentUser, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [games, setGames] = useState([]);
  const [standings, setStandings] = useState([]);
  // LEAGUE-DIV-1 M2 — divisions + the active scope. Single-division leagues
  // (KOHA/ESHL) get one "Main" division → no picker, no scoping change.
  const [divisions, setDivisions] = useState([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('Schedule');
  const [showAll, setShowAll] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // Additional commissioner granted via league_roles — mirror of the
  // multi-director pattern. Loaded once after league + currentUser resolve;
  // ORed into isCommissioner so the Manage button + scorer paths honor it.
  const [isExtraCommissioner, setIsExtraCommissioner] = useState(false);
  // "🔔 Follow league" — opt-in for push notifications fired when any league
  // game finalizes (per send-league-recap-push Edge Function targeting).
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // League-scoped Feed tab — auto-recaps land here when a game finalizes
  // via ScorerView (see createGameRecapPost + triggerLeagueRecapPush). Lazy-
  // loaded the first time the Feed tab opens so the Schedule landing stays
  // fast.
  const [feedPosts, setFeedPosts] = useState(null); // null = not loaded yet
  const [feedLoading, setFeedLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // userRole comes back as null for anon users — that's fine, we render
      // PublicLeagueLanding before any role-gated UI. The other four queries
      // all hit public-read policies so they work for anon too.
      const [l, t, g, s, r, dv] = await Promise.all([
        getLeague(id), getLeagueTeams(id), getLeagueGames(id), getLeagueStandings(id),
        currentUser ? getUserLeagueRole(id) : Promise.resolve(null),
        listLeagueDivisions(id),
      ]);
      setLeague(l); setTeams(t); setGames(g); setStandings(s); setUserRole(r); setDivisions(dv);
    } catch(e) {
      // Distinguish a genuine fetch failure from "league not found" — both
      // used to render the same generic "League not found" screen, which made
      // a connection drop look like a permanent 404. Surface the error so the
      // user has something to retry.
      // eslint-disable-next-line no-console
      console.error('[League] load failed', e);
      setError(e?.message || 'Failed to load league');
    } finally { setLoading(false); }
  }, [id, currentUser]);

  useEffect(() => { load(); }, [load]);

  // One view event per page load for EVERY visitor (not just logged-out),
  // tagged with `anonymous` — measures total interest in a shared league page
  // and still isolates share-driven anon traffic. Ref-guarded to fire once.
  // (Was anon-only before, so logged-in views went uncounted.)
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (!league?.id || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track('league_public_view', { league_id: league.id, anonymous: !currentUser });
  }, [league?.id, currentUser]);

  // Resolve isFollowing once on mount / user change. Cheap single-row lookup.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsFollowing(false); return; }
    isFollowingLeague(currentUser.id, id).then((v) => { if (!cancelled) setIsFollowing(v); });
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  // Resolve isExtraCommissioner — non-founder commissioners need the same
  // Manage button + scorer affordances as the founder.
  useEffect(() => {
    let cancelled = false;
    if (!id || !currentUser?.id) { setIsExtraCommissioner(false); return; }
    isExtraCommissionerLookup(currentUser.id, id).then((v) => { if (!cancelled) setIsExtraCommissioner(v); });
    return () => { cancelled = true; };
  }, [id, currentUser?.id]);

  // Resolve the active division (LEAGUE-DIV-1 M2, Decision #6). Priority:
  // ?division= URL param → the user's OWN division (team membership) → first by
  // sort_order. Re-runs only when the current selection is missing/invalid for
  // this league (so a manual switch is never overridden, and navigating to a
  // different league re-resolves).
  useEffect(() => {
    if (!divisions.length) return;
    if (selectedDivisionId && divisions.some((d) => d.id === selectedDivisionId)) return;
    let cancelled = false;
    (async () => {
      const urlDiv = searchParams.get('division');
      if (urlDiv && divisions.some((d) => d.id === urlDiv)) { if (!cancelled) setSelectedDivisionId(urlDiv); return; }
      if (currentUser?.id) {
        const mine = await getMyDivisionInLeague(currentUser.id, id);
        if (!cancelled && mine && divisions.some((d) => d.id === mine)) { setSelectedDivisionId(mine); return; }
      }
      if (!cancelled) setSelectedDivisionId(divisions[0].id);
    })();
    return () => { cancelled = true; };
  }, [divisions, selectedDivisionId, currentUser?.id, id, searchParams]);

  // Lazy-load the league-scoped feed the first time the Feed tab opens.
  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'Feed' || !id || feedPosts !== null) return;
    setFeedLoading(true);
    getLeaguePosts(id, 50).then(({ data }) => {
      if (cancelled) return;
      setFeedPosts(data || []);
      setFeedLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeTab, id, feedPosts]);

  // Realtime: spectators see scores update live when scorers finalize a
  // game. Mirrors the Tournament.js pattern (channel name carries a random
  // suffix to survive StrictMode remounts). Filter on league_id so we only
  // wake up for this league's writes.
  useEffect(() => {
    if (!id) return;
    let channel = null;
    // Debounce: coalesce bursts of league_games changes into one reload per
    // ~1.5s window so a scorer entering several goals doesn't re-run the full
    // load() (standings view included) for every spectator on every tap.
    let reloadTimer = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { try { load(); } catch { /* swallow */ } }, 1500);
    };
    try {
      const name = `league:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase.channel(name)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'league_games', filter: `league_id=eq.${id}` },
          scheduleReload)
        .subscribe();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[league] realtime subscribe failed; spectators may see stale data:', err);
    }
    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      try { if (channel) supabase.removeChannel(channel); } catch { /* swallow */ }
    };
  }, [id, load]);

  const handleFollowToggle = async () => {
    if (!currentUser?.id || !id || followBusy) return;
    setFollowBusy(true);
    if (isFollowing) {
      const { error: unfollowErr } = await unfollowLeague(currentUser.id, id);
      setFollowBusy(false);
      if (!unfollowErr) setIsFollowing(false);
      return;
    }
    // First-time follow: ensure push pipeline is wired. Same fall-through as
    // tournament Follow — DB row gets created either way; if the user later
    // enables push from Profile, future recaps will deliver.
    const alreadyOn = await isPushSubscribed();
    if (!alreadyOn) {
      const sub = await subscribeToPush(currentUser.id);
      if (!sub) {
        setFollowBusy(false);
        // eslint-disable-next-line no-alert
        window.alert("Push notifications are off for this device, so following won't deliver pushes yet. You can still enable them later from your Profile.");
      }
    }
    const { error: followErr } = await followLeague(currentUser.id, id);
    setFollowBusy(false);
    if (!followErr) setIsFollowing(true);
  };

  // Switch division + reflect it in the URL (shareable link + reload-safe).
  const selectDivision = (divId) => {
    setSelectedDivisionId(divId);
    const next = new URLSearchParams(searchParams);
    if (divId) next.set('division', divId); else next.delete('division');
    setSearchParams(next, { replace: true });
  };

  // Shared team-row renderer for the Teams tab (flat list + grouped-by-division).
  const renderLeagueTeamRow = (lt) => (
    <div key={lt.id} onClick={() => navigate('/team/' + lt.team_id)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(46,91,140,0.1)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <TeamLogo team={lt.team || { name: lt.team_name, logo_color: lt.logo_color, logo_initials: lt.logo_initials, logo_url: lt.logo_url }} size={36} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{lt.team?.name || lt.team_name}</div>
        <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>{lt.team?.home_rink || lt.team?.location || ''}</div>
      </div>
      <div style={{ color: 'rgba(244,247,250,0.25)', fontSize: 18 }}>›</div>
    </div>
  );

  if (loading) return <Layout profile={profile}><div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>Loading...</div></Layout>;
  if (error) return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif', padding: 20, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: C.red, fontWeight: 600, marginBottom: 4 }}>Couldn't load this league</div>
          <div style={{ color: 'rgba(244,247,250,0.5)', fontSize: 12, marginBottom: 16 }}>{error}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={load} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Retry</button>
            <button onClick={() => navigate('/leagues')} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Leagues</button>
          </div>
        </div>
      </div>
    </Layout>
  );
  if (!league) {
    // Anon users get the same "private league" framing tournaments use —
    // RLS already filters non-public leagues out of getLeague.
    const isAnon = !currentUser;
    return (
      <Layout profile={profile}>
        <div style={{ background: C.dark, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ice, fontFamily: 'Barlow, sans-serif', padding: 20, textAlign: 'center' }}>
          <div style={{ maxWidth: 380 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{isAnon ? '🔒' : '⚠️'}</div>
            <div style={{ color: isAnon ? C.ice : C.red, fontWeight: 600, marginBottom: 4 }}>
              {isAnon ? 'This league is private' : 'League not found'}
            </div>
            <div style={{ color: 'rgba(244,247,250,0.5)', fontSize: 12, marginBottom: 16 }}>
              {isAnon ? 'Sign in to view standings, schedule, and team pages — or it may not be published yet.' : 'It may have been removed or never published.'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {isAnon ? <>
                <button onClick={() => navigate('/login')} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Sign in / Sign up</button>
                <button onClick={() => navigate('/leagues')} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Browse leagues</button>
              </> : <>
                <button onClick={load} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', fontWeight: 700 }}>Retry</button>
                <button onClick={() => navigate('/leagues')} style={{ background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>Back to Leagues</button>
              </>}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Anonymous spectators: render the teaser landing with metadata + teams.
  // Live standings / schedule / scoresheet stay gated behind sign-up. After
  // auth they're back here for the full experience.
  if (!currentUser) {
    return <Layout profile={profile}><PublicLeagueLanding league={league} teams={teams} games={games} navigate={navigate} /></Layout>;
  }

  // Multi-commissioner: the founder (leagues.commissioner_id) lands as
  // userRole='commissioner' via getUserLeagueRole; additional commissioners
  // come back through the isExtraCommissioner async lookup. Either path
  // grants the same Manage button + scorer affordances.
  const isCommissioner = userRole === 'commissioner' || isExtraCommissioner;
  // LEAGUE-MGR-1 — operational staff (manager-or-above). Gets the Manage button +
  // feed/gallery moderation, but the Manage page itself hides the commissioner-only
  // tabs (Registrations, Settings, Staff) and RLS blocks settings/billing/delete.
  const isManager = isCommissioner || userRole === 'manager';

  // LEAGUE-DIV-1 M2 — scope the competitive views (Schedule + Standings) to the
  // selected division. Single-division leagues (multiDivision=false) pass the
  // full arrays through untouched → byte-identical to today. The Teams tab is a
  // cross-division finder (handled in its own render), so it is NOT scoped here.
  const multiDivision = divisions.length > 1;
  const scopedGames = multiDivision && selectedDivisionId ? games.filter(g => g.division_id === selectedDivisionId) : games;
  const scopedStandings = multiDivision && selectedDivisionId ? standings.filter(r => r.division_id === selectedDivisionId) : standings;

  // OTL column appears only once real OTL data exists (any team has an OTL).
  // Until M3's ScorerView capture marks a game OT/SO, every league renders
  // exactly as today — the safest reading of the byte-identical guardrail.
  const showOtl = scopedStandings.some(r => (r.otl || 0) > 0);
  const standingsCols = showOtl ? '1fr 26px 26px 26px 30px 26px 26px 34px' : '1fr 28px 28px 28px 28px 28px 34px';

  const now = new Date();
  const liveGames = scopedGames.filter(g => g.status === 'live');
  const upcomingGames = scopedGames.filter(g => g.status === 'scheduled' && new Date(g.start_time) >= now);
  const recentGames = scopedGames.filter(g => g.status === 'final').slice(-5).reverse();
  const allGamesByWeek = scopedGames.reduce((acc, g) => {
    const week = getWeekLabel(g.start_time);
    if (!acc[week]) acc[week] = [];
    acc[week].push(g);
    return acc;
  }, {});

  return (
    <Layout profile={profile}>
      <SEO
        title={`${league.name}${league.division ? ' · ' + league.division : ''}`}
        description={`${league.name} on Rinkd. Live standings, full schedule, and team pages for the ${league.division || 'league'}.`}
        url={`https://rinkd.app/league/${league.id}`}
      />
      <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* ADS-1 event banner — renders only when this league has an active sponsor */}
        <AdSlot slot="event_banner" targetType="league" targetId={league.id} style={{ margin: '12px 16px 0' }} />

        {/* BANNER */}
        <div style={{ background: 'linear-gradient(135deg,#0B1F3A 0%,#1a3a5c 100%)', padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 12,
              background: league.logo_url ? `url(${league.logo_url}) center/cover, ${league.logo_color || C.red}` : (league.logo_color || C.red),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: '#fff', flexShrink: 0,
            }}>
              {!league.logo_url && (league.logo_initials || league.name.slice(0, 2).toUpperCase())}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 22, color: C.ice, lineHeight: 1.1 }}>{league.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginTop: 4 }}>
                {[league.division, league.season, league.location].filter(Boolean).join(' · ')}
              </div>
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, marginTop: 6, background: league.status === 'active' ? 'rgba(34,197,94,0.15)' : 'rgba(244,247,250,0.08)', color: league.status === 'active' ? '#22C55E' : 'rgba(244,247,250,0.4)', letterSpacing: '0.06em' }}>
                {league.status === 'active' ? '● IN SEASON' : league.status === 'complete' ? 'SEASON COMPLETE' : 'DRAFT'}
              </span>
              {league.is_activated === false && (
                <span title="Live scoring + push notifications are locked until a Rinkd admin activates this league."
                  style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, marginTop: 6, marginLeft: 6, background: 'rgba(245,158,11,0.18)', color: '#F59E0B', letterSpacing: '0.06em' }}>
                  🔒 Activation pending
                </span>
              )}
            </div>
            {/* Follow button — hidden for commissioners (they already get
                events from their own writes via the live recap path).
                Mirrors the Tournament.js Follow pattern. */}
            {currentUser && !isCommissioner && (
              <button onClick={handleFollowToggle} disabled={followBusy}
                style={{
                  background: isFollowing ? 'rgba(46,91,140,0.25)' : C.red,
                  color: isFollowing ? C.ice : '#fff',
                  border: isFollowing ? '1px solid rgba(46,91,140,0.5)' : 'none',
                  borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 700,
                  cursor: followBusy ? 'wait' : 'pointer',
                  fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  opacity: followBusy ? 0.6 : 1, whiteSpace: 'nowrap',
                }}>
                {isFollowing ? '🔔 Following' : '🔔 Follow'}
              </button>
            )}
            {currentUser && <PinToNavButton userId={currentUser.id} pinType="league" targetId={id} />}
            {isManager && (
              <button onClick={() => navigate(`/league/${id}/manage`)}
                style={{ background: 'rgba(46,91,140,0.25)', border: '0.5px solid rgba(46,91,140,0.5)', borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 600, color: C.ice, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.25)'; e.currentTarget.style.color = C.ice; }}>
                ⚙️ Manage
              </button>
            )}
          </div>

          {/* Stats bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: '0.5px solid rgba(46,91,140,0.4)', background: C.navy }}>
            {[
              { num: teams.length, label: 'Teams' },
              { num: games.length, label: 'Games' },
              { num: games.filter(g => g.status === 'final').length, label: 'Played' },
              { num: games.filter(g => g.status === 'scheduled').length, label: 'Left' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '10px 0', textAlign: 'center', borderRight: i < 3 ? '0.5px solid rgba(46,91,140,0.3)' : 'none' }}>
                <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.ice }}>{s.num}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(244,247,250,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '2px solid rgba(46,91,140,0.3)', overflowX: 'auto' }}>
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ fontSize: 13, fontWeight: 700, padding: '10px 16px', color: '#FFFFFF', background: 'transparent', border: 'none', borderBottom: activeTab === tab ? '3px solid #D72638' : '3px solid transparent', marginBottom: -2, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap', opacity: activeTab === tab ? 1 : 0.5, transition: 'opacity 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#0B1F3A'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.opacity = activeTab === tab ? '1' : '0.5'; }}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {/* LEAGUE-DIV-1 M2 — adaptive division selector. Renders nothing for
              single-division leagues (KOHA/ESHL unchanged). */}
          <DivisionPicker divisions={divisions} selectedId={selectedDivisionId} onSelect={selectDivision} accent={league.accent_color || C.red} />
          {league.status === 'draft' && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '0.5px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⏳</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B' }}>League activation pending</div>
                <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginTop: 2 }}>The commissioner is still setting up the schedule. You'll be notified when the season goes live.</div>
              </div>
            </div>
          )}


          {/* SCHEDULE TAB */}
          {activeTab === 'Schedule' && (
            <>
              <AdSlot slot="schedule_presented" targetType="league" targetId={league.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
              {games.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button
                    onClick={() => setSubscribeOpen(true)}
                    style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '8px 16px', borderRadius: 999,
                      background: C.red, border: 'none',
                      color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: "'Barlow', sans-serif", transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
                    📡 Subscribe to League Calendar
                  </button>
                </div>
              )}
              {!showAll ? (
                <>
                  {liveGames.length > 0 && (
                    <>
                      <div style={secLabel}>Live Now</div>
                      <div style={card}>{liveGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {upcomingGames.length > 0 && (
                    <>
                      <div style={secLabel}>Upcoming</div>
                      <div style={card}>{upcomingGames.slice(0, 5).map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {recentGames.length > 0 && (
                    <>
                      <div style={secLabel}>Recent Results</div>
                      <div style={card}>{recentGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </>
                  )}
                  {scopedGames.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(244,247,250,0.3)', fontSize: 13, padding: '40px 0' }}>No games scheduled yet</div>}
                  {scopedGames.length > 0 && (
                    <button onClick={() => setShowAll(true)}
                      style={{ width: '100%', padding: 12, background: 'rgba(46,91,140,0.15)', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 10, color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', marginTop: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(46,91,140,0.15)'; e.currentTarget.style.color = C.ice; }}>
                      View Full Season Schedule ({scopedGames.length} games)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={secLabel}>Full Season Schedule</div>
                    <button onClick={() => setShowAll(false)} style={{ background: 'none', border: 'none', color: 'rgba(244,247,250,0.4)', fontSize: 12, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>← Back</button>
                  </div>
                  {Object.entries(allGamesByWeek).map(([week, wGames]) => (
                    <div key={week}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8, marginTop: 4 }}>{week}</div>
                      <div style={card}>{wGames.map(g => <GameRow key={g.id} game={g} isCommissioner={isCommissioner} navigate={navigate} />)}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* STANDINGS TAB */}
          {activeTab === 'Standings' && (
            <>
              <AdSlot slot="standings_presented" targetType="league" targetId={league.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
              <div style={secLabel}>Season Standings</div>
              <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: standingsCols, padding: '8px 12px', background: 'rgba(46,91,140,0.2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.35)', textTransform: 'uppercase' }}>
                  <span>Team</span><span style={{textAlign:'center'}}>GP</span><span style={{textAlign:'center'}}>W</span><span style={{textAlign:'center'}}>L</span>{showOtl && <span style={{textAlign:'center'}}>OTL</span>}<span style={{textAlign:'center'}}>T</span><span style={{textAlign:'center'}}>GF</span><span style={{textAlign:'center'}}>PTS</span>
                </div>
                {scopedStandings.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No games played yet</div>}
                {scopedStandings.map((row, i) => (
                  <div key={row.lt_id} style={{ display: 'grid', gridTemplateColumns: standingsCols, padding: '10px 12px', borderTop: '0.5px solid rgba(244,247,250,0.06)', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 5, background: row.logo_url ? `url(${row.logo_url}) center/cover, ${row.logo_color || C.blue}` : (row.logo_color || C.blue), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff', flexShrink: 0 }}>
                        {!row.logo_url && (row.logo_initials || row.team_name.slice(0, 2).toUpperCase())}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{row.team_name}</span>
                    </div>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.gp}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.wins}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.losses}</span>
                    {showOtl && <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.otl || 0}</span>}
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.ties}</span>
                    <span style={{ fontSize: 12, textAlign: 'center', color: 'rgba(244,247,250,0.65)' }}>{row.gf}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', color: row.rank === 1 ? C.red : row.pts === 0 ? 'rgba(244,247,250,0.25)' : C.ice }}>{row.pts}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* STATS TAB — skater + goalie leaderboards (jersey-keyed, roster names) */}
          {activeTab === 'Stats' && (
            <>
              <AdSlot slot="stats_presented" targetType="league" targetId={league.id} style={{ maxWidth: 320, margin: '0 0 12px' }} radius={8} />
              <SeasonGamePucks scope="league" id={id} accent={league.accent_color || C.red} />
              <StatLeaderboards source="league" id={id} accent={league.accent_color || C.red} archived={league.settings?.archived_stats || null} />
            </>
          )}

          {/* TEAMS TAB */}
          {activeTab === 'Teams' && (
            multiDivision ? (
              /* Cross-division finder: search across the whole league, grouped
                 by division. The competitive views (Schedule/Standings) follow
                 the picker; Teams is intentionally the league-wide directory. */
              <>
                <input value={teamSearch} onChange={e => setTeamSearch(e.target.value)} placeholder="Search teams across all divisions…"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', color: C.ice, borderRadius: 10, padding: '10px 12px', fontSize: 13, outline: 'none', marginBottom: 12, fontFamily: 'Barlow, sans-serif' }} />
                {teams.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No teams yet</div>}
                {divisions.map(d => {
                  const term = teamSearch.trim().toLowerCase();
                  const divTeams = teams.filter(t => t.division_id === d.id && (!term || (t.team?.name || t.team_name || '').toLowerCase().includes(term)));
                  if (divTeams.length === 0) return null;
                  return (
                    <div key={d.id}>
                      <div style={secLabel}>{d.name} · {divTeams.length}</div>
                      <div style={card}>{divTeams.map(renderLeagueTeamRow)}</div>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <div style={secLabel}>{teams.length} Teams</div>
                <div style={card}>
                  {teams.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(244,247,250,0.3)', textAlign: 'center' }}>No teams yet</div>}
                  {teams.map(renderLeagueTeamRow)}
                </div>
              </>
            )
          )}

          {/* FEED TAB — auto-recaps + user posts scoped to this league */}
          {activeTab === 'Feed' && (
            <LeagueFeedTab
              posts={feedPosts}
              setPosts={setFeedPosts}
              loading={feedLoading}
              navigate={navigate}
              currentUser={currentUser}
              leagueId={id}
              canModerate={isManager}
            />
          )}

          {/* GALLERY TAB — media-only grid over league posts (inherits
              reactions/comments/likes/moderation; no separate table) */}
          {activeTab === 'Gallery' && (
            <Gallery leagueId={id} currentUser={currentUser} />
          )}

          {/* INFO TAB */}
          {activeTab === 'Info' && (
            <>
              {/* "Run your league on Rinkd" marketing banner — only shown
                  on non-activated leagues. Once Pete flips activation true
                  this is a real paying customer's page; the lead-gen CTA
                  belongs on demos + draft leagues only. */}
              {league.is_activated === false && (
                <div style={{ background: 'linear-gradient(135deg,#0f2847 0%,#0B1F3A 100%)', border: '1px solid rgba(46,91,140,0.6)', borderRadius: 14, padding: '20px 18px', marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 6 }}>Run your league on Rinkd</div>
                  <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.5)', marginBottom: 14, lineHeight: 1.6 }}>Live standings · real-time scoring · team management · season scheduling</div>
                  <a href="mailto:hello@rinkd.app?subject=League Hosting Inquiry" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 22px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>✉️ hello@rinkd.app</a>
                  <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)', marginTop: 10 }}>We'll respond within 24 hours</div>
                  <div style={{ marginTop: 8 }}><a href="/pricing" style={{ color: 'rgba(244,247,250,0.6)', fontSize: 12, textDecoration: 'underline' }}>See pricing →</a></div>
                </div>
              )}
              <div style={card}>
                {[['Division', league.division], ['Season', league.season], ['Location', league.location], ['Point System', `${league.settings?.points_win ?? 2}W · ${league.settings?.points_tie ?? 1}T · ${league.settings?.points_loss ?? 0}L`], ['Commissioner', league.commissioner ? `@${league.commissioner.handle}` : '—']].filter(([,v]) => v).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '0.5px solid rgba(244,247,250,0.06)' }}>
                    <span style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <SubscribeCalendarSheet
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        httpsUrl={`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/schedule-ics?league=${league?.id || ''}`}
        webcalUrl={`${(process.env.REACT_APP_SUPABASE_URL || '').replace(/^https/, 'webcal')}/functions/v1/schedule-ics?league=${league?.id || ''}`}
        title={league?.name ? `the full ${league.name} schedule` : 'the league schedule'}
      />
    </Layout>
  );
}

function getWeekLabel(dateStr) {
  const date = new Date(dateStr);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

const secLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(244,247,250,0.3)', textTransform: 'uppercase', marginBottom: 8 };
const card = { background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 };

// League-scoped feed. Mirror of the Tournament Feed tab pattern shipped
// May 18 (commit 4ec187c4 + ae4d7985). Surfaces auto-recap posts (from
// ScorerView finalize → createGameRecapPost + triggerLeagueRecapPush) AND
// user-authored posts scoped to this league. User posts do NOT trigger
// pushes — only recaps do — to keep notification volume sane.
function LeagueFeedTab({ posts, setPosts, loading, navigate, currentUser, leagueId, canModerate = false }) {
  const [draft, setDraft] = useState('');
  const [postMentionIds, setPostMentionIds] = useState([]);
  const [mediaFile, setMediaFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState(null);
  const [likedPosts, setLikedPosts] = useState([]);
  const [reactionMap, setReactionMap] = useState({});
  const likeInFlightRef = useRef(new Set());

  // Load which of the visible posts the current user has already liked. Keyed
  // on the id SET, not the posts objects — an optimistic like rewrites a post
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

  // Reaction counts are public — load them on the same id-SET key as likes,
  // regardless of sign-in. PostReactions owns its own optimistic state.
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
    if (!currentUser?.id || !leagueId || submitting) return;
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
      const { data, error } = await createPost(currentUser.id, { content, mediaUrl, mediaType, leagueId });
      if (error) { setComposerError(error.message || 'Post failed'); setSubmitting(false); return; }
      if (data) {
        // Persist resolved @-mentions (best-effort; failure shouldn't block the post).
        if (postMentionIds.length) savePostMentions(data.id, postMentionIds);
        // Optimistic prepend so the author sees their post immediately. The
        // next refetch picks up the same row by id.
        const newPost = { ...data, profiles: currentUser.profile || null };
        setPosts((prev) => [newPost, ...(prev || [])]);
      }
      setDraft('');
      setPostMentionIds([]);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {currentUser && (
        <div style={{ background: '#11253E', borderRadius: 10, padding: '10px 12px' }}>
          <MentionInput
            value={draft}
            onChange={setDraft}
            onMentionsChange={setPostMentionIds}
            placeholder="Post to the league feed…"
            rows={2}
            maxLength={500}
            textareaStyle={{ background: '#07111F', color: C.ice, border: '1px solid #1F3553', borderRadius: 6, padding: '8px 10px', fontFamily: 'Barlow, sans-serif', fontSize: 13 }}
          />
          {mediaFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9BB5D6', marginTop: 6 }}>
              <span>📎 {mediaFile.name}</span>
              <button onClick={() => setMediaFile(null)} style={{ background: 'transparent', border: 'none', color: '#E26B6B', fontSize: 11, cursor: 'pointer' }}>Remove</button>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <label style={{ cursor: 'pointer', fontSize: 12, color: '#9BB5D6' }}>
              📷 Photo
              <input type="file" accept="image/*,video/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setMediaFile(f); }} />
            </label>
            <button onClick={handleSubmit} disabled={submitting || (!draft.trim() && !mediaFile)}
              style={{ background: submitting || (!draft.trim() && !mediaFile) ? '#1F3553' : '#5B9FE2', color: C.ice, border: 'none', borderRadius: 6, padding: '6px 14px', fontFamily: 'Barlow, sans-serif', fontSize: 12, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer' }}>
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </div>
          {composerError && <div style={{ color: '#E26B6B', fontSize: 11, marginTop: 6 }}>{composerError}</div>}
          <div style={{ fontSize: 10, color: '#7C8B9F', marginTop: 4, textAlign: 'right' }}>{draft.length}/500</div>
        </div>
      )}

      {loading || posts === null ? (
        <div style={{ textAlign: 'center', color: '#7C8B9F', fontSize: 13, padding: '24px 16px' }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7C8B9F', fontSize: 13, padding: '40px 16px', lineHeight: 1.6 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📰</div>
          No updates yet.<br />
          Recaps appear here when games finalize. You can post too.
        </div>
      ) : (
        posts.map((p) => {
          const lines = String(p.content || '').split('\n').filter(Boolean);
          const headline = lines[0] || 'Update';
          const body = lines.slice(1).join(' · ');
          const author = p.profiles?.name || p.profiles?.handle || '';
          const mentionMap = mentionMapFromRows(p.post_mentions);
          return (
            <div key={p.id} style={{ background: '#11253E', borderRadius: 10, padding: '12px 14px', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {p.tag && (
                    <div style={{ display: 'inline-block', background: (p.tag_color || '#2E5B8C') + '40', color: p.tag_color || '#9BB5D6', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, marginBottom: 6 }}>
                      {p.tag}
                    </div>
                  )}
                  <div style={{ fontWeight: p.recap_for_game_id ? 700 : 500, fontSize: p.recap_for_game_id ? 15 : 13, lineHeight: 1.3, marginBottom: body ? 4 : 0 }}><MentionText text={headline} mentions={mentionMap} /></div>
                  {body && <div style={{ fontSize: 13, color: '#C5D2E1', lineHeight: 1.4, marginBottom: 8 }}><MentionText text={body} mentions={mentionMap} /></div>}
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
                    onModerated={() => handleHidden(p.id)}
                  />
                )}
              </div>
              {p.media_url && (
                <div style={{ marginTop: 6, marginBottom: 6, borderRadius: 6, overflow: 'hidden' }}>
                  {p.media_type === 'video'
                    ? <video src={p.media_url} controls style={{ width: '100%', display: 'block' }} />
                    : <img src={p.media_url} alt="" style={{ width: '100%', display: 'block' }} />}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <PostReactions postId={p.id} currentUserId={currentUser?.id} initial={reactionMap[p.id]} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#7C8B9F', marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <button
                    onClick={() => onLike(p.id)}
                    disabled={!currentUser}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: currentUser ? 'pointer' : 'default', color: likedPosts.includes(p.id) ? '#D72638' : '#7C8B9F', fontFamily: 'Barlow, sans-serif', fontSize: 12 }}
                  >
                    <span style={{ fontSize: 14 }}>{likedPosts.includes(p.id) ? '❤️' : '🤍'}</span>
                    <span style={{ fontWeight: likedPosts.includes(p.id) ? 700 : 400 }}>{p.likes || 0}</span>
                  </button>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{author ? `${author} · ` : ''}{timeAgo(p.created_at)} ago</span>
                </div>
                {p.recap_for_game_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button onClick={() => navigate(`/game/${p.recap_for_game_id}?type=league`)}
                      style={{ background: 'transparent', border: 'none', color: '#5B9FE2', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                      View game →
                    </button>
                    <ShareButton gameId={p.recap_for_game_id} isLeague variant="ghost"
                      getCard={() => loadGameCardData(p.recap_for_game_id, true)} />
                  </div>
                )}
                {p.gamepuck_reveal_game_id && (
                  <button onClick={() => navigate(`/game/${p.gamepuck_reveal_game_id}?type=league`)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(215,38,56,0.15)', border: '1px solid #D72638', color: '#F4F7FA', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 12px', borderRadius: 999 }}>
                    🏒 Peel to reveal →
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

// Anonymous-spectator landing for /league/:id. Shows league metadata + teams
// + a clear "sign up to view live" CTA. Live data (standings, scoresheet,
// feed composer) stays gated — the conversion lever is "see live scores +
// follow your team's results." League details (name/dates/venue/season) are
// intentionally public to make the URL shareable + Google-indexable.
//
// Direct mirror of PublicTournamentLanding in Tournament.js.
function PublicLeagueLanding({ league, teams, games, navigate }) {
  const accent = league?.accent_color || '#D72638';
  const venueLine = [league?.venue_name, league?.venue_address].filter(Boolean).join(' · ');
  const dateLine = [league?.start_date, league?.end_date].filter(Boolean).join(' – ');
  const seasonLine = [league?.season, league?.division, league?.level, league?.location].filter(Boolean).join(' · ');
  const totalTeams = teams?.length || 0;
  const totalGames = games?.length || 0;
  const playedGames = useMemo(() => (games || []).filter((g) => g.status === 'final').length, [games]);
  const returnTo = encodeURIComponent(`/league/${league.id}`);
  return (
    <div style={{ background: C.dark, minHeight: '100vh', fontFamily: 'Barlow, sans-serif', color: C.ice }}>
      {/* ADS-1 M5 — sponsor banner also shows to anon spectators (null when no sponsor) */}
      <AdSlot slot="event_banner" targetType="league" targetId={league.id} style={{ margin: '12px 16px 0' }} />
      <div style={{ background: C.navy, padding: '16px 18px 0', borderTop: `3px solid ${accent}`, borderBottom: '0.5px solid rgba(46,91,140,0.4)' }}>
        <button onClick={() => navigate('/leagues')} style={{ color: 'rgba(244,247,250,0.6)', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Barlow, sans-serif', marginBottom: 8 }}>← All leagues</button>
        {league?.logo_url && (
          <img src={league.logo_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ height: 48, width: 'auto', display: 'block', marginBottom: 10, borderRadius: 6 }} />
        )}
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28, lineHeight: 1.05 }}>
          {(league?.name || '').toUpperCase()}
        </div>
        {seasonLine && <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.6)', marginTop: 4 }}>{seasonLine}</div>}
        {(dateLine || venueLine) && (
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)', margin: '8px 0 16px' }}>
            {dateLine}{dateLine && venueLine ? ' · ' : ''}{venueLine}
          </div>
        )}
      </div>

      <div style={{ padding: '20px 18px', maxWidth: 560, margin: '0 auto' }}>
        {/* Sign-up hero */}
        <div style={{ background: `linear-gradient(135deg,${accent}33 0%,#0f2847 100%)`, border: `1px solid ${accent}66`, borderRadius: 14, padding: '20px 18px', marginBottom: 18, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, marginBottom: 6, textTransform: 'uppercase' }}>Follow every game</div>
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.75)', marginBottom: 16, lineHeight: 1.55 }}>
            Live scores, standings, and the schedule — plus a recap the moment each game ends. Sign up free to follow the season.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate(`/login?returnTo=${returnTo}`)}
              style={{ background: accent, color: '#fff', border: 'none', borderRadius: 999, padding: '12px 28px', fontFamily: 'Barlow, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Sign up free →
            </button>
            <button onClick={() => navigate(`/login?returnTo=${returnTo}`)}
              style={{ background: 'transparent', color: C.ice, border: '1px solid rgba(244,247,250,0.3)', borderRadius: 999, padding: '12px 22px', fontFamily: 'Barlow, sans-serif', fontSize: 13, cursor: 'pointer' }}>
              Sign in
            </button>
          </div>
        </div>

        {/* At-a-glance stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
          {[
            { num: totalTeams, label: 'Teams' },
            { num: totalGames, label: 'Games' },
            { num: playedGames, label: 'Played' },
          ].map((s) => (
            <div key={s.label} style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: accent, lineHeight: 1 }}>{s.num}</div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(244,247,250,0.5)', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Teams list — names + colored chips. Records hidden behind sign-up. */}
        {teams?.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 15, marginBottom: 10, textTransform: 'uppercase' }}>
              Competing teams
            </div>
            <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              {teams.map((lt, i) => {
                const name = lt.team?.name || lt.team_name || '—';
                const color = lt.team?.logo_color || lt.logo_color || C.blue;
                const initials = lt.team?.logo_initials || lt.logo_initials || name.slice(0, 2).toUpperCase();
                const logoUrl = lt.team?.logo_url || lt.logo_url;
                return (
                  <div key={lt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: i ? '0.5px solid rgba(244,247,250,0.06)' : 'none' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: logoUrl ? `url(${logoUrl}) center/cover, ${color}` : color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 11, color: '#fff', flexShrink: 0 }}>
                      {!logoUrl && initials}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Secondary CTA for scrollers */}
        <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '18px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.65)', marginBottom: 12, lineHeight: 1.55 }}>
            Live scores, standings, the full schedule, and a recap of every game — as it happens. Free to follow.
          </div>
          <button onClick={() => navigate(`/login?returnTo=${returnTo}`)}
            style={{ background: accent, color: '#fff', border: 'none', borderRadius: 999, padding: '11px 24px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Create your free account
          </button>
        </div>
      </div>
    </div>
  );
}
