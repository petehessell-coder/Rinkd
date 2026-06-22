import { supabase } from './supabase';

const AVATAR_COLORS = ['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'];

// YOUTH-PRIVACY: profiles.email + date_of_birth are column-revoked from the
// authenticated role (personal contact info is never client-scrapeable). So
// `select('*')` on profiles now ERRORS — read this explicit non-contact column
// list instead. Own email/DOB come from the auth session or get_my_contact().
// If a future migration adds a profiles column the client needs, add it here.
export const PROFILE_SELECT =
  'id, name, handle, avatar_color, avatar_initials, bio, position, level, home_rink, ' +
  'points, tier, created_at, updated_at, is_premium, premium_until, stripe_customer_id, ' +
  'cover_image_url, onboarding_completed_at, welcome_seen, avatar_url, is_admin, persona, ' +
  'gender, last_seen_at, notification_email_transactional, notification_email_marketing, ' +
  'notification_push, profile_complete, auth_user_id, account_type';

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
 * Profile fields are derived server-side by the ensure_profile_for_current_user
 * SECURITY DEFINER RPC from auth.users.user_metadata (set by signUp) — the
 * client no longer needs table grants on profiles to provision its own row.
 */
export async function ensureProfileForUser(user) {
  if (!user?.id) return { data: null, error: { message: 'No user' } };

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return { data: existing, error: null };

  // Profile creation runs server-side via the ensure_profile_for_current_user
  // SECURITY DEFINER RPC. The function derives every field from the caller's
  // auth.users row + user_metadata (set in signUp), mirroring the old client
  // derivation exactly, and is immune to the YOUTH-PRIVACY column gate — which
  // REVOKEs SELECT on profiles.email + date_of_birth from `authenticated` and so
  // breaks any client-side upsert / ON CONFLICT / RETURNING on those columns.
  // (That gate bit signup before — Sentry 09883627, prior bandaid b10155c2.)
  // The RPC keys solely off auth.uid(), so a caller can only ever create its OWN
  // row, and it's idempotent — safe even if the existence check above raced a
  // concurrent onAuthStateChange. We no longer need table grants on profiles to
  // provision, so future grant changes can't break signup.
  const { error: profileError } = await supabase.rpc('ensure_profile_for_current_user');
  if (profileError) {
    // eslint-disable-next-line no-console
    console.error('[ensureProfileForUser] ensure_profile RPC failed:', profileError);
    return { error: profileError };
  }

  // Invite-linking and follow-seeding happen authoritatively inside the RPC's
  // INSERT via AFTER-INSERT triggers — one source of truth, runs regardless of
  // onboarding:
  //   • tr_auto_follow_seed_accounts      — seeds Pete + The BLPA + Howie follows
  //   • tr_link_invited_player_on_profile — links pending team invites by email
  // The old client linkPendingInvitesForUser backstop was retired: that trigger
  // runs the identical invite match on insert (verified byte-equivalent against
  // the link_pending_team_invites RPC it called), so the client call was a pure
  // redundant round-trip.
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
    .select(PROFILE_SELECT)
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
