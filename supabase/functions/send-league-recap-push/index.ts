// Fire push notifications for a single LEAGUE game-recap post to every user who
// subscribed to that game's league. Mirror of send-recap-push (the tournament
// path) — same don't-trust-the-client architecture: the caller hands over a
// post_id and this function looks up ALL targeting data itself (post → league →
// league_subscriptions → push_subscriptions), all under service role.
//
// Called from:
//   - sync-gamesheet's league pass (postLeagueRecapAndPush) on each game's first
//     finalize — those recaps carry recap_for_league_game_id (GAMESHEET-LEAGUES-1).
//   - src/lib/push.js -> triggerLeagueRecapPush (ScorerView league finalize) —
//     legacy recaps that carried recap_for_game_id (pre-recap_for_league_game_id).
// This function resolves the league game id from EITHER column so both callers
// work; the URL + dedup tag are unchanged from the prior deploy.
//
// Monetization gate: if the recap's parent league has is_activated=false, refuse
// to fire. RLS already blocks the upstream scoring writes that produce a recap,
// and the poller only syncs activated leagues — this is defense-in-depth.
//
// Auth: requires a valid authed-user JWT (Supabase verifies it before invoking).
// The service-role JWT the poller sends also satisfies verify_jwt.
//
// Required secrets (already set when send-recap-push was deployed):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - VAPID_PUBLIC_KEY        (same value as the React app's REACT_APP_VAPID_PUBLIC_KEY)
//   - VAPID_PRIVATE_KEY       (kept secret, server-only)
//   - VAPID_SUBJECT           (mailto:hello@rinkd.app)
//
// Manual test (after deploy):
//   curl -X POST https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-league-recap-push \
//        -H "Authorization: Bearer $USER_JWT" \
//        -H "Content-Type: application/json" \
//        -d '{"post_id":"<league_recap_post_uuid>"}'

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
    return json({ error: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set as Edge Function secrets' }, 500);
  }

  let payload: { post_id?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const postId = payload?.post_id;
  if (!postId || typeof postId !== 'string') return json({ error: 'post_id required' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Look up the recap post. A league recap carries recap_for_league_game_id
  //    (poller) OR, for legacy rows, recap_for_game_id (ScorerView). Resolve the
  //    league game id from whichever is set.
  const { data: post, error: postErr } = await supabase
    .from('posts')
    .select('id, content, recap_for_league_game_id, recap_for_game_id, league_id, tag')
    .eq('id', postId)
    .maybeSingle();
  if (postErr) return json({ error: postErr.message }, 500);
  if (!post) return json({ error: 'post not found' }, 404);
  const leagueGameId: string | null = post.recap_for_league_game_id ?? post.recap_for_game_id ?? null;
  if (!leagueGameId) return json({ error: 'not a league recap post' }, 400);

  // 2. Find the league. Prefer post.league_id (canonical) and fall back to
  //    walking via league_games for older rows that pre-date the column.
  let leagueId: string | null = post.league_id ?? null;
  if (!leagueId) {
    const { data: g, error: gErr } = await supabase
      .from('league_games')
      .select('id, league_id')
      .eq('id', leagueGameId)
      .maybeSingle();
    if (gErr) return json({ error: gErr.message }, 500);
    if (!g?.league_id) return json({ error: 'recap not linked to a league' }, 400);
    leagueId = g.league_id;
  }
  const { data: lg, error: lgErr } = await supabase
    .from('leagues')
    .select('id, name, is_activated')
    .eq('id', leagueId)
    .maybeSingle();
  if (lgErr) return json({ error: lgErr.message }, 500);
  // Activation gate: leagues not yet activated by an admin can't fan out pushes.
  if (lg?.is_activated === false) {
    return json({ sent: 0, attempted: 0, reason: 'league_not_activated' });
  }
  const leagueName = lg?.name ?? null;

  // 3. Find the league's subscribers.
  const { data: subs, error: subsErr } = await supabase
    .from('league_subscriptions')
    .select('user_id')
    .eq('league_id', leagueId);
  if (subsErr) return json({ error: subsErr.message }, 500);
  const userIds = (subs ?? []).map((s) => s.user_id);
  if (userIds.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_subscribers' });

  // 4. Resolve their push subscriptions.
  const { data: pushSubs, error: pushErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  // 5. Build the payload. content's first line is the headline ("🏒 FINAL ·
  //    Beer Necessities 4, Net Profits 3"); the rest is context. The recap opens
  //    the league game detail page (/league-game/:id).
  const lines = String(post.content || '').split('\n').filter(Boolean);
  const title = lines[0] || leagueName || 'Rinkd';
  const body = lines.slice(1).join(' · ') || 'Tap to view the recap.';
  const url = `/league-game/${leagueGameId}`;
  const tag = `league-recap:${post.id}`; // collapse-key so a re-fire doesn't stack
  const pushPayload = JSON.stringify({ title, body, url, tag });

  // 6. Send in CHUNKED batches, prune 410/404 (expired/cancelled subs).
  //    Unbounded Promise.all over every subscriber risks an edge-function
  //    timeout at pilot scale. We dispatch in sequential batches of BATCH_SIZE,
  //    concurrent WITHIN a batch via Promise.allSettled, so peak concurrency is
  //    bounded but throughput stays high. Per-sub error isolation (stale pruning
  //    + non-stale logging) is unchanged — it just runs one batch at a time.
  const BATCH_SIZE = 100;
  const stale: string[] = [];
  let sent = 0;
  let failed = 0;

  const sendOne = async (s: { user_id: string; subscription: string }) => {
    let parsed: unknown;
    try { parsed = JSON.parse(s.subscription); }
    catch { stale.push(s.user_id); return; }
    try {
      await webpush.sendNotification(parsed as { endpoint: string }, pushPayload);
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        stale.push(s.user_id);
      } else {
        failed++;
        console.error('[send-league-recap-push] delivery failed', {
          user_id: s.user_id, post_id: post.id, statusCode,
          message: (err as { message?: string })?.message,
        });
      }
    }
  };

  for (let i = 0; i < pushSubs.length; i += BATCH_SIZE) {
    const batch = pushSubs.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(sendOne));
  }

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('user_id', stale);
  }

  console.log('[send-league-recap-push] done', { sent, failed, pruned: stale.length, attempted: pushSubs.length });
  return json({ sent, attempted: pushSubs.length, pruned: stale.length });
});
