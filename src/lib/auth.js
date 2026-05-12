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
    handle: handle.replace('@', ''),
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

  if (profileError) console.error('Profile creation error:', profileError);

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
  return supabase.auth.signOut();
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
