// =============================================================================
// Event-Centric Home — the data layer for the signed-in front door.
//
// Strategy (CLAUDE.md "Saturday Night"): every read here is BOUNDED. We never
// "fetch everything" — each home layer is its own small, indexed query keyed
// off the user's context (their teams + the events they follow) with an
// explicit limit. Realtime (not polling) drives the live tiles; these loaders
// just re-run on a ping. The Featured set is cached for the session.
//
// Personalized layers RISE for members and COLLAPSE cleanly for cold users so
// the home is never empty: This week + Featured + Discover + search always
// carry the page.
// =============================================================================
import { supabase } from './supabase';
import { getGamedayContext, getGamedayGames } from './gameday';
import { getUserTeams, getTeamGames } from './teams';
import { getLeagueStandings } from './leagues';

// Launch Featured event = the existing XRHL league (logo + brand color already
// on the record). Pinned via leagues.is_featured = true.
export const FEATURED_LEAGUE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
// Never-empty fallback shown to brand-new users (zero follows).
export const DEMO_LEAGUE_ID = '934dd511-e15e-4a07-94ff-1edd6ff31dfc';

// ── Featured hero ──────────────────────────────────────────────────────────
// Admin-pinnable: leagues/tournaments with is_featured=true win; otherwise we
// fall back to the most recently active public league so the hero is NEVER a
// broken/empty slot to a cold evaluator. The identity (logo/name/href) is
// cached for the session; the LIVE flag is always recomputed fresh so the hero
// can light up the moment the featured event tips off.
let _featuredBase = null;
let _featuredErr = false;

async function loadFeaturedBase() {
  if (_featuredBase || _featuredErr) return _featuredBase;
  try {
    // 1) Pinned league.
    const { data: lg } = await supabase
      .from('leagues')
      .select('id,name,season,location,venue_name,logo_url,logo_color,logo_initials')
      .eq('is_featured', true).eq('is_public', true)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (lg) {
      _featuredBase = leagueToFeatured(lg);
      return _featuredBase;
    }
    // 2) Pinned tournament (non-youth).
    const { data: tn } = await supabase
      .from('tournaments')
      .select('id,name,start_date,end_date,logo_url,status,is_youth')
      .eq('is_featured', true).neq('is_youth', true)
      .order('start_date', { ascending: false }).limit(1).maybeSingle();
    if (tn) {
      _featuredBase = tournamentToFeatured(tn);
      return _featuredBase;
    }
    // 3) Fallback: most-recently-active public, activated league.
    const { data: any } = await supabase
      .from('leagues')
      .select('id,name,season,location,venue_name,logo_url,logo_color,logo_initials')
      .eq('is_public', true).eq('is_activated', true)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (any) { _featuredBase = leagueToFeatured(any); return _featuredBase; }
    return null;
  } catch (e) {
    // Never let a featured-hero failure break the whole home.
    _featuredErr = true;
    console.warn('[home] featured load failed:', e?.message || e);
    return null;
  }
}

function leagueToFeatured(lg) {
  return {
    type: 'league', id: lg.id, name: lg.name,
    subtitle: lg.season || lg.location || lg.venue_name || 'League',
    logo_url: lg.logo_url, logo_color: lg.logo_color, logo_initials: lg.logo_initials,
    href: `/league/${lg.id}`,
  };
}
function tournamentToFeatured(tn) {
  return {
    type: 'tournament', id: tn.id, name: tn.name,
    subtitle: tn.start_date ? fmtEventDate(tn.start_date) : 'Tournament',
    logo_url: tn.logo_url, logo_color: null, logo_initials: null,
    href: `/tournament/${tn.id}`,
  };
}

async function eventHasLiveGame(ev) {
  try {
    const table = ev.type === 'league' ? 'league_games' : 'games';
    const col = ev.type === 'league' ? 'league_id' : 'tournament_id';
    const { data } = await supabase.from(table).select('id').eq(col, ev.id).eq('status', 'live').limit(1);
    return !!(data && data.length);
  } catch { return false; }
}

export async function getFeaturedEvent() {
  const base = await loadFeaturedBase();
  if (!base) return null;
  const isLive = await eventHasLiveGame(base);
  return { ...base, isLive };
}

// ── This week (public, never-empty) ─────────────────────────────────────────
// Upcoming non-youth tournaments still running or starting soon. Bounded by
// limit + an end_date floor; ordered soonest-first. Carries "This week" for a
// brand-new user and supplements a member's own upcoming games.
export async function getUpcomingPublicEvents(limit = 8) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('tournaments')
      .select('id,name,start_date,end_date,logo_url,is_youth,status')
      .neq('is_youth', true)
      .gte('end_date', today)
      .order('start_date', { ascending: true })
      .limit(limit);
    return (data || [])
      .filter((t) => (t.status || 'active') !== 'cancelled')
      .map((t) => ({
        kind: 'event', id: t.id, name: t.name, startDate: t.start_date,
        logo_url: t.logo_url, href: `/tournament/${t.id}`,
      }));
  } catch (e) {
    console.warn('[home] upcoming public events failed:', e?.message || e);
    return [];
  }
}

// ── Your hockey (members) ────────────────────────────────────────────────────
// Aggregates across the user's team memberships: their live + next games and
// recent finals (recap-ready for league games). Bounded: we cap the number of
// teams we hydrate so a user on many teams still gets a fast, fixed-cost read.
const TEAM_HYDRATE_CAP = 5;

export async function getYourHockey(userId) {
  if (!userId) return { teamCount: 0, teams: [], live: [], next: [], recentFinals: [] };
  let teams = [];
  try { teams = await getUserTeams(userId); } catch (_) { teams = []; }
  if (!teams.length) return { teamCount: 0, teams: [], live: [], next: [], recentFinals: [] };

  const slice = teams.slice(0, TEAM_HYDRATE_CAP);
  const perTeam = await Promise.all(slice.map(async (m) => {
    const team = m.team || {};
    let games = [];
    try { games = await getTeamGames(m.team_id); } catch (_) { games = []; }
    return games.map((g) => ({ ...g, _teamId: m.team_id, _team: team }));
  }));
  const all = perTeam.flat();
  const now = Date.now();

  const live = all.filter((g) => g.status === 'live')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const next = all
    .filter((g) => g.status === 'scheduled' && new Date(g.start_time).getTime() >= now - 3 * 3600 * 1000)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 3);

  const recentFinals = all
    .filter((g) => g.status === 'final')
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
    .slice(0, 3)
    .map((g) => ({
      id: g.id,
      source: g._source === 'league' ? 'league' : 'team',
      teamName: g._team?.name || 'My team',
      teamLogo: g._team || null,
      opponent: g.opponent || 'Opponent',
      isHome: g.is_home,
      homeScore: g.home_score, awayScore: g.away_score,
      startTime: g.start_time,
      leagueName: g._league_name || null,
      // Recap cards only exist for league games today.
      hasRecap: g._source === 'league',
    }));

  return {
    teamCount: teams.length,
    teams: teams.map((m) => m.team).filter(Boolean),
    live, next, recentFinals,
  };
}

// ── Standings leader highlight (scarce gold = the league leader) ─────────────
// One bounded read of the standings view for a league the user follows; returns
// the rank-1 team only. Gold is reserved for this single competitive highlight.
export async function getStandingsLeader(leagueId) {
  if (!leagueId) return null;
  try {
    const rows = await getLeagueStandings(leagueId);
    const leader = (rows || []).find((r) => r.rank === 1) || (rows || [])[0];
    if (!leader) return null;
    return {
      leagueId,
      teamName: leader.team_name,
      logo: { logo_color: leader.logo_color, logo_initials: leader.logo_initials, logo_url: leader.logo_url, name: leader.team_name },
      wins: leader.wins ?? 0, losses: leader.losses ?? 0, ties: leader.ties ?? 0, otl: leader.otl ?? 0,
      pts: leader.pts ?? 0,
    };
  } catch (e) {
    console.warn('[home] standings leader failed:', e?.message || e);
    return null;
  }
}

// ── One-shot aggregate for the page ──────────────────────────────────────────
// Fires every layer concurrently so the home first-paints fast (skeleton →
// hydrate). Each piece self-guards: one failing layer never blanks the page.
export async function loadHome(userId) {
  const ctx = await getGamedayContext(userId).catch(() => ({ tournamentIds: [], leagueIds: [], teamIds: [] }));
  const hasFollows = !!(ctx.tournamentIds.length || ctx.leagueIds.length || ctx.teamIds.length);

  const [featured, gameday, your, publicEvents, leader] = await Promise.all([
    getFeaturedEvent(),
    // Live + this-week (168h) across the user's followed/rostered events.
    getGamedayGames(userId, { windowHours: 168, ctx }).catch(() => ({ live: [], upcoming: [] })),
    getYourHockey(userId),
    getUpcomingPublicEvents(8),
    ctx.leagueIds.length ? getStandingsLeader(ctx.leagueIds[0]) : Promise.resolve(null),
  ]);

  return {
    featured,
    live: gameday.live || [],
    upcoming: gameday.upcoming || [],
    your,
    publicEvents,
    leader,
    hasFollows,
    // Followed event ids — the home subscribes to these for Realtime live
    // updates (no polling). Capped at the source.
    followIds: { tournamentIds: ctx.tournamentIds || [], leagueIds: ctx.leagueIds || [] },
  };
}

// ── Persistent search (the navigation guarantee) ─────────────────────────────
// Multi-entity, each capped tiny. Players, teams, leagues, tournaments — a fan
// reaches anything in one tap. select() lists explicit columns (never '*' on
// profiles — the youth-privacy column gate rejects it).
export async function searchEverything(term) {
  const q = (term || '').trim();
  if (q.length < 2) return { players: [], teams: [], leagues: [], tournaments: [] };
  const like = `%${q}%`;
  const [players, teams, leagues, tournaments] = await Promise.all([
    supabase.from('profiles').select('id,name,handle,avatar_url,avatar_color,avatar_initials,position,tier').ilike('name', like).limit(5).then((r) => r.data || []).catch(() => []),
    supabase.from('teams').select('id,name,logo_color,logo_initials,logo_url,is_youth,is_public').ilike('name', like).limit(5).then((r) => r.data || []).catch(() => []),
    supabase.from('leagues').select('id,name,season,logo_color,logo_initials,logo_url').eq('is_public', true).ilike('name', like).limit(5).then((r) => r.data || []).catch(() => []),
    supabase.from('tournaments').select('id,name,start_date,logo_url,is_youth').neq('is_youth', true).ilike('name', like).limit(5).then((r) => r.data || []).catch(() => []),
  ]);
  return { players, teams, leagues, tournaments };
}

// ── Small shared formatters ──────────────────────────────────────────────────
export function fmtEventDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// "SAT · 7:00P" style pill text for an upcoming game (neutral, not urgent).
export function fmtGameWhen(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    const day = dt.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
    let t = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    t = t.replace(/\s?([AP])M/i, (_, p) => p.toUpperCase()).replace(':00', '');
    return `${day} · ${t}`;
  } catch { return ''; }
}
