import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")
const FROM = "Rinkd <hello@rinkd.app>"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

// Authorize the caller to submit a scoresheet for this game. Mirrors the
// games_update / league_games_update RLS exactly: the assigned scorekeeper,
// the tournament director / league commissioner, or an assigned role-scorer.
// We never trust the request body for identity or for the recipient list —
// the caller is taken from the verified JWT and recipients are looked up from
// the game's own teams server-side. (Closes the prior hole where any authed
// user could email an arbitrary PDF to arbitrary addresses via this function
// and overwrite scoresheet_url on any game.)
async function authorizeAndResolveRecipients(svc, isLeague: boolean, gameId: string, userId: string) {
  if (isLeague) {
    const { data: g } = await svc.from("league_games")
      .select("league_id, scorekeeper_id, home_team_id, away_team_id").eq("id", gameId).single()
    if (!g) return { status: 404 }
    let ok = g.scorekeeper_id === userId
    if (!ok) {
      const { data: isCommish } = await svc.rpc("is_league_commissioner", { p_league_id: g.league_id, p_user_id: userId })
      ok = !!isCommish
    }
    if (!ok) {
      const { data: role } = await svc.from("league_roles")
        .select("user_id").eq("league_id", g.league_id).eq("user_id", userId).eq("role", "scorer").maybeSingle()
      ok = !!role
    }
    if (!ok) return { status: 403 }
    // recipients: league_teams.id -> teams.manager_id -> profiles.email
    let emails: string[] = []
    const ltIds = [g.home_team_id, g.away_team_id].filter(Boolean)
    if (ltIds.length) {
      const { data: lts } = await svc.from("league_teams").select("team_id").in("id", ltIds)
      const teamIds = (lts || []).map((x) => x.team_id).filter(Boolean)
      if (teamIds.length) {
        const { data: teams } = await svc.from("teams").select("manager_id").in("id", teamIds)
        const mgrIds = (teams || []).map((x) => x.manager_id).filter(Boolean)
        if (mgrIds.length) {
          const { data: profs } = await svc.from("profiles").select("email").in("id", mgrIds)
          emails = (profs || []).map((p) => p.email).filter(Boolean)
        }
      }
    }
    return { status: 200, emails }
  }

  const { data: g } = await svc.from("games")
    .select("tournament_id, scorekeeper_id, home_team_id, away_team_id").eq("id", gameId).single()
  if (!g) return { status: 404 }
  let ok = g.scorekeeper_id === userId
  if (!ok) {
    const { data: isDir } = await svc.rpc("is_tournament_director", { p_tournament_id: g.tournament_id, p_user_id: userId })
    ok = !!isDir
  }
  if (!ok) {
    const { data: role } = await svc.from("tournament_roles")
      .select("user_id").eq("tournament_id", g.tournament_id).eq("user_id", userId).eq("role", "scorer").maybeSingle()
    ok = !!role
  }
  if (!ok) return { status: 403 }
  // recipients: tournament_teams.contact_email
  let emails: string[] = []
  const ttIds = [g.home_team_id, g.away_team_id].filter(Boolean)
  if (ttIds.length) {
    const { data: tts } = await svc.from("tournament_teams").select("contact_email").in("id", ttIds)
    emails = (tts || []).map((t) => t.contact_email).filter(Boolean)
  }
  return { status: 200, emails }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    // Identify the caller from their JWT — never from the request body.
    // Pass the token explicitly to getUser(): in a stateless edge function
    // there's no persisted session, so the no-arg form would return null and
    // 401 every legitimate call.
    const authHeader = req.headers.get("Authorization") || ""
    const token = authHeader.replace(/^Bearer\s+/i, "")
    if (!token) return json({ error: "missing authorization" }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token)
    if (userErr || !user) return json({ error: "unauthorized" }, 401)

    const { pdf_base64, filename, game_id, is_league, home_team, away_team, context_name } = await req.json()
    if (!pdf_base64 || !filename || !game_id) return json({ error: "missing required fields" }, 400)

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Authorize for THIS game + resolve recipients server-side (ignore any
    // manager_emails in the body).
    const authz = await authorizeAndResolveRecipients(svc, !!is_league, game_id, user.id)
    if (authz.status === 404) return json({ error: "game not found" }, 404)
    if (authz.status === 403) return json({ error: "forbidden" }, 403)
    const recipientEmails: string[] = authz.emails || []

    const results: Record<string, string> = {}

    // Store the PDF.
    const pdfBytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0))
    const storagePath = `${is_league ? "league" : "tournament"}/${game_id}/${filename}`
    const { error: uploadError } = await svc.storage
      .from("scoresheets")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true })

    if (uploadError) {
      results.storage = "error: " + uploadError.message
      console.error("[submit-scoresheet] storage upload failed", { game_id, user_id: user.id, error: uploadError.message })
    } else {
      results.storage = "uploaded"
      const { data: urlData } = await svc.storage
        .from("scoresheets")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
      const scoresheetUrl = urlData?.signedUrl || null
      const table = is_league ? "league_games" : "games"
      await svc.from(table).update({ scoresheet_url: scoresheetUrl }).eq("id", game_id)
    }

    // Email the official scoresheet to the game's real team contacts.
    if (recipientEmails.length > 0 && RESEND_API_KEY) {
      const html = "<html><body style='background:#07111F;font-family:Arial,sans-serif;'><div style='max-width:520px;margin:0 auto;padding:32px 20px;'><div style='background:#0B1F3A;border-radius:16px;padding:32px;'><h2 style='color:#F4F7FA;'>Official Scoresheet</h2><p style='color:rgba(244,247,250,0.6);'>The signed scoresheet for " + home_team + " vs " + away_team + " in " + context_name + " is attached.</p><a href='https://www.rinkd.app' style='background:#D72638;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;display:inline-block;margin-top:16px;'>View on Rinkd</a></div></div></body></html>"
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: recipientEmails, subject: "Official Scoresheet — " + home_team + " vs " + away_team, html, attachments: [{ filename, content: pdf_base64 }] }),
      })
      if (emailRes.ok) {
        results.email = "sent"
      } else {
        results.email = "error"
        const detail = await emailRes.text().catch(() => "")
        console.error("[submit-scoresheet] resend email failed", { game_id, user_id: user.id, status: emailRes.status, detail })
      }
    } else {
      results.email = recipientEmails.length === 0 ? "skipped" : "no_api_key"
    }

    return json({ success: true, results })
  } catch (err) {
    console.error("[submit-scoresheet] unhandled error", { error: err?.message })
    return json({ error: err.message }, 500)
  }
})
