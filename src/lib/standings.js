// Feed A2 — standings-movement posts. Thin client wrapper around the
// post_standings_movement RPC. Fail-soft by design (mirrors recordGameMilestones
// in lib/milestones.js): if the migration isn't applied yet, or the call errors,
// it no-ops so a finalize NEVER breaks. Leagues only — tournaments later.
import { supabase } from './supabase';

// After a league game finalizes, diff the live standings against the last
// snapshot and auto-post any POSITIVE movement (climbed / into 1st). Scoped to
// the game's division so only the affected partition is processed; pass null for
// a single-division league. Best-effort — must never block the score commit, so
// every failure is swallowed.
export async function postStandingsMovement(leagueId, divisionId = null) {
  if (!leagueId) return;
  try {
    await supabase.rpc('post_standings_movement', {
      p_league_id: leagueId,
      p_division_id: divisionId || null,
    });
  } catch {
    /* not applied / transient — movement posts are best-effort */
  }
}
