import { supabase } from './supabase';

/**
 * Round-robin fixture generator using the circle method.
 *   teams: array of league_team objects with .id (and optional .name for display)
 *   format: 'single' | 'double'
 *   pairs:  array of [homeIdx, awayIdx] index pairs into `teams`
 *
 * For odd N we pad with a `null` (bye); pairs with null are dropped.
 * Double round-robin = single + reversed home/away.
 */
export function generateRoundRobin(teams, format = 'single') {
  if (!teams || teams.length < 2) return [];

  // For odd N, pad with a bye (null). Pairs against the bye are dropped.
  const padded = teams.length % 2 === 0 ? teams.slice() : teams.concat([null]);
  const n = padded.length;
  const rounds = n - 1;
  const half = n / 2;

  // First pass: build pairings round by round using the circle method —
  // no home/away yet, just who plays who.
  const all = padded.slice();
  const pairsByRound = [];
  for (let r = 0; r < rounds; r++) {
    const round = [];
    for (let i = 0; i < half; i++) {
      const a = all[i];
      const b = all[n - 1 - i];
      if (a && b) round.push([a, b]);
    }
    pairsByRound.push(round);
    const last = all.pop();
    all.splice(1, 0, last); // rotate (keep all[0] fixed)
  }

  // Second pass: greedy home/away assignment biased toward balance.
  // For each pair, whoever has fewer home games gets home; tie → round-parity flip.
  const homeCount = new Map();
  for (const t of teams) homeCount.set(t.id, 0);

  const fixtures = [];
  for (let r = 0; r < pairsByRound.length; r++) {
    for (const [a, b] of pairsByRound[r]) {
      const aHome = homeCount.get(a.id) || 0;
      const bHome = homeCount.get(b.id) || 0;
      let home, away;
      if (aHome < bHome)      { home = a; away = b; }
      else if (bHome < aHome) { home = b; away = a; }
      else                    { home = (r % 2 === 0) ? a : b; away = home === a ? b : a; }
      homeCount.set(home.id, (homeCount.get(home.id) || 0) + 1);
      fixtures.push([home, away, r + 1]);
    }
  }

  if (format === 'double') {
    // Second leg mirrors the first (home/away swapped) so each pair plays both venues.
    const reverseLeg = fixtures.map(([h, a, r]) => [a, h, r + rounds]);
    return fixtures.concat(reverseLeg);
  }
  return fixtures;
}

/**
 * Map abstract fixtures (rounds of [home, away, roundNum]) onto real dates,
 * times, and rinks. One round = one week (configurable). Games within a round
 * stagger by `slotMinutes` so they don't all share the same minute on the
 * conflict report.
 *
 * Each game's rink defaults to the home team's home_rink (resolved by caller
 * — we just pass rinkId straight through).
 */
export function expandFixturesToGames({
  fixtures, startDate, gameTime = '20:00', dayOfWeek, slotMinutes = 60, getRinkIdForTeam,
}) {
  const games = [];
  const startDay = new Date(startDate);
  startDay.setHours(0, 0, 0, 0);

  // Align startDay to the requested dayOfWeek (0=Sun..6=Sat) on or after startDate
  if (dayOfWeek != null) {
    const delta = (dayOfWeek - startDay.getDay() + 7) % 7;
    startDay.setDate(startDay.getDate() + delta);
  }

  // Group fixtures by round so we can offset each round's date
  const byRound = {};
  for (const f of fixtures) {
    const r = f[2] || 1;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(f);
  }
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  const [hh, mm] = gameTime.split(':').map(n => parseInt(n, 10));

  for (const r of rounds) {
    const roundGames = byRound[r];
    const roundDate = new Date(startDay);
    roundDate.setDate(roundDate.getDate() + (r - 1) * 7);
    roundDate.setHours(hh || 20, mm || 0, 0, 0);

    roundGames.forEach((f, idx) => {
      const [home, away] = f;
      const gameTime = new Date(roundDate.getTime() + idx * slotMinutes * 60 * 1000);
      games.push({
        home_team_id: home.id,
        away_team_id: away.id,
        rink_id: getRinkIdForTeam ? getRinkIdForTeam(home) : null,
        start_time: gameTime.toISOString(),
        status: 'scheduled',
        round: r,
      });
    });
  }
  return games;
}

/**
 * Detect schedule conflicts. Returns an array of { type, message, gameIds[] }.
 *   - 'rink_double_book': two games at the same rink overlapping in time (within 90 min)
 *   - 'team_double_play': one team plays twice within `teamGapHours` hours
 *
 * The default `teamGapHours` (4) is tuned for typical weekly leagues — a team
 * playing twice in the same 4-hour window is unusual enough to flag. Pass a
 * smaller value for short-turnaround events (multi-game tournament days) so
 * the conflict list doesn't drown the director in expected back-to-backs.
 */
export function detectScheduleConflicts(games, { teamGapHours = 4, gameDurationMin = 90 } = {}) {
  const conflicts = [];
  const sorted = games.slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  // Rink double-book
  const byRink = {};
  for (const g of sorted) {
    if (!g.rink_id) continue;
    if (!byRink[g.rink_id]) byRink[g.rink_id] = [];
    byRink[g.rink_id].push(g);
  }
  for (const rinkId of Object.keys(byRink)) {
    const list = byRink[rinkId];
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const gap = (new Date(b.start_time) - new Date(a.start_time)) / 60000;
      if (gap < gameDurationMin) {
        conflicts.push({
          type: 'rink_double_book',
          message: `Same rink, ${Math.round(gap)} min apart`,
          gameIds: [a.id || a._key, b.id || b._key],
        });
      }
    }
  }

  // Team double-play
  const byTeam = {};
  for (const g of sorted) {
    for (const t of [g.home_team_id, g.away_team_id]) {
      if (!t) continue;
      if (!byTeam[t]) byTeam[t] = [];
      byTeam[t].push(g);
    }
  }
  for (const teamId of Object.keys(byTeam)) {
    const list = byTeam[teamId];
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const gapHrs = (new Date(b.start_time) - new Date(a.start_time)) / 3600000;
      if (gapHrs < teamGapHours) {
        conflicts.push({
          type: 'team_double_play',
          message: `Team plays again ${Math.round(gapHrs)}h later`,
          gameIds: [a.id || a._key, b.id || b._key],
        });
      }
    }
  }
  return conflicts;
}

/** Bulk INSERT generated games into league_games. */
export async function bulkInsertLeagueGames(leagueId, games, divisionId = null) {
  const rows = games.map(g => ({
    league_id: leagueId,
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    rink_id: g.rink_id || null,
    start_time: g.start_time,
    status: g.status || 'scheduled',
    period: 1,
    round: g.round != null ? String(g.round) : null,
    // LEAGUE-DIV-1 M4 — tag generated games with their division (per-game
    // g.division_id wins, else the caller's scope). NULL for single-division.
    division_id: g.division_id || divisionId || null,
    // Phase 3 of the league-parity build: tag every generated game with its
    // phase so the league_standings view can filter to regular_season only.
    // Default matches the DB column default; passing 'playoffs' from the
    // (future) bracket generator keeps that path easy.
    phase: g.phase || 'regular_season',
    // Per-game stream URL override (KOHA + future YouTube/Twitch-broadcast
    // leagues). NULL means inherit from the rink at render time. The smart
    // schedule generator doesn't know URLs so this is null for generated
    // games; commissioners fill it per-game later or set a rink default.
    youtube_url: (g.youtube_url || '').trim() || null,
  }));
  const { data, error } = await supabase
    .from('league_games')
    .insert(rows)
    .select('id, start_time, home_team_id, away_team_id, rink_id, status, round');
  return { data, error };
}

/** Update a single game's date/rink (for drag/edit). */
export async function rescheduleGame(gameId, { start_time, rink_id }) {
  const updates = {};
  if (start_time) updates.start_time = start_time;
  if (rink_id !== undefined) updates.rink_id = rink_id;
  const { data, error } = await supabase
    .from('league_games')
    .update(updates)
    .eq('id', gameId)
    .select()
    .single();
  return { data, error };
}

/** Delete one game (for un-publishing a mistake). */
export async function deleteLeagueGame(gameId) {
  const { error } = await supabase.from('league_games').delete().eq('id', gameId);
  return { error };
}
