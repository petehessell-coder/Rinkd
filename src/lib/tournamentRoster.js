import { supabase } from './supabase';

/**
 * STATS-3 Step 4 — tournament player linking.
 *
 * Stamps game_lineups.user_id for a (tournament team, jersey) so the player's
 * event stats show up on their profile (get_player_tournament_stats). The DB
 * RPCs are the security boundary: ADULTS ONLY (is_minor_profile is hard-blocked
 * server-side), director-or-self authz, self-serve may only claim an UNLINKED
 * jersey. The wrappers below never re-implement that gate — they surface the
 * RPC's error string straight to the UI.
 */

export async function linkTournamentPlayer(tournamentTeamId, jersey, userId) {
  const { data, error } = await supabase.rpc('link_tournament_player', {
    p_tournament_team_id: tournamentTeamId,
    p_jersey: jersey,
    p_user_id: userId,
  });
  return { stamped: data ?? 0, error };
}

export async function unlinkTournamentPlayer(tournamentTeamId, jersey) {
  const { data, error } = await supabase.rpc('unlink_tournament_player', {
    p_tournament_team_id: tournamentTeamId,
    p_jersey: jersey,
  });
  return { cleared: data ?? 0, error };
}

/**
 * A tournament team's "roster" is not a stored table — it's the distinct jersey
 * numbers that have appeared in this team's tournament game_lineups, with a
 * representative entered name. game_lineups.game_id is polymorphic (no FK to
 * games), so we resolve the tournament's game ids first, then filter — no embed.
 */
export async function listTournamentTeamJerseys(tournamentId, tournamentTeamId) {
  const { data: games } = await supabase
    .from('games').select('id').eq('tournament_id', tournamentId);
  const gameIds = (games || []).map((g) => g.id);
  if (gameIds.length === 0) return [];
  const { data, error } = await supabase
    .from('game_lineups')
    .select('jersey_number, invite_name')
    .eq('game_source', 'tournament')
    .eq('team_id', tournamentTeamId)
    .in('game_id', gameIds)
    .not('jersey_number', 'is', null);
  if (error) { console.warn('[tournamentRoster] listTournamentTeamJerseys failed:', error.message); return []; }
  // Dedupe by jersey, keeping the first non-empty name we saw.
  const byJersey = new Map();
  for (const r of data || []) {
    const cur = byJersey.get(r.jersey_number);
    if (!cur) byJersey.set(r.jersey_number, { jersey_number: r.jersey_number, invite_name: r.invite_name || '' });
    else if (!cur.invite_name && r.invite_name) cur.invite_name = r.invite_name;
  }
  return Array.from(byJersey.values()).sort((a, b) => a.jersey_number - b.jersey_number);
}

/**
 * Current jersey->profile links for a team, keyed by jersey. tournament_player_links
 * has TWO FKs to profiles (user_id + linked_by), so a bare PostgREST embed would
 * be ambiguous — fetch the linked profile names in a second step instead.
 * Returns a map: { [jersey_number]: { user_id, name, handle } }.
 */
export async function getTournamentTeamLinks(tournamentTeamId) {
  const { data: links, error } = await supabase
    .from('tournament_player_links')
    .select('jersey_number, user_id')
    .eq('tournament_team_id', tournamentTeamId);
  if (error) { console.warn('[tournamentRoster] getTournamentTeamLinks failed:', error.message); return {}; }
  if (!links || links.length === 0) return {};
  const ids = [...new Set(links.map((l) => l.user_id))];
  const { data: profs } = await supabase.from('profiles').select('id, name, handle').in('id', ids);
  const byId = new Map((profs || []).map((p) => [p.id, p]));
  const out = {};
  for (const l of links) {
    const p = byId.get(l.user_id);
    out[l.jersey_number] = { user_id: l.user_id, name: p?.name || 'Unknown', handle: p?.handle || null };
  }
  return out;
}

/**
 * Search profiles to link by name or handle. account_type is returned so the UI
 * can pre-warn on minors — but the RPC is the real gate (it rejects minors).
 */
export async function searchLinkableProfiles(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, avatar_color, avatar_initials, account_type')
    .or(`name.ilike.%${q}%,handle.ilike.%${q}%`)
    .limit(8);
  if (error) { console.warn('[tournamentRoster] searchLinkableProfiles failed:', error.message); return []; }
  return data || [];
}
