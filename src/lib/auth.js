import { supabase } from './supabase';
import { linkPendingInvitesForUser } from './roster';

const AVATAR_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'];

function pickInitials(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

export async function signUp({ email, password, name, handle, position, level, dob, captchaToken }) {
  // COPPA check — also guards against an invalid `dob` that would produce NaN
  // and silently bypass the under-13 block.
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  if (!Number.isFinite(age) || age < 13) {
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

  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const initials = pickInitials(name);

  // Pass profile fields to Supabase as user_metadata so we can rebuild the
  // profile row whenever the user first arrives with a real session —
  // whether that's immediately (auto-confirm on) or later via the email
  // confirmation link (auto-confirm off, data.session is null on signUp
  // and the profile INSERT would otherwise run anonymously and fail).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Forward the Cloudflare Turnstile token so Supabase's CAPTCHA
      // Protection (when enabled in dashboard → Auth → Settings) can
      // validate it server-side. Undefined when Turnstile isn't configured
      // for the build — Supabase accepts undefined as "no challenge."
      captchaToken: captchaToken || undefined,
      data: {
        name,
        handle: cleanHandle,
        position: position || 'Fan',
        level: level || 'Beer League',
        avatar_color: color,
        avatar_initials: initials,
      },
    },
  });
  if (error) return { error };

  const userId = data.user?.id;
  if (!userId) return { error: { message: 'Signup failed. Please try again.' } };

  // No session → Supabase has email confirmation turned on. We cannot insert
  // the profile from here (anonymous INSERT will be rejected by RLS). Tell the
  // caller to show a "Check your email" screen; `ensureProfileForUser` runs
  // post-confirmation when SIGNED_IN fires with a real session attached.
  if (!data.session) {
    return { data, needsConfirmation: true, error: null };
  }

  // Auto-confirm path — we have a session, create the profile + side effects
  // synchronously so the user lands on /feed with everything ready.
  const ensured = await ensureProfileForUser(data.user);
  if (ensured.error) {
    return { error: { message: "Your account was created but your profile didn't finish setting up. Please contact hello@rinkd.app." } };
  }

  return { data, error: null };
}

/**
 * Idempotent: ensures a profile row + auto-follow seeds + linked invites
 * exist for the given auth user. Safe to call from signUp (auto-confirm path)
 * AND from App.js's onAuthStateChange handler (post-email-confirmation path
 * for new users, no-op for returning users).
 *
 * Reads profile fields from auth.users.user_metadata (set by signUp).
 */
export async function ensureProfileForUser(user) {
  if (!user?.id) return { data: null, error: { message: 'No user' } };

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return { data: existing, error: null };

  const meta = user.user_metadata || {};
  const emailLocal = (user.email || '').split('@')[0] || 'player';
  const name = meta.name || emailLocal;
  const handle = meta.handle || emailLocal.replace(/[^a-zA-Z0-9_]/g, '') || `user_${user.id.slice(0, 8)}`;
  const color = meta.avatar_color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const initials = meta.avatar_initials || pickInitials(name);

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    email: (user.email || '').toLowerCase(),
    name,
    handle,
    avatar_color: color,
    avatar_initials: initials,
    position: meta.position || 'Fan',
    level: meta.level || 'Beer League',
    points: 0,
    tier: 'Mite',
    bio: '',
    home_rink: '',
    created_at: new Date().toISOString(),
  });

  if (profileError) {
    // eslint-disable-next-line no-console
    console.error('[ensureProfileForUser] profile upsert failed:', profileError);
    return { error: profileError };
  }

  // Side effects — quiet failure for each. The profile creation succeeded,
  // and these are nice-to-have on first sign-in. They're also idempotent: a
  // returning user already has the linked invite or the follow row.
  try {
    const { linked } = await linkPendingInvitesForUser(user.id, user.email);
    if (linked > 0) {
      // eslint-disable-next-line no-console
      console.info(`[ensureProfileForUser] auto-linked ${linked} pending team invite${linked === 1 ? '' : 's'}.`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ensureProfileForUser] linkPendingInvitesForUser threw:', e?.message || e);
  }

  // Seed follows (Pete + The BLPA + Howie Miller) are handled server-side by
  // the `tr_auto_follow_seed_accounts` trigger on profiles INSERT — one source
  // of truth, fires regardless of onboarding. The old client-side
  // "follow top 3 by points" block was removed (May 23) because it seeded
  // whatever demo accounts ranked highest, not the intended real accounts.

  return { data: { id: user.id }, error: null };
}

export async function signIn({ email, password, captchaToken }) {
  // Forward the Cloudflare Turnstile token when one is captured. Supabase
  // CAPTCHA Protection (enabled in the dashboard May 18) applies globally
  // to /auth/v1/signin, so without a token here every sign-in fails with
  // "captcha protection: request disallowed (no captcha_token found)".
  // The widget renders next to the login form in Auth.js.
  return supabase.auth.signInWithPassword({
    email, password,
    options: { captchaToken: captchaToken || undefined },
  });
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
