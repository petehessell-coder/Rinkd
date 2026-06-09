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

// ---- sponsor categories (youth content rule) --------------------------------
export const AD_CATEGORIES = [
  'food', 'beverage', 'retail', 'automotive', 'financial', 'healthcare',
  'home_services', 'sports_fitness', 'real_estate', 'education', 'nonprofit', 'other',
  // restricted on youth events:
  'alcohol', 'sportsbook', 'tobacco_vape', 'cannabis', 'dating',
];
// Locked Jun 8 — blocked on feature_profile='youth_competitive' events.
export const YOUTH_BLOCKED_CATEGORIES = ['alcohol', 'sportsbook', 'tobacco_vape', 'cannabis', 'dating'];
export const isCategoryAllowedForYouth = (cat) => !YOUTH_BLOCKED_CATEGORIES.includes(cat);

// ---- admin CRUD (writes owner-gated by RLS: is_league_commissioner /
//      is_tournament_director / staff) ----------------------------------------

export async function listOwnerSponsors(ownerType, ownerId) {
  const { data, error } = await supabase
    .from('ad_creatives')
    .select('*, placements:ad_placements(*)')
    .eq('owner_type', ownerType).eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadCreativeImage(file, userId) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('ad-creatives')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) return { url: null, error };
  const { data } = supabase.storage.from('ad-creatives').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// Create a sponsor = one creative + one placement (the chosen slot). Phase 1 = event_banner.
export async function createSponsor({ ownerType, ownerId, sponsorName, imageUrl, linkUrl, category, slot = 'event_banner', weight = 1, startsAt = null, endsAt = null }) {
  const { data: creative, error } = await supabase.from('ad_creatives')
    .insert({ owner_type: ownerType, owner_id: ownerId, sponsor_name: sponsorName, image_url: imageUrl || null, link_url: linkUrl || null, category: category || null, moderation_status: 'approved' })
    .select().single();
  if (error) throw error;
  const { error: pErr } = await supabase.from('ad_placements')
    .insert({ creative_id: creative.id, slot, target_type: ownerType, target_id: ownerId, weight, starts_at: startsAt, ends_at: endsAt, is_active: true });
  if (pErr) { await supabase.from('ad_creatives').delete().eq('id', creative.id); throw pErr; }
  clearAdCache(ownerType, ownerId);
  return creative;
}

export async function updatePlacement(placementId, fields, ownerType, ownerId) {
  const { error } = await supabase.from('ad_placements').update(fields).eq('id', placementId);
  if (error) throw error;
  clearAdCache(ownerType, ownerId);
}

export async function deleteSponsor(creativeId, ownerType, ownerId) {
  const { error } = await supabase.from('ad_creatives').delete().eq('id', creativeId); // cascades placements
  if (error) throw error;
  clearAdCache(ownerType, ownerId);
}

export async function getAdReport(ownerType, ownerId, days = 30) {
  const { data, error } = await supabase.rpc('get_ad_report', { p_owner_type: ownerType, p_owner_id: ownerId, p_days: days });
  if (error) throw error;
  return data || [];
}
