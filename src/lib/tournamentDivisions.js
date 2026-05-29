import { supabase } from './supabase';

/**
 * Multi-division tournament helpers (MULTIDIV-1, M4).
 *
 * A `tournament_divisions` row is the unit of competition; the tournament is
 * the event wrapper. Reads are public (RLS: public read). Writes are gated by
 * `is_tournament_director` RLS on `tournament_divisions`.
 *
 * Per-division `settings` (jsonb) override the tournament's settings — an empty
 * `{}` means "inherit from the tournament" (handled by the consumer's merge).
 */

export async function listDivisions(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_divisions')
    .select('id, tournament_id, name, age_group, tier, sort_order, settings, created_at')
    .eq('tournament_id', tournamentId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return { data: data || [], error };
}

export async function createDivision(tournamentId, fields) {
  const { data, error } = await supabase
    .from('tournament_divisions')
    .insert({
      tournament_id: tournamentId,
      name: (fields.name || '').trim(),
      age_group: fields.ageGroup?.trim() || null,
      tier: fields.tier?.trim() || null,
      sort_order: Number.isFinite(fields.sortOrder) ? fields.sortOrder : 0,
      settings: fields.settings || {},
    })
    .select()
    .single();
  return { data, error };
}

export async function updateDivision(divisionId, fields) {
  const payload = {};
  if (fields.name !== undefined) payload.name = (fields.name || '').trim();
  if (fields.ageGroup !== undefined) payload.age_group = fields.ageGroup?.trim() || null;
  if (fields.tier !== undefined) payload.tier = fields.tier?.trim() || null;
  if (fields.sortOrder !== undefined) payload.sort_order = Number.isFinite(fields.sortOrder) ? fields.sortOrder : 0;
  if (fields.settings !== undefined) payload.settings = fields.settings || {};
  const { data, error } = await supabase
    .from('tournament_divisions')
    .update(payload)
    .eq('id', divisionId)
    .select()
    .single();
  return { data, error };
}

// Deleting a division CASCADE-deletes its tournament_teams (FK ON DELETE
// CASCADE) and NULLs its games' division_id (FK ON DELETE SET NULL). The
// caller is expected to confirm with the director first — the teams go with it.
export async function deleteDivision(divisionId) {
  const { error } = await supabase.from('tournament_divisions').delete().eq('id', divisionId);
  return { error };
}

// Persist a new ordering. `orderedIds` is the division IDs in display order;
// each row's sort_order is set to its index. Runs the updates in parallel and
// returns the first error if any leg fails (a partial reorder is self-healing
// on the next full reorder — sort_order is purely presentational).
export async function reorderDivisions(orderedIds) {
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('tournament_divisions').update({ sort_order: idx }).eq('id', id)
    )
  );
  const failed = results.find((r) => r.error);
  return { error: failed?.error || null };
}
