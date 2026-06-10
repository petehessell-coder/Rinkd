// Edge Function: delete-account
//
// Called by the user's own session token (verify_jwt:true). Deletes the caller's
// profiles row explicitly (REG-1 decoupled profiles from auth.users, so the old
// auth→profiles CASCADE no longer exists — profiles.auth_user_id is ON DELETE
// SET NULL because a minor's identity must not die with a guardian's login),
// then deletes the auth.users row. The profile delete cascades to all content
// tables wired with ON DELETE CASCADE (posts, comments, likes, follows,
// team_members, etc.). Stewarded entities the user created (leagues, teams,
// tournaments, articles, etc.) survive with SET NULL on their owner column.
//
// Order matters: profile first (while the auth_user_id link still exists),
// auth user second. If the auth delete fails the user can retry; the profile
// lookup simply finds nothing and the retry deletes only the auth user.
//
// Belt-and-suspenders: we verify the JWT-derived user_id matches the user we're
// deleting, so a malformed call can't be used to delete someone else.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }),
      { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  try {
    // Extract the user from the bearer JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'missing bearer token' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // anon-key client just to introspect the JWT
    const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await anon.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'invalid session' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Service-role admin client does the actual delete.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // REG-1: delete the profile row first (auth→profiles no longer cascades).
    // Keyed on auth_user_id so it only ever hits the caller's own profile.
    const { error: profErr } = await admin
      .from('profiles')
      .delete()
      .eq('auth_user_id', user.id);
    if (profErr) {
      console.error('[delete-account] profile delete failed', profErr);
      return new Response(JSON.stringify({ error: profErr.message }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error('[delete-account] admin.deleteUser failed', delErr);
      return new Response(JSON.stringify({ error: delErr.message }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, user_id: user.id }),
      { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[delete-account] fatal', err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
