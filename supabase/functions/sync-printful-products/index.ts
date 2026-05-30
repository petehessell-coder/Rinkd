// Sync the Rinkd Printful store (sync products + variants) into public.products
// and public.product_variants. This is the NATIVE merch source (source =
// 'rinkd_merch') — distinct from the affiliate Pure Hockey feed.
//
// Required secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-provided)
//   PRINTFUL_API_KEY                          — Printful private token (Bearer)
//   PRINTFUL_STORE_ID  (optional)             — needed if the token is account-
//                                               level with >1 store
//   SYNC_SECRET        (optional)             — if set, callers MUST send a
//                                               matching `x-sync-secret` header
//                                               (lets a cron trigger this safely)
//
// Cadence: run on a daily cron (retail prices / variants drift). Manual admin
// invoke is fine too. Read-only against Printful; the only writes are upserts
// into our own products/product_variants + deactivating rows that vanished from
// the store (we never hard-delete — keeps order_items + analytics intact).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PRINTFUL_API_KEY = Deno.env.get('PRINTFUL_API_KEY');
const PRINTFUL_STORE_ID = Deno.env.get('PRINTFUL_STORE_ID');
const SYNC_SECRET = Deno.env.get('SYNC_SECRET');

const PF_BASE = 'https://api.printful.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function pfHeaders(): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${PRINTFUL_API_KEY}` };
  if (PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = PRINTFUL_STORE_ID;
  return h;
}

async function pfGet(path: string): Promise<any> {
  const res = await fetch(`${PF_BASE}${path}`, { headers: pfHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Printful ${path} -> ${res.status}: ${data?.error?.message || data?.result || res.statusText}`);
  }
  return data;
}

// "...3001 - Black / L"  ->  { color: "Black", size: "L" }. Best-effort: Printful
// doesn't return size/color as discrete fields on a sync_variant, only in name.
function parseColorSize(name: string): { color: string | null; size: string | null } {
  const tail = (name || '').split(' - ').pop() || '';
  const parts = tail.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2) return { color: parts[0], size: parts[1] };
  if (parts.length === 1 && tail !== name) return { color: null, size: parts[0] };
  return { color: null, size: null };
}

function variantImage(sv: any): string | null {
  const files = Array.isArray(sv?.files) ? sv.files : [];
  const preview = files.find((f: any) => f?.type === 'preview' && f?.preview_url)
    || files.find((f: any) => f?.preview_url);
  return preview?.preview_url || sv?.product?.image || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (SYNC_SECRET && req.headers.get('x-sync-secret') !== SYNC_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!PRINTFUL_API_KEY) {
    return json({ skipped: 'PRINTFUL_API_KEY not set' }, 200);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // 1) Page through the store's sync products.
    const syncProducts: any[] = [];
    let offset = 0;
    const limit = 100;
    // hard cap pagination so a bad response can't loop forever
    for (let page = 0; page < 50; page++) {
      const data = await pfGet(`/store/products?offset=${offset}&limit=${limit}`);
      const batch = data?.result || [];
      syncProducts.push(...batch);
      const total = data?.paging?.total ?? batch.length;
      offset += limit;
      if (offset >= total || batch.length === 0) break;
    }

    const seenProductExternalIds: string[] = [];
    let variantCount = 0;

    // 2) For each sync product, fetch its detail (variants) and upsert.
    for (const sp of syncProducts) {
      const detail = await pfGet(`/store/products/${sp.id}`);
      const product = detail?.result?.sync_product || sp;
      const variants: any[] = detail?.result?.sync_variants || [];

      // skip a product with no live (non-ignored) variants
      const liveVariants = variants.filter((v) => !v.is_ignored);
      if (liveVariants.length === 0) continue;

      const externalId = String(product.id);
      seenProductExternalIds.push(externalId);

      // "from" price = lowest variant retail price, for the card.
      const prices = liveVariants
        .map((v) => Number(v.retail_price))
        .filter((n) => Number.isFinite(n) && n > 0);
      const fromPrice = prices.length ? Math.min(...prices) : null;
      const currency = liveVariants[0]?.currency || 'USD';

      const { data: prow, error: pErr } = await svc
        .from('products')
        .upsert(
          {
            source: 'rinkd_merch',
            external_id: externalId,
            name: product.name,
            image_url: product.thumbnail_url || null,
            price: fromPrice,
            currency,
            url: null, // native merch — no outbound buy link
            is_affiliate: false,
            is_active: true,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'source,external_id' },
        )
        .select('id')
        .single();
      if (pErr || !prow) throw new Error(`product upsert failed (${externalId}): ${pErr?.message}`);

      // Upsert this product's variants.
      const seenVariantIds: number[] = [];
      for (const v of liveVariants) {
        const { color, size } = parseColorSize(v.name);
        seenVariantIds.push(v.id);
        const { error: vErr } = await svc.from('product_variants').upsert(
          {
            product_id: prow.id,
            printful_variant_id: v.id, // sync-variant id (POST /orders uses this)
            printful_catalog_variant_id: v.variant_id ?? null, // catalog id (shipping rates use this)
            name: v.name,
            color,
            size,
            price: Number(v.retail_price) || 0,
            currency: v.currency || currency,
            image_url: variantImage(v),
            is_active: true,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'product_id,printful_variant_id' },
        );
        if (vErr) throw new Error(`variant upsert failed (${v.id}): ${vErr.message}`);
        variantCount++;
      }

      // Deactivate this product's variants that disappeared from the store.
      if (seenVariantIds.length) {
        await svc
          .from('product_variants')
          .update({ is_active: false })
          .eq('product_id', prow.id)
          .not('printful_variant_id', 'in', `(${seenVariantIds.join(',')})`);
      }
    }

    // 3) Deactivate merch products no longer in the store (keep affiliate rows alone).
    let q = svc.from('products').update({ is_active: false }).eq('source', 'rinkd_merch');
    if (seenProductExternalIds.length) {
      q = q.not('external_id', 'in', `(${seenProductExternalIds.map((e) => `"${e}"`).join(',')})`);
    }
    await q;

    return json({
      ok: true,
      products: seenProductExternalIds.length,
      variants: variantCount,
    });
  } catch (err) {
    console.error('[sync-printful-products] error', { error: (err as Error)?.message });
    return json({ error: (err as Error)?.message || 'sync failed' }, 500);
  }
});
