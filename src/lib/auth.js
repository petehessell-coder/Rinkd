import { supabase } from './supabase';

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
  // Filter only allowed fields to prevent freezing from invalid data
  const allowed = ['name', 'bio', 'position', 'level', 'home_rink', 'handle'];
  const filtered = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) filtered[key] = updates[key];
  }
  
  const { data, error } = await supabase
    .from('profiles')
    .update(filtered)
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}
