import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'Rinkd <hello@rinkd.app>'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    const { type, to_email, to_name, team_name, league_name, league_id, division, season, invited_by, tournament_name, tournament_id } = await req.json()

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
            <div style="text-align:center;margin-bottom:32px;">
              <div style="display:inline-block;background:#0B1F3A;border-radius:12px;padding:16px 24px;">
                <span style="font-size:28px;font-weight:900;font-style:italic;color:#F4F7FA;letter-spacing:-0.5px;">R<span style="color:#D72638">INKD</span></span>
              </div>
            </div>
            <div style="background:#0B1F3A;border-radius:16px;padding:32px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.4);">
              <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">You're on the roster. 🏒</div>
              <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:24px;">
                ${invited_by ? `<strong style="color:#F4F7FA">${invited_by}</strong> has added` : "You've been added"}
                <strong style="color:#F4F7FA"> ${to_name || 'you'}</strong> to
                <strong style="color:#F4F7FA">${team_name}</strong> on Rinkd.
                Create your free account to claim your spot, view the roster, and follow your team's schedule.
              </div>
              <a href="https://www.rinkd.app" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
                Claim Your Spot →
              </a>
            </div>
            <div style="background:#0B1F3A;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.3);">
              <div style="font-size:13px;font-weight:700;color:rgba(244,247,250,0.4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">What is Rinkd?</div>
              ${['🏒 Team rosters & schedules', '📊 Live scores & standings', '🎬 Game highlights & feed', '🥅 Tournament & league management'].map(item => `
                <div style="padding:5px 0;font-size:14px;color:rgba(244,247,250,0.7);">${item}</div>
              `).join('')}
            </div>
            <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
              You received this because ${invited_by || 'a team manager'} added you to their roster.<br>
              <a href="https://www.rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
              <a href="https://www.rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
            </div>
          </div>
        </body>
        </html>`
    }

    if (type === 'league_invite') {
      const leagueUrl = league_id ? `https://www.rinkd.app/league/${league_id}` : 'https://www.rinkd.app/leagues';
      subject = `${league_name} is on Rinkd — your team has been added`
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
              <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">Your league is live. 🏆</div>
              <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:8px;">
                Your team has been added to <strong style="color:#F4F7FA">${league_name}</strong> on Rinkd.
              </div>
              ${division || season ? `
              <div style="background:rgba(46,91,140,0.2);border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                ${division ? `<div style="font-size:13px;color:rgba(244,247,250,0.6);margin-bottom:4px;">Division: <strong style="color:#F4F7FA">${division}</strong></div>` : ''}
                ${season ? `<div style="font-size:13px;color:rgba(244,247,250,0.6);">Season: <strong style="color:#F4F7FA">${season}</strong></div>` : ''}
              </div>` : '<div style="margin-bottom:20px;"></div>'}
              <div style="font-size:14px;color:rgba(244,247,250,0.5);line-height:1.6;margin-bottom:24px;">
                Follow live standings, scores, and the full season schedule — all in one place.
                The league page will be active once the commissioner publishes the schedule.
              </div>
              <a href="${leagueUrl}" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
                View League →
              </a>
            </div>
            <div style="background:#0B1F3A;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(46,91,140,0.3);">
              <div style="font-size:13px;font-weight:700;color:rgba(244,247,250,0.4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;">What you can do on Rinkd</div>
              ${['📊 Live standings updated after every game', '📅 Full season schedule in one place', '🏒 Manage your team roster & RSVP', '🎬 Share game highlights & updates'].map(item => `
                <div style="padding:5px 0;font-size:14px;color:rgba(244,247,250,0.7);">${item}</div>
              `).join('')}
            </div>
            <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
              <a href="https://www.rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
              <a href="https://www.rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
            </div>
          </div>
        </body>
        </html>`
    }

    if (type === 'tournament_scorer_invite') {
      const tournamentUrl = tournament_id ? `https://www.rinkd.app/tournament/${tournament_id}` : 'https://www.rinkd.app'
      subject = `You're on the scorer crew for ${tournament_name || 'a tournament'} on Rinkd`
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
              <div style="font-size:22px;font-weight:900;font-style:italic;color:#F4F7FA;margin-bottom:8px;">You're keeping score. 🥅</div>
              <div style="font-size:15px;color:rgba(244,247,250,0.6);line-height:1.6;margin-bottom:24px;">
                ${invited_by ? `<strong style="color:#F4F7FA">${invited_by}</strong> wants you` : "You've been asked"}
                on the scorer crew for <strong style="color:#F4F7FA">${tournament_name || 'a tournament'}</strong> on Rinkd.
                Create your free account with this email address, and you'll be able to run the scoreboard for assigned games.
              </div>
              <a href="${tournamentUrl}" style="display:inline-block;background:#D72638;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;">
                Join Rinkd →
              </a>
            </div>
            <div style="text-align:center;font-size:12px;color:rgba(244,247,250,0.25);line-height:1.6;">
              You received this because ${invited_by || 'a tournament director'} added you as a scorer.<br>
              Once you've signed up with this email, they'll finish adding you.<br>
              <a href="https://www.rinkd.app" style="color:rgba(244,247,250,0.4);">rinkd.app</a> ·
              <a href="https://www.rinkd.app/privacy" style="color:rgba(244,247,250,0.4);">Privacy</a>
            </div>
          </div>
        </body>
        </html>`
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
