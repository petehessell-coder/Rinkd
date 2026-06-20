import { supabase } from './supabase';

// ── Native Rinkd-merch store (Printful-fulfilled, Stripe-paid) ────────────────
// Affiliate products (pure_hockey) still load via getProducts() in products.js;
// this module is the native-merch (source='rinkd_merch') side that has variants
// + a real cart + checkout.

/**
 * Active Rinkd-merch products with their active variants nested.
 * Returns [] on error so the Store renders its empty state instead of breaking.
 */
export async function getMerchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, variants:product_variants(*)')
    .eq('source', 'rinkd_merch')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(500); // perf(scale): cap the merch catalog read (twin of getProducts)
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[store] merch load failed:', error.message);
    return [];
  }
  return (data || []).map((p) => ({
    ...p,
    variants: (p.variants || [])
      .filter((v) => v.is_active)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
  })).filter((p) => p.variants.length > 0);
}

/**
 * Start a merch checkout. Sends only variant ids + quantities + the shipping
 * address — the `store-checkout` Edge Function re-prices everything from the DB,
 * gets the live Printful shipping rate, creates the pending order, and returns a
 * Stripe Checkout URL. Login is required (the buyer is read from the JWT).
 *
 * @returns {Promise<{ url: string }>}  redirect the browser to `url`.
 * Throws an Error with optional `.reason` ('stale_cart' | 'shipping' | …).
 */
export async function startStoreCheckout({ items, shipping, email }) {
  const { data, error } = await supabase.functions.invoke('store-checkout', {
    body: {
      items,
      shipping,
      email,
      appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context.json(); } catch { /* non-JSON */ }
    const e = new Error((payload && (payload.error || payload.reason)) || error.message || 'Could not start checkout.');
    e.reason = payload?.reason || null;
    throw e;
  }
  return data; // { url }
}
