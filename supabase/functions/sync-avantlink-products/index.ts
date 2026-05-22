// Sync the Pure Hockey product catalog (via AvantLink) into public.products.
//
// SCAFFOLD — NOT YET DEPLOYED OR SCHEDULED. The Pure Hockey affiliate
// application is in AvantLink staff review. Wire this up at approval, once we
// have:
//   - our AvantLink affiliate/website ID
//   - Pure Hockey's merchant ID (connected to our account)
//   - the product datafeed URL + format (confirm against AvantLink's docs)
//
// Required secrets (set at approval):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//   AVANTLINK_FEED_URL   — the Pure Hockey datafeed endpoint
//
// Intended cadence once live: daily cron (prices/availability drift; stale
// prices violate AvantLink TOS). Run it through a scheduled trigger.
//
// Design notes:
//   - CURATED, not the full catalog: only import SKUs in our chosen collections
//     (beer-league-essentials, goalie-gear, new-skater, ...). Decide the
//     mapping when we see the real feed categories.
//   - Upsert on (source, external_id) so re-syncs update in place.
//   - Mark missing-from-feed rows is_active=false rather than deleting (keeps
//     analytics + avoids dead links resurrecting).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AVANTLINK_FEED_URL = Deno.env.get('AVANTLINK_FEED_URL');

serve(async () => {
  if (!AVANTLINK_FEED_URL) {
    return new Response(
      JSON.stringify({ skipped: 'AVANTLINK_FEED_URL not set — pending Pure Hockey affiliate approval' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // TODO (at approval): fetch + parse the Pure Hockey datafeed and map each
  // feed row to a products row. Field mapping below is illustrative — confirm
  // the real field names + the affiliate deep-link format from AvantLink.
  //
  //   const feed = await (await fetch(AVANTLINK_FEED_URL)).json(); // or CSV/XML
  //   const rows = feed
  //     .filter((item) => COLLECTION_FOR[item.category])      // curate
  //     .map((item) => ({
  //       source: 'pure_hockey',
  //       external_id: item.sku,
  //       name: item.name,
  //       description: item.description,
  //       brand: item.brand,
  //       category: item.category,
  //       collection: COLLECTION_FOR[item.category],
  //       image_url: item.image_url,
  //       price: item.sale_price ?? item.price,
  //       currency: 'USD',
  //       url: item.affiliate_deep_link,   // AvantLink-tracked link (our IDs)
  //       is_affiliate: true,
  //       is_active: true,
  //       synced_at: new Date().toISOString(),
  //     }));
  //   await svc.from('products').upsert(rows, { onConflict: 'source,external_id' });
  //   // then deactivate pure_hockey rows whose external_id wasn't in this feed

  return new Response(
    JSON.stringify({ ok: true, note: 'scaffold — feed fetch + mapping pending AvantLink approval' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
