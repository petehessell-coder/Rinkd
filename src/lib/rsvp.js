import { supabase } from './supabase';

// RSVP is polymorphic across the three game tables (C06 PR-2 / BUG-1 fix). One
// row in team_game_rsvps points at exactly ONE of three id columns, chosen by
// the game's source:
//   'team'       → game_id             (team_games)
//   'league'     → league_game_id      (league_games)
//   'tournament' → tournament_game_id  (games)
// A DB CHECK (num_nonnulls = 1) guarantees exactly one is set, and a per-source
// partial unique index keeps one row per (game, user) per source.
//
// `source` defaults to 'team' so any legacy caller that hasn't been updated
// still reads/writes the team column exactly as before.
const COLUMN_BY_SOURCE = {
  team: 'game_id',
  league: 'league_game_id',
  tournament: 'tournament_game_id',
};

function columnFor(source) {
  return COLUMN_BY_SOURCE[source] || COLUMN_BY_SOURCE.team;
}

export async function getRsvp(gameId, userId, source = 'team') {
  const col = columnFor(source);
  const { data } = await supabase
    .from('team_game_rsvps')
    .select('*')
    .eq(col, gameId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function getGameRsvps(gameId, source = 'team') {
  const col = columnFor(source);
  const { data } = await supabase
    .from('team_game_rsvps')
    .select('*, profile:profiles!team_game_rsvps_user_id_fkey(id, name, handle, avatar_color, avatar_initials)')
    .eq(col, gameId)
    .order('created_at');
  return data || [];
}

export async function upsertRsvp(gameId, userId, status, source = 'team') {
  const col = columnFor(source);
  const { data, error } = await supabase
    .from('team_game_rsvps')
    .upsert(
      { [col]: gameId, user_id: userId, status },
      // Conflict target is the source's (id, user_id) partial unique index.
      { onConflict: `${col},user_id` }
    )
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteRsvp(gameId, userId, source = 'team') {
  const col = columnFor(source);
  const { error } = await supabase
    .from('team_game_rsvps')
    .delete()
    .eq(col, gameId)
    .eq('user_id', userId);
  if (error) throw error;
}
