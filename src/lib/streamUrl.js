// Helpers for the per-game stream URL (YouTube, Twitch, Facebook Live, etc.).
//
// KOHA streams live on YouTube, not LiveBarn — generic enough to cover
// other platforms a future commissioner might use without a schema change.
// The column on league_games + rinks is plain text; this lib does the
// "what platform is this?" detection so the UI can label the button
// correctly.

/**
 * Detect the streaming platform from a raw URL.
 * Returns one of: 'youtube' | 'twitch' | 'facebook' | 'vimeo' | 'other' | null
 * (null when the URL is missing or empty).
 */
export function detectStreamPlatform(url) {
  const s = (url || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('youtube.com') || s.includes('youtu.be')) return 'youtube';
  if (s.includes('twitch.tv')) return 'twitch';
  if (s.includes('facebook.com') || s.includes('fb.watch')) return 'facebook';
  if (s.includes('vimeo.com')) return 'vimeo';
  return 'other';
}

const LABELS = {
  youtube:  'Watch on YouTube',
  twitch:   'Watch on Twitch',
  facebook: 'Watch on Facebook',
  vimeo:    'Watch on Vimeo',
  other:    'Watch live',
};

/** Button copy for the detected platform. */
export function streamButtonLabel(url) {
  const p = detectStreamPlatform(url);
  return p ? LABELS[p] : null;
}

/** Resolve the effective stream URL for a game, preferring per-game over rink default. */
export function resolveStreamUrl(game) {
  const direct = (game?.youtube_url || '').trim();
  if (direct) return direct;
  const inherited = (game?.rink?.youtube_url || '').trim();
  return inherited || null;
}

/**
 * Quick sanity check before storing. Returns the URL trimmed + with a
 * scheme prepended if missing. Doesn't validate against a regex —
 * commissioners paste from a wide variety of platforms and we'd rather
 * accept "youtube.com/@KOHA/live" than reject because the protocol is
 * absent.
 */
export function normalizeStreamUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return `https://${s}`;
}
