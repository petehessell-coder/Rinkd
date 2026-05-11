/**
 * Builds the right maps deep link for the current device.
 *
 *   iOS    → maps:?q=...    (opens Apple Maps natively; fallback to web if not present)
 *   Android → geo:0,0?q=... (opens default maps app; Google Maps wins on most devices)
 *   Desktop → https://google.com/maps/search/?api=1&query=...
 *
 * Pass either a structured rink ({ address, name, maps_url }) or a free-form
 * location string. Prefers an explicit `maps_url` if the rink record has one
 * (e.g. an apartment-style address that needs a verified place ID).
 */

function isIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIPadOS = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
  return isDevice || isIPadOS;
}

function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent || '');
}

/** Pull the most useful query string out of a rink or plain text. */
export function rinkToQuery(rinkOrText) {
  if (!rinkOrText) return '';
  if (typeof rinkOrText === 'string') return rinkOrText.trim();
  const { address, name, sub_rink } = rinkOrText;
  if (address && address.trim()) return address.trim();
  const namePart = [sub_rink, name].filter(Boolean).join(' ');
  return namePart.trim();
}

/**
 * Build the deep-link URL. Returns null if there's nothing useful to link to.
 */
export function buildMapsUrl(rinkOrText) {
  if (rinkOrText && typeof rinkOrText !== 'string' && rinkOrText.maps_url) {
    return rinkOrText.maps_url;
  }
  const q = rinkToQuery(rinkOrText);
  if (!q) return null;
  const encoded = encodeURIComponent(q);
  if (isIos())     return `maps://?q=${encoded}`;
  if (isAndroid()) return `geo:0,0?q=${encoded}`;
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

/** Imperative form for buttons. */
export function openMaps(rinkOrText) {
  const url = buildMapsUrl(rinkOrText);
  if (!url) return false;
  if (isIos() || isAndroid()) {
    // Native scheme — let the OS pick the handler. window.location replaces the
    // current tab on a non-native scheme (safe — it'll either open the app or do nothing).
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener');
  }
  return true;
}
