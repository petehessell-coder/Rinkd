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
export function roundRobinPairs(teamIds) {
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

  // Capture old pool-game IDs BEFORE inserting, so we can delete only those
  // specific rows after the new schedule lands. The previous version deleted
  // first and then inserted; if the insert failed (RLS, validation, network),
  // the director's whole schedule was gone with no recovery.
  // TODO: replace this two-step + the delete-after-insert with a single
  // `generate_pool_schedule(tournament_id, rows)` RPC so the swap is atomic.
  let oldIds = [];
  if (replaceExisting) {
    const { data: olds } = await supabase
      .from('games')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', 'pool');
    oldIds = (olds || []).map(o => o.id);
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

  // Insert the new schedule FIRST. If this fails, the existing one is intact.
  const { error: insertErr } = await supabase.from('games').insert(rows);
  if (insertErr) return { inserted: 0, error: insertErr };

  // Now safely delete the old rows. Scope the delete to the captured IDs so
  // we can't accidentally wipe the new ones (which are also round='pool').
  if (oldIds.length > 0) {
    const { error: deleteErr } = await supabase.from('games').delete().in('id', oldIds);
    if (deleteErr) {
      // New schedule landed, but the old one didn't get cleaned up — the
      // director will see duplicates. Surface so they can clean up manually.
      return {
        inserted: rows.length,
        error: deleteErr,
        warning: 'New schedule generated but old games could not be deleted — you may see duplicates. Refresh and remove them by hand.',
      };
    }
  }

  return { inserted: rows.length, error: null };
}

// ------------------------------ Bracket builder ------------------------------

// Manager-side standings lookup — used to render W/L/T per team on the Teams
// tab so the director can see records at a glance during a live event.
// Tiny columns set; full standings view is heavier than we need here.
export async function listStandingsSummary(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_standings')
    .select('team_id, gp, wins, losses, ties, pts')
    .eq('tournament_id', tournamentId);
  return { data: data || [], error };
}

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

// ============================================================================
// Championship bracket — 4-team-per-pool ("all teams advance") pattern.
//
// Per the BLPA Cleveland format: each pool's 4 teams play a 4-game bracket:
//   Semi 1:  Seed 2 vs Seed 3
//   Semi 2:  Seed 1 vs Seed 4
//   Final:   Winner(Semi 1) vs Winner(Semi 2)  → winner=gold, loser=silver
//   Bronze:  Loser(Semi 1)  vs Loser(Semi 2)   → winner=bronze, loser=4th
//
// Two helpers below: one to generate the 4 games on demand (button-triggered
// from TournamentManage), one to fill in gold/bronze slots once each semi
// finalizes (triggered from ScorerView's finalize path).
//
// We tag the bracket position with a `bracket_slot` token written into
// `games.notes`-less... wait, no notes column. Use a marker pattern in the
// game's round + start_time ordering instead? Too fragile.
//
// Simpler approach: store the bracket position in the game row itself using
// home_team_id and away_team_id with NULL placeholders for gold/bronze, plus
// the `round` column ('semifinal' for semis, 'final' for gold, 'consolation'
// for bronze). To map semis → final/bronze, we also need to remember which
// semi feeds which slot. We do that by ordering: semi 1 = 2v3 is the lower
// start_time; semi 2 = 1v4 is the next. When semi 1 finalizes its winner
// becomes the home of the final; semi 2 winner becomes the away. Losers
// follow the same pattern for the bronze.
// ============================================================================

export async function generateChampionshipBracket(tournamentId, opts = {}) {
  const { startTime = null, rinkId = null, gameMinutes = 60 } = opts;
  // 1. Pull standings to determine seeds per pool. Caller is expected to
  //    only run this once all pool games are final.
  const { data: standings, error: stdErr } = await supabase
    .from('tournament_standings')
    .select('team_id, pool, pool_rank')
    .eq('tournament_id', tournamentId)
    .order('pool', { ascending: true })
    .order('pool_rank', { ascending: true });
  if (stdErr) return { inserted: 0, error: stdErr };
  if (!standings || standings.length === 0) return { inserted: 0, error: new Error('No standings available — finish at least one pool game first.') };

  // 2. Group by pool. Each pool needs exactly 4 teams for this pattern.
  const byPool = standings.reduce((acc, row) => {
    if (!acc[row.pool]) acc[row.pool] = [];
    acc[row.pool].push(row);
    return acc;
  }, {});
  const pools = Object.entries(byPool).sort(([a], [b]) => a.localeCompare(b));
  const pool4Teams = pools.filter(([, teams]) => teams.length === 4);
  if (pool4Teams.length === 0) {
    return { inserted: 0, error: new Error('This generator expects 4 teams per pool. None of the pools matched.') };
  }

  // 3. Refuse to re-run when bracket games already exist for this tournament
  //    — avoids double-creation if the button is double-clicked. Director can
  //    delete bracket games manually before re-generating.
  const { data: existing } = await supabase
    .from('games')
    .select('id, round')
    .eq('tournament_id', tournamentId)
    .neq('round', 'pool');
  if (existing && existing.length > 0) {
    return { inserted: 0, error: new Error(`Bracket already has ${existing.length} game${existing.length === 1 ? '' : 's'}. Delete them first if you want to regenerate.`) };
  }

  // 4. Build the 4 games per pool. Semi 1 (seed 2 v 3) sorts before Semi 2
  //    (seed 1 v 4) by start_time so resolveBracketSlotsFromSemis can pair
  //    them by chronological order. Final and bronze games start with NULL
  //    home/away — they fill in once both semis go final.
  const baseStart = startTime ? new Date(startTime) : null;
  const slotMinutes = parseInt(gameMinutes, 10) || 60;
  const rows = [];
  pool4Teams.forEach(([pool, teams], poolIdx) => {
    const seeds = teams; // already sorted by pool_rank ascending
    const seed = (n) => seeds[n - 1]?.team_id;
    // 4 games per pool, spaced `slotMinutes` apart starting at baseStart.
    // Pools start sequentially so two pools don't collide on a single rink
    // unless caller assigns different rinks (which they should).
    const slotFor = (idx) => baseStart ? new Date(baseStart.getTime() + (poolIdx * 4 + idx) * slotMinutes * 60_000).toISOString() : null;
    rows.push(
      { tournament_id: tournamentId, round: 'semifinal',   pool, home_team_id: seed(2), away_team_id: seed(3), status: 'scheduled', start_time: slotFor(0), rink_id: rinkId },
      { tournament_id: tournamentId, round: 'semifinal',   pool, home_team_id: seed(1), away_team_id: seed(4), status: 'scheduled', start_time: slotFor(1), rink_id: rinkId },
      { tournament_id: tournamentId, round: 'consolation', pool, home_team_id: null,    away_team_id: null,    status: 'scheduled', start_time: slotFor(2), rink_id: rinkId },
      { tournament_id: tournamentId, round: 'final',       pool, home_team_id: null,    away_team_id: null,    status: 'scheduled', start_time: slotFor(3), rink_id: rinkId },
    );
  });

  const { data, error } = await supabase.from('games').insert(rows).select('id, round, pool, start_time');
  if (error) return { inserted: 0, error };
  return { inserted: data?.length || 0, error: null, poolsCovered: pool4Teams.map(([p]) => p) };
}

// Resolves the winner of a bracket game, accounting for shootout_winner on
// tied bracket games (championship can't end in a tie when shootouts are on).
// Returns 'home' | 'away' | null.
export function bracketWinnerSide(game) {
  if (!game || game.status !== 'final') return null;
  if ((game.home_score ?? 0) > (game.away_score ?? 0)) return 'home';
  if ((game.away_score ?? 0) > (game.home_score ?? 0)) return 'away';
  if (game.shootout_winner === 'home' || game.shootout_winner === 'away') return game.shootout_winner;
  return null;
}

// Called from ScorerView's finalize path after a semifinal goes final. Looks
// at all semis in this game's pool; if both are final, fills the gold and
// bronze games' empty home/away slots with the winners/losers. Idempotent:
// if the slots are already filled (from a previous run), it skips.
export async function resolveBracketSlotsFromSemis(tournamentId, pool) {
  if (!tournamentId || !pool) return { updated: 0, error: null };
  // Pull all bracket games for the pool ordered by start_time so semi 1 is
  // the earlier (seed 2 v 3) and semi 2 is the later (seed 1 v 4) per the
  // ordering generateChampionshipBracket uses.
  const { data: bracketGames, error: ge } = await supabase
    .from('games')
    .select('id, round, pool, home_team_id, away_team_id, home_score, away_score, status, shootout_winner, start_time')
    .eq('tournament_id', tournamentId)
    .eq('pool', pool)
    .neq('round', 'pool')
    .order('start_time', { ascending: true });
  if (ge) return { updated: 0, error: ge };

  const semis = (bracketGames || []).filter(g => g.round === 'semifinal');
  if (semis.length < 2) return { updated: 0, error: null }; // not enough yet
  const [semi1, semi2] = semis;
  if (semi1.status !== 'final' || semi2.status !== 'final') return { updated: 0, error: null };

  const w1 = bracketWinnerSide(semi1);
  const w2 = bracketWinnerSide(semi2);
  if (!w1 || !w2) return { updated: 0, error: new Error('A semifinal is tied with no shootout winner recorded — resolve it before the bracket can advance.') };

  const winnerTeamId = (g, side) => side === 'home' ? g.home_team_id : g.away_team_id;
  const loserTeamId  = (g, side) => side === 'home' ? g.away_team_id : g.home_team_id;

  const final  = bracketGames.find(g => g.round === 'final');
  const bronze = bracketGames.find(g => g.round === 'consolation');

  const updates = [];
  if (final && (final.home_team_id === null || final.away_team_id === null)) {
    updates.push(
      supabase.from('games').update({
        home_team_id: winnerTeamId(semi1, w1),
        away_team_id: winnerTeamId(semi2, w2),
      }).eq('id', final.id)
    );
  }
  if (bronze && (bronze.home_team_id === null || bronze.away_team_id === null)) {
    updates.push(
      supabase.from('games').update({
        home_team_id: loserTeamId(semi1, w1),
        away_team_id: loserTeamId(semi2, w2),
      }).eq('id', bronze.id)
    );
  }
  if (updates.length === 0) return { updated: 0, error: null };

  const results = await Promise.all(updates);
  const failed = results.find(r => r.error);
  if (failed) return { updated: 0, error: failed.error };
  return { updated: updates.length, error: null };
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
  if (fields.logoUrl !== undefined) payload.logo_url = fields.logoUrl || null;
  if (fields.accentColor !== undefined) payload.accent_color = fields.accentColor || null;
  if (fields.registrationOpen !== undefined) payload.registration_open = !!fields.registrationOpen;
  if (fields.registrationFeeCents !== undefined) payload.registration_fee_cents = fields.registrationFeeCents;
  if (fields.registrationDeadline !== undefined) payload.registration_deadline = fields.registrationDeadline || null;
  if (fields.maxTeams !== undefined) payload.max_teams = fields.maxTeams;
  const { data, error } = await supabase
    .from('tournaments')
    .update(payload)
    .eq('id', tournamentId)
    .select()
    .single();
  return { data, error };
}
