import { supabase } from './supabase';

/**
 * Tournament management helpers — used by the Director's manage page.
 * Reads are public; writes are gated by the RLS policies that require
 * tournaments.director_id = auth.uid().
 */

// ------------------------------ Teams ------------------------------

export async function listTeams(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_teams')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('pool', { ascending: true, nullsFirst: false })
    .order('seed', { ascending: true, nullsFirst: false })
    .order('team_name', { ascending: true });
  return { data: data || [], error };
}

export async function createTeam(tournamentId, fields) {
  const { data, error } = await supabase
    .from('tournament_teams')
    .insert({
      tournament_id: tournamentId,
      team_name: (fields.teamName || '').trim(),
      pool: fields.pool?.trim() || null,
      seed: fields.seed ? parseInt(fields.seed, 10) : null,
      contact_email: fields.contactEmail?.trim() || null,
      logo_url: fields.logoUrl?.trim() || null,
    })
    .select()
    .single();
  return { data, error };
}

export async function updateTeam(teamId, fields) {
  const payload = {};
  if (fields.teamName !== undefined) payload.team_name = (fields.teamName || '').trim();
  if (fields.pool !== undefined) payload.pool = fields.pool?.trim() || null;
  if (fields.seed !== undefined) payload.seed = fields.seed ? parseInt(fields.seed, 10) : null;
  if (fields.contactEmail !== undefined) payload.contact_email = fields.contactEmail?.trim() || null;
  if (fields.logoUrl !== undefined) payload.logo_url = fields.logoUrl?.trim() || null;
  const { data, error } = await supabase
    .from('tournament_teams')
    .update(payload)
    .eq('id', teamId)
    .select()
    .single();
  return { data, error };
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('tournament_teams').delete().eq('id', teamId);
  return { error };
}

// ------------------------------ Games ------------------------------

export async function listGames(tournamentId) {
  const { data, error } = await supabase
    .from('games')
    .select(`
      *,
      home_team:tournament_teams!home_team_id(id, team_name, pool, seed),
      away_team:tournament_teams!away_team_id(id, team_name, pool, seed),
      rink:rinks(id, name, sub_rink)
    `)
    .eq('tournament_id', tournamentId)
    .order('start_time', { ascending: true });
  return { data: data || [], error };
}

export async function updateGame(gameId, fields) {
  const payload = {};
  if (fields.startTime !== undefined) payload.start_time = fields.startTime;
  if (fields.rinkId !== undefined) payload.rink_id = fields.rinkId || null;
  if (fields.homeTeamId !== undefined) payload.home_team_id = fields.homeTeamId || null;
  if (fields.awayTeamId !== undefined) payload.away_team_id = fields.awayTeamId || null;
  if (fields.round !== undefined) payload.round = fields.round || 'pool';
  if (fields.status !== undefined) payload.status = fields.status;
  const { data, error } = await supabase
    .from('games')
    .update(payload)
    .eq('id', gameId)
    .select()
    .single();
  return { data, error };
}

export async function deleteGame(gameId) {
  const { error } = await supabase.from('games').delete().eq('id', gameId);
  return { error };
}

// ------------------------------ Round-robin generator ------------------------------

/**
 * Circle-method round-robin. Returns array of pairs [homeId, awayId] with
 * naive home/away balance — first team alternates.
 * Adds a bye-rotation if the team count is odd.
 */
function roundRobinPairs(teamIds) {
  if (teamIds.length < 2) return [];
  const t = [...teamIds];
  if (t.length % 2 === 1) t.push(null); // bye marker
  const n = t.length;
  const rounds = n - 1;
  const half = n / 2;
  const pairs = [];

  let homeCount = Object.fromEntries(teamIds.map((id) => [id, 0]));

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = t[i];
      const b = t[n - 1 - i];
      if (!a || !b) continue;
      // Assign home/away to whoever's hosted fewer so far
      let home, away;
      if ((homeCount[a] || 0) <= (homeCount[b] || 0)) { home = a; away = b; }
      else { home = b; away = a; }
      homeCount[home] = (homeCount[home] || 0) + 1;
      pairs.push({ homeId: home, awayId: away });
    }
    // Rotate (keep first fixed, rotate the rest)
    const fixed = t[0];
    const rest = t.slice(1);
    rest.unshift(rest.pop());
    t.splice(0, t.length, fixed, ...rest);
  }

  return pairs;
}

/**
 * Build a full pool-play schedule. Generates games for every team in the same
 * pool to face every other team in that pool exactly once, slotted at the
 * staggered intervals provided.
 */
export async function generatePoolSchedule(tournamentId, opts) {
  const {
    startDate,        // ISO date string e.g. '2026-06-12T08:00'
    gameMinutes = 60, // game length incl. flood
    rinkId = null,    // optional default rink
    replaceExisting = false,
  } = opts;

  const { data: teams } = await listTeams(tournamentId);
  if (!teams.length) return { error: { message: 'No teams found in tournament' }, inserted: 0 };

  // Group by pool. Teams with no pool go into '_' bucket together.
  const byPool = {};
  for (const t of teams) {
    const key = t.pool || '_';
    if (!byPool[key]) byPool[key] = [];
    byPool[key].push(t.id);
  }

  if (replaceExisting) {
    // Wipe any existing pool games (keep bracket round games)
    await supabase
      .from('games')
      .delete()
      .eq('tournament_id', tournamentId)
      .eq('round', 'pool');
  }

  const rows = [];
  let cursor = new Date(startDate);
  for (const pool of Object.keys(byPool).sort()) {
    const pairs = roundRobinPairs(byPool[pool]);
    for (const p of pairs) {
      rows.push({
        tournament_id: tournamentId,
        home_team_id: p.homeId,
        away_team_id: p.awayId,
        rink_id: rinkId,
        start_time: cursor.toISOString(),
        status: 'scheduled',
        round: 'pool',
      });
      cursor = new Date(cursor.getTime() + gameMinutes * 60 * 1000);
    }
  }

  if (!rows.length) return { inserted: 0, error: { message: 'Pool generation produced 0 games (need ≥ 2 teams per pool).' } };

  const { error } = await supabase.from('games').insert(rows);
  return { inserted: rows.length, error };
}

// ------------------------------ Bracket builder ------------------------------

/**
 * Top-N-per-pool seeding. Returns an ordered list of qualifying teams with
 * their pool + pool rank derived from the standings view.
 */
export async function loadPoolQualifiers(tournamentId, advancePerPool) {
  const { data } = await supabase
    .from('tournament_standings')
    .select('*')
    .eq('tournament_id', tournamentId)
    .lte('pool_rank', advancePerPool)
    .order('pool', { ascending: true })
    .order('pool_rank', { ascending: true });
  return data || [];
}

/**
 * Create a bracket matchup. Two team IDs, a round label ('quarterfinal' |
 * 'semifinal' | 'final' | 'consolation'), and a start time.
 */
export async function createBracketGame(tournamentId, { homeTeamId, awayTeamId, round, startTime, rinkId = null }) {
  const { data, error } = await supabase
    .from('games')
    .insert({
      tournament_id: tournamentId,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      round,
      start_time: startTime,
      rink_id: rinkId,
      status: 'scheduled',
    })
    .select()
    .single();
  return { data, error };
}

// ------------------------------ Misc ------------------------------

export async function updateTournament(tournamentId, fields) {
  const payload = {};
  if (fields.name !== undefined) payload.name = (fields.name || '').trim();
  if (fields.division !== undefined) payload.division = fields.division?.trim() || null;
  if (fields.startDate !== undefined) payload.start_date = fields.startDate || null;
  if (fields.endDate !== undefined) payload.end_date = fields.endDate || null;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.settings !== undefined) payload.settings = fields.settings;
  const { data, error } = await supabase
    .from('tournaments')
    .update(payload)
    .eq('id', tournamentId)
    .select()
    .single();
  return { data, error };
}
