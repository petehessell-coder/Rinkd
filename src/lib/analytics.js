import { supabase } from './supabase';

/**
 * Lightweight self-hosted analytics. Events go to public.analytics_events.
 * Reads are restricted to commissioners via RLS; writes are open (we accept
 * some abuse risk in exchange for not losing pre-auth events like signup_view).
 *
 * Usage:
 *   import { track } from '../lib/analytics';
 *   track('post_created', { post_id, has_media: true });
 *
 * Properties stay small JSON. Never put PII or message bodies in here.
 */

const SESSION_KEY = 'rinkd_anon_session_v1';

function sessionId() {
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

async function currentUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch { return null; }
}

/**
 * Fire-and-forget event tracker. Never blocks the UI. Failures are swallowed
 * so a 4xx from Supabase doesn't surface as a user-visible error.
 */
export async function track(event, properties = {}) {
  if (typeof window === 'undefined') return;
  // Don't track on localhost so dev work doesn't pollute prod data.
  if (window.location?.hostname === 'localhost') return;

  try {
    const user_id = await currentUserId();
    await supabase.from('analytics_events').insert({
      event,
      user_id,
      session_id: sessionId(),
      url: window.location?.pathname + (window.location?.search || ''),
      referrer: document.referrer || null,
      user_agent: navigator.userAgent || null,
      properties,
    });
  } catch { /* silent */ }
}

/** Pageview helper. Call from any route on mount. */
export function trackPage(name, properties = {}) {
  return track('page_view', { page: name, ...properties });
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
