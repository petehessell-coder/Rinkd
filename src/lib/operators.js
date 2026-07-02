// =============================================================================
// C12 · Operator Front Door — the data layer for the branded /o/:slug page.
//
// One operator card (featured_operators) + its curated pinned events
// (featured_operator_events, one league OR one tournament per row), plus the
// live-status read over those events and a single Realtime channel that
// re-queries on a debounced ping. Every write is an admin DEFINER RPC.
//
// Scale (CLAUDE.md "Saturday Night"): the operator + events read is cached
// (short TTL) so a back-nav / crawler re-hit doesn't refetch; the live query is
// bounded (.limit) over the pinned event ids; NO polling — one channel scoped to
// the pinned events (capped at 20 bindings), mirroring GamedayStrip.
//
// Youth privacy is defense-in-depth: the write RPC already refuses non-public
// leagues + youth tournaments, and we ALSO drop them client-side on read
// (is_public!==true / is_youth!==false) so a data drift can never leak one.
// All embeds are FK-NAME-QUALIFIED (the Jun-2 embed-ambiguity footgun rule).
// =============================================================================
import { supabase } from './supabase';
import { cached, invalidatePrefix } from './cache';

// Reuse the EXACT gameday select + normalizers so the live games render through
// the shared Gameday/LiveGameCard with no shape drift.
const L_LIVE_SELECT =
  'id, status, start_time, period, home_score, away_score, league_id, home_team_id, away_team_id, ' +
  'home_lt:league_teams!home_team_id(id,team_name,logo_color,logo_initials,logo_url,team_id,team:teams(id,name,logo_url)), ' +
  'away_lt:league_teams!away_team_id(id,team_name,logo_color,logo_initials,logo_url,team_id,team:teams(id,name,logo_url)), ' +
  'league:leagues!league_games_league_id_fkey(name)';
const T_LIVE_SELECT =
  'id, status, start_time, period, home_score, away_score, tournament_id, home_team_id, away_team_id, ' +
  'home_team:tournament_teams!home_team_id(id,team_name,logo_url), ' +
  'away_team:tournament_teams!away_team_id(id,team_name,logo_url), ' +
  'tournament:tournaments!games_tournament_id_fkey(name)';

function normLeagueLiveGame(g) {
  return {
    id: g.id, source: 'league', status: g.status, startTime: g.start_time,
    period: g.period ?? null,
    homeScore: g.home_score, awayScore: g.away_score,
    home: { id: g.home_team_id, name: g.home_lt?.team?.name || g.home_lt?.team_name || 'Home', logoUrl: g.home_lt?.team?.logo_url || g.home_lt?.logo_url || null },
    away: { id: g.away_team_id, name: g.away_lt?.team?.name || g.away_lt?.team_name || 'Away', logoUrl: g.away_lt?.team?.logo_url || g.away_lt?.logo_url || null },
    eventId: g.league_id, eventName: g.league?.name || 'League',
    gameUrl: `/lg/${g.id}`,
  };
}
function normTournamentLiveGame(g) {
  return {
    id: g.id, source: 'tournament', status: g.status, startTime: g.start_time,
    period: g.period ?? null,
    homeScore: g.home_score, awayScore: g.away_score,
    home: { id: g.home_team_id, name: g.home_team?.team_name || 'Home', logoUrl: g.home_team?.logo_url || null },
    away: { id: g.away_team_id, name: g.away_team?.team_name || 'Away', logoUrl: g.away_team?.logo_url || null },
    eventId: g.tournament_id, eventName: g.tournament?.name || 'Tournament',
    gameUrl: `/g/${g.id}`,
  };
}

// ── Operator card + pinned events ────────────────────────────────────────────
// Returns { operator, events } or { operator: null } for an unknown/inactive
// slug (RLS hides drafts from anon; admins see them for preview). `events` is
// normalized to a flat, youth-safe list ordered by sort_order.
export function getOperatorBySlug(slug) {
  const normSlug = (slug || '').toLowerCase();
  const key = `operator:${normSlug}`;
  return cached(key, 60_000, async () => {
    const { data: operator, error } = await supabase
      .from('featured_operators')
      .select('id, slug, name, tagline, logo_url, logo_initials, brand_color, accent_color, cover_image_url, website_url, platform_label, is_active')
      .eq('slug', normSlug)
      .maybeSingle();
    if (error) throw error;
    if (!operator) return { operator: null, events: [] };

    const { data: rows, error: evErr } = await supabase
      .from('featured_operator_events')
      .select(
        'id, sort_order, league_id, tournament_id, ' +
        'league:leagues!featured_operator_events_league_id_fkey(id,name,season,location,venue_name,logo_url,logo_color,logo_initials,accent_color,cover_image_url,is_public,settings), ' +
        'tournament:tournaments!featured_operator_events_tournament_id_fkey(id,name,start_date,end_date,status,logo_url,accent_color,cover_image_url,is_youth,settings)'
      )
      .eq('operator_id', operator.id)
      .order('sort_order', { ascending: true });
    if (evErr) throw evErr;

    const events = normalizeEvents(rows || []);
    return { operator, events };
  });
}

// Drop youth/non-public defensively, then flatten to one shape the page renders.
function normalizeEvents(rows) {
  const out = [];
  for (const r of rows) {
    if (r.league_id && r.league) {
      // Defense in depth: only public leagues survive to the page.
      if (r.league.is_public !== true) continue;
      const lg = r.league;
      out.push({
        kind: 'league', id: lg.id, name: lg.name,
        season: lg.season || null, location: lg.location || null, venueName: lg.venue_name || null,
        logo_url: lg.logo_url || null, logo_color: lg.logo_color || null, logo_initials: lg.logo_initials || null,
        accent_color: lg.accent_color || null, cover_image_url: lg.cover_image_url || null,
        startDate: null, endDate: null,
        href: `/league/${lg.id}`, sort_order: r.sort_order ?? 0,
      });
    } else if (r.tournament_id && r.tournament) {
      // Defense in depth: youth (true OR null) tournaments never render.
      if (r.tournament.is_youth !== false) continue;
      const tn = r.tournament;
      out.push({
        kind: 'tournament', id: tn.id, name: tn.name,
        season: null, location: null, venueName: null,
        logo_url: tn.logo_url || null, logo_color: null, logo_initials: null,
        accent_color: tn.accent_color || null, cover_image_url: tn.cover_image_url || null,
        startDate: tn.start_date || null, endDate: tn.end_date || null,
        href: `/tournament/${tn.id}`, sort_order: r.sort_order ?? 0,
      });
    }
  }
  return out.sort((a, b) => (a.sort_order - b.sort_order));
}

// ── Live games across the pinned events (bounded) ────────────────────────────
// Two bounded queries (league ids → league_games, tournament ids → games), each
// .eq('status','live') and capped. Returns a flat list of gameday-shaped rows
// the shared LiveGameCard renders directly.
export async function getOperatorLiveGames(events) {
  const leagueIds = events.filter((e) => e.kind === 'league').map((e) => e.id);
  const tournamentIds = events.filter((e) => e.kind === 'tournament').map((e) => e.id);
  if (!leagueIds.length && !tournamentIds.length) return [];

  const q = [];
  if (leagueIds.length) {
    q.push(
      supabase.from('league_games').select(L_LIVE_SELECT).eq('status', 'live').in('league_id', leagueIds).limit(12)
        .then((r) => (r.data || []).map(normLeagueLiveGame)).catch(() => [])
    );
  }
  if (tournamentIds.length) {
    q.push(
      supabase.from('games').select(T_LIVE_SELECT).eq('status', 'live').in('tournament_id', tournamentIds).limit(12)
        .then((r) => (r.data || []).map(normTournamentLiveGame)).catch(() => [])
    );
  }
  const parts = await Promise.all(q);
  return parts.flat();
}

// ── Realtime (no polling) ────────────────────────────────────────────────────
// ONE channel bound per pinned event id (capped at 20, mirroring GamedayStrip),
// debounced 600ms so a flurry of goals collapses into a single re-query. Returns
// an unsubscribe fn; call it on unmount.
export function subscribeOperatorLive(slug, events, onChange) {
  const leagueIds = events.filter((e) => e.kind === 'league').map((e) => e.id);
  const tournamentIds = events.filter((e) => e.kind === 'tournament').map((e) => e.id);
  if (!leagueIds.length && !tournamentIds.length) return () => {};

  let debounce = null;
  const ping = () => { clearTimeout(debounce); debounce = setTimeout(onChange, 600); };

  const channel = supabase.channel(`operator-${slug}`);
  leagueIds.slice(0, 20).forEach((lid) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'league_games', filter: `league_id=eq.${lid}` }, ping);
  });
  tournamentIds.slice(0, 20).forEach((tid) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${tid}` }, ping);
  });
  channel.subscribe();

  return () => {
    clearTimeout(debounce);
    try { supabase.removeChannel(channel); } catch { /* swallow */ }
  };
}

// ── Admin write wrappers (DEFINER RPCs; admin-gated server-side) ──────────────
export async function adminUpsertFeaturedOperator(payload) {
  const { data, error } = await supabase.rpc('admin_upsert_featured_operator', {
    p_slug:            payload.slug,
    p_name:            payload.name,
    p_id:              payload.id ?? null,
    p_tagline:         payload.tagline ?? null,
    p_logo_url:        payload.logo_url ?? null,
    p_logo_initials:   payload.logo_initials ?? null,
    p_brand_color:     payload.brand_color ?? null,
    p_accent_color:    payload.accent_color ?? null,
    p_cover_image_url: payload.cover_image_url ?? null,
    p_website_url:     payload.website_url ?? null,
    p_platform_label:  payload.platform_label ?? null,
    p_is_active:       payload.is_active ?? false,
  });
  if (error) throw error;
  // perf(scale) — the /o/:slug page cache (getOperatorBySlug, 60s TTL) must
  // not serve a stale card after an admin edit. No slug-scoped key is cheaply
  // derivable here for an existing operator being renamed, so sweep the whole
  // `operator:` namespace — coarse but correct, and cheap (admin writes are rare).
  invalidatePrefix('operator:');
  return data; // operator uuid
}

export async function adminSetFeaturedOperatorEvents(operatorId, events) {
  const { error } = await supabase.rpc('admin_set_featured_operator_events', {
    p_operator_id: operatorId,
    p_events: events, // [{ league_id|tournament_id, sort_order }]
  });
  if (error) throw error;
  // Same coarse sweep — this call only has the operator id, not its slug.
  invalidatePrefix('operator:');
}

export async function adminDeleteFeaturedOperator(id) {
  const { error } = await supabase.rpc('admin_delete_featured_operator', { p_id: id });
  if (error) throw error;
}

export async function adminSetFeatured(kind, id, value) {
  const { error } = await supabase.rpc('admin_set_featured', { p_kind: kind, p_id: id, p_value: value });
  if (error) throw error;
}

// Admin list — RLS lets drafts through for admins. Also hydrates a pinned-event
// COUNT per operator (cheap head query) so the panel can warn on empties.
export async function adminListFeaturedOperators() {
  const { data: operators, error } = await supabase
    .from('featured_operators')
    .select('id, slug, name, tagline, logo_url, logo_initials, brand_color, accent_color, cover_image_url, website_url, platform_label, is_active, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const list = operators || [];
  if (!list.length) return [];

  const counts = await Promise.all(
    list.map((op) =>
      supabase.from('featured_operator_events').select('id', { count: 'exact', head: true }).eq('operator_id', op.id)
        .then((r) => r.count || 0).catch(() => 0)
    )
  );
  return list.map((op, i) => ({ ...op, eventCount: counts[i] }));
}

// Full pinned-event rows for one operator (admin editor prefill).
export async function adminGetOperatorEvents(operatorId) {
  const { data, error } = await supabase
    .from('featured_operator_events')
    .select('id, sort_order, league_id, tournament_id')
    .eq('operator_id', operatorId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}
