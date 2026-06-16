import { supabase } from './supabase';

/**
 * SOCIAL-2 (S3) — GameSheet link + match-confirmation helpers for the director
 * GameSheet tab. Reads + writes are gated by the director RLS on
 * gamesheet_links / gamesheet_game_map. The actual polling/score-writing is
 * done server-side by the `sync-gamesheet` Edge Function (cron); this lib only
 * manages the link and lets the director confirm/ignore the matches it queues.
 */

export async function listLinks(tournamentId) {
  const { data, error } = await supabase
    .from('gamesheet_links')
    .select('id, tournament_id, division_id, gamesheet_season_id, status, auto_import, last_synced_at, last_sync_note, created_at')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

// Create a link AND flip the event into external-scoring mode (poller-fed →
// the manual ScorerView is gated off, so there's no dual scoring path).
// autoImport (default true): the poller creates teams + games from GameSheet
// for anything it can't match to an existing Rinkd game — so the operator
// doesn't have to rebuild their schedule first.
export async function createLink(tournamentId, { seasonId, divisionId = null, autoImport = true }) {
  const sid = String(seasonId || '').trim();
  if (!sid) return { data: null, error: new Error('A GameSheet season id is required') };
  const { data, error } = await supabase
    .from('gamesheet_links')
    .insert({ tournament_id: tournamentId, division_id: divisionId || null, gamesheet_season_id: sid, status: 'active', auto_import: !!autoImport })
    .select()
    .single();
  if (error) return { data: null, error };
  // Mark the tournament external-scored AND stash the season id in the public
  // settings JSONB — the public Stats tab reads it to embed GameSheet's stats
  // widget (gamesheet_links is director-only RLS, so it can't read it directly).
  const { data: tRow } = await supabase.from('tournaments').select('settings').eq('id', tournamentId).single();
  const mergedSettings = { ...(tRow?.settings || {}), gamesheet_season_id: sid };
  await supabase.from('tournaments').update({ scoring_source: 'external', settings: mergedSettings }).eq('id', tournamentId);
  return { data, error: null };
}

export async function setLinkStatus(linkId, status) {
  const { error } = await supabase.from('gamesheet_links').update({ status }).eq('id', linkId);
  return { error };
}

// Remove a link. If it was the last link on the event, revert to manual scoring
// so the director regains the ScorerView.
export async function removeLink(linkId, tournamentId) {
  const { error } = await supabase.from('gamesheet_links').delete().eq('id', linkId);
  if (error) return { error };
  const { data: remaining } = await supabase
    .from('gamesheet_links').select('id').eq('tournament_id', tournamentId).limit(1);
  if (!remaining || remaining.length === 0) {
    const { data: tRow } = await supabase.from('tournaments').select('settings').eq('id', tournamentId).single();
    const s = { ...(tRow?.settings || {}) };
    delete s.gamesheet_season_id;
    await supabase.from('tournaments').update({ scoring_source: 'rinkd', settings: s }).eq('id', tournamentId);
  }
  return { error: null };
}

// All map rows for a tournament's links, newest first. Joined through links so
// one query covers every link on the event.
export async function listGameMaps(tournamentId) {
  const { data: links } = await supabase
    .from('gamesheet_links').select('id').eq('tournament_id', tournamentId);
  const ids = (links || []).map(l => l.id);
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from('gamesheet_game_map')
    .select('id, link_id, rinkd_game_id, gamesheet_game_id, status, gs_home_name, gs_visitor_name, gs_division, gs_date, gs_time, gs_home_goals, gs_visitor_goals, updated_at')
    .in('link_id', ids)
    .order('status', { ascending: true })
    .order('updated_at', { ascending: false });
  return { data: data || [], error };
}

// Confirm a queued match. Optionally (re)assign the Rinkd game — used to resolve
// an unmatched row (rinkd_game_id was null) by picking the game manually.
export async function confirmMatch(mapId, rinkdGameId = undefined) {
  const payload = { status: 'confirmed', updated_at: new Date().toISOString() };
  if (rinkdGameId !== undefined) payload.rinkd_game_id = rinkdGameId || null;
  const { error } = await supabase.from('gamesheet_game_map').update(payload).eq('id', mapId);
  return { error };
}

export async function ignoreMatch(mapId) {
  const { error } = await supabase
    .from('gamesheet_game_map')
    .update({ status: 'ignored', updated_at: new Date().toISOString() })
    .eq('id', mapId);
  return { error };
}
