import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import SEO from '../components/SEO';
import { Icon, Img } from '../components/ui';
import { Avatar, TierBadge, TeamLogo } from '../components/Logos';
import TapeText from '../components/TapeText';
import { CardGridSkeleton, ListRowSkeleton } from '../components/Skeletons';
import EmptyState from '../components/ui/EmptyState';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import { followUser, unfollowUser, timeAgo } from '../lib/posts';
import { getBlockedIds } from '../lib/blocks';
import { getTier } from '../lib/tiers';
import { C, colors } from '../lib/tokens';

// Escape characters that have special meaning inside a PostgREST .or() clause
// — a raw `,` or `)` in a user's search query would break the OR-list parser
// and could either return zero rows or surface a 400 from PostgREST. Stripping
// rather than escaping is fine: nobody searches for those literally.
function safeIlikeFragment(s) {
  return String(s || '').replace(/[,()*]/g, ' ').trim();
}

const TABS = [
  { id: 'players',  label: 'Players' },
  { id: 'teams',    label: 'Teams' },
  { id: 'leagues',  label: 'Leagues' },
  { id: 'articles', label: 'Articles' },
];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// =================== PLAYER ROW ===================
function PlayerRow({ p, currentUser, onOpen, isFollowingProp = false }) {
  // Initial state hydrated from the batched isFollowing fetch the parent did.
  // The previous version fired its own per-row query — N round-trips per page.
  const [following, setFollowing] = useState(isFollowingProp);
  const [busy, setBusy] = useState(false);
  const tier = getTier(p.points || 0);

  // Keep local state in sync if the parent's batched result re-resolves
  // (e.g., after a new search returns).
  useEffect(() => { setFollowing(isFollowingProp); }, [isFollowingProp]);

  const toggle = async (e) => {
    e.stopPropagation();
    if (!currentUser) return;
    setBusy(true);
    // Only flip local state if the write actually succeeded. The previous
    // version unconditionally flipped optimistically and ignored errors, so a
    // failed follow looked like a successful follow until reload.
    const result = following
      ? await unfollowUser(currentUser.id, p.id)
      : await followUser(currentUser.id, p.id);
    if (!result?.error) {
      setFollowing(!following);
      if (!following) track('discover_follow', { target_user_id: p.id });
    }
    setBusy(false);
  };

  return (
    <div onClick={onOpen} className="rinkd-pressable" style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: 12,
      cursor: 'pointer', transition: 'background 0.15s',
    }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(46,91,140,0.12)'}
       onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Avatar profile={p} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{p.name}</span>
          <TierBadge tier={tier.name} size="xs" />
        </div>
        <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>@{p.handle}{p.position ? ` · ${p.position}` : ''}{p.level ? ` · ${p.level}` : ''}</div>
      </div>
      {currentUser && currentUser.id !== p.id && (
        <button onClick={toggle} disabled={busy}
          style={{
            background: following ? 'transparent' : C.red,
            color: following ? C.steel : '#fff',
            border: following ? `1px solid ${C.border}` : 'none',
            padding: '6px 14px', minHeight: 44, borderRadius: 999, cursor: 'pointer',
            fontSize: 12, fontWeight: 700, fontFamily: 'Barlow, sans-serif',
          }}>
          {following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  );
}

// =================== TRENDING POSTS RAIL ===================
function TrendingRail({ navigate }) {
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data, error: qErr } = await supabase
      .from('posts')
      .select('id, content, media_url, media_type, likes, comment_count, created_at, profiles!posts_author_id_fkey(id, name, handle, avatar_color, avatar_initials, tier)')
      .gte('created_at', sevenDaysAgo)
      .order('likes', { ascending: false })
      .limit(6);
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    setTrend(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <CardGridSkeleton count={3} />;
  if (error) {
    return (
      <div style={{ padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 13, color: C.steel, textAlign: 'center' }}>
        Couldn't load trending posts.{' '}
        <button onClick={load} style={{ background: 'none', border: 'none', color: C.red, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }
  if (!trend.length) {
    return (
      <EmptyState
        icon="📣"
        title="Quiet on the feed"
        body="Be the first to post something this week and you'll land right here."
        cta={{ label: 'Open Feed', onClick: () => navigate('/feed') }}
      />
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {trend.map((p) => (
        <div key={p.id} onClick={() => navigate(`/profile/${p.profiles?.id}`)} className="rinkd-pressable" style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Avatar profile={p.profiles} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: C.ice, fontWeight: 600 }}>{p.profiles?.name}</div>
              <div style={{ fontSize: 11, color: C.steel }}>{timeAgo(p.created_at)}</div>
            </div>
          </div>
          {p.media_url && (
            p.media_type === 'video'
              ? <div style={{ background: '#000', borderRadius: 8, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.steel, fontSize: 12 }}>▶ Video</div>
              : <Img src={p.media_url} alt="" height={110} radius={8} />
          )}
          {p.content && <div style={{ fontSize: 13, color: C.ice, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{p.content}</div>}
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.steel, marginTop: 'auto' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="like" size={14} /> {p.likes || 0}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="comment" size={14} /> {p.comment_count || 0}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =================== TOP SCORERS RAIL ===================
function TopScorersRail() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Real top scorers, aggregated server-side via the get_top_scorers RPC.
    // Replaces a query that referenced `scorer_id` — a column that doesn't
    // exist on game_goals (the column is scorer_number, a jersey #) — so this
    // rail was silently broken and always empty. The leaderboard fills in
    // once there are profile-linked scorers in the data.
    const { data, error: qErr } = await supabase.rpc('get_top_scorers', { p_limit: 5 });
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ListRowSkeleton rows={5} />;
  if (error) {
    return (
      <div style={{ padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 13, color: C.steel, textAlign: 'center' }}>
        Couldn't load top scorers.{' '}
        <button onClick={load} style={{ background: 'none', border: 'none', color: C.red, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div style={{ padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 13, color: C.steel, textAlign: 'center' }}>
        Standings light up once league games go final.
      </div>
    );
  }
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {rows.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: i === 0 ? C.red : i === 1 ? C.blue : 'rgba(244,247,250,0.15)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
          <Avatar profile={p} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.ice }}>{p.name}</div>
            <div style={{ fontSize: 11, color: C.steel }}>@{p.handle}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: C.red, lineHeight: 1 }}>{p.goals}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goals</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =================== MAIN PAGE ===================
export default function Discover({ currentUser, profile }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('players');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Batched isFollowing lookup result — one query for the whole visible page
  // instead of N per-row queries. Refreshes whenever the players list changes.
  const [followingSet, setFollowingSet] = useState(() => new Set());
  // perf(scale) C08 PR-F — "Show more" keyset paging, ONE tab at a time.
  // Search results stay single-page (per spec) — hasMore/loadingMore only
  // apply when there's no active search. PAGE_CAP is the per-tab page size
  // (matches the existing 40-cap); each tab's cursor is the sort column of
  // its own ORDER BY so paging is a real keyset, not an offset.
  const PAGE_CAP = 40;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const search$ = debounced.trim();
  const ilike = useMemo(() => {
    const safe = safeIlikeFragment(search$);
    return safe ? `%${safe}%` : null;
  }, [search$]);

  // Tab config: which setter, the base query builder, the cursor column, and
  // how to read a cursor value off the last row of a page. Shared by both the
  // first-page load() and loadMore() below so the two can never drift.
  const tabConfig = useMemo(() => ({
    players: {
      setter: setPlayers,
      cursorKey: 'points',
      build: () => supabase.from('profiles')
        // YOUTH-PRIVACY: minors never surface in people search (RLS also
        // hides them, but exclude explicitly so an insider's view stays consistent).
        .select('id, name, handle, position, level, points, tier, avatar_color, avatar_initials')
        .neq('account_type', 'minor')
        .order('points', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true }), // tie-breaker so the cursor is deterministic
      applySearch: (q) => q.or(`name.ilike.${ilike},handle.ilike.${ilike}`),
      // Compound cursor (points, id) — a plain `points < cur` would silently
      // skip/duplicate rows that TIE on the same points value at the page
      // boundary (common near 0 points). `or` replicates keyset-with-tiebreaker.
      // cur === null means the cursor row itself had no points (sorts last,
      // nullsFirst:false) — there's nothing further to page to.
      applyCursor: (q, cur, curId) => (cur == null ? q.eq('id', curId).limit(0) : q.or(`points.lt.${cur},and(points.eq.${cur},id.gt.${curId})`)),
    },
    teams: {
      setter: setTeams,
      cursorKey: 'created_at',
      build: () => supabase.from('teams')
        .select('id, name, level, division, location, logo_color, logo_initials, logo_url, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }), // tie-breaker so the cursor is deterministic
      applySearch: (q) => q.or(`name.ilike.${ilike},level.ilike.${ilike},location.ilike.${ilike}`),
      // Compound cursor (created_at, id) — same tie-safe pattern as players:
      // a plain `created_at < cur` can skip a row that TIES on created_at at
      // the page boundary.
      applyCursor: (q, cur, curId) => q.or(`created_at.lt.${cur},and(created_at.eq.${cur},id.gt.${curId})`),
    },
    leagues: {
      setter: setLeagues,
      cursorKey: 'created_at',
      build: () => supabase.from('leagues')
        .select('id, name, division, season, logo_color, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }), // tie-breaker so the cursor is deterministic
      applySearch: (q) => q.or(`name.ilike.${ilike},division.ilike.${ilike}`),
      // Compound cursor (created_at, id) — see teams above.
      applyCursor: (q, cur, curId) => q.or(`created_at.lt.${cur},and(created_at.eq.${cur},id.gt.${curId})`),
    },
    articles: {
      setter: setArticles,
      cursorKey: 'published_at',
      build: () => supabase.from('rinkside_articles')
        .select('id, slug, title, subtitle, hero_image_url, category, author_name, published_at, read_minutes')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .order('id', { ascending: true }), // tie-breaker so the cursor is deterministic
      applySearch: (q) => q.or(`title.ilike.${ilike},subtitle.ilike.${ilike},category.ilike.${ilike}`),
      // Compound cursor (published_at, id) — see teams above.
      applyCursor: (q, cur, curId) => q.or(`published_at.lt.${cur},and(published_at.eq.${cur},id.gt.${curId})`),
    },
  }), [ilike]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasMore(false);
    const cfg = tabConfig[tab];
    let q = cfg.build().limit(PAGE_CAP);
    if (ilike) q = cfg.applySearch(q);
    const { data, error: qErr } = await q;
    if (qErr) { setError(qErr.message); setLoading(false); return; }
    let rows = data || [];
    if (tab === 'players') {
      // Hide blocked users (either direction) from the people-search results.
      const blocked = await getBlockedIds();
      rows = blocked.size ? rows.filter((p) => !blocked.has(p.id)) : rows;
    }
    cfg.setter(rows);
    // Search stays single-page; directory browsing (no search) can page further.
    setHasMore(!ilike && (data || []).length === PAGE_CAP);
    setLoading(false);
  }, [tab, ilike, tabConfig]);

  useEffect(() => { load(); }, [load]);

  // "Show more" — keyset page using the LAST loaded row's cursor column.
  // Never active during a search (hasMore is forced false above).
  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const cfg = tabConfig[tab];
      const currentRows = { players, teams, leagues, articles }[tab];
      const lastRow = currentRows[currentRows.length - 1];
      const cursor = lastRow?.[cfg.cursorKey];
      let q = cfg.build().limit(PAGE_CAP);
      if (cursor != null) q = cfg.applyCursor(q, cursor, lastRow?.id);
      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      let rows = data || [];
      if (tab === 'players') {
        const blocked = await getBlockedIds();
        rows = blocked.size ? rows.filter((p) => !blocked.has(p.id)) : rows;
      }
      cfg.setter((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const fresh = rows.filter((r) => !seen.has(r.id));
        return [...prev, ...fresh];
      });
      setHasMore((data || []).length === PAGE_CAP);
    } catch (e) {
      setError(e?.message || 'Could not load more results.');
    }
    setLoadingMore(false);
  };

  // One batched isFollowing lookup whenever the visible player list changes —
  // replaces N per-PlayerRow queries. Quietly fails to an empty set on error
  // (the UI just shows the Follow button until the next refresh).
  useEffect(() => {
    if (tab !== 'players' || !currentUser?.id || players.length === 0) {
      setFollowingSet(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = players.map(p => p.id).filter(id => id !== currentUser.id);
      if (ids.length === 0) { if (!cancelled) setFollowingSet(new Set()); return; }
      const { data } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id)
        .in('following_id', ids);
      if (cancelled) return;
      setFollowingSet(new Set((data || []).map(r => r.following_id)));
    })();
    return () => { cancelled = true; };
  }, [tab, players, currentUser?.id]);

  useEffect(() => {
    if (search$) track('discover_search', { tab, q_length: search$.length });
  }, [search$, tab]);

  // Distinct error/retry block — shown in place of the tab list when a query
  // fails, so a failed search doesn't masquerade as "no results found."
  const errorBlock = error ? (
    <div style={{ padding: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: C.red }}>Couldn't load results</div>
      <div style={{ fontSize: 12, color: C.steel, marginBottom: 16 }}>{error}</div>
      <button onClick={load}
        style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '8px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        Retry
      </button>
    </div>
  ) : null;

  return (
    <Layout profile={profile} currentPage="discover">
      <SEO title="Discover" description="Find players, teams, leagues, and stories across the Rinkd community." />
      <div style={{ background: C.dark, minHeight: '100vh', color: C.ice, fontFamily: 'Barlow, sans-serif' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '20px 16px 80px' }}>

          {/* Hero */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 30, lineHeight: 1.1, textTransform: 'uppercase' }}><TapeText height={28}>Discover</TapeText></div>
            <div style={{ fontSize: 13, color: C.steel, marginTop: 2 }}>Players, teams, leagues, and stories across the Rinkd community.</div>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${tab}…`}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: C.navy, border: `1px solid ${C.border}`, color: C.ice,
                padding: '12px 14px 12px 38px', borderRadius: 999, fontSize: 14,
                fontFamily: 'Barlow, sans-serif', outline: 'none',
              }}/>
            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.steel, fontSize: 16, pointerEvents: 'none' }}><Icon name="discover" size={16} /></div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 16, overflowX: 'auto' }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent', color: tab === t.id ? C.ice : C.steel,
                  border: 'none', padding: '10px 16px', minHeight: 44, cursor: 'pointer',
                  fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                  borderBottom: tab === t.id ? `3px solid ${C.red}` : '3px solid transparent',
                  fontFamily: 'Barlow, sans-serif', whiteSpace: 'nowrap',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Results */}
          <div style={{ marginBottom: 26 }}>
            {tab === 'players' && (
              loading ? <ListRowSkeleton rows={6} /> :
              error ? errorBlock :
              players.length === 0 ? <EmptyState icon="👥" title={search$ ? `No players match "${search$}"` : 'The roster is filling up'} body={search$ ? 'Try a different name or handle.' : 'New players join every week — check back soon.'} /> :
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {players.map((p, i) => (
                  <div key={p.id} style={{ borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
                    <PlayerRow p={p} currentUser={currentUser} onOpen={() => navigate(`/profile/${p.id}`)} isFollowingProp={followingSet.has(p.id)} />
                  </div>
                ))}
              </div>
            )}

            {tab === 'teams' && (
              loading ? <ListRowSkeleton rows={6} /> :
              error ? errorBlock :
              teams.length === 0 ? <EmptyState icon="🏒" title={search$ ? `No teams match "${search$}"` : 'No teams on the ice yet'} body={search$ ? 'Try a different name or location.' : 'Be the first — spin up your team and it shows up here.'} cta={{ label: 'Create a Team', onClick: () => navigate('/team/create') }} /> :
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {teams.map((t, i) => (
                  <div key={t.id} onClick={() => navigate(`/team/${t.id}`)} className="rinkd-pressable" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', cursor: 'pointer' }}>
                    <TeamLogo team={t} size={42} radius={10} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: C.steel }}>{[t.level, t.division, t.location].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'leagues' && (
              loading ? <ListRowSkeleton rows={6} /> :
              error ? errorBlock :
              leagues.length === 0 ? <EmptyState icon="🏆" title={search$ ? `No leagues match "${search$}"` : 'No leagues running yet'} body={search$ ? 'Try a different name.' : 'Be the first — start your league and it shows up here.'} cta={{ label: 'Create a League', onClick: () => navigate('/league/create') }} /> :
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {leagues.map((l, i) => (
                  <div key={l.id} onClick={() => navigate(`/league/${l.id}`)} className="rinkd-pressable" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none', cursor: 'pointer' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: l.logo_color || colors.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🏆</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.ice }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: C.steel }}>{[l.division, l.season].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'articles' && (
              loading ? <CardGridSkeleton count={6} /> :
              error ? errorBlock :
              articles.length === 0 ? <EmptyState icon="📰" title={search$ ? `No articles match "${search$}"` : 'Fresh off the press soon'} body="Rinkside features are dropping soon." cta={{ label: 'Visit Rinkside', onClick: () => navigate('/rinkside') }} /> :
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {articles.map((a) => (
                  <div key={a.id} onClick={() => navigate(`/rinkside/${a.slug}`)} className="rinkd-pressable" style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                    overflow: 'hidden', cursor: 'pointer',
                  }}>
                    <div style={{ height: 130, background: a.hero_image_url ? `url(${a.hero_image_url}) center/cover` : C.navy }} />
                    <div style={{ padding: 12 }}>
                      {a.category && <div style={{ fontSize: 10, color: C.red, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{a.category}</div>}
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 16, lineHeight: 1.15, color: C.ice, textTransform: 'uppercase', marginBottom: 4 }}>{a.title}</div>
                      {a.subtitle && <div style={{ fontSize: 12, color: C.steel, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{a.subtitle}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* perf(scale) C08 PR-F — "Show more" keyset page, one tab at a
                time. Never shown mid-search (hasMore is forced false then). */}
            {!loading && !error && hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                <button onClick={loadMore} disabled={loadingMore}
                  style={{ background: 'transparent', color: C.ice, border: `1px solid ${C.border}`, borderRadius: 999, padding: '8px 20px', minHeight: 44, fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: loadingMore ? 'default' : 'pointer', opacity: loadingMore ? 0.6 : 1 }}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              </div>
            )}
          </div>

          {/* Trending posts */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.04em' }}>
              🔥 Trending This Week
            </div>
            <TrendingRail navigate={navigate} />
          </div>

          {/* Top scorers */}
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.04em' }}>
              🥅 Top Scorers
            </div>
            <TopScorersRail />
          </div>

        </div>
      </div>
    </Layout>
  );
}
