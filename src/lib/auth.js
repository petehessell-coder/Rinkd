import { supabase } from './supabase';
import { linkPendingInvitesForUser } from './roster';

export async function signUp({ email, password, name, handle, position, level, dob }) {
  // COPPA check
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  if (age < 13) {
    return { error: { message: 'You must be 13 or older to create a Rinkd account.' } };
  }

  // Pre-check handle availability BEFORE creating the auth user. A duplicate
  // handle is the most common cause of the profile insert failing — catching
  // it here avoids leaving an orphaned auth.users row with no profile.
  const cleanHandle = handle.replace('@', '');
  const { data: handleTaken } = await supabase
    .from('profiles').select('id').eq('handle', cleanHandle).maybeSingle();
  if (handleTaken) {
    return { error: { message: 'That handle is already taken — please pick another.' } };
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error };

  const userId = data.user?.id;
  if (!userId) return { error: { message: 'Signup failed. Please try again.' } };

  const avatarColors = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'];
  const color = avatarColors[Math.floor(Math.random() * avatarColors.length)];
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userId,
    email: email.toLowerCase(),
    name,
    handle: cleanHandle,
    avatar_color: color,
    avatar_initials: initials,
    position: position || 'Fan',
    level: level || 'Beer League',
    points: 0,
    tier: 'Mite',
    bio: '',
    home_rink: '',
    created_at: new Date().toISOString()
  });

  // If the profile row didn't get created, the account is half-built — every
  // page that assumes a profile will break. Surface it instead of reporting
  // success. (The durable fix is a DB trigger that creates the profile
  // transactionally with the auth user — see Rinkd_Canonical_Data_Model.md.)
  if (profileError) {
    console.error('Profile creation error:', profileError);
    return { error: { message: "Your account was created but your profile didn't finish setting up. Please contact hello@rinkd.app." } };
  }

  // If a team manager invited this user before they signed up, link them up now.
  // Quiet failure — the signup itself still succeeds.
  try {
    const { linked } = await linkPendingInvitesForUser(userId, email);
    if (linked > 0) {
      // eslint-disable-next-line no-console
      console.info(`[signUp] auto-linked ${linked} pending team invite${linked === 1 ? '' : 's'}.`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[signUp] linkPendingInvitesForUser threw:', e?.message || e);
  }

  // Auto-follow the top 3 active users so the new user's Following feed isn't
  // empty on landing. Quiet failure — signup succeeds regardless. These follows
  // can be unfollowed at any time from the followed user's profile.
  try {
    const { data: topUsers } = await supabase
      .from('profiles')
      .select('id')
      .neq('id', userId)
      .order('points', { ascending: false, nullsFirst: false })
      .limit(3);
    if (topUsers?.length) {
      await supabase.from('follows').insert(
        topUsers.map((u) => ({ follower_id: userId, following_id: u.id }))
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[signUp] auto-follow seeded users failed:', e?.message || e);
  }

  return { data, error: null };
}

export async function signIn({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  // 'local' scope clears this device's session from local storage without a
  // network round-trip to revoke the token server-side. Far more reliable on
  // flaky wifi, and it's the right scope for a "sign out of this device" button.
  return supabase.auth.signOut({ scope: 'local' });
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

export async function updateProfile(userId, updates) {
  // Whitelist of fields a user may write to their own profile. Adding to this
  // list is how we enable new editable surfaces (avatar, cover, etc.).
  // Sensitive columns (points, tier, is_premium, welcome_seen, etc.) are
  // intentionally excluded — those are set server-side via triggers, admin
  // tools, or Stripe webhooks.
  const allowed = [
    'name', 'bio', 'position', 'level', 'home_rink', 'handle',
    'avatar_url', 'avatar_color', 'avatar_initials', 'cover_image_url',
  ];
  const filtered = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }

  if (Object.keys(filtered).length === 0) {
    return { data: null, error: { message: 'No editable fields provided' } };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(filtered)
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}
