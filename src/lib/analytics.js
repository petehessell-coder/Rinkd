import { supabase } from './supabase';

/**
 * Lightweight self-hosted analytics. Events go to public.analytics_events.
 * Reads are restricted to commissioners via RLS; writes require user_id to
 * match auth.uid() or be null (RLS enforces — see migration
 * surfaces_11_17_rls_volunteer_slots_and_analytics_events).
 *
 * Usage:
 *   import { track } from '../lib/analytics';
 *   track('post_created', { post_id, has_media: true });
 *
 * Properties stay small JSON. Never put PII or message bodies in here.
 */

const SESSION_KEY = 'rinkd_anon_session_v1';

// Crawlers, link-unfurlers, headless browsers, and uptime/SEO bots inflate the
// top of the funnel (auth_view / landing_view) but never convert — they made
// ~7% of sessions in our pre-pilot sample and skew every conversion rate. Drop
// their events at write time so analytics_events stays a clean human-funnel.
// Conservative list: only well-known non-human agents, to avoid false positives
// on real mobile/desktop browsers.
const BOT_UA = /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|slackbot|telegrambot|whatsapp|vkshare|w3c_validator|headlesschrome|phantomjs|lighthouse|gtmetrix|pingdom|uptimerobot|datadog|statuscake|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|python-requests|axios\/|node-fetch|okhttp|java\/|curl\/|wget\//i;

export function isLikelyBot() {
  if (typeof navigator === 'undefined') return false;
  try {
    if (navigator.webdriver) return true; // automated browser (Selenium/Playwright/etc.)
    return BOT_UA.test(navigator.userAgent || '');
  } catch { return false; }
}

export function sessionId() {
  if (typeof window === 'undefined') return null;
  try {
    let s = localStorage.getItem(SESSION_KEY);
    if (!s) {
      s = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch { return null; }
}

// Module-level cache of the current user_id, kept in sync with Supabase auth
// state. `track()` used to call `supabase.auth.getUser()` on every event,
// which adds locking + JSON-parse overhead even though the session itself is
// in localStorage. With dozens of events per page (clicks, hovers, scroll
// markers), that adds up. We resolve once on module load + listen for changes.
let cachedUserId = null;
let userIdResolved = false;
let userIdResolving = null;

function resolveCachedUserId() {
  if (userIdResolved) return Promise.resolve(cachedUserId);
  if (userIdResolving) return userIdResolving;
  userIdResolving = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      cachedUserId = data?.session?.user?.id ?? null;
    } catch {
      cachedUserId = null;
    }
    userIdResolved = true;
    userIdResolving = null;
    return cachedUserId;
  })();
  return userIdResolving;
}

// Refresh the cached user_id on auth state changes so a sign-in/sign-out is
// reflected in subsequent events without another getSession() round-trip.
if (typeof window !== 'undefined' && supabase?.auth) {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      cachedUserId = session?.user?.id ?? null;
      userIdResolved = true;
    });
  } catch { /* swallow — analytics must never crash boot */ }
}

/**
 * Fire-and-forget event tracker. Never blocks the UI. Failures are swallowed
 * so a 4xx from Supabase doesn't surface as a user-visible error.
 */
export async function track(event, properties = {}, urlOverride) {
  if (typeof window === 'undefined') return;
  // Don't track on localhost so dev work doesn't pollute prod data.
  if (window.location?.hostname === 'localhost') return;
  // Drop bot/crawler/headless traffic so it doesn't skew the conversion funnel.
  if (isLikelyBot()) return;

  try {
    const user_id = await resolveCachedUserId();
    await supabase.from('analytics_events').insert({
      event,
      user_id,
      session_id: sessionId(),
      // urlOverride lets pageviews record the bare pathname (no query string)
      // so single-use tokens in `?...` (invite / reset links) never land here.
      url: urlOverride != null ? urlOverride : window.location?.pathname + (window.location?.search || ''),
      referrer: document.referrer || null,
      user_agent: navigator.userAgent || null,
      properties,
    });
  } catch { /* silent */ }
}

/**
 * Pageview helper — fired on every route change by <RouteAnalytics/>. Records
 * the bare pathname (query string stripped) so per-session navigation paths can
 * be reconstructed (ORDER BY created_at within a session_id) without capturing
 * tokens/PII. Pass an explicit path; falls back to the current pathname.
 */
export function trackPage(path, properties = {}) {
  const p = path
    || (typeof window !== 'undefined' ? window.location?.pathname : null)
    || '/';
  return track('page_view', { page: p, ...properties }, p);
}

/** Bulk-load helper for the admin dashboard. */
export async function loadDailyRollup(days = 30) {
  const { data } = await supabase
    .from('analytics_daily')
    .select('*')
    .gte('day', new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10))
    .order('day', { ascending: false });
  return data || [];
}

export async function loadDAU(days = 30) {
  const { data } = await supabase
    .from('analytics_dau')
    .select('*')
    .gte('day', new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10));
  return data || [];
}

export async function loadRecentEvents(limit = 100) {
  const { data } = await supabase
    .from('analytics_events')
    .select('id, event, user_id, url, properties, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Top viewed pages over the last 30d (page_view events grouped by path).
 * Backed by the security_invoker view analytics_top_pages, so RLS still scopes
 * reads to commissioners/admins. Each row: { page, views, sessions, users }.
 */
export async function loadTopPages(limit = 40) {
  const { data } = await supabase
    .from('analytics_top_pages')
    .select('*')
    .limit(limit);
  return data || [];
}

// GROWTH-SHARE-1 P2 — the share → visit → install funnel. Counts the three
// events over `days` plus a per-card-type share breakdown. Head-count queries
// (no rows fetched). share_recap fires on every Share (recap/gamepuck/photo);
// public_game_viewed on a login-less /g|/lg open; pwa_installed on appinstalled.
export async function loadGrowthFunnel(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const count = (build) => build(
    supabase.from('analytics_events').select('id', { count: 'exact', head: true }).gte('created_at', since)
  ).then((r) => r.count || 0);
  const [shares, visits, installs, recap, gamepuck, photo] = await Promise.all([
    count((q) => q.eq('event', 'share_recap')),
    count((q) => q.eq('event', 'public_game_viewed')),
    count((q) => q.eq('event', 'pwa_installed')),
    count((q) => q.eq('event', 'share_recap').eq('properties->>card_type', 'recap')),
    count((q) => q.eq('event', 'share_recap').eq('properties->>card_type', 'gamepuck')),
    count((q) => q.eq('event', 'share_recap').eq('properties->>card_type', 'photo')),
  ]);
  return { shares, visits, installs, byType: { recap, gamepuck, photo } };
}
