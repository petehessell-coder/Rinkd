// Phase 3 of the league-parity build (May 19, 2026 plan).
//
// Pure-function schedule generator for league regular seasons. Pete picked
// **Option B** on May 19: commissioner enters a TARGET games per team; the
// generator computes the number of round-robin meetings needed, then slots
// the games onto a calendar built from days-of-week + games-per-day +
// start-date. Returns proposed `{ home_team_id, away_team_id, start_time,
// phase }` rows — the caller does the DB insert (we never write here).
//
// Why pure: makes the live UI preview ("32 games over 14 weeks ending
// Dec 15") trivial — re-run the generator on every form change without
// touching the DB.
//
// Home/away balance: the underlying `roundRobinPairs` (in
// tournamentManage.js) already alternates home counts within one
// round-robin. We layer on top by flipping the pairing's host on every
// other meeting, so a team that played 5 home games in meeting 1 plays
// 5 away in meeting 2.

import { roundRobinPairs } from './tournamentManage';

// Default first puck (24-hr local time). Commissioner can shift games by
// editing them individually in the Schedule tab after generation.
const DEFAULT_FIRST_PUCK_HOUR   = 18; // 18:00 = 6 PM
const DEFAULT_FIRST_PUCK_MINUTE = 0;

// Time between consecutive games on the same rink/day. 75-minute spacing
// fits a standard 3×15 stop-time game with intermission + flood. UI lets
// the commissioner override.
const DEFAULT_GAME_BLOCK_MINUTES = 75;

/**
 * Compute the schedule shape for a given target-games-per-team. Returns
 * `{ meetingsPerPair, gamesPerTeam, totalGames }` so the UI can preview
 * the "actual" outcome before committing.
 *
 * meetingsPerPair = round(target / (N-1)), minimum 1. We round to nearest
 * instead of floor or ceil so a target of "30" with 8 teams (7 opponents)
 * gives 4 meetings → 28 games per team — closer than 5 (35) for a
 * commissioner who said "around 30".
 */
export function computeScheduleShape({ teamCount, targetGamesPerTeam }) {
  const N = teamCount;
  const T = Math.max(0, Math.floor(targetGamesPerTeam || 0));
  if (N < 2 || T < 1) {
    return { meetingsPerPair: 0, gamesPerTeam: 0, totalGames: 0 };
  }
  const opponents = N - 1;
  // Math.max ensures the commissioner always gets at least one full
  // round-robin even if their target is below opponents (e.g. asking for
  // 5 games per team with 8 teams → 1 meeting → 7 games per team).
  const meetingsPerPair = Math.max(1, Math.round(T / opponents));
  const gamesPerTeam = meetingsPerPair * opponents;
  const totalGames = (gamesPerTeam * N) / 2;
  return { meetingsPerPair, gamesPerTeam, totalGames };
}

/**
 * Build the calendar of game slots from the wizard's day-of-week + games-
 * per-day inputs. Walks the calendar forward from startDate until
 * `totalSlots` slots have been emitted.
 *
 * `daysOfWeek` is an array of Sun=0..Sat=6 integers. `gamesPerDay` is per
 * rink — the caller can spread across rinks themselves by running the
 * generator per rink (Phase 3 ships single-rink first; per-rink balancing
 * is a Phase 3b refinement once commissioners ask).
 *
 * Returns an array of ISO date-time strings, one per slot.
 */
export function buildSlotTimeline({
  startDate,
  daysOfWeek,
  gamesPerDay,
  totalSlots,
  firstPuckHour = DEFAULT_FIRST_PUCK_HOUR,
  firstPuckMinute = DEFAULT_FIRST_PUCK_MINUTE,
  gameBlockMinutes = DEFAULT_GAME_BLOCK_MINUTES,
}) {
  const slots = [];
  if (totalSlots <= 0) return slots;
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return slots;
  const perDay = Math.max(1, Math.floor(gamesPerDay || 1));
  const allowed = new Set(daysOfWeek.map((d) => Number(d)));

  // Normalize start: treat the input as local YYYY-MM-DD; first puck on
  // the first allowed day on/after start. Bail after a generous walk so
  // a misconfigured form never spins forever.
  const cursor = new Date(startDate + 'T00:00:00');
  if (Number.isNaN(cursor.getTime())) return slots;

  const HARD_MAX_DAYS = 365 * 3; // 3 years is more than any real league
  let daysWalked = 0;
  while (slots.length < totalSlots && daysWalked < HARD_MAX_DAYS) {
    if (allowed.has(cursor.getDay())) {
      for (let i = 0; i < perDay && slots.length < totalSlots; i++) {
        const t = new Date(cursor);
        t.setHours(firstPuckHour, firstPuckMinute + i * gameBlockMinutes, 0, 0);
        slots.push(t.toISOString());
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    daysWalked++;
  }
  return slots;
}

/**
 * Generate a full proposed schedule.
 *
 *   teams                 array of objects with `.id` (league_teams.id)
 *   targetGamesPerTeam    user-entered integer; rounded into a clean
 *                         round-robin count via computeScheduleShape.
 *   startDate             ISO 'YYYY-MM-DD'
 *   daysOfWeek            array of Sun=0..Sat=6
 *   gamesPerDay           per-rink games slotted per day
 *   rinkId                applied to every generated row (single-rink
 *                         shipping; per-rink is Phase 3b)
 *   firstPuckHour/Minute  optional override of the default 18:00
 *   gameBlockMinutes      optional override of the default 75-min spacing
 *
 * Returns:
 *   { rows: [{ league_id, home_team_id, away_team_id, rink_id, start_time, status, phase }],
 *     shape: { meetingsPerPair, gamesPerTeam, totalGames },
 *     lastSlotDate: ISO string of the final game, or null }
 *
 * Caller passes `league_id` separately and merges into each row before
 * the batch insert.
 */
export function generateLeagueSchedule({
  teams,
  targetGamesPerTeam,
  startDate,
  daysOfWeek,
  gamesPerDay,
  rinkId = null,
  firstPuckHour,
  firstPuckMinute,
  gameBlockMinutes,
}) {
  const teamIds = (teams || []).map((t) => t.id).filter(Boolean);
  const shape = computeScheduleShape({ teamCount: teamIds.length, targetGamesPerTeam });
  if (shape.totalGames === 0) {
    return { rows: [], shape, lastSlotDate: null };
  }

  // Run K round-robins. On odd meetings (1st, 3rd, ...) use the pair as
  // returned by roundRobinPairs (already home-balanced within one RR).
  // On even meetings (2nd, 4th, ...) flip home/away so a team that
  // played a pair at home in meeting 1 plays it away in meeting 2.
  const allPairs = [];
  for (let m = 0; m < shape.meetingsPerPair; m++) {
    const rr = roundRobinPairs(teamIds);
    for (const p of rr) {
      if (m % 2 === 0) allPairs.push({ home: p.homeId, away: p.awayId });
      else             allPairs.push({ home: p.awayId, away: p.homeId });
    }
  }

  // Slot every pair onto the calendar.
  const slots = buildSlotTimeline({
    startDate,
    daysOfWeek,
    gamesPerDay,
    totalSlots: allPairs.length,
    firstPuckHour,
    firstPuckMinute,
    gameBlockMinutes,
  });
  // If the calendar walk ran out of days (HARD_MAX_DAYS), bail with what
  // we have rather than producing a partial schedule with wrong counts.
  if (slots.length < allPairs.length) {
    return { rows: [], shape, lastSlotDate: null, error: 'calendar_exhausted' };
  }

  const rows = allPairs.map((p, i) => ({
    home_team_id: p.home,
    away_team_id: p.away,
    rink_id: rinkId,
    start_time: slots[i],
    status: 'scheduled',
    phase: 'regular_season',
  }));

  return {
    rows,
    shape,
    lastSlotDate: slots[slots.length - 1] || null,
  };
}
