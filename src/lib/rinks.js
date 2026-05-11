import { supabase } from './supabase';

/** List all rinks, alphabetical. */
export async function listRinks() {
  const { data, error } = await supabase
    .from('rinks')
    .select('*')
    .order('name')
    .order('sub_rink');
  if (error) throw error;
  return data || [];
}

export async function createRink({ name, sub_rink, address, live_barn_venue_id, maps_url }) {
  const row = {
    name: (name || '').trim(),
    sub_rink: (sub_rink || '').trim() || null,
    address: (address || '').trim() || null,
    live_barn_venue_id: (live_barn_venue_id || '').trim() || null,
    maps_url: (maps_url || '').trim() || null,
  };
  if (!row.name) throw new Error('Rink name is required');
  const { data, error } = await supabase.from('rinks').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateRink(id, updates) {
  const allowed = ['name', 'sub_rink', 'address', 'live_barn_venue_id', 'maps_url'];
  const patch = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      const v = typeof updates[k] === 'string' ? updates[k].trim() : updates[k];
      patch[k] = v === '' ? null : v;
    }
  }
  const { data, error } = await supabase.from('rinks').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRink(id) {
  const { error } = await supabase.from('rinks').delete().eq('id', id);
  if (error) throw error;
}
