// ADS-1 · M1 — the impression/tap beacon. BATCHED (Infra guardrail #1): events
// buffer and flush in ONE record_ad_events RPC — never one request per render.
// Bot-filtered + localhost-skipped so dev + crawlers don't pollute the counts.

import { supabase } from './supabase';
import { isLikelyBot, sessionId } from './analytics';

const MAX_BUFFER = 20;
const FLUSH_MS = 10000;
const queue = [];
let timer = null;

function trackingActive() {
  if (typeof window === 'undefined') return false;
  if (window.location?.hostname === 'localhost') return false; // never pollute prod from dev
  if (isLikelyBot()) return false;
  return true;
}

function queueEvent(placementId, kind) {
  if (!placementId || !trackingActive()) return;
  queue.push({ placement_id: placementId, kind, session_id: sessionId() });
  if (queue.length >= MAX_BUFFER) flushAdEvents();
  else if (!timer) timer = setTimeout(flushAdEvents, FLUSH_MS);
}

export const adImpression = (placementId) => queueEvent(placementId, 'impression');
export const adTap = (placementId) => queueEvent(placementId, 'tap');

export async function flushAdEvents() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const batch = queue.splice(0, 200);
  try { await supabase.rpc('record_ad_events', { p_events: batch }); }
  catch { /* best-effort — drop on failure, never surface to the user */ }
}

// Flush the last buffer on tab-hide / unload so trailing impressions aren't lost.
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAdEvents();
  });
  window.addEventListener('pagehide', flushAdEvents);
}
