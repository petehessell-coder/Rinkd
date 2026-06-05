// Hourly cron: drips the three onboarding emails (welcome / find-your-team / first-highlight)
// based on profile age. Ledger table onboarding_emails_sent prevents duplicates.
//
// Cron schedule (pg_cron): minute 15 of every hour
//   select cron.schedule('rinkd-onboarding-emails-hourly','15 * * * *',
//     $$ select net.http_post(
//          url:='https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/send-onboarding-emails',
//          headers:=jsonb_build_object('Content-Type','application/json'),
//          body:='{}'::jsonb,
//          timeout_milliseconds:=60000
//        ) $$);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM = 'Rinkd <hello@rinkd.app>';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escape(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function shellHtml({ eyebrow, headline, body, ctaLabel, ctaUrl, footnote }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07111F;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#0B1F3A;border-radius:16px;padding:18px 28px;border:1px solid rgba(46,91,140,0.4);">
        <img src="https://rinkd.app/mascot-rizzo.png" alt="Rizzo — Rinkd mascot" width="120" style="display:block;width:120px;height:auto;margin:0 auto 10px;border:0;" />
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:900;font-style:italic;color:#F4F7FA;letter-spacing:0.08em;text-transform:uppercase;text-align:center;">R<span style="color:#D72638">INKD</span></div>
      </div>
    </div>
    <div style="background:#0B1F3A;border-radius:16px;padding:32px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.4);">
      <div style="font-size:11px;font-weight:700;color:#D72638;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">${escape(eyebrow)}</div>
      <div style="font-size:24px;font-weight:900;font-style:italic;color:#F4F7FA;line-height:1.15;margin-bottom:14px;">${escape(headline)}</div>
      <div style="font-size:15px;color:rgba(244,247,250,0.75);line-height:1.65;margin-bottom:22px;">${body}</div>
      <a href="${escape(ctaUrl)}" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">${escape(ctaLabel)}</a>
      ${footnote ? `<div style="font-size:12px;color:rgba(244,247,250,0.4);margin-top:18px;line-height:1.5;">${footnote}</div>` : ''}
    </div>
    <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
      <a href="https://rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
      <a href="https://rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
    </div>
  </div>
</body></html>`;
}

const TEMPLATES = {
  welcome_day0: (name) => ({
    subject: `Welcome to the locker room${name ? `, ${name}` : ''} 🏒`,
    html: shellHtml({
      eyebrow: 'Welcome',
      headline: `Welcome to the locker room${name ? `, ${name}` : ''}.`,
      body: `Rinkd is the social platform built for the hockey community — players, parents, coaches, fans. <br/><br/>Three things worth doing in your first week:<br/><br/>
        • <strong style="color:#F4F7FA">Find your team</strong> — join a roster or invite your captain<br/>
        • <strong style="color:#F4F7FA">Drop your first highlight</strong> — photo or short clip<br/>
        • <strong style="color:#F4F7FA">Follow a few players</strong> — your feed gets better the more people you follow`,
      ctaLabel: 'Open Rinkd →',
      ctaUrl: 'https://rinkd.app/feed',
    }),
  }),
  find_team_day3: (name) => ({
    subject: `${name ? name + ', f' : 'F'}ind your team on Rinkd`,
    html: shellHtml({
      eyebrow: 'Day 3',
      headline: 'Where do you play?',
      body: `Rinkd is most useful once your team is on it. Two ways to get rolling:<br/><br/>
        • <strong style="color:#F4F7FA">Search Discover</strong> — if your team is already on Rinkd, tap Request to Join and your manager will see it instantly<br/>
        • <strong style="color:#F4F7FA">Create the team yourself</strong> — takes 60 seconds, then forward the invite link to your bench`,
      ctaLabel: 'Find or Create a Team →',
      ctaUrl: 'https://rinkd.app/discover',
      footnote: 'Once your team is set up, the rest of Rinkd — schedule, RSVP, lineups, calendar export, push reminders — turns on automatically.',
    }),
  }),
  first_highlight_day7: () => ({
    subject: 'Post your first highlight',
    html: shellHtml({
      eyebrow: 'Day 7',
      headline: 'Got a goal this week?',
      body: `Drop a photo or short clip on your feed — first highlights are how the rest of the community finds you.<br/><br/>
        Tap the camera icon in the composer, pick a photo or up to 50MB of video, and you're live. Bonus points if you tag it with <span style="color:#D72638;font-weight:700">Goal Alert</span> or <span style="color:#2E5B8C;font-weight:700">Game Recap</span>.`,
      ctaLabel: 'Drop a Post →',
      ctaUrl: 'https://rinkd.app/feed',
      footnote: `Don't have a clip handy? Repost or comment on someone else's — it counts.`,
    }),
  }),
};

async function sendOne(toEmail, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [toEmail], subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, id: data.id } : { ok: false, err: data };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const startedAt = Date.now();

  try {
    const now = Date.now();
    const buckets = [
      { kind: 'welcome_day0',         minHoursAgo: 0,    maxHoursAgo: 48 },
      { kind: 'find_team_day3',       minHoursAgo: 60,   maxHoursAgo: 120 },
      { kind: 'first_highlight_day7', minHoursAgo: 144,  maxHoursAgo: 216 },
    ];

    let attempted = 0, sent = 0, skippedDup = 0, failed = 0;

    for (const b of buckets) {
      const minIso = new Date(now - b.maxHoursAgo * 3600 * 1000).toISOString();
      const maxIso = new Date(now - b.minHoursAgo * 3600 * 1000).toISOString();

      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, email, name, created_at')
        .gte('created_at', minIso)
        .lt('created_at', maxIso)
        .not('email', 'is', null);
      if (error) { console.error('[onboarding] load error', b.kind, error); continue; }

      const ids = (profiles || []).map(p => p.id);
      if (!ids.length) continue;
      const { data: already } = await supabase
        .from('onboarding_emails_sent')
        .select('user_id')
        .eq('kind', b.kind)
        .in('user_id', ids);
      const seen = new Set((already || []).map((r) => r.user_id));

      for (const p of (profiles || [])) {
        if (seen.has(p.id)) { skippedDup++; continue; }
        attempted++;
        const tpl = TEMPLATES[b.kind](p.name || '');
        const r = await sendOne(p.email, tpl.subject, tpl.html);
        if (r.ok) {
          sent++;
          await supabase.from('onboarding_emails_sent').insert({
            user_id: p.id, email: p.email, kind: b.kind, resend_id: r.id ?? null,
          });
        } else {
          failed++;
          console.error('[onboarding] send fail', { user: p.id, kind: b.kind, err: r.err });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, attempted, sent, skipped_duplicate: skippedDup, failed, elapsed_ms: Date.now() - startedAt }),
      { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[onboarding] fatal', err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
