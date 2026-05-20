// Phase 3b of the league-parity build (May 19, 2026).
//
// Pure-function playoff bracket generator. Pete's call: same separation
// pattern as the smart schedule generator — pure math here, the caller
// does the DB insert via `bulkInsertLeagueGames`. Every row this returns
// is tagged `phase='playoffs'` so the regular-season `league_standings`
// view excludes them structurally.
//
// MVP shape: emit ONE round at a time with real seeds/winners. Because
// `league_games.home_team_id` and `away_team_id` are NOT NULL, we can't
// pre-create TBD placeholder rounds the way tournaments do. Commissioner
// re-runs the generator after each round completes (this lib supports
// both "seed-from-standings" for round 1 and "advance-winners" for
// round N+1).
//
// Canonical round values (free-form text, no DB CHECK — leagues with
// non-standard formats can use other strings):
//   'quarterfinal' — round 1 when 8 teams advance
//   'semifinal'    — round 1 when 4 teams advance; round 2 when 8 advance
//   'final'        — gold-medal game (last round)
//   'bronze'       — bronze-medal game (loser-of-semis match)

import { buildSlotTimeline } from './leagueScheduleGenerator';

const DEFAULT_FIRST_PUCK_HOUR   = 18;
const DEFAULT_FIRST_PUCK_MINUTE = 0;
const DEFAULT_GAME_BLOCK_MINUTES = 75;

/** Supported bracket sizes for Phase 3b. 2/4/8 covers the vast majority
 *  of beer/youth/adult-rec leagues; 16+ is a Phase 4 thing if asked. */
export const SUPPORTED_BRACKET_SIZES = [2, 4, 8];

/**
 * Standard seeding for a given bracket size.
 *   2 teams → [1v2]
 *   4 teams → [1v4, 2v3]   (semifinals)
 *   8 teams → [1v8, 4v5, 3v6, 2v7]   (quarterfinals)
 * Returns pairs as objects {homeSeed, awaySeed} — higher seed (lower
 * number) is the home team.
 */
export function seedPairs(bracketSize) {
  if (bracketSize === 2) return [{ homeSeed: 1, awaySeed: 2 }];
  if (bracketSize === 4) return [{ homeSeed: 1, awaySeed: 4 }, { homeSeed: 2, awaySeed: 3 }];
  if (bracketSize === 8) {
    return [
      { homeSeed: 1, awaySeed: 8 },
      { homeSeed: 4, awaySeed: 5 },
      { homeSeed: 3, awaySeed: 6 },
      { homeSeed: 2, awaySeed: 7 },
    ];
  }
  return [];
}

/** Round label that corresponds to the first round of a given bracket size. */
export function firstRoundLabel(bracketSize) {
  if (bracketSize === 8) return 'quarterfinal';
  if (bracketSize === 4) return 'semifinal';
  if (bracketSize === 2) return 'final';
  return null;
}

/**
 * Generate ROUND 1 of a playoff bracket from the league standings.
 *
 * Inputs:
 *   standings              league_standings rows (lt_id, team_name, rank, ...) — sorted by rank
 *   bracketSize            2 | 4 | 8
 *   startDate              ISO 'YYYY-MM-DD'
 *   daysOfWeek             array of Sun=0..Sat=6 (single day works too)
 *   gamesPerDay            per-day slot cap on the chosen rink
 *   rinkId                 optional uuid; applied to every generated row
 *   firstPuckHour/Minute   optional override
 *   gameBlockMinutes       optional override
 *
 * Returns: { rows, label, error? }
 *   rows  — bracket game rows ready for bulkInsertLeagueGames
 *   label — 'quarterfinal' | 'semifinal' | 'final'
 *   error — present when something blocks generation (e.g. too few teams)
 *
 * Higher seed is the home team. Caller decides home-ice tiebreakers if
 * the standings rank doesn't capture them.
 */
export function generatePlayoffRoundOne({
  standings,
  bracketSize,
  startDate,
  daysOfWeek,
  gamesPerDay = 1,
  rinkId = null,
  firstPuckHour = DEFAULT_FIRST_PUCK_HOUR,
  firstPuckMinute = DEFAULT_FIRST_PUCK_MINUTE,
  gameBlockMinutes = DEFAULT_GAME_BLOCK_MINUTES,
}) {
  if (!SUPPORTED_BRACKET_SIZES.includes(bracketSize)) {
    return { rows: [], label: null, error: 'unsupported_bracket_size' };
  }
  const ranked = (standings || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
  if (ranked.length < bracketSize) {
    return { rows: [], label: null, error: 'not_enough_teams' };
  }
  const top = ranked.slice(0, bracketSize);
  const pairs = seedPairs(bracketSize);
  const label = firstRoundLabel(bracketSize);

  const slots = buildSlotTimeline({
    startDate,
    daysOfWeek,
    gamesPerDay,
    totalSlots: pairs.length,
    firstPuckHour,
    firstPuckMinute,
    gameBlockMinutes,
  });
  if (slots.length < pairs.length) {
    return { rows: [], label, error: 'calendar_exhausted' };
  }

  const rows = pairs.map((p, i) => ({
    home_team_id: top[p.homeSeed - 1].lt_id,
    away_team_id: top[p.awaySeed - 1].lt_id,
    rink_id: rinkId,
    start_time: slots[i],
    status: 'scheduled',
    phase: 'playoffs',
    round: label,
  }));

  return { rows, label };
}

/**
 * Generate ROUND N+1 from a list of round-N games that have been
 * finalized. Caller hands over the previous round's `league_games` rows
 * (must have status='final' + home_score/away_score set). We pair the
 * winners according to bracket order: in an 8-team bracket, QF winner #0
 * plays QF winner #1, QF winner #2 plays QF winner #3. In a 4-team
 * bracket, semi winner #0 plays semi winner #1 in the final; losers play
 * in the bronze game.
 *
 * Inputs:
 *   previousRound          finalized round-N league_games rows in seed
 *                          order (i.e. the order they were inserted).
 *                          Required fields: id, home_team_id, away_team_id,
 *                          home_score, away_score, round.
 *   bracketSize            same as round 1; needed to know the next label.
 *   includeBronze          when previousRound is semifinals, also emit a
 *                          bronze game pairing the two losers. Default true.
 *   startDate / daysOfWeek / gamesPerDay / rinkId / first puck / spacing
 *                          same shape as round 1.
 *
 * Returns: { rows, label, error? }
 *
 * Note: round-1 → round-2 only fires when bracketSize=8 (QF → SF). For
 * bracketSize=4 the previousRound IS the semifinals and we emit the
 * final + (optional) bronze. For bracketSize=2 there's no next round.
 */
export function generatePlayoffNextRound({
  previousRound,
  bracketSize,
  includeBronze = true,
  startDate,
  daysOfWeek,
  gamesPerDay = 1,
  rinkId = null,
  firstPuckHour = DEFAULT_FIRST_PUCK_HOUR,
  firstPuckMinute = DEFAULT_FIRST_PUCK_MINUTE,
  gameBlockMinutes = DEFAULT_GAME_BLOCK_MINUTES,
}) {
  if (!Array.isArray(previousRound) || previousRound.length === 0) {
    return { rows: [], label: null, error: 'no_previous_round' };
  }
  // Verify the previous round is fully final.
  for (const g of previousRound) {
    if (g.status !== 'final') {
      return { rows: [], label: null, error: 'previous_round_not_final' };
    }
  }
  const prevLabel = previousRound[0]?.round;
  const winners = previousRound.map(winnerLtId);
  const losers  = previousRound.map(loserLtId);

  let nextLabel = null;
  let pairs = [];
  let bronze = null;

  if (prevLabel === 'quarterfinal') {
    nextLabel = 'semifinal';
    pairs = pairWinnersInOrder(winners);
  } else if (prevLabel === 'semifinal') {
    nextLabel = 'final';
    pairs = pairWinnersInOrder(winners);
    if (includeBronze && losers.length === 2 && losers[0] && losers[1]) {
      bronze = { home: losers[0], away: losers[1] };
    }
  } else if (prevLabel === 'final') {
    return { rows: [], label: null, error: 'tournament_complete' };
  } else {
    return { rows: [], label: null, error: 'unknown_previous_round' };
  }

  if (pairs.some((p) => !p.home || !p.away)) {
    return { rows: [], label: nextLabel, error: 'incomplete_winners' };
  }

  const totalSlots = pairs.length + (bronze ? 1 : 0);
  const slots = buildSlotTimeline({
    startDate, daysOfWeek, gamesPerDay, totalSlots,
    firstPuckHour, firstPuckMinute, gameBlockMinutes,
  });
  if (slots.length < totalSlots) {
    return { rows: [], label: nextLabel, error: 'calendar_exhausted' };
  }

  // Bronze first if we have one — losers play before gold. Commissioners
  // can shift the times manually after generation if they want gold last.
  // We schedule bronze at slot[0], the championship pairs after.
  let cursor = 0;
  const rows = [];
  if (bronze) {
    rows.push({
      home_team_id: bronze.home,
      away_team_id: bronze.away,
      rink_id: rinkId,
      start_time: slots[cursor++],
      status: 'scheduled',
      phase: 'playoffs',
      round: 'bronze',
    });
  }
  for (const p of pairs) {
    rows.push({
      home_team_id: p.home,
      away_team_id: p.away,
      rink_id: rinkId,
      start_time: slots[cursor++],
      status: 'scheduled',
      phase: 'playoffs',
      round: nextLabel,
    });
  }
  // The bronze game still gets round='bronze'; the gold-medal game gets
  // the canonical nextLabel ('final'). Surface the championship label as
  // the returned `label` so the UI can say "Generated 1 bronze + 1 final".
  return { rows, label: nextLabel };
}

/** Returns the league_teams.id of the winner of a finalized game, or null
 *  on a tie (shouldn't happen in playoffs but we don't enforce it here). */
function winnerLtId(g) {
  if (!g || g.status !== 'final') return null;
  if ((g.home_score ?? 0) > (g.away_score ?? 0)) return g.home_team_id;
  if ((g.away_score ?? 0) > (g.home_score ?? 0)) return g.away_team_id;
  return null;
}

function loserLtId(g) {
  if (!g || g.status !== 'final') return null;
  if ((g.home_score ?? 0) > (g.away_score ?? 0)) return g.away_team_id;
  if ((g.away_score ?? 0) > (g.home_score ?? 0)) return g.home_team_id;
  return null;
}

/** Pair winners by adjacency: [w0, w1, w2, w3] → [(w0,w1), (w2,w3)]. The
 *  generator seeded round 1 so adjacent slots are the cross-bracket
 *  matchups; their winners meet in the next round. */
function pairWinnersInOrder(winners) {
  const pairs = [];
  for (let i = 0; i < winners.length; i += 2) {
    pairs.push({ home: winners[i], away: winners[i + 1] });
  }
  return pairs;
}
