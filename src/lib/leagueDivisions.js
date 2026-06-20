import { supabase } from './supabase';
import { cached, invalidatePrefix } from './cache';

// LEAGUE-DIV-1 — read helpers for M2 (public division nav).
// CRUD (create / update / delete / reorder) lands in M3 and will live here too.

// perf(scale): divisions are near-immutable during a session and read on every
// League-page mount; cache them so a spectator opening/closing the page (and the
// post-5a realtime split) never re-pulls them. Writers below invalidate, so a
// commissioner never sees their own stale edit; the 60s TTL bounds it elsewhere.
const DIVISIONS_NS = 'league-divisions:';

/** All divisions for a league, in commissioner-defined order. Public read. */
export async function listLeagueDivisions(leagueId) {
  if (!leagueId) return [];
  const rows = await cached(`${DIVISIONS_NS}${leagueId}`, 60_000, async () => {
    const { data, error } = await supabase
      .from('league_divisions')
      .select('id, league_id, name, sort_order, settings')
      .eq('league_id', leagueId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  });
  return rows.slice(); // copy so a caller can't mutate the cached array in place
}

// ── M3 commissioner CRUD (writes go through league_divisions RLS, which is
//    gated on is_league_commissioner; the client can't bypass it). ──

/** Create a division at the end of the order. Returns the new row. */
export async function createLeagueDivision(leagueId, name) {
  const { data: last } = await supabase
    .from('league_divisions')
    .select('sort_order')
    .eq('league_id', leagueId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextSort = ((last?.[0]?.sort_order) ?? -1) + 1;
  const { data, error } = await supabase
    .from('league_divisions')
    .insert({ league_id: leagueId, name: (name || '').trim() || 'New Division', sort_order: nextSort })
    .select()
    .single();
  if (error) throw error;
  invalidatePrefix(DIVISIONS_NS);
  return data;
}

/** Rename (and/or update settings on) a division. */
export async function updateLeagueDivision(id, updates) {
  const { data, error } = await supabase
    .from('league_divisions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  invalidatePrefix(DIVISIONS_NS);
  return data;
}

/**
 * Delete a division. Per the M1 FK rules this CASCADE-removes its league_teams
 * links (the teams' membership in this league) and SET NULLs its games'
 * division_id (games survive, unscoped). Callers MUST warn first.
 */
export async function deleteLeagueDivision(id) {
  const { error } = await supabase.from('league_divisions').delete().eq('id', id);
  if (error) throw error;
  invalidatePrefix(DIVISIONS_NS);
}

/** Persist a new order — sets sort_order = array index for each id. */
export async function reorderLeagueDivisions(orderedIds) {
  // Sequential to keep it simple; division counts are small (≤ a few dozen).
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('league_divisions')
      .update({ sort_order: i })
      .eq('id', orderedIds[i]);
    if (error) throw error;
  }
  invalidatePrefix(DIVISIONS_NS);
}

/** Assign (or clear) a league team's division. Uses the M1 league_teams_update policy. */
export async function assignLeagueTeamDivision(leagueTeamId, divisionId) {
  const { error } = await supabase
    .from('league_teams')
    .update({ division_id: divisionId || null })
    .eq('id', leagueTeamId);
  if (error) throw error;
}

/**
 * The current user's division in THIS league, resolved via team membership:
 *   user → team_members (active/pending) → teams → league_teams (this league) → division_id
 * Powers the "land on my own division" smart default (Decision #6). Same chain
 * shape as getMyPrimaryLeague (NAV-PIN-1), one level deeper. Fail-soft → null.
 */
export async function getMyDivisionInLeague(userId, leagueId) {
  if (!userId || !leagueId) return null;
  try {
    const { data: mem } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .in('status', ['active', 'pending']);
    const teamIds = (mem || []).map((m) => m.team_id).filter(Boolean);
    if (!teamIds.length) return null;
    const { data: lt } = await supabase
      .from('league_teams')
      .select('division_id')
      .eq('league_id', leagueId)
      .in('team_id', teamIds)
      .not('division_id', 'is', null)
      .limit(1);
    return lt?.[0]?.division_id || null;
  } catch {
    return null;
  }
}
