import { supabase } from './supabase';

// Active store products for display. Read-only from the client — writes happen
// via the AvantLink feed sync (service role) or admin. Returns [] on error so
// the Store renders its empty/coming-soon state instead of breaking.
export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[products] load failed:', error.message);
    return [];
  }
  return data || [];
}
