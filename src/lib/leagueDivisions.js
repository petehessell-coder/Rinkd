import { supabase } from './supabase';

// LEAGUE-DIV-1 — read helpers for M2 (public division nav).
// CRUD (create / update / delete / reorder) lands in M3 and will live here too.

/** All divisions for a league, in commissioner-defined order. Public read. */
export async function listLeagueDivisions(leagueId) {
  if (!leagueId) return [];
  const { data, error } = await supabase
    .from('league_divisions')
    .select('id, league_id, name, sort_order, settings')
    .eq('league_id', leagueId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
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
