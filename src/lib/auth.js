import { supabase } from './supabase';

export async function signUp({ email, password, name, handle, position, level }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, handle, position, level }
    }
  });
  if (error) throw error;

  // Create profile row
  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: data.user.id,
      name,
      handle: handle.toLowerCase().replace(/[^a-z0-9_]/g, ''),
      position,
      level,
      avatar_color: randomColor(),
      avatar_initials: initials(name),
      bio: '',
      points: 50,
      tier: 'Mite',
    });
    if (profileError) console.error('Profile create error:', profileError);
  }
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function randomColor() {
  const colors = ['#2E5B8C','#D72638','#8B5CF6','#22C55E','#F59E0B','#EC4899','#0891B2'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}
