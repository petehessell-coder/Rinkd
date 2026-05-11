import { supabase } from './supabase';

/**
 * Crease = the premium content layer. Free episodes are gated only by login;
 * premium episodes require has_crease_access() to return true (either the
 * profiles.is_premium flag or an active crease_subscriptions row).
 */

export async function listShows() {
  const { data, error } = await supabase
    .from('crease_shows')
    .select('*')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function getShowBySlug(slug) {
  const { data, error } = await supabase
    .from('crease_shows')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  return { data, error };
}

export async function listEpisodes(showId) {
  const { data, error } = await supabase
    .from('crease_episodes')
    .select('*')
    .eq('show_id', showId)
    .eq('is_published', true)
    .order('episode_number', { ascending: true });
  return { data: data || [], error };
}

export async function getEpisode(showId, episodeNumber) {
  const { data, error } = await supabase
    .from('crease_episodes')
    .select('*')
    .eq('show_id', showId)
    .eq('episode_number', episodeNumber)
    .eq('is_published', true)
    .maybeSingle();
  return { data, error };
}

/**
 * Cheap client-side check off the profile + subscriptions table. Server-side
 * we also have the SQL function has_crease_access(user_id) for trusted
 * gating (use it in any future signed-URL Edge Function).
 */
export async function hasCreaseAccess(userId) {
  if (!userId) return false;
  const { data: profile } = await supabase
    .from('profiles').select('is_premium, premium_until').eq('id', userId).maybeSingle();
  if (profile?.is_premium) return true;
  if (profile?.premium_until && new Date(profile.premium_until) > new Date()) return true;

  const { data: sub } = await supabase
    .from('crease_subscriptions')
    .select('status, current_period_end')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return false;
  if (!sub.current_period_end) return true;
  return new Date(sub.current_period_end) > new Date();
}

export function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
