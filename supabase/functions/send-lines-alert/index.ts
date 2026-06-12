// LRS-1 Phase 4 — fan the "tonight's lines are up" push out to the team.
//
// Called from the client right after upsert_lineup_post lands the lines post
// on the team feed (src/lib/lineups.js → sendLineupPostPush), on the FIRST
// post for a game only — content refreshes never re-push. The post is the
// record; this fn is only the push amplifier (send-sub-alert posture: caller
// passes a post_id, ALL targeting is resolved here with the service role).
//
// SCOPING: recipients are exactly the ACTIVE roster of the post's team
// (minus the author/caller) — the post must carry lines_for_game_id, or
// nothing is sent. This fn can never become a broadcast channel for ordinary
// team posts or to anyone beyond the room.
//
// PRIVACY (the cluster's non-negotiable): the payload is TEAM-LEVEL ONLY —
// "Tonight's lines are up", never a player name. OS notification surfaces
// (lock screens, notification centers) are outside the app's login gate, so
// minors' names stay off them entirely; the names live in the post, behind
// the team feed.
//
// Authorization (verified JWT, never the body): the caller must be a
// manager/coach of the post's team (is_team_manager — the same authority
// that created the post).
//
// Per recipient: an in-app notifications row (kind='lineup_alert' —
// deliberately NOT in trg_enqueue_notification_push's WHEN list, no double
// push) + a web push, with the send-recap-push delivery/prune loop.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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

  // Identity from the verified JWT only.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'missing authorization' }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return json({ error: 'unauthorized' }, 401);

  let payload: { post_id?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const postId = payload?.post_id;
  if (!postId || typeof postId !== 'string') return json({ error: 'post_id required' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. The post must be a tonight's-lines post on a team feed — that's the scope.
  const { data: post, error: postErr } = await svc
    .from('posts')
    .select('id, author_id, team_id, lines_for_game_id')
    .eq('id', postId)
    .maybeSingle();
  if (postErr) return json({ error: postErr.message }, 500);
  if (!post?.team_id || !post?.lines_for_game_id) return json({ error: 'not a lines post' }, 400);

  // 2. Authorize the caller: manager/coach of THIS team (the same authority
  //    upsert_lineup_post required to create the post).
  const { data: isMgr, error: mgrErr } = await svc.rpc('is_team_manager', {
    p_team_id: post.team_id, p_user_id: user.id,
  });
  if (mgrErr) return json({ error: mgrErr.message }, 500);
  if (!isMgr) return json({ error: 'only a team manager or coach can send the lines alert' }, 403);

  const { data: team, error: teamErr } = await svc
    .from('teams')
    .select('id, name')
    .eq('id', post.team_id)
    .maybeSingle();
  if (teamErr) return json({ error: teamErr.message }, 500);

  // Once per post, ever. The client only fires on the FIRST post for a game,
  // but a re-invocation (manual call, double-tap race between two managers)
  // must not re-spam the room — the bell rows are the dedupe record.
  const { data: already } = await svc
    .from('notifications')
    .select('id')
    .eq('post_id', post.id)
    .eq('kind', 'lineup_alert')
    .limit(1);
  if (already && already.length > 0) {
    return json({ sent: 0, attempted: 0, reason: 'already_alerted' });
  }

  // 3. Recipients: the team's ACTIVE roster, minus the author/caller. Minors
  //    without auth users simply have no push_subscriptions row — harmless.
  const { data: roster, error: memErr } = await svc
    .from('team_members')
    .select('user_id')
    .eq('team_id', post.team_id)
    .eq('status', 'active')
    .not('user_id', 'is', null);
  if (memErr) return json({ error: memErr.message }, 500);
  const recipientIds = [...new Set((roster ?? []).map((m) => m.user_id))]
    .filter((id) => id && id !== user.id && id !== post.author_id) as string[];
  if (recipientIds.length === 0) return json({ sent: 0, attempted: 0, reason: 'empty_roster' });

  // Team-level only — no player names on OS surfaces (minor shield).
  const title = `🏒 ${team?.name || 'Your team'}`;
  const body = 'Tonight’s lines are up — tap to see who’s starting.';
  const url = `/team/${post.team_id}`;

  // 4. In-app rows (bell). kind='lineup_alert' is outside the generic push
  //    trigger's WHEN list — delivery happens below, exactly once.
  const { error: notifErr } = await svc.from('notifications').insert(
    recipientIds.map((rid) => ({
      recipient_id: rid,
      actor_id: post.author_id,
      kind: 'lineup_alert',
      post_id: post.id,
      team_id: post.team_id,
      url,
      body,
      metadata: { game_id: post.lines_for_game_id },
    })),
  );
  if (notifErr) {
    console.error('[send-lines-alert] notifications insert failed', { error: notifErr.message });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ sent: 0, attempted: 0, reason: 'vapid_not_configured' });
  }

  // 5. Web push to the roster only, pruning stale subscriptions.
  const { data: pushSubs, error: pushErr } = await svc
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', recipientIds);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  const tag = `lines:${post.id}`; // collapse-key — a re-fire updates, never stacks
  const pushPayload = JSON.stringify({ title, body, url, tag });

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
      if (statusCode === 410 || statusCode === 404) {
        stale.push(s.user_id);
      } else {
        console.error('[send-lines-alert] delivery failed', {
          user_id: s.user_id, post_id: post.id, statusCode,
          message: (err as { message?: string })?.message,
        });
      }
    }
  }));

  if (stale.length > 0) {
    await svc.from('push_subscriptions').delete().in('user_id', stale);
  }

  return json({ sent, attempted: pushSubs.length, pruned: stale.length, team: team?.name });
});
