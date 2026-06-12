import { supabase } from './supabase';
import { createPost } from './posts';

// LRS-1 Phase 3 — subs pools (ESHL). A pool IS a league_team flagged
// is_sub_pool ('skaters' | 'goalies'), so its roster/page/feed are the
// ordinary team machinery. These helpers cover the three new behaviors:
// finding the pools that serve a playing team, creating them
// (commissioner), and the SUB-ALERT-1 "Sub Needed" post + push.

/**
 * The sub pools available to one playing league_team: pools in the same
 * league, preferring the team's division, falling back to league-wide pools
 * (division_id null). Members come back with profile names so the day-of
 * pull list renders without another query.
 *
 * Returns [{ id, team_id, team_name, sub_pool_kind, members: [...] }]
 */
export async function listSubPoolsForTeam(lineupTeamId) {
  const { data: self, error: selfErr } = await supabase
    .from('league_teams')
    .select('id, league_id, division_id')
    .eq('id', lineupTeamId)
    .single();
  if (selfErr || !self?.league_id) return [];

  const { data: pools, error: poolsErr } = await supabase
    .from('league_teams')
    .select('id, team_id, team_name, sub_pool_kind, division_id')
    .eq('league_id', self.league_id)
    .eq('is_sub_pool', true);
  if (poolsErr || !pools?.length) return [];

  // Division-scoped pools win; league-wide pools only fill kinds the
  // division doesn't cover.
  const divisional = pools.filter(p => self.division_id && p.division_id === self.division_id);
  const leagueWide = pools.filter(p => p.division_id == null);
  const chosen = [...divisional];
  for (const p of leagueWide) {
    if (!chosen.some(c => c.sub_pool_kind === p.sub_pool_kind)) chosen.push(p);
  }
  if (!chosen.length) return [];

  const { data: members } = await supabase
    .from('team_members')
    .select('id, team_id, user_id, jersey_number, position, profile:profiles(id, name, handle)')
    .in('team_id', chosen.map(p => p.team_id))
    .eq('status', 'active')
    .not('user_id', 'is', null)
    .order('jersey_number');

  return chosen.map(p => ({
    ...p,
    members: (members || []).filter(m => m.team_id === p.team_id),
  }));
}

/** All pools in a league (LeagueManage listing). */
export async function listLeagueSubPools(leagueId) {
  const { data, error } = await supabase
    .from('league_teams')
    .select('id, team_id, team_name, sub_pool_kind, division_id')
    .eq('league_id', leagueId)
    .eq('is_sub_pool', true)
    .order('sub_pool_kind');
  if (error) throw error;
  return data || [];
}

/**
 * Commissioner-only (the RPC fail-closes): creates the skaters + goalies
 * pools for the league (or one division). Idempotent — existing pools are
 * skipped.
 */
export async function createLeagueSubPools(leagueId, divisionId = null) {
  const { data, error } = await supabase.rpc('create_league_sub_pools', {
    p_league_id: leagueId,
    p_division_id: divisionId,
  });
  if (error) throw error;
  return data || [];
}

/**
 * SUB-ALERT-1: post "Sub Needed" on the pool's team feed, then fan the push
 * out to the pool members via the send-sub-alert edge fn. The post is the
 * record (visible on the pool's feed either way); the push is best-effort —
 * a push failure must not eat the post.
 *
 * Returns { post, pushed } — `pushed: false` means the post exists but the
 * alert fn errored (caller may surface "posted, push may be delayed").
 */
export async function sendSubNeededAlert({ pool, gameTitle, note }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in required');
  const content = [
    `🚨 SUB NEEDED — ${pool.team_name}`,
    gameTitle || null,
    note?.trim() || null,
    'Reply here or message the coach if you can play.',
  ].filter(Boolean).join('\n');
  const { data: post, error } = await createPost(user.id, {
    content,
    tag: 'Sub Needed',
    tagColor: '#F59E0B',
    teamId: pool.team_id,
  });
  if (error) throw error;
  let pushed = true;
  try {
    const { error: fnErr } = await supabase.functions.invoke('send-sub-alert', {
      body: { post_id: post.id },
    });
    if (fnErr) pushed = false;
  } catch {
    pushed = false;
  }
  return { post, pushed };
}
