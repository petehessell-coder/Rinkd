import { supabase } from './supabase';

export async function getTeam(id) {
  // Explicit FK hint required: teams now has TWO FKs pointing at profiles
  // (manager_id from day one, plus claimed_by added with the ghost-team
  // schema). PostgREST's shorthand embed gets ambiguous and the whole query
  // throws, which Team.js mistakes for "not found." Naming the constraint
  // (`teams_manager_id_fkey`) tells PostgREST which join to use.
  const { data, error } = await supabase
    .from('teams')
    .select('*, manager:profiles!teams_manager_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listTeams({ search = '' } = {}) {
  // TODO: paginate — cap to avoid pulling the entire teams table once the
  // directory grows. The search box lets users find anything beyond the cap.
  // YOUTH-PRIVACY: discovery shows PUBLIC (adult) teams only. visibility is the
  // source of truth (youth teams are always 'private'); is_public stays mirrored.
  let query = supabase.from('teams').select('*').eq('visibility', 'public').order('name').limit(50);
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTeam({ name, division, level, location, home_rink, logo_color, logo_initials, logo_url, is_youth }) {
  const { data: { user } } = await supabase.auth.getUser();
  // YOUTH-PRIVACY: every team is born with a youth/adult classification. Youth
  // => private/invite-only (enforced by the DB trigger, which also rejects any
  // attempt to make a youth team public). Conservative default: youth when the
  // caller doesn't specify. visibility is derived; the trigger has final say.
  const youth = is_youth !== false; // default true (private) when unset
  const { data, error } = await supabase.from('teams')
    .insert({
      name, division, level, location, home_rink, logo_color, logo_initials,
      logo_url: logo_url || null, manager_id: user.id,
      is_youth: youth, visibility: youth ? 'private' : 'public',
    })
    .select().single();
  if (error) throw error;
  // Auto-add manager as member
  await supabase.from('team_members').insert({ team_id: data.id, user_id: user.id, role: 'manager', status: 'active' });
  return data;
}

export async function updateTeam(id, updates) {
  const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getTeamMembers(teamId) {
  // YOUTH-PRIVACY: invite_email is column-revoked — select explicit columns
  // (no contact). Managers fetch roster contacts via the get_team_contacts RPC.
  const { data, error } = await supabase
    .from('team_members')
    .select('id, team_id, user_id, role, jersey_number, position, shot_hand, is_captain, is_alternate, status, invite_name, profile:profiles!team_members_user_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq('team_id', teamId)
    .in('status', ['active', 'pending'])
    .order('role')
    .order('jersey_number')
    .limit(200); // perf(scale): roster ceiling — a corrupted/import-ballooned roster can't pull thousands
  if (error) throw error;
  return data || [];
}

export async function getTeamGames(teamId) {
  // TODO: paginate — cap each sub-query and the merged result. Once a team
  // accumulates years of games this view needs a real "season" filter UI.
  // Bumped 50→200 with the unified schedule: a season of weekly practices sorts
  // (far-future first) ahead of recent game results, so a 50-row merge cap could
  // silently drop recent finals. 200 matches the display + series-generation cap.
  const PAGE_CAP = 200;

  // Get regular team games
  const { data: teamGames, error } = await supabase
    .from('team_games')
    .select('*')
    .eq('team_id', teamId)
    .order('start_time', { ascending: false })
    .limit(PAGE_CAP);
  if (error) throw error;

  // Get league_teams rows for this team
  const { data: leagueTeamRows } = await supabase
    .from('league_teams')
    .select('id, league_id, league:leagues(id, name)')
    .eq('team_id', teamId);

  if (!leagueTeamRows || leagueTeamRows.length === 0) {
    return (teamGames || []).map(g => ({ ...g, _source: 'team' }));
  }

  const ltIds = leagueTeamRows.map(lt => lt.id);

  // Get league games where this team is home or away
  const { data: homeGames } = await supabase
    .from('league_games')
    .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), rink:rinks(name,sub_rink,live_barn_venue_id)')
    .in('home_team_id', ltIds)
    .order('start_time', { ascending: false })
    .limit(PAGE_CAP);

  const { data: awayGames } = await supabase
    .from('league_games')
    .select('*, home_lt:league_teams!home_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), away_lt:league_teams!away_team_id(id, team_name, logo_color, logo_initials, team:teams(id,name)), rink:rinks(name,sub_rink,live_barn_venue_id)')
    .in('away_team_id', ltIds)
    .order('start_time', { ascending: false })
    .limit(PAGE_CAP);

  // Normalize league games to match team_games shape
  const normalizeLeagueGame = (g) => {
    const lt = leagueTeamRows.find(lt => lt.id === g.home_team_id || lt.id === g.away_team_id);
    const isHome = ltIds.includes(g.home_team_id);
    const oppLt = isHome ? g.away_lt : g.home_lt;
    const opponent = oppLt?.team?.name || oppLt?.team_name || 'Unknown';
    return {
      ...g,
      _source: 'league',
      _league_name: lt?.league?.name,
      _league_id: lt?.league?.id,
      is_home: isHome,
      opponent,
      location: g.rink ? `${g.rink.sub_rink || ''} · ${g.rink.name}` : g.location,
      home_score: g.home_score,
      away_score: g.away_score,
    };
  };

  const allLeagueGames = [
    ...(homeGames || []).map(normalizeLeagueGame),
    ...(awayGames || []).map(normalizeLeagueGame),
  ];

  // Deduplicate (a game could appear in both home and away if same team plays itself)
  const seen = new Set();
  const deduped = allLeagueGames.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });

  // Merge and sort by start_time descending, then cap. Each sub-query is
  // capped at PAGE_CAP so the merged result is bounded but we still want
  // the page to feel snappy at scale.
  const all = [
    ...(teamGames || []).map(g => ({ ...g, _source: 'team' })),
    ...deduped,
  ].sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, PAGE_CAP);

  return all;
}

export async function addTeamMember({ team_id, user_id, role, jersey_number, position, shot_hand, invite_email, invite_name }) {
  const status = user_id ? 'active' : 'pending';
  const { data, error } = await supabase.from('team_members')
    .insert({ team_id, user_id: user_id || null, role, jersey_number, position, shot_hand, invite_email, invite_name, status })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateTeamMember(id, updates) {
  const { data, error } = await supabase.from('team_members').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function removeTeamMember(id) {
  const { error } = await supabase.from('team_members').delete().eq('id', id);
  if (error) throw error;
}

export async function addTeamGame({ team_id, opponent, is_home, location, start_time, notes }) {
  const { data, error } = await supabase.from('team_games')
    .insert({ team_id, opponent, is_home, location, start_time, notes, status: 'scheduled' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateTeamGame(id, updates) {
  const { data, error } = await supabase.from('team_games').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ── UNIFIED SCHEDULE (games + practices + events) ──────────────────────────
// A practice/event is just a team_games row with event_type != 'game'. RSVP,
// .ics export, and reminders all hang off the row, so they come along for free.

/**
 * Add a single schedule item of any type. Games keep the opponent/home-away
 * shape; practices/events use `title` + `end_time` and leave opponent/is_home
 * null (the DB CHECK only requires an opponent for event_type='game').
 */
export async function addScheduleItem({
  team_id, event_type = 'game', opponent = null, is_home = null,
  title = null, location = null, start_time, end_time = null, notes = null,
}) {
  const row = {
    team_id,
    event_type,
    location: location || null,
    start_time,
    end_time: end_time || null,
    notes: notes || null,
    status: 'scheduled',
  };
  if (event_type === 'game') {
    row.opponent = opponent;
    row.is_home = is_home == null ? true : is_home;
  } else {
    row.title = title || (event_type === 'practice' ? 'Practice' : 'Event');
    row.is_home = null;
  }
  const { data, error } = await supabase.from('team_games').insert(row).select().single();
  if (error) throw error;
  return data;
}

/**
 * Generate a recurring practice/event SERIES as concrete rows (one team_games
 * row per occurrence) sharing a client-minted series_id. Concrete rows (not an
 * RRULE) so RSVP / reminders / per-occurrence .ics all work unchanged.
 *
 *   daysOfWeek:  array of 0..6 (0=Sun) — which weekdays each week
 *   startTime / endTime: 'HH:MM' 24h, applied in the viewer's local timezone
 *   startDate / endDate: 'YYYY-MM-DD' inclusive range
 *
 * Returns the inserted rows. Caps at 200 occurrences as a sanity rail so a
 * fat-fingered multi-year range can't balloon a team's schedule.
 */
export async function generatePracticeSeries({
  team_id, event_type = 'practice', daysOfWeek = [], startTime, endTime = null,
  startDate, endDate, location = null, title = null,
}) {
  if (!team_id || !startDate || !endDate || !startTime || !daysOfWeek.length) {
    throw new Error('Pick at least one weekday, a start time, and a date range.');
  }
  const series_id =
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${team_id}-${startDate}-${startTime}-${Math.round(Math.random() * 1e9)}`;
  const days = new Set(daysOfWeek.map(Number));
  const [sh, sm] = startTime.split(':').map(n => parseInt(n, 10));
  const [eh, em] = (endTime || '').split(':').map(n => parseInt(n, 10));

  const rows = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T23:59:59`);
  const CAP = 200;
  while (cursor <= last && rows.length < CAP) {
    if (days.has(cursor.getDay())) {
      const start = new Date(cursor);
      start.setHours(sh || 0, sm || 0, 0, 0);
      let end = null;
      if (endTime && !Number.isNaN(eh)) {
        end = new Date(cursor);
        end.setHours(eh, Number.isNaN(em) ? 0 : em, 0, 0);
        // Spanning midnight (end <= start) → roll end to the next day.
        if (end <= start) end.setDate(end.getDate() + 1);
      }
      rows.push({
        team_id,
        event_type,
        series_id,
        title: title || (event_type === 'practice' ? 'Practice' : 'Event'),
        location: location || null,
        is_home: null,
        opponent: null,
        start_time: start.toISOString(),
        end_time: end ? end.toISOString() : null,
        status: 'scheduled',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (!rows.length) throw new Error('No dates matched — check the weekdays and date range.');
  const { data, error } = await supabase.from('team_games').insert(rows).select();
  if (error) throw error;
  return { rows: data || [], series_id, count: (data || []).length };
}

/** Cancel a whole recurring series (e.g. "cancel all Thursday practices"). */
export async function deleteSeries(seriesId) {
  if (!seriesId) throw new Error('Missing series id.');
  const { error } = await supabase.from('team_games').delete().eq('series_id', seriesId);
  if (error) throw error;
}

/** Edit common fields across a whole series (title/location/notes). */
export async function updateSeries(seriesId, fields = {}) {
  if (!seriesId) throw new Error('Missing series id.');
  const allowed = {};
  for (const k of ['title', 'location', 'notes']) {
    if (k in fields) allowed[k] = fields[k];
  }
  if (!Object.keys(allowed).length) return;
  const { error } = await supabase.from('team_games').update(allowed).eq('series_id', seriesId);
  if (error) throw error;
}

/** Delete a single schedule item (one game/practice/event occurrence). */
export async function deleteScheduleItem(id) {
  if (!id) throw new Error('Missing schedule item id.');
  const { error } = await supabase.from('team_games').delete().eq('id', id);
  if (error) throw error;
}

export async function requestToJoin(teamId, message = '') {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('team_join_requests')
    .insert({ team_id: teamId, user_id: user.id, message })
    .select().single();
  if (error) throw error;
  return data;
}

export async function getJoinRequests(teamId) {
  const { data, error } = await supabase
    .from('team_join_requests')
    .select('*, profile:profiles!team_join_requests_user_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

/**
 * Approve a join request. If `member_id` is given, the requester is BOUND onto
 * that existing unclaimed (ghost/imported) roster slot instead of creating a
 * duplicate row. Otherwise a fresh membership is created. The RPC enforces the
 * manager/commissioner guard and de-dupes server-side.
 */
export async function approveJoinRequest(requestId, { member_id = null } = {}) {
  const { error } = await supabase.rpc('approve_join_request', {
    p_request_id: requestId,
    p_member_id: member_id || null,
  });
  if (error) throw error;
}

/** Unclaimed (no user_id) roster slots on a team — e.g. imported ghost rosters. */
export async function getUnclaimedSlots(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, invite_name, jersey_number, position, role')
    .eq('team_id', teamId)
    .is('user_id', null)
    .order('invite_name');
  if (error) throw error;
  return data || [];
}

export async function denyJoinRequest(requestId) {
  const { error } = await supabase.from('team_join_requests').update({ status: 'denied' }).eq('id', requestId);
  if (error) throw error;
}

export async function getUserTeams(userId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, team_id, user_id, role, jersey_number, status, team:teams(*)')
    .eq('user_id', userId)
    .in('status', ['active', 'pending']);
  if (error) throw error;
  return data || [];
}

// YOUTH-PRIVACY: results-only public read path. Safe to render for a youth team
// to a non-insider — team name, logo, record, recent FINAL scores (date +
// opponent only). NO roster, NO contacts, NO schedule times, NO locations.
export async function getPublicTeamSummary(teamId) {
  const { data, error } = await supabase.rpc('public_team_summary', { p_team_id: teamId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

// YOUTH-PRIVACY: roster contact emails for team insiders (managers/coaches).
// invite_email is column-revoked, so the manage view fetches contacts here.
export async function getTeamContacts(teamId) {
  const { data, error } = await supabase.rpc('get_team_contacts', { p_team_id: teamId });
  if (error) throw error;
  return data || [];
}

export async function getUserRoleOnTeam(teamId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('team_members')
    .select('role, is_captain, is_alternate')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();
  return data ?? null;
}

// True if the current user is a league commissioner OR manager of the league this
// team plays in (server-side check via the SECURITY DEFINER RPC; league_roles isn't
// directly client-readable). Powers the team-page Manage button for league staff who
// don't directly manage the team — e.g. so a commissioner can reach the Requests tab
// to approve a roster join-request when the team has no (other) manager.
export async function isLeagueStaffOfTeam(teamId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc('is_league_commissioner_of_team', { p_team_id: teamId, p_user_id: user.id });
  if (error) return false;
  return !!data;
}
