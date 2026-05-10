import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'Rinkd <hello@rinkd.app>'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { type, to_email, to_name, team_name, league_name, invited_by } = await req.json()

    let subject = ''
    let html = ''

    if (type === 'team_invite') {
      subject = `You've been added to ${team_name} on Rinkd`
      html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;padding:0;background:#07111F;font-family:'Helvetica Neue',Arial,sans-serif;">
          <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
            
            <!-- Logo -->
            <div style="text-align:center;margin-bottom:32px;">
              <div style="display:inline-block;background:#0B1F3A;border-radius:12px;padding:16px 24px;">
                <span style="font-size:28px;font-weight:900;font-style:italic;color:#F4F7FA;letter-spacing:-0.5px;">R<span style="color:#D72638">INKD</span></span>
              </div>
            </div>

            <!-- Card -->
            <div style="background:#0B1F3A;border-radius:16px;padding:32px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.4);">
              <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">
                You're on the roster. 🏒
              </div>
              <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:24px;">
                ${invited_by ? `<strong style="color:#F4F7FA">${invited_by}</strong> has added` : 'You\'ve been added'}
                <strong style="color:#F4F7FA"> ${to_name || 'you'}</strong> to 
                <strong style="color:#F4F7FA">${team_name}</strong> on Rinkd.
                Create your free account to claim your spot, view the roster, and follow your team's schedule.
              </div>
              <a href="https://rinkd.app" 
                style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;letter-spacing:0.01em;">
                Claim Your Spot →
              </a>
            </div>

            <!-- What is Rinkd -->
            <div style="background:#0B1F3A;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.3);">
              <div style="font-size:13px;font-weight:700;color:rgba(244,247,250,0.4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">What is Rinkd?</div>
              ${['🏒 Team rosters & schedules', '📊 Live scores & standings', '🎬 Game highlights & feed', '🥅 Tournament & league management'].map(item => `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:14px;color:rgba(244,247,250,0.7);">${item}</div>
              `).join('')}
            </div>

            <!-- Footer -->
            <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
              You received this because ${invited_by || 'a team manager'} added you to their roster.<br>
              <a href="https://rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> · 
              <a href="https://rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
            </div>
          </div>
        </body>
        </html>
      `
    }

    if (type === 'league_invite') {
      subject = `${league_name} is on Rinkd`
      html = `
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
              <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">
                Your league is live. 🏆
              </div>
              <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:24px;">
                <strong style="color:#F4F7FA">${league_name}</strong> is now on Rinkd.
                Follow live standings, scores, and the full season schedule — all in one place.
              </div>
              <a href="https://rinkd.app/leagues" 
                style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
                View League →
              </a>
            </div>
            <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);">
              <a href="https://rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> · 
              <a href="https://rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
            </div>
          </div>
        </body>
        </html>
      `
    }

    if (!subject || !html) {
      return new Response(JSON.stringify({ error: 'Invalid invite type' }), { status: 400 })
    }

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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } })
  }
})
