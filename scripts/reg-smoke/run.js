#!/usr/bin/env node
/**
 * REG-1 Phase 1 — RLS + consent smoke suite.
 *
 * Runs against a DISPOSABLE Supabase dev branch (never prod) after the four
 * reg1 migrations are applied. Exercises the policy surface through PostgREST
 * with real JWTs — the same path the app uses.
 *
 *   SMOKE_SUPABASE_URL=https://<branch-ref>.supabase.co \
 *   SMOKE_ANON_KEY=<branch anon key> \
 *   SMOKE_SERVICE_ROLE_KEY=<branch service role key> \
 *   node scripts/reg-smoke/run.js
 *
 * Covers (REG_MEGABUILD brief §9, Phase 1):
 *   identity bridge (current_profile_id), profiles RLS bootstrap + cross-user
 *   denial, PII column grants for anon, minor no-login invariant, household
 *   creation, managed-profile minting, consent (nothing links without
 *   approval), duplicate name+DOB → claim request, guardian/org-admin claim
 *   decisions, append-only audit, privileged-column freeze, invite magic-link
 *   accept incl. wrong-email rejection, post-rewrite social policies, and the
 *   invite-email auto-link trigger.
 */
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_ANON_KEY;
const SERVICE = process.env.SMOKE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Set SMOKE_SUPABASE_URL, SMOKE_ANON_KEY, SMOKE_SERVICE_ROLE_KEY (dev-branch values).');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function makeUser(label) {
  const email = `${label}-${Date.now()}@reg1smoke.test`;
  const password = 'Smoke-test-pass-1!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  const id = data.user.id;
  // mimic ensureProfileForUser (REG-1 shape: id === auth uid, auth_user_id set)
  const { error: pErr } = await admin.from('profiles').insert({
    id, auth_user_id: id, account_type: 'adult', email,
    name: label, handle: `${label}-${id.slice(0, 8)}`, avatar_initials: label.slice(0, 2).toUpperCase(),
  });
  if (pErr) throw new Error(`profile(${label}): ${pErr.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${label}): ${sErr.message}`);
  return { id, email, client };
}

(async () => {
  console.log(`REG-1 smoke vs ${URL}\n`);

  // ── identities ────────────────────────────────────────────────────────────
  const parentA = await makeUser('parenta');
  const parentB = await makeUser('parentb');
  const stranger = await makeUser('stranger');
  const orgAdmin = await makeUser('orgadmin');
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  // 1. identity bridge
  {
    const { data, error } = await parentA.client.rpc('current_profile_id');
    check('current_profile_id() resolves to own profile', !error && data === parentA.id, error?.message);
  }

  // 2. anon PII column grants (email / date_of_birth / auth_user_id locked)
  {
    const { error: e1 } = await anon.from('profiles').select('id,name').limit(1);
    check('anon can read public profile columns', !e1, e1?.message);
    const { error: e2 } = await anon.from('profiles').select('email').limit(1);
    const { error: e3 } = await anon.from('profiles').select('date_of_birth').limit(1);
    const { error: e4 } = await anon.from('profiles').select('auth_user_id').limit(1);
    check('anon blocked from email/date_of_birth/auth_user_id', !!e2 && !!e3 && !!e4);
  }

  // 3. household creation + membership visibility
  let houseA;
  {
    const { data, error } = await parentA.client.rpc('create_household', { p_name: 'Smoke House A' });
    houseA = data;
    check('guardian can create a household', !error && !!houseA, error?.message);
    const { data: rows } = await stranger.client.from('households').select('id').eq('id', houseA);
    check('stranger cannot see the household', (rows || []).length === 0);
  }

  // 4. managed (minor) profile minting — guardian only, RPC only
  let kidId;
  {
    const { data, error } = await parentA.client.rpc('create_managed_profile', {
      p_household_id: houseA, p_name: 'Smoke Kid', p_date_of_birth: '2016-03-04',
    });
    const row = Array.isArray(data) ? data[0] : data;
    kidId = row?.profile_id;
    check('guardian mints a minor profile', !error && row?.outcome === 'created' && !!kidId, error?.message);

    const { data: kid } = await admin.from('profiles').select('account_type,auth_user_id,email').eq('id', kidId).single();
    check('minor is login-less (auth_user_id NULL, no email)',
      kid?.account_type === 'minor' && kid?.auth_user_id === null && kid?.email === null);

    const { error: sErr } = await stranger.client.rpc('create_managed_profile', {
      p_household_id: houseA, p_name: 'Fake Kid', p_date_of_birth: '2015-01-01',
    });
    check('stranger cannot mint into someone else\'s household', !!sErr);

    const { error: dErr } = await parentB.client.from('profiles').insert({
      name: 'Direct Kid', handle: `direct-${Date.now()}`, account_type: 'adult', auth_user_id: null,
    });
    check('direct INSERT of a login-less profile is blocked by RLS', !!dErr);
  }

  // 5. minor no-login invariant (DB CHECK, even for service role)
  {
    const { error } = await admin.from('profiles').insert({
      name: 'Bad Minor', handle: `bad-${Date.now()}`, account_type: 'minor', auth_user_id: orgAdmin.id,
    });
    check('CHECK blocks minor with a login even via service role', !!error);
  }

  // 6. unilateral linking is impossible
  {
    const { error } = await parentB.client.from('household_members').insert({
      household_id: houseA, profile_id: parentB.id, role: 'guardian', status: 'active', added_by: parentB.id,
    });
    check('direct household_members INSERT denied (no write policy)', !!error);
  }

  // 7. duplicate guard: same name+DOB routes to claim request + notifies guardian
  let claimId;
  {
    const { data: houseB } = await parentB.client.rpc('create_household', { p_name: 'Smoke House B' });
    const { data, error } = await parentB.client.rpc('create_managed_profile', {
      p_household_id: houseB, p_name: 'smoke kid', p_date_of_birth: '2016-03-04', // case-insensitive match
    });
    const row = Array.isArray(data) ? data[0] : data;
    claimId = row?.claim_id;
    check('duplicate name+DOB → claim_requested (no twin profile)',
      !error && row?.outcome === 'claim_requested' && row?.profile_id === kidId, error?.message);

    const { count } = await admin.from('profiles')
      .select('id', { count: 'exact', head: true }).ilike('name', 'smoke kid');
    check('exactly one Smoke Kid profile exists', count === 1, `count=${count}`);

    const { data: notif } = await admin.from('notifications')
      .select('id').eq('recipient_id', parentA.id).eq('kind', 'guardianship_claim');
    check('existing guardian was notified of the claim attempt', (notif || []).length >= 1);
  }

  // 8. claim decisions: self-approval and strangers blocked; guardian approves
  {
    const { error: selfErr } = await parentB.client.rpc('decide_guardianship_claim', { p_claim_id: claimId, p_approve: true });
    check('claimant cannot approve own claim', !!selfErr);
    const { error: strErr } = await stranger.client.rpc('decide_guardianship_claim', { p_claim_id: claimId, p_approve: true });
    check('stranger cannot decide the claim', !!strErr);

    // TAKEOVER BLOCKED: an org admin who rosters the kid must NOT be able to
    // approve a claim while the kid already has a guardian (forged/opportunistic
    // roster link cannot escalate into guardianship over a child with a family).
    const { data: team } = await admin.from('teams')
      .insert({ name: 'Takeover Roster', manager_id: orgAdmin.id }).select('id').single();
    await admin.from('team_members').insert({ team_id: team.id, user_id: kidId, role: 'player', status: 'active' });
    const { error: oaErr } = await orgAdmin.client.rpc('decide_guardianship_claim', { p_claim_id: claimId, p_approve: true });
    check('org admin cannot approve while a guardian exists (takeover blocked)', !!oaErr);

    const { error: okErr } = await parentA.client.rpc('decide_guardianship_claim', { p_claim_id: claimId, p_approve: true });
    check('existing guardian approves the claim', !okErr, okErr?.message);
    const { data: link } = await admin.from('household_members')
      .select('id').eq('profile_id', kidId).eq('status', 'active');
    check('minor now spans both households', (link || []).length === 2, `rows=${(link || []).length}`);
  }

  // 8b. managed_adult cannot be claimed as a minor
  {
    const { data: house } = await admin.from('household_members')
      .select('household_id').eq('profile_id', parentA.id).eq('role', 'guardian').limit(1).single();
    const { data: ma } = await parentA.client.rpc('create_managed_profile', {
      p_household_id: house.household_id, p_name: 'Adult Dependent', p_date_of_birth: '1990-01-01', p_account_type: 'managed_adult',
    });
    const maId = (Array.isArray(ma) ? ma[0] : ma)?.profile_id;
    const { data: hb } = await admin.from('household_members')
      .select('household_id').eq('profile_id', parentB.id).eq('role', 'guardian').limit(1).single();
    const { error: maErr } = await parentB.client.rpc('request_guardianship', {
      p_minor_profile_id: maId, p_household_id: hb.household_id,
    });
    check('managed_adult is not claimable as a minor', !!maErr);
  }

  // 8c. co-guardian cannot be evicted; self-removal allowed
  {
    const { data: house } = await admin.from('household_members')
      .select('household_id').eq('profile_id', parentA.id).eq('role', 'guardian').limit(1).single();
    await admin.from('household_members').upsert({
      household_id: house.household_id, profile_id: parentB.id, role: 'guardian', status: 'active',
      added_by: parentA.id, approved_by: parentA.id,
    }, { onConflict: 'household_id,profile_id' });
    const { data: pbMember } = await admin.from('household_members')
      .select('id').eq('household_id', house.household_id).eq('profile_id', parentB.id).single();
    const { data: paMember } = await admin.from('household_members')
      .select('id').eq('household_id', house.household_id).eq('profile_id', parentA.id).single();
    const { error: evictErr } = await parentA.client.rpc('remove_household_member', { p_member_id: pbMember.id });
    check('a guardian cannot evict a co-guardian', !!evictErr);
    const { error: selfErr } = await parentA.client.rpc('remove_household_member', { p_member_id: paMember.id });
    check('a guardian can step down themselves', !selfErr, selfErr?.message);
  }

  // 9. append-only audit
  {
    const { data: audit } = await admin.from('guardianship_audit').select('id,action').limit(50);
    check('audit trail recorded events', (audit || []).length >= 4, `rows=${(audit || []).length}`);
    const target = audit?.[0]?.id;
    const { error: uErr } = await parentA.client.from('guardianship_audit')
      .update({ action: 'tampered' }).eq('id', target);
    const { error: dErr } = await parentA.client.from('guardianship_audit').delete().eq('id', target);
    const { data: still } = await admin.from('guardianship_audit').select('action').eq('id', target).single();
    check('audit is append-only (UPDATE/DELETE blocked)',
      (!!uErr || !!dErr || still?.action !== 'tampered') && still?.action !== 'tampered');
  }

  // 10. profiles RLS: own row, guardian row, cross-user denial
  {
    await parentA.client.from('profiles').update({ bio: 'own-edit' }).eq('id', parentA.id);
    const { data: own } = await admin.from('profiles').select('bio').eq('id', parentA.id).single();
    check('user can update own profile', own?.bio === 'own-edit');

    await stranger.client.from('profiles').update({ bio: 'hacked' }).eq('id', parentA.id);
    const { data: notHacked } = await admin.from('profiles').select('bio').eq('id', parentA.id).single();
    check('cross-user profile update is a no-op', notHacked?.bio !== 'hacked');

    await parentA.client.from('profiles').update({ bio: 'guardian-edit' }).eq('id', kidId);
    const { data: kid } = await admin.from('profiles').select('bio').eq('id', kidId).single();
    check('guardian can edit managed minor profile', kid?.bio === 'guardian-edit');

    await stranger.client.from('profiles').update({ bio: 'stranger-edit' }).eq('id', kidId);
    const { data: kid2 } = await admin.from('profiles').select('bio').eq('id', kidId).single();
    check('stranger cannot edit the minor', kid2?.bio !== 'stranger-edit');
  }

  // 11. privileged-column freeze (is_admin / account_type / auth_user_id)
  {
    await parentA.client.from('profiles')
      .update({ is_admin: true, account_type: 'managed_adult' }).eq('id', parentA.id);
    const { data } = await admin.from('profiles').select('is_admin,account_type').eq('id', parentA.id).single();
    check('is_admin + account_type frozen for non-admins',
      data?.is_admin === false && data?.account_type === 'adult');
  }

  // 12. household invite magic link (mutual consent; wrong email rejected)
  {
    const { data, error } = await parentA.client.rpc('create_household_invite', {
      p_household_id: houseA, p_email: parentB.email,
    });
    const row = Array.isArray(data) ? data[0] : data;
    check('guardian creates co-guardian invite', !error && !!row?.token, error?.message);
    const { error: wrongErr } = await stranger.client.rpc('accept_household_invite', { p_token: row.token });
    check('wrong-email accept rejected', !!wrongErr);
    const { error: okErr } = await parentB.client.rpc('accept_household_invite', { p_token: row.token });
    check('invited co-guardian accepts', !okErr, okErr?.message);
    const { data: g } = await admin.from('household_members').select('role,status')
      .eq('household_id', houseA).eq('profile_id', parentB.id).single();
    check('co-guardian active in shared household', g?.role === 'guardian' && g?.status === 'active');
  }

  // 13. post-rewrite social policies still hold (spot check of the §4 transform)
  {
    const { error: ok } = await parentA.client.from('posts')
      .insert({ author_id: parentA.id, content: 'reg1 smoke post' });
    check('user can post as self (rewritten policy)', !ok, ok?.message);
    const { error: imp } = await parentB.client.from('posts')
      .insert({ author_id: parentA.id, content: 'impersonation' });
    check('user cannot post as someone else', !!imp);
  }

  // 14. invite-email auto-link trigger (moved to profiles INSERT)
  {
    const { data: team, error: tErr } = await admin.from('teams')
      .insert({ name: 'Smoke Linkers', manager_id: orgAdmin.id }).select('id').single();
    if (tErr) {
      check('seed team for link test', false, tErr.message);
    } else {
      const linkEmail = `linkme-${Date.now()}@reg1smoke.test`;
      await admin.from('team_members').insert({
        team_id: team.id, invite_name: 'Link Me', invite_email: linkEmail, status: 'pending', role: 'player',
      });
      const { data: u } = await admin.auth.admin.createUser({
        email: linkEmail, password: 'Smoke-test-pass-1!', email_confirm: true,
      });
      await admin.from('profiles').insert({
        id: u.user.id, auth_user_id: u.user.id, account_type: 'adult', email: linkEmail,
        name: 'Link Me', handle: `linkme-${u.user.id.slice(0, 8)}`,
      });
      const { data: tm } = await admin.from('team_members')
        .select('user_id,status').eq('team_id', team.id).ilike('invite_email', linkEmail).single();
      check('profile creation auto-links pending team invite', tm?.user_id === u.user.id && tm?.status === 'active',
        JSON.stringify(tm));
    }
  }

  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
