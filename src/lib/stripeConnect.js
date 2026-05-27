import { supabase } from './supabase';

// Stripe Connect (Express) for organizers. One connected account per profile
// (the founding commissioner / director), reused across all their events. Paid
// registrations route 99% of the entry fee to that account via a destination
// charge, with Rinkd's 1% application fee. See:
//   supabase/functions/stripe-connect   (onboarding)
//   supabase/functions/stripe-checkout  (the destination charge + 1%)
//   supabase/functions/stripe-webhook   (account.updated → charges_enabled)

/**
 * The current user's own Connect account status (RLS: owner reads own row).
 * Returns { charges_enabled, payouts_enabled, details_submitted } or null if
 * they've never started onboarding.
 */
export async function getMyConnectStatus() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('stripe_connect_accounts')
    .select('charges_enabled, payouts_enabled, details_submitted')
    .eq('owner_profile_id', user.id)
    .maybeSingle();
  return data ?? null;
}

/**
 * Can THIS league accept card payments? True iff its founding commissioner has a
 * Connect account with charges_enabled. Backed by the SECURITY DEFINER RPC so any
 * commissioner can check readiness without reading the account row.
 */
export async function leaguePayoutsReady(leagueId) {
  const { data, error } = await supabase.rpc('league_payouts_ready', { p_league_id: leagueId });
  if (error) return false;
  return data === true;
}

/** Can THIS tournament accept card payments directly? (founder/director connected) */
export async function tournamentPayoutsReady(tournamentId) {
  const { data, error } = await supabase.rpc('tournament_payouts_ready', { p_tournament_id: tournamentId });
  if (error) return false;
  return data === true;
}

/**
 * Start (or resume) Express onboarding for the current user and redirect the
 * browser to Stripe's hosted flow. `returnPath` is a same-origin path Stripe
 * sends them back to (e.g. `/league/:id/manage`).
 */
export async function startConnectOnboarding(returnPath) {
  const { data, error } = await supabase.functions.invoke('stripe-connect', {
    body: {
      appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
      returnPath,
    },
  });
  if (error) {
    let body = null;
    try { body = await error.context.json(); } catch { /* non-JSON body */ }
    throw new Error((body && body.error) || error.message || 'Could not start payout setup.');
  }
  if (data?.url && typeof window !== 'undefined') window.location.href = data.url;
  return data;
}
