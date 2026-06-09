// ADS-1 · M1 — serving: fetch active placements for a page (cached) + weighted
// pick. Zero third-party script; just a cached-config read of our own tables.

import { supabase } from './supabase';

const CACHE = new Map(); // "type:id" -> { at, placements }
const TTL = 5 * 60 * 1000; // placements rarely change; don't refetch on tab switches

// All renderable placements for a page (every slot). RLS already restricts anon
// to approved+active+in-window, but we filter client-side too so an OWNER viewing
// their OWN public page never sees their draft/expired ads.
export async function getActivePlacements({ targetType, targetId }) {
  if (!targetType || !targetId) return [];
  const key = `${targetType}:${targetId}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.placements;

  const { data, error } = await supabase
    .from('ad_placements')
    .select('id, slot, weight, starts_at, ends_at, is_active, creative:ad_creatives(id, sponsor_name, image_url, link_url, moderation_status)')
    .eq('target_type', targetType)
    .eq('target_id', targetId);
  if (error) return hit?.placements || [];

  const now = Date.now();
  const placements = (data || []).filter((p) =>
    p.is_active && p.creative && p.creative.moderation_status === 'approved'
    && (!p.starts_at || new Date(p.starts_at).getTime() <= now)
    && (!p.ends_at || new Date(p.ends_at).getTime() >= now));
  CACHE.set(key, { at: Date.now(), placements });
  return placements;
}

// Weighted-random pick from one slot's placements (or null). Stable by design:
// the caller picks once on mount so it doesn't flip on re-render.
export function pickByWeight(list) {
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  const w = (p) => Math.max(1, p.weight || 1);
  const total = list.reduce((s, p) => s + w(p), 0);
  let r = Math.random() * total;
  for (const p of list) { r -= w(p); if (r <= 0) return p; }
  return list[list.length - 1];
}

// Call after an admin edits placements so the next page view re-fetches.
export function clearAdCache(targetType, targetId) {
  if (targetType && targetId) CACHE.delete(`${targetType}:${targetId}`);
  else CACHE.clear();
}
