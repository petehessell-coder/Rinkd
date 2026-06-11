import { supabase } from './supabase';

// REG-3 — individual (player) registration data access.
// Money writes happen ONLY in the register-player edge fn / stripe-webhook;
// this lib reads the spine and starts checkout.

const PROFILE_COLS = 'id, name, handle, avatar_color, avatar_initials, avatar_url, account_type';

// Event context for the public register-player page (anon-readable columns).
export async function getPlayerRegContext(kind, targetId) {
  const table = kind === 'tournament' ? 'tournaments' : 'leagues';
  const [{ data: event, error }, { data: waiver }] = await Promise.all([
    supabase.from(table)
      .select('id, name, player_fee_cents, player_registration_open')
      .eq('id', targetId).maybeSingle(),
    supabase.from('waiver_templates')
      .select('id, title, body_md, required, version')
      .eq('owner_type', kind).eq('owner_id', targetId).maybeSingle(),
  ]);
  if (error) throw error;
  return { event, waiver };
}

// Starts checkout (or completes a free registration) via the edge fn.
// Returns { url } (redirect to Stripe) or { free: true, registrationId }.
export async function startPlayerRegistration({ kind, targetId, profileId, waiverAccepted }) {
  const { data, error } = await supabase.functions.invoke('register-player', {
    body: { kind, targetId, profileId, waiverAccepted, appUrl: window.location.origin },
  });
  if (error) {
    // functions.invoke buries the response body on non-2xx — surface it.
    let msg = error.message || 'Registration failed.';
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
      if (ctx?.reason) return Promise.reject(Object.assign(new Error(msg), { reason: ctx.reason }));
    } catch (_) {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// My family's registrations (parent view): spine rows for people I can see,
// payment state embedded. RLS scopes this to involved rows.
export async function getMyFamilyRegistrations() {
  const { data, error } = await supabase
    .from('registrations')
    .select(`id, registrant_type, registrant_id, target_type, target_id, status, amount_cents, created_at,
             registrant:profiles!registrations_registrant_id_fkey(${PROFILE_COLS}),
             plan:payment_plans(id, total_cents, status,
               installments:payment_installments(id, amount_cents, status, due_date, paid_at))`)
    .eq('registrant_type', 'profile')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Org view: player registrations for an event (commissioner/director only via RLS).
export async function getEventPlayerRegistrations(kind, targetId) {
  const { data, error } = await supabase
    .from('registrations')
    .select(`id, registrant_id, status, amount_cents, created_at, rostered_team_id, rostered_at,
             registrant:profiles!registrations_registrant_id_fkey(${PROFILE_COLS}),
             plan:payment_plans(total_cents, status,
               installments:payment_installments(status, paid_at)),
             waivers:waiver_acceptances(id, accepted_at, accepted_by)`)
    .eq('registrant_type', 'profile')
    .eq('target_type', kind)
    .eq('target_id', targetId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Org: assign a paid registrant to a league roster (consented path, league-only v1).
export async function assignRegistrantToTeam(registrationId, teamId) {
  const { error } = await supabase.rpc('assign_registrant_to_team', {
    p_registration_id: registrationId, p_team_id: teamId,
  });
  if (error) throw error;
}

// Org: waiver template upsert (one per event in v1; RLS gates to the organizer).
export async function saveWaiverTemplate(kind, targetId, { title, body_md, required }) {
  const { data: existing } = await supabase
    .from('waiver_templates').select('id, version')
    .eq('owner_type', kind).eq('owner_id', targetId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('waiver_templates')
      .update({ title, body_md, required, version: (existing.version || 1) + 1 })
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase.from('waiver_templates')
    .insert({ owner_type: kind, owner_id: targetId, title, body_md, required })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

export function regPaymentState(reg) {
  const inst = reg?.plan?.installments?.[0];
  if (!reg) return 'unknown';
  if ((reg.amount_cents || 0) === 0) return reg.status === 'active' ? 'free' : reg.status;
  if (inst?.status === 'paid') return 'paid';
  if (reg.status === 'pending') return 'unpaid';
  return reg.status;
}
