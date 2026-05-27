import { supabase } from './supabase';
import { addLeagueTeam } from './leagues';

// Nameplate initials from a team name (mirrors the stripe-webhook fallback so a
// team created on payment and one created on manual approve look identical).
function initials(teamName) {
  const words = (teamName || '').split(/\s+/).filter(Boolean);
  const ini = words.slice(0, 2).map(w => w[0]).join('') || (teamName || '').slice(0, 2);
  return ini.toUpperCase().slice(0, 3);
}

/**
 * PUBLIC: submit a league registration. Calls the `stripe-checkout` Edge Function,
 * which (service role) validates the league is open + within deadline + under
 * capacity, inserts the pending registration, and — for a paid league — creates a
 * Stripe Checkout session.
 *
 * Returns one of:
 *   { url }         paid league → caller should redirect the browser to this URL
 *   { free: true }  free league (fee = 0) → no payment; caller shows confirmation
 *
 * Throws an Error with `.reason` ('closed' | 'deadline_passed' | 'full' | …) on a
 * server-side rejection so the page can show a friendly closed/full message.
 */
export async function createRegistrationCheckout(parentId, { teamName, contactName, contactEmail }, kind = 'league') {
  const body = {
    kind,
    teamName,
    contactName,
    contactEmail,
    appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
  };
  if (kind === 'tournament') body.tournamentId = parentId; else body.leagueId = parentId;
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body });

  if (error) {
    // Non-2xx from the function arrives as a FunctionsHttpError whose `context`
    // is the raw Response — pull our { error, reason } body out of it.
    let body = null;
    try { body = await error.context.json(); } catch { /* non-JSON body */ }
    const e = new Error((body && (body.error || body.reason)) || error.message || 'Could not start registration.');
    e.reason = body?.reason || null;
    throw e;
  }
  return data; // { url } | { free: true, registrationId }
}

/**
 * Commissioner-only (RLS): all registrations for a league, newest first.
 * A non-commissioner gets an empty list (RLS filters every row).
 */
export async function getLeagueRegistrations(leagueId) {
  const { data, error } = await supabase
    .from('league_registrations')
    .select('*')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Commissioner-only (RLS): set a registration's status. */
export async function updateRegistrationStatus(registrationId, status) {
  const { data, error } = await supabase
    .from('league_registrations')
    .update({ status })
    .eq('id', registrationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Approve a registration: create the league team (exactly once) + mark approved.
 *
 * Idempotent via `league_team_id`: if a team was already created for this
 * registration — by the Stripe webhook on payment, or by a prior approve click —
 * we skip the insert and just confirm the status. This is the manual counterpart
 * to the webhook's auto-approve; a free-league registration has no webhook, so the
 * commissioner approves here.
 */
export async function approveRegistration(registrationId) {
  const { data: reg, error } = await supabase
    .from('league_registrations')
    .select('id, league_id, team_name, league_team_id')
    .eq('id', registrationId)
    .single();
  if (error) throw error;

  if (reg.league_team_id) {
    return updateRegistrationStatus(registrationId, 'approved');
  }

  const lt = await addLeagueTeam(reg.league_id, {
    teamName: reg.team_name,
    logoColor: '#2E5B8C',
    logoInitials: initials(reg.team_name),
  });

  const { data, error: upErr } = await supabase
    .from('league_registrations')
    .update({ status: 'approved', league_team_id: lt.id })
    .eq('id', registrationId)
    .select()
    .single();
  if (upErr) throw upErr;
  return data;
}

// ── Tournament registrations (mirror of the league functions above; same Stripe
// checkout + webhook back them, branched by `kind`). ───────────────────────────

/** Director-only (RLS): all registrations for a tournament, newest first. */
export async function getTournamentRegistrations(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_registrations')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Director-only (RLS): set a tournament registration's status. */
export async function updateTournamentRegistrationStatus(registrationId, status) {
  const { data, error } = await supabase
    .from('tournament_registrations')
    .update({ status })
    .eq('id', registrationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Approve a tournament registration: create the tournament_teams row (exactly
 * once, idempotent via tournament_team_id) + mark approved. Manual counterpart to
 * the webhook's auto-approve (free tournaments have no webhook). Matches the
 * webhook's team shape so a paid team and a manually-approved one look identical.
 */
export async function approveTournamentRegistration(registrationId) {
  const { data: reg, error } = await supabase
    .from('tournament_registrations')
    .select('id, tournament_id, team_name, contact_email, tournament_team_id')
    .eq('id', registrationId)
    .single();
  if (error) throw error;

  if (reg.tournament_team_id) {
    return updateTournamentRegistrationStatus(registrationId, 'approved');
  }

  const { data: team, error: tErr } = await supabase
    .from('tournament_teams')
    .insert({ tournament_id: reg.tournament_id, team_name: reg.team_name, contact_email: reg.contact_email || null })
    .select('id')
    .single();
  if (tErr) throw tErr;

  const { data, error: upErr } = await supabase
    .from('tournament_registrations')
    .update({ status: 'approved', tournament_team_id: team.id })
    .eq('id', registrationId)
    .select()
    .single();
  if (upErr) throw upErr;
  return data;
}
