import { supabase } from './supabase';
import { linkPendingInvitesForUser } from './roster';

const AVATAR_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'];

function pickInitials(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

export async function signUp({ email, password, dateOfBirth, marketingOptIn = false, captchaToken }) {
  // ONBOARD-1 (May 28, 2026): single-step signup. The auth gate collects only
  // email + password + DOB (+ Turnstile + marketing opt-in checkbox). Name,
  // handle, persona, position, etc. are filled in progressively via the
  // OnboardingModal + dismissible Feed banner — the lowest-friction path
  // that still satisfies the COPPA hard-block + Supabase CAPTCHA Protection.

  // COPPA check — also guards against an invalid `dateOfBirth` that would
  // produce NaN and silently bypass the under-13 block.
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  if (!Number.isFinite(age) || age < 13) {
    return { error: { message: 'You must be 13 or older to create a Rinkd account.' } };
  }

  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  // Pass enrichment fields to Supabase as user_metadata so we can rebuild the
  // profile row whenever the user first arrives with a real session — whether
  // that's immediately (auto-confirm on) or later via the email confirmation
  // link (auto-confirm off, data.session is null on signUp and the profile
  // INSERT would otherwise run anonymously and fail).
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
        // ENRICH-1: only the minimum at the gate.
        date_of_birth: dateOfBirth, // YYYY-MM-DD from <input type="date">
        marketing_opt_in: !!marketingOptIn,
        avatar_color: color,
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
  // ONBOARD-1: auto-generated placeholder handle — uniqueness guaranteed by
  // the UUID prefix. The user picks a real handle later from the Profile
  // page (no friction at the auth gate). The visible "user-..." prefix
  // signals "this is a default" so people are nudged to change it.
  const handle = meta.handle
    || `user-${user.id.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const color = meta.avatar_color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const initials = meta.avatar_initials || pickInitials(name);

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    // REG-1: profiles are decoupled from auth.users. Real users keep
    // id === auth uid (so existing user.id comparisons stay correct) AND
    // carry the explicit auth_user_id link that RLS routes through via
    // current_profile_id(). Managed/minor profiles (auth_user_id NULL) are
    // only ever minted server-side by create_managed_profile().
    auth_user_id: user.id,
    account_type: 'adult',
    email: (user.email || '').toLowerCase(),
    name,
    handle,
    avatar_color: color,
    avatar_initials: initials,
    // ENRICH-1 fields piped from user_metadata (set in signUp). Persona,
    // gender, and profile_complete intentionally left at their column defaults
    // (NULL / NULL / FALSE) so the OnboardingModal + dismissible Feed banner
    // surface as the progressive-disclosure nudge.
    date_of_birth: meta.date_of_birth || null,
    notification_email_marketing: !!meta.marketing_opt_in,
    // Legacy position/level: cleared so they don't render as defaulted values
    // (the old code wrote "Fan" / "Beer League" — making it look like the
    // user self-identified that way). Persona is the new segmentation field
    // and stays NULL until they pick one in the OnboardingModal.
    position: '',
    level: '',
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

/**
 * ENRICH-1 (May 28, 2026) — bounded `last_seen_at` update. Called from
 * App.js's onAuthStateChange handler on SIGNED_IN; the PostgREST WHERE
 * clause caps writes to one every 5 minutes per user so token refreshes
 * (≈hourly while active) don't slam the table.
 *
 * Fire-and-forget — we don't surface errors. RLS already permits a user
 * to update their own row; the guard trigger doesn't touch this column.
 */
export async function touchLastSeen(userId) {
  if (!userId) return;
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  try {
    await supabase
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff}`);
  } catch (_) {
    /* best-effort */
  }
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
    // ENRICH-1 (May 28, 2026) — user-writable additions.
    // `date_of_birth` is included but the `guard_profile_privileged_columns`
    // BEFORE-UPDATE trigger silently freezes it after the first set for
    // non-admins (anti-age-fraud). Admins can correct it from the admin
    // surface; service-role migrations bypass the trigger entirely.
    'persona', 'gender', 'date_of_birth', 'profile_complete',
    'notification_email_transactional', 'notification_email_marketing', 'notification_push',
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
