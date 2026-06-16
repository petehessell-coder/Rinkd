import { supabase } from './supabase';

/**
 * INTEGRATIONS-1 — reusable data-sync authorization (clickwrap) helpers.
 *
 * Any external-data integration that needs the operator to attest they have the
 * right to share their data (HockeyShift today; reusable for GameSheet or any
 * future provider) records one row per (owner, integration) here. The UI lives
 * in the shared <DataSyncAuthorization> component.
 *
 * owner: { type: 'league' | 'tournament', id }
 * integration: 'hockeyshift' | 'gamesheet' | ...
 */

// Latest non-revoked authorization for an owner+integration, or null.
export async function getIntegrationAuthorization(ownerType, ownerId, integration) {
  const { data, error } = await supabase
    .from('integration_authorizations')
    .select('id, statement, version, authorized_by, authorized_at, revoked_at')
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('integration', integration)
    .is('revoked_at', null)
    .order('authorized_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data || null, error };
}

// Record a fresh authorization. Stamps the acting user (RLS also enforces
// authorized_by = auth.uid()). `statement` is the exact text the user agreed to;
// `version` lets a later wording change stay auditable.
export async function recordIntegrationAuthorization({ ownerType, ownerId, integration, statement, version = 'v1' }) {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return { data: null, error: { message: 'You must be signed in to authorize a data sync.' } };
  const { data, error } = await supabase
    .from('integration_authorizations')
    .insert({
      owner_type: ownerType,
      owner_id: ownerId,
      integration,
      statement,
      version,
      authorized_by: uid,
    })
    .select('id, statement, version, authorized_by, authorized_at, revoked_at')
    .single();
  return { data, error };
}

// Soft-revoke the active authorization (audit row stays; revoked_at set).
export async function revokeIntegrationAuthorization(id) {
  const { error } = await supabase
    .from('integration_authorizations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  return { error };
}
