/**
 * LiveBarn integration helpers.
 *
 * Until we close a real partnership with LiveBarn, every rink in our DB carries
 * a placeholder venue ID (the values we seeded for demo purposes plus a couple
 * of obvious test strings). Until that's swapped for the rink's actual
 * LiveBarn ID, the "Watch on LiveBarn" buttons would point at the wrong
 * arena's stream — so we hide them entirely and show a "coming soon" stub.
 *
 * Once the partnership lands and venue IDs get swapped via:
 *   UPDATE rinks SET live_barn_venue_id = '<real>' WHERE id = '<rink_uuid>';
 * the buttons re-enable automatically — no code change needed.
 */

// IDs we seeded for demo purposes. Anything in this list is treated as "not
// real" and the LiveBarn button is hidden. Real LiveBarn IDs are typically
// 4-5 digit numerics — anything that's clearly a test string is also hidden.
const PLACEHOLDER_IDS = new Set([
  '4182', '3047', '1023', '4188', '5219', '6234',
  // Test scaffolding
  'LK-RNK1',
]);

export function isPlaceholderLiveBarnId(venueId) {
  if (!venueId) return true;
  const trimmed = String(venueId).trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_IDS.has(trimmed)) return true;
  // Anything that's not numeric is suspicious — real LiveBarn IDs are digits.
  if (!/^\d+$/.test(trimmed)) return true;
  return false;
}

/**
 * Returns the LiveBarn watch URL for a venue, or null if the venue ID is a
 * placeholder. NOTE: the RINKD10 referrer code is intentionally kept here for
 * when the partnership closes — until then we won't generate the URL at all
 * for placeholder rinks, so the code is never exposed to a user as a misleading
 * affiliate hook.
 */
export function getLiveBarnUrl(venueId) {
  if (isPlaceholderLiveBarnId(venueId)) return null;
  return `https://watch.livebarn.com/en/videoplayer?venueid=${venueId}&referrer=rinkd&promo=RINKD10`;
}
