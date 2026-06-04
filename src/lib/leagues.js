import { supabase } from './supabase';

// LEAGUE-DIV-1 (M1): all league-standings reads go through this constant so the
// M4 cutover is a one-line flip. On `feature/league-divisions` this points at
// the staged division-scoped + OTL view (`league_standings_md`); `main` stays
// on the live `league_standings` until the M4 rename. The staged view is proven
// byte-identical to live for single-division leagues (KOHA/ESHL/CSHL).
export const STANDINGS_VIEW = 'league_standings_md';

export async function listLeagues({ search = '' } = {}) {
  // TODO: paginate — cap to avoid pulling the entire leagues table once the
  // directory grows. The search box lets users find anything beyond the cap.
  let q = supabase.from('leagues').select('*').eq('is_public', true).order('name').limit(50);
  if (search) q = q.ilike('name', `%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getLeague(id) {
  const { data, error } = await supabase
    .from('leagues')
    .select('*, commissioner:profiles(id, name, handle, avatar_color, avatar_initials)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createLeague({
  name, division, level, location, season,
  logo_color, logo_initials, logo_url, accent_color,
  start_date, end_date, venue_name, venue_address,
  settings,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Your session expired — please sign in again.');
  // Null out empty-string date fields so Postgres doesn't reject them.
  const nz = v => (typeof v === 'string' && v.trim() === '' ? null : v);
  const { data, error } = await supabase.from('leagues')
    .insert({
      name,
      division: nz(division),
      level: nz(level),
      location: nz(location),
      season: nz(season),
      logo_color,
      logo_initials: nz(logo_initials),
      logo_url: nz(logo_url),
      accent_color: nz(accent_color),
      start_date: nz(start_date),
      end_date: nz(end_date),
      venue_name: nz(venue_name),
      venue_address: nz(venue_address),
      settings,
      commissioner_id: user.id,
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateLeague(id, updates) {
  const { data, error } = await supabase.from('leagues').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getLeagueTeams(leagueId) {
  // `manager:profiles` lets the LeagueManage Teams tab show "Manager:
  // @handle" or "Unclaimed" per team without a second query. The FK hint
  // disambiguates from any other profile relationship.
  const { data, error } = await supabase
    .from('league_teams')
    .select(`*, team_name, logo_color, logo_initials,
      team:teams(id, name, logo_color, logo_initials, logo_url, home_rink, location, manager_id,
        manager:profiles!teams_manager_id_fkey(id, name, handle, avatar_color, avatar_initials))`)
    .eq('league_id', leagueId)
    .order('joined_at');
  if (error) throw error;
  return data || [];
}

export async function addLeagueTeam(leagueId, { teamId = null, teamName, logoColor, logoInitials, division = '', divisionId = null }) {
  const { data, error } = await supabase.from('league_teams')
    .insert({ league_id: leagueId, team_id: teamId || null, team_name: teamName, logo_color: logoColor, logo_initials: logoInitials, division, division_id: divisionId || null })
    .select().single();
  if (error) throw error;
  return data;
}

export async function linkLeagueTeam(leagueTeamId, teamId) {
  const { data, error } = await supabase.from('league_teams')
    .update({ team_id: teamId })
    .eq('id', leagueTeamId)
    .select().single();
  if (error) throw error;
  return data;
}

export async function removeLeagueTeam(id) {
  const { error } = await supabase.from('league_teams').delete().eq('id', id);
  if (error) throw error;
}

export async function getLeagueGames(leagueId) {
  const { data, error } = await supabase
    .from('league_games')
    .select(`*,
      home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id, name, logo_color, logo_initials)),
      away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id, name, logo_color, logo_initials)),
      rink:rinks(id, name, sub_rink, live_barn_venue_id, youtube_url)
    `)
    .eq('league_id', leagueId)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addLeagueGame({ league_id, home_team_id, away_team_id, rink_id, location, start_time, live_barn_venue_id, youtube_url }) {
  const { data, error } = await supabase.from('league_games')
    .insert({
      league_id, home_team_id, away_team_id, rink_id, location, start_time,
      live_barn_venue_id: live_barn_venue_id || null,
      youtube_url: (youtube_url || '').trim() || null,
      status: 'scheduled',
    })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateLeagueGame(id, updates) {
  const { data, error } = await supabase.from('league_games').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getLeagueStandings(leagueId, divisionId = null) {
  let q = supabase
    .from(STANDINGS_VIEW)
    .select('*')
    .eq('league_id', leagueId);
  // Optional division scope (M2+ passes the selected division; null = whole
  // league, which for single-division leagues is the one "Main" division).
  if (divisionId) q = q.eq('division_id', divisionId);
  const { data, error } = await q.order('rank', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Returns the highest role the current user has on this league.
 *
 *   'commissioner' — founding commissioner OR has league_roles.role = 'commissioner'
 *   'scorer'       — has league_roles.role = 'scorer'
 *   'viewer'       — signed in but no role on this league
 *   null           — not signed in
 *
 * Multi-commissioner support shipped Phase 1: any caller that previously
 * compared `league.commissioner_id === currentUser.id` synchronously
 * should still work for the founder, but should ALSO honor an async
 * isExtraCommissioner check (or call this function) so additional
 * commissioners get the same access. See src/lib/leagueCommissioners.js.
 */
export async function getUserLeagueRole(leagueId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: lg } = await supabase.from('leagues').select('commissioner_id').eq('id', leagueId).single();
  if (!lg) return null;
  if (lg.commissioner_id === user.id) return 'commissioner';

  const { data: role } = await supabase
    .from('league_roles')
    .select('role')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (role?.role === 'commissioner') return 'commissioner';
  if (role?.role === 'scorer') return 'scorer';
  return 'viewer';
}

// The single league to surface as a user's "quick-nav" pin (LeaguePinIcon).
// "My league" resolves by strength of belonging, first match wins:
//   1. a league I run        — leagues.commissioner_id, then league_roles=commissioner
//   2. a league my team is in — team_members → league_teams
//   3. a league I follow      — league_subscriptions
// Fail-soft: any error / no match returns null (the pin just doesn't render).
// Returns only the fields the avatar + link need. Ordered by name where a tier
// has several so the pick is stable across reloads.
const PIN_COLS = 'id, name, logo_url, accent_color, logo_color, logo_initials';

export async function getMyPrimaryLeague(userId) {
  if (!userId) return null;
  try {
    // 1a — leagues I founded
    const { data: founded } = await supabase
      .from('leagues')
      .select(PIN_COLS)
      .eq('commissioner_id', userId)
      .order('name')
      .limit(1);
    if (founded?.length) return founded[0];

    // 1b — leagues where I'm an added commissioner
    const { data: roleRows } = await supabase
      .from('league_roles')
      .select(`league:leagues(${PIN_COLS})`)
      .eq('user_id', userId)
      .eq('role', 'commissioner')
      .limit(1);
    if (roleRows?.[0]?.league) return roleRows[0].league;

    // 2 — the league my team plays in
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .in('status', ['active', 'pending']);
    const teamIds = (memberships || []).map(m => m.team_id).filter(Boolean);
    if (teamIds.length) {
      const { data: lt } = await supabase
        .from('league_teams')
        .select(`league:leagues(${PIN_COLS})`)
        .in('team_id', teamIds)
        .limit(1);
      if (lt?.[0]?.league) return lt[0].league;
    }

    // 3 — a league I follow
    const { data: subs } = await supabase
      .from('league_subscriptions')
      .select(`league:leagues(${PIN_COLS})`)
      .eq('user_id', userId)
      .limit(1);
    if (subs?.[0]?.league) return subs[0].league;

    return null;
  } catch {
    return null;
  }
}
