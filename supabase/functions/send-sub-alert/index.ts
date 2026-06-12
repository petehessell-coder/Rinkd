// SUB-ALERT-1 (LRS-1 Phase 3) — fan a "Sub Needed" post out to the pool.
//
// Called from the client right after the post lands on the pool's team feed
// (src/lib/subPools.js → sendSubNeededAlert). The post is the record; this fn
// is only the push amplifier. send-recap-push posture: the caller passes a
// post_id, ALL targeting is resolved here with the service role.
//
// SCOPING IS THE NON-NEGOTIABLE: recipients are exactly the ACTIVE roster of
// the pool's backing team (minus the author) — the post must reference a team
// that IS a sub pool, or nothing is sent. This fn can never become a
// broadcast channel to a regular team or the league at large.
//
// Authorization (verified JWT, never the body): the caller must be a league
// commissioner of the pool's league, or a manager/coach somewhere in that
// league (the playing-team coach who needs the sub — they are NOT on the
// pool's roster, which is why pool-membership alone is the wrong check).
//
// Per recipient: an in-app notifications row (kind='sub_alert' — deliberately
// NOT in trg_enqueue_notification_push's WHEN list, no double push) + a web
// push, with the send-recap-push delivery/prune loop.
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

  // 1. The post must live on a SUB POOL's team feed — that's the scope.
  const { data: post, error: postErr } = await svc
    .from('posts')
    .select('id, author_id, content, team_id')
    .eq('id', postId)
    .maybeSingle();
  if (postErr) return json({ error: postErr.message }, 500);
  if (!post?.team_id) return json({ error: 'not a team post' }, 400);

  const { data: pool, error: poolErr } = await svc
    .from('league_teams')
    .select('id, league_id, team_id, team_name, sub_pool_kind')
    .eq('team_id', post.team_id)
    .eq('is_sub_pool', true)
    .maybeSingle();
  if (poolErr) return json({ error: poolErr.message }, 500);
  if (!pool) return json({ error: 'post is not on a sub pool feed' }, 400);

  // 2. Authorize the caller against the pool's league.
  let allowed = false;
  {
    const { data: isCommish } = await svc.rpc('is_league_commissioner', {
      p_league_id: pool.league_id, p_user_id: user.id,
    });
    allowed = !!isCommish;
  }
  if (!allowed) {
    // A manager/coach of any team in this league may call for subs.
    const { data: mgrRows } = await svc
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', user.id)
      .in('role', ['manager', 'coach'])
      .eq('status', 'active');
    const teamIds = (mgrRows ?? []).map((r) => r.team_id).filter(Boolean);
    if (teamIds.length) {
      const { data: inLeague } = await svc
        .from('league_teams')
        .select('id')
        .eq('league_id', pool.league_id)
        .in('team_id', teamIds)
        .limit(1);
      allowed = !!(inLeague && inLeague.length);
    }
    if (!allowed) {
      // teams.manager_id founders without a team_members row.
      const { data: founders } = await svc
        .from('teams')
        .select('id')
        .eq('manager_id', user.id);
      const founderIds = (founders ?? []).map((t) => t.id);
      if (founderIds.length) {
        const { data: inLeague } = await svc
          .from('league_teams')
          .select('id')
          .eq('league_id', pool.league_id)
          .in('team_id', founderIds)
          .limit(1);
        allowed = !!(inLeague && inLeague.length);
      }
    }
  }
  if (!allowed) return json({ error: 'only league staff or a team manager in this league can alert the pool' }, 403);

  // 3. Recipients: the pool's ACTIVE roster, minus the author/caller.
  const { data: poolMembers, error: memErr } = await svc
    .from('team_members')
    .select('user_id')
    .eq('team_id', pool.team_id)
    .eq('status', 'active')
    .not('user_id', 'is', null);
  if (memErr) return json({ error: memErr.message }, 500);
  const recipientIds = [...new Set((poolMembers ?? []).map((m) => m.user_id))]
    .filter((id) => id && id !== user.id && id !== post.author_id) as string[];
  if (recipientIds.length === 0) return json({ sent: 0, attempted: 0, reason: 'empty_pool' });

  const firstLine = String(post.content || '').split('\n').filter(Boolean)[0] || 'Sub needed';
  const title = `🏒 ${pool.team_name}`;
  const body = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  const url = `/team/${pool.team_id}`;

  // 4. In-app rows (bell). kind='sub_alert' is outside the generic push
  //    trigger's WHEN list — delivery happens below, exactly once.
  const { error: notifErr } = await svc.from('notifications').insert(
    recipientIds.map((rid) => ({
      recipient_id: rid,
      actor_id: post.author_id,
      kind: 'sub_alert',
      post_id: post.id,
      team_id: pool.team_id,
      url,
      body,
      metadata: { league_id: pool.league_id, pool_kind: pool.sub_pool_kind },
    })),
  );
  if (notifErr) {
    console.error('[send-sub-alert] notifications insert failed', { error: notifErr.message });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ sent: 0, attempted: 0, reason: 'vapid_not_configured' });
  }

  // 5. Web push to pool members only, pruning stale subscriptions.
  const { data: pushSubs, error: pushErr } = await svc
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', recipientIds);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  const tag = `subalert:${post.id}`; // collapse-key — a re-fire updates, never stacks
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
        console.error('[send-sub-alert] delivery failed', {
          user_id: s.user_id, post_id: post.id, statusCode,
          message: (err as { message?: string })?.message,
        });
      }
    }
  }));

  if (stale.length > 0) {
    await svc.from('push_subscriptions').delete().in('user_id', stale);
  }

  return json({ sent, attempted: pushSubs.length, pruned: stale.length, pool: pool.team_name });
});
