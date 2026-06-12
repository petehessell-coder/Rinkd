// GS-2 — alert the tournament director(s) the moment a suspension is filed.
//
// Invoked by the tr_enqueue_suspension_alert DB trigger (pg_net, anon-key
// bearer) so the alert fires for BOTH insert transports: the direct
// queuedWrite from ScorerView and the sync-scorekeeper-queue replay of an
// offline filing. Mirrors send-recap-push's posture: the caller supplies only
// an id; ALL targeting and payload data is looked up here with the service
// role — a caller can't influence who gets alerted or what they read.
//
// Per director it does two things:
//   1. inserts an in-app notifications row (kind='suspension' — deliberately
//      NOT in trg_enqueue_notification_push's WHEN list, so the generic
//      notification pusher won't double-push it), and
//   2. sends the web push itself (same delivery + stale-subscription pruning
//      loop as send-recap-push).
//
// Replay safety: the row's alerted_at is claimed atomically before sending —
// a re-POST with the same suspension_id (or a double trigger fire) reports
// 'already_alerted' instead of re-pushing the directors.
//
// Privacy: recipients are tournament directors only — the people already
// authorized to read the full game_suspensions row. Nothing here touches the
// public surface (that's get_tournament_suspension_flags, team-level only).
//
// Required secrets (same set as send-recap-push):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

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

const TYPE_LABELS: Record<string, string> = {
  game_misconduct: 'Game misconduct',
  match_penalty: 'Match penalty',
  suspension_1: '1-game suspension',
  suspension_2: '2-game suspension',
  suspension_3: '3-game suspension',
  indefinite: 'Indefinite suspension',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: { suspension_id?: string };
  try { payload = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const suspensionId = payload?.suspension_id;
  if (!suspensionId || typeof suspensionId !== 'string') return json({ error: 'suspension_id required' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Claim the alert atomically. 0 rows ⇒ unknown id, not pending, or
  //    already alerted — all of them mean "do not push".
  const { data: claimed, error: claimErr } = await supabase
    .from('game_suspensions')
    .update({ alerted_at: new Date().toISOString() })
    .eq('id', suspensionId)
    .eq('status', 'pending')
    .is('alerted_at', null)
    .select('id, tournament_id, game_id, team_id, player_name, jersey_number, suspension_type, games_remaining')
    .maybeSingle();
  if (claimErr) return json({ error: claimErr.message }, 500);
  if (!claimed) return json({ sent: 0, attempted: 0, reason: 'already_alerted_or_not_pending' });

  // 2. Resolve display context + the director set.
  const [{ data: tournament }, { data: team }, { data: roleRows }] = await Promise.all([
    supabase.from('tournaments').select('id, name, director_id').eq('id', claimed.tournament_id).maybeSingle(),
    supabase.from('tournament_teams').select('team_name').eq('id', claimed.team_id).maybeSingle(),
    supabase.from('tournament_roles').select('user_id').eq('tournament_id', claimed.tournament_id).eq('role', 'director'),
  ]);
  if (!tournament) return json({ error: 'tournament not found' }, 404);

  const directorIds = [...new Set(
    [tournament.director_id, ...(roleRows ?? []).map((r) => r.user_id)].filter(Boolean),
  )] as string[];
  if (directorIds.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_directors' });

  const typeLabel = TYPE_LABELS[claimed.suspension_type] || claimed.suspension_type;
  const who = `${claimed.jersey_number != null ? `#${claimed.jersey_number} ` : ''}${claimed.player_name}`;
  const title = `🚨 Suspension filed — ${tournament.name}`;
  const body = [
    `${who} (${team?.team_name || 'Unknown team'})`,
    typeLabel,
    claimed.suspension_type !== 'indefinite' ? `${claimed.games_remaining} game${claimed.games_remaining === 1 ? '' : 's'} to serve` : null,
  ].filter(Boolean).join(' · ');
  const url = `/tournament/${tournament.id}/manage`;

  // 3. In-app rows for the bell. kind='suspension' keeps the generic push
  //    trigger quiet (it's not in the WHEN list) — delivery happens below.
  const { error: notifErr } = await supabase.from('notifications').insert(
    directorIds.map((rid) => ({
      recipient_id: rid,
      kind: 'suspension',
      game_id: claimed.game_id,
      url,
      body,
      metadata: { suspension_id: claimed.id, tournament_id: tournament.id },
    })),
  );
  if (notifErr) {
    // Non-fatal: push below is the time-critical half. Log and keep going.
    console.error('[send-suspension-alert] notifications insert failed', { error: notifErr.message });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ sent: 0, attempted: 0, reason: 'vapid_not_configured' });
  }

  // 4. Web push to the directors, pruning expired subscriptions (the
  //    send-recap-push loop).
  const { data: pushSubs, error: pushErr } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', directorIds);
  if (pushErr) return json({ error: pushErr.message }, 500);
  if (!pushSubs || pushSubs.length === 0) return json({ sent: 0, attempted: 0, reason: 'no_push_subscriptions' });

  const tag = `suspension:${claimed.id}`; // collapse-key so a re-fire doesn't stack
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
        console.error('[send-suspension-alert] delivery failed', {
          user_id: s.user_id, suspension_id: claimed.id, statusCode,
          message: (err as { message?: string })?.message,
        });
      }
    }
  }));

  if (stale.length > 0) {
    await supabase.from('push_subscriptions').delete().in('user_id', stale);
  }

  return json({ sent, attempted: pushSubs.length, pruned: stale.length });
});
