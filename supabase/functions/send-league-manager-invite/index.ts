import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// LEAGUE-MGR-1 — magic-link email for a league MANAGER invite.
//
// Kept as a dedicated function (rather than a new `send-invite` branch) so the
// shared, pilot-relevant send-invite is untouched in the pilot window. Post-pilot,
// fold this into a reconciled send-invite (which has repo/deployed drift to resolve)
// and retire this function.
//
// Pairs with create_league_manager_invite (token) + accept_league_manager_invite.
// The token is the bearer credential; the link routes to /accept-league-invite,
// which signs the recipient in (or through signup) before consuming.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'Rinkd <hello@rinkd.app>'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const hdr = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
const isToken = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{16,128}$/i.test(s)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { to_email, league_name, invited_by, accept_token } = await req.json()

    if (typeof to_email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to_email)) {
      return new Response(JSON.stringify({ error: 'Invalid recipient email' }), { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })
    }
    if (!isToken(accept_token)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing token' }), { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } })
    }

    const eEmail = esc(to_email)
    const eLeague = esc(league_name)
    const eInvitedBy = invited_by ? esc(invited_by) : null
    const acceptUrl = `https://www.rinkd.app/accept-league-invite?token=${encodeURIComponent(accept_token)}`

    const subject = hdr(`You're a manager for ${league_name || 'a league'} on Rinkd`)
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="margin:0;padding:0;background:#07111F;font-family:'Helvetica Neue',Arial,sans-serif;">
        <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;background:#0B1F3A;border-radius:12px;padding:16px 24px;">
              <span style="font-size:28px;font-weight:900;font-style:italic;color:#F4F7FA;letter-spacing:-0.5px;">R<span style="color:#D72638">INKD</span></span>
            </div>
          </div>
          <div style="background:#0B1F3A;border-radius:16px;padding:32px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.4);">
            <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">You're running the league. 🏆</div>
            <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:8px;">
              ${eInvitedBy ? `<strong style="color:#F4F7FA">${eInvitedBy}</strong> has invited you` : "You've been invited"}
              to help manage <strong style="color:#F4F7FA">${eLeague}</strong> on Rinkd as a league manager.
            </div>
            <div style="font-size:14px;color:rgba(244,247,250,0.5);line-height:1.6;margin-bottom:24px;">
              Click below to accept. If you don't have a Rinkd account yet, you'll create one with this email first — then you'll be set up as a manager automatically.
            </div>
            <a href="${acceptUrl}" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
              Accept Invitation →
            </a>
            <div style="font-size:11px;color:rgba(244,247,250,0.35);margin-top:18px;">
              This link expires in 14 days and can only be used once. Sign up with <strong style="color:rgba(244,247,250,0.6)">${eEmail}</strong> — the link verifies that the account matches.
            </div>
          </div>
          <div style="background:#0B1F3A;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.3);">
            <div style="font-size:13px;font-weight:700;color:rgba(244,247,250,0.4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">What a league manager can do</div>
            ${['🗓️ Build the schedule & playoffs', '👥 Manage teams & divisions', '✅ Approve roster join-requests', '🎬 Moderate the league feed & gallery'].map(item => `
              <div style="padding:5px 0;font-size:14px;color:rgba(244,247,250,0.7);">${item}</div>
            `).join('')}
          </div>
          <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
            You received this because ${eInvitedBy || 'a league commissioner'} invited you to help run the league.<br>
            <a href="https://www.rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
            <a href="https://www.rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
          </div>
        </div>
      </body>
      </html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to_email], subject, html }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('Resend error:', data)
      return new Response(JSON.stringify({ error: data }), { status: res.status, headers: { 'Access-Control-Allow-Origin': '*' } })
    }
    return new Response(JSON.stringify({ success: true, id: data.id }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } })
  }
})
