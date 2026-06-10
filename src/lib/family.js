import { supabase } from './supabase';

// REG-2 — family / household data access. Thin wrappers over the Phase-1
// consent RPCs (all SECURITY DEFINER; they enforce the locked consent model —
// the client never writes household_members / guardianship_claims directly).
//
// PostgREST embed discipline (see memory: postgrest_embed_ambiguity): these
// tables carry >1 FK to profiles, so every profile embed MUST be FK-qualified.

const PROFILE_COLS = 'id, name, handle, avatar_color, avatar_initials, avatar_url, account_type, date_of_birth';

// ── Reads ───────────────────────────────────────────────────────────────────

// Everything the switcher + /family screen need, in three round-trips.
// Returns { households, members, managed, coGuardians } where:
//   members      — all active members of every household I belong to (profile embedded)
//   managed      — login-less people (minor / managed_adult) in households I GUARD (the actable set)
//   coGuardians  — other guardians sharing a household with me
export async function getFamily(myProfileId) {
  if (!myProfileId) return { households: [], members: [], managed: [], coGuardians: [] };

  const { data: myMemberships, error: e1 } = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('profile_id', myProfileId)
    .eq('status', 'active');
  if (e1) throw e1;
  if (!myMemberships || myMemberships.length === 0) {
    return { households: [], members: [], managed: [], coGuardians: [] };
  }

  const householdIds = myMemberships.map(m => m.household_id);
  const guardianHouseholds = new Set(
    myMemberships.filter(m => m.role === 'guardian').map(m => m.household_id)
  );

  const [{ data: households, error: e2 }, { data: members, error: e3 }] = await Promise.all([
    supabase.from('households').select('id, name, created_by, created_at').in('id', householdIds),
    supabase
      .from('household_members')
      .select(`id, household_id, profile_id, role, status, created_at,
               profile:profiles!household_members_profile_id_fkey(${PROFILE_COLS})`)
      .in('household_id', householdIds)
      .eq('status', 'active'),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const all = members || [];
  const managed = all.filter(m =>
    guardianHouseholds.has(m.household_id) &&
    m.profile_id !== myProfileId &&
    ['minor', 'managed_adult'].includes(m.profile?.account_type)
  );
  const coGuardians = all.filter(m => m.role === 'guardian' && m.profile_id !== myProfileId);

  return { households: households || [], members: all, managed, coGuardians };
}

// Claims I'm party to: ones I can decide (as guardian / rostering org admin) +
// ones I filed. RLS (guardianship_claims_involved_read) already scopes this.
export async function getClaims() {
  const { data, error } = await supabase
    .from('guardianship_claims')
    .select(`id, status, note, requested_at, minor_profile_id, claimant_profile_id, household_id,
             minor:profiles!guardianship_claims_minor_profile_id_fkey(${PROFILE_COLS}),
             claimant:profiles!guardianship_claims_claimant_profile_id_fkey(${PROFILE_COLS})`)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// A person's teams + their upcoming games (for the PersonCard / acting-as view).
export async function getPersonTeams(profileId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, jersey_number, role, team:teams(id, name, logo_color, logo_initials)')
    .eq('user_id', profileId)
    .in('status', ['active', 'pending']);
  if (error) throw error;
  return data || [];
}

export async function getPersonUpcomingGames(teamIds, limit = 6) {
  if (!teamIds || teamIds.length === 0) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('team_games')
    .select('*')
    .in('team_id', teamIds)
    .gte('start_time', nowIso)
    .order('start_time', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ── Writes (consent RPCs) ─────────────────────────────────────────────────────

export async function createHousehold(name) {
  const { data, error } = await supabase.rpc('create_household', { p_name: name || null });
  if (error) throw error;
  return data; // household id
}

// Returns { profileId, claimId, outcome } where outcome is 'created' | 'claim_requested'.
export async function createManagedProfile(householdId, name, dateOfBirth, accountType = 'minor') {
  const { data, error } = await supabase.rpc('create_managed_profile', {
    p_household_id: householdId,
    p_name: name,
    p_date_of_birth: dateOfBirth || null,
    p_account_type: accountType,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { profileId: row?.profile_id, claimId: row?.claim_id, outcome: row?.outcome };
}

export async function createHouseholdInvite(householdId, email) {
  const { data, error } = await supabase.rpc('create_household_invite', {
    p_household_id: householdId, p_email: email,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row?.id, token: row?.token };
}

export async function acceptHouseholdInvite(token) {
  const { data, error } = await supabase.rpc('accept_household_invite', { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { householdId: row?.household_id };
}

export async function requestGuardianship(minorProfileId, householdId, note) {
  const { data, error } = await supabase.rpc('request_guardianship', {
    p_minor_profile_id: minorProfileId, p_household_id: householdId, p_note: note || null,
  });
  if (error) throw error;
  return data; // claim id
}

export async function decideGuardianshipClaim(claimId, approve) {
  const { error } = await supabase.rpc('decide_guardianship_claim', {
    p_claim_id: claimId, p_approve: approve,
  });
  if (error) throw error;
}

export async function cancelGuardianshipClaim(claimId) {
  const { error } = await supabase.rpc('cancel_guardianship_claim', { p_claim_id: claimId });
  if (error) throw error;
}

export async function removeHouseholdMember(memberId) {
  const { error } = await supabase.rpc('remove_household_member', { p_member_id: memberId });
  if (error) throw error;
}
