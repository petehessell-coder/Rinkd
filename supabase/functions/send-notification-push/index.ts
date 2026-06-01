// Fire a single web push for one in-app notification. Generic over notification
// kind — the notify triggers (comment / mention / reaction / …) already write
// recipient_id + body + url into public.notifications, so this function is the
// one place that turns any of those rows into an OS-level push.
//
// Invoked by the AFTER INSERT trigger on public.notifications (enqueue_notification_push)
// via pg_net, passing { notification_id }. pg_net is fire-and-forget, so a push
// failure can never block or roll back the action that created the notification
// (a comment, a reaction, etc.). Targeting is derived entirely server-side from
// notification_id — the caller can't influence who gets pushed or the payload.
//
// Auth: the trigger calls with the project's public anon key as bearer, which
// satisfies the gateway's verify_jwt. DB access here uses the service role.
//
// Required secrets (shared across Edge Functions, already set for send-recap-push):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT

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

// Per-kind toast title. Body comes verbatim from notifications.body (e.g.
// "Jordan commented on your post"), which already names the actor.
const KIND_TITLE: Record<string, string> = {
  comment:  '💬 New comment',
  mention:  '@ You were mentioned',
  reaction: '🔥 New reaction',
  like:     '❤️ New like',
  follow:   '👀 New follower',
};

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

  let payload: { notification_id?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const notificationId = payload?.notification_id;
  if (!notificationId || typeof notificationId !== 'string') return json({ error: 'notification_id required' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Load the notification — recipient + copy are already resolved by the
  //    notify trigger that created it.
  const { data: notif, error: notifErr } = await supabase
    .from('notifications')
    .select('id, recipient_id, kind, body, url')
    .eq('id', notificationId)
    .maybeSingle();
  if (notifErr) return json({ error: notifErr.message }, 500);
  if (!notif) return json({ error: 'notification not found' }, 404);
  if (!notif.recipient_id) return json({ sent: 0, attempted: 0, reason: 'no_recipient' });

  // 2. Resolve the recipient's push subscriptions (a user can have several —
  //    phone + laptop, etc).
  const { data: pushSubs, error: pushErr } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, subscription')
    .eq('user_id', notif.recipient_id);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  // 3. Build the toast. Collapse-key by recipient+kind so a burst (e.g. a
  //    flurry of reactions) coalesces into one OS notification instead of a
  //    stack of them.
  const title = KIND_TITLE[notif.kind] || 'Rinkd';
  const body = notif.body || 'Tap to open Rinkd.';
  const url = notif.url || '/feed';
  const tag = `notif:${notif.recipient_id}:${notif.kind}`;
  const pushPayload = JSON.stringify({ title, body, url, tag });

  // 4. Send in parallel; prune expired/cancelled subs (410/404). Prune by the
  //    specific subscription row id, not user_id — a user's other devices must
  //    survive when one endpoint expires.
  const stale: string[] = [];
  let sent = 0;
  await Promise.all(pushSubs.map(async (s) => {
    let parsed: unknown;
    try { parsed = JSON.parse(s.subscription); }
    catch { stale.push(s.id); return; }
    try {
      await webpush.sendNotification(parsed as { endpoint: string }, pushPayload);
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        stale.push(s.id);
      } else {
        console.error('[send-notification-push] delivery failed', {
          recipient_id: notif.recipient_id, notification_id: notif.id, kind: notif.kind,
          statusCode, message: (err as { message?: string })?.message,
        });
      }
    }
  }));

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', stale);
  }

  return json({ sent, attempted: pushSubs.length, pruned: stale.length });
});
