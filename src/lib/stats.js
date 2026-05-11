import { supabase } from './supabase';

export async function getPlayerLeagueStats(userId) {
  // Get all team_members rows for this user to find their jersey numbers per team
  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id, jersey_number, team:teams(id, name, logo_color, logo_initials)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('jersey_number', 'is', null);

  if (!memberships || memberships.length === 0) return [];

  const results = [];

  for (const m of memberships) {
    if (!m.jersey_number) continue;

    // Find league_teams rows for this team
    const { data: leagueTeams } = await supabase
      .from('league_teams')
      .select('id, league_id, league:leagues(id, name, season, division)')
      .eq('team_id', m.team_id);

    if (!leagueTeams || leagueTeams.length === 0) continue;

    for (const lt of leagueTeams) {
      // Get all finalized league games for this league team
      const { data: homeGames } = await supabase
        .from('league_games')
        .select('id, home_score, away_score')
        .eq('home_team_id', lt.id)
        .eq('status', 'final');

      const { data: awayGames } = await supabase
        .from('league_games')
        .select('id, home_score, away_score')
        .eq('away_team_id', lt.id)
        .eq('status', 'final');

      const teamGameIds = [
        ...(homeGames || []).map(g => g.id),
        ...(awayGames || []).map(g => g.id),
      ];

      if (teamGameIds.length === 0) continue;

      // Roster-aware GP: only count finalized games this player was actually
      // on the lineup for. Fall back to "all team games" when no lineup has
      // been recorded yet (preserves stats for leagues that haven't started
      // using the lineup feature).
      const { data: lineupRows } = await supabase
        .from('game_lineups')
        .select('game_id')
        .eq('team_id', lt.id)
        .eq('user_id', userId)
        .in('game_id', teamGameIds);

      const playedGameIds = (lineupRows || []).map(r => r.game_id);
      const hasLineups = playedGameIds.length > 0;
      // The game window for stats: only games we know the player was rostered
      // for. If no lineup data exists at all for ANY of this team's finals,
      // assume the legacy behavior (whole team's games) so we don't silently
      // drop existing stats.
      const { count: totalLineupCount } = await supabase
        .from('game_lineups')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', lt.id)
        .in('game_id', teamGameIds);
      const useLineups = (totalLineupCount || 0) > 0;
      const allGameIds = useLineups ? playedGameIds : teamGameIds;

      if (allGameIds.length === 0) {
        // Player not on any saved lineup for this team yet — skip
        continue;
      }

      // Goals scored by this jersey number on this team's games
      const { data: goalsScored } = await supabase
        .from('game_goals')
        .select('id, team_id, assist1_number, assist2_number')
        .in('game_id', allGameIds)
        .eq('team_id', lt.id)
        .eq('scorer_number', m.jersey_number);

      // Assists — could be assist1 or assist2
      const { data: assist1 } = await supabase
        .from('game_goals')
        .select('id')
        .in('game_id', allGameIds)
        .eq('team_id', lt.id)
        .eq('assist1_number', m.jersey_number);

      const { data: assist2 } = await supabase
        .from('game_goals')
        .select('id')
        .in('game_id', allGameIds)
        .eq('team_id', lt.id)
        .eq('assist2_number', m.jersey_number);

      // Penalties
      const { data: penaltiesData } = await supabase
        .from('game_penalties')
        .select('duration_minutes')
        .in('game_id', allGameIds)
        .eq('team_id', lt.id)
        .eq('player_number', m.jersey_number);

      const goals = (goalsScored || []).length;
      const assists = (assist1 || []).length + (assist2 || []).length;
      const pim = (penaltiesData || []).reduce((sum, p) => sum + (p.duration_minutes || 0), 0);
      const gp = allGameIds.length;

      if (goals === 0 && assists === 0 && pim === 0 && gp === 0) continue;

      results.push({
        league_id: lt.league_id,
        league_name: lt.league?.name,
        season: lt.league?.season,
        division: lt.league?.division,
        team_id: m.team_id,
        team_name: m.team?.name,
        team_logo_color: m.team?.logo_color,
        team_logo_initials: m.team?.logo_initials,
        jersey_number: m.jersey_number,
        gp,
        goals,
        assists,
        points: goals + assists,
        pim,
      });
    }
  }

  // Sort by points desc
  return results.sort((a, b) => b.points - a.points);
}
