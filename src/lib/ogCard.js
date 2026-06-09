// GROWTH-SHARE-1 · M4 — persist the share-card so a pasted link unfurls it.
//
// On an AUTHENTICATED share we compose the wide (OG) format and upload it to the
// public `share-cards` bucket at <g|lg>/<gameId>.png. The edge middleware points
// og:image at that object if it exists, else the generic fallback. Best-effort
// and fire-and-forget — it must NEVER affect the share UX. Anonymous sharers
// can't write (storage RLS), so their OG just falls back until someone signed-in
// shares the same game.

import { supabase } from './supabase';
import { composeRecapCard } from './shareCard';

export function shareCardPath(gameId, isLeague) {
  return `${isLeague ? 'lg' : 'g'}/${gameId}.png`;
}

export async function uploadShareCard(gameId, isLeague, card) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // anon → no write; OG falls back to the generic card
    const wide = await composeRecapCard(card, { format: 'wide' });
    await supabase.storage.from('share-cards').upload(
      shareCardPath(gameId, isLeague),
      wide,
      { upsert: true, contentType: 'image/png', cacheControl: '3600' },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ogCard] share-card upload skipped:', e?.message || e);
  }
}
