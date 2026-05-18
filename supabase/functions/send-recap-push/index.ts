// Fire push notifications for a single game-recap post to every user who
// subscribed to that game's tournament. Called from the React app after
// createGameRecapPost succeeds (see src/lib/push.js -> triggerTournamentRecapPush).
//
// Auth: requires a valid authed-user JWT (Supabase verifies it before invoking).
// The function takes a post_id and looks up ALL targeting data itself —
// callers can't influence who gets pushed or what the payload contains, only
// which recap to fire. Worst-case abuse: someone calls it twice on the same
// post_id and re-fires the push. Annoying, not exploitable. Rate-limit later
// if it shows up in practice.
//
// Required secrets (Supabase Edge Function env):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - VAPID_PUBLIC_KEY        (same value as the React app's REACT_APP_VAPID_PUBLIC_KEY)
//   - VAPID_PRIVATE_KEY       (kept secret, server-only)
//   - VAPID_SUBJECT           (mailto:hello@rinkd.app)
//
// Manual test (after deploy):
//   curl -X POST https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-recap-push \
//        -H "Authorization: Bearer $USER_JWT" \
//        -H "Content-Type: application/json" \
//        -d '{"post_id":"<recap_post_uuid>"}'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@rinkd.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    // Fail-fast with a clear message rather than silently no-op'ing — saves
    // debug time during the initial Vercel/Supabase secret rollout.
    return json({ error: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set as Edge Function secrets' }, 500);
  }

  let payload: { post_id?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const postId = payload?.post_id;
  if (!postId || typeof postId !== 'string') return json({ error: 'post_id required' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Look up the recap post + game + tournament in one join.
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('id, content, recap_for_game_id, recap_for_game_id, tag')
    .eq('id', postId)
    .maybeSingle();
  if (postErr) return json({ error: postErr.message }, 500);
  if (!post) return json({ error: 'post not found' }, 404);
  if (!post.recap_for_game_id) return json({ error: 'not a recap post' }, 400);

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id, tournament_id, tournament:tournaments(id, name)')
    .eq('id', post.recap_for_game_id)
    .maybeSingle();
  if (gameErr) return json({ error: gameErr.message }, 500);
  if (!game?.tournament_id) return json({ error: 'recap not linked to a tournament' }, 400);

  // 2. Find the tournament's subscribers.
  const { data: subs, error: subsErr } = await supabase
    .from('tournament_subscriptions')
    .select('user_id')
    .eq('tournament_id', game.tournament_id);
  if (subsErr) return json({ error: subsErr.message }, 500);
  const userIds = (subs ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_subscribers' });

  // 3. Resolve their push subscriptions.
  const { data: pushSubs, error: pushErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  // 4. Build the payload. content's first line is the headline ("🏒 FINAL ·
  //    Beer Necessities 4, Net Profits 3"); the rest is context. We pass
  //    them as title/body to the service worker which renders the OS toast.
  const lines = String(post.content || '').split('\n').filter(Boolean);
  const title = lines[0] || (game.tournament as { name?: string } | null)?.name || 'Rinkd';
  const body = lines.slice(1).join(' · ') || 'Tap to view the recap.';
  const url = `/game/${game.id}`;
  const tag = `recap:${post.id}`; // collapse-key so a re-fire doesn't stack
  const pushPayload = JSON.stringify({ title, body, url, tag });

  // 5. Send in parallel, prune 410/404 (expired/cancelled subs).
  const stale: string[] = [];
  let sent = 0;
  await Promise.all(pushSubs.map(async (s) => {
    let parsed: unknown;
    try { parsed = JSON.parse(s.subscription); }
    catch { stale.push(s.user_id); return; }
    try {
      await webpush.sendNotification(parsed as { endpoint: string }, pushPayload);
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) stale.push(s.user_id);
      // Other errors (network, malformed endpoint URL) are swallowed — one
      // bad subscription shouldn't block the rest.
    }
  }));

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('user_id', stale);
  }

  return json({ sent, attempted: pushSubs.length, pruned: stale.length });
});
