#!/usr/bin/env node
/**
 * seed-rinks-osm.mjs — populate the `rinks` table from OpenStreetMap.
 *
 * Pulls every named ICE rink in the US + Canada from OpenStreetMap (Overpass
 * API, leisure=ice_rink) and UPSERTs them into Rinkd's `rinks` table, keyed on
 * `osm_id` so it's idempotent — re-run any time to refresh, no duplicates.
 *
 * Data © OpenStreetMap contributors, ODbL (free + redistributable with
 * attribution). Zero cost.
 *
 * RUN (from the repo root, where node_modules + @supabase/supabase-js live):
 *   export SUPABASE_URL="https://tbpoopsyhfuqcbugrjbh.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service role key from Supabase dashboard → Settings → API>"
 *   node scripts/seed-rinks-osm.mjs
 *
 * Needs Node 18+ (global fetch). Takes a few minutes (it's polite to the free
 * Overpass server — ~1.5s between regions). Safe to Ctrl-C and re-run.
 *
 * NOTE: the SERVICE ROLE key bypasses RLS — keep it out of the browser/app;
 * this is a local admin script only.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first. See the header of this file.');
  process.exit(1);
}
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Overpass mirrors — we rotate if one 406/429/5xx's. A descriptive User-Agent
// is REQUIRED (bare automation requests get a 406 from the main instance).
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'Rinkd-rink-seed/1.0 (+https://rinkd.app; contact pete@rinkd.app)';

// ISO 3166-2 regions: 50 US states + DC + 13 Canadian provinces/territories.
const REGIONS = [
  'US-AL','US-AK','US-AZ','US-AR','US-CA','US-CO','US-CT','US-DE','US-DC','US-FL',
  'US-GA','US-HI','US-ID','US-IL','US-IN','US-IA','US-KS','US-KY','US-LA','US-ME',
  'US-MD','US-MA','US-MI','US-MN','US-MS','US-MO','US-MT','US-NE','US-NV','US-NH',
  'US-NJ','US-NM','US-NY','US-NC','US-ND','US-OH','US-OK','US-OR','US-PA','US-RI',
  'US-SC','US-SD','US-TN','US-TX','US-UT','US-VT','US-VA','US-WA','US-WV','US-WI','US-WY',
  'CA-AB','CA-BC','CA-MB','CA-NB','CA-NL','CA-NS','CA-NT','CA-NU','CA-ON','CA-PE','CA-QC','CA-SK','CA-YT',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function queryFor(iso) {
  return `[out:json][timeout:120];area["ISO3166-2"="${iso}"]->.a;nwr["leisure"="ice_rink"](area.a);out center tags;`;
}

function addressFrom(t) {
  const parts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    t['addr:city'], t['addr:state'], t['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function toRink(el) {
  const t = el.tags || {};
  const name = (t.name || t['name:en'] || '').trim();
  if (!name) return null; // unnamed rinks aren't useful for matching
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    sub_rink: null,
    address: addressFrom(t),
    maps_url: (lat != null && lon != null) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : null,
    category: 'ice',
  };
}

async function fetchRegion(iso) {
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000); // hard 45s cap — never hang on a slow mirror
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,           // required — bare requests get a 406
          'Accept': '*/*',            // [out:json] in the query controls the format
        },
        body: 'data=' + encodeURIComponent(queryFor(iso)),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 504) { await sleep(3000); throw new Error(`busy ${res.status}`); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.elements || []).map(toRink).filter(Boolean);
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('timed out (45s)') : e;
      // try the next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`all Overpass mirrors failed (${lastErr?.message || 'unknown'})`);
}

async function upsert(rows) {
  // de-dupe within the batch by osm_id (Overpass can repeat across queries)
  const seen = new Map();
  for (const r of rows) seen.set(r.osm_id, r);
  const unique = [...seen.values()];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { error } = await supa.from('rinks').upsert(chunk, { onConflict: 'osm_id' });
    if (error) throw error;
  }
  return unique.length;
}

(async () => {
  console.log(`Seeding ice rinks from OpenStreetMap across ${REGIONS.length} regions…\n`);
  let grandTotal = 0;
  for (const iso of REGIONS) {
    try {
      const rinks = await fetchRegion(iso);
      const n = await upsert(rinks);
      grandTotal += n;
      console.log(`  ${iso}: ${String(n).padStart(4)} rinks  (running total ${grandTotal})`);
    } catch (e) {
      console.warn(`  ${iso}: ⚠ ${e.message} — skipped, re-run later`);
    }
    await sleep(1500); // be polite to the free Overpass server
  }
  const { count } = await supa.from('rinks').select('*', { count: 'exact', head: true });
  console.log(`\n✅ Done. rinks table now holds ${count} rows.`);
  process.exit(0);
})();
