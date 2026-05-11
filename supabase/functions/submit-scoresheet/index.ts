import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const FROM = "Rinkd <hello@rinkd.app>"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } })
  }
  try {
    const { pdf_base64, filename, game_id, is_league, home_team, away_team, context_name, manager_emails } = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const results = {}

    const pdfBytes = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0))
    const storagePath = `${is_league ? "league" : "tournament"}/${game_id}/${filename}`
    const { error: uploadError } = await supabase.storage
      .from("scoresheets")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true })

    if (uploadError) {
      results.storage = "error: " + uploadError.message
    } else {
      results.storage = "uploaded"
      const { data: urlData } = await supabase.storage
        .from("scoresheets")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
      const scoresheetUrl = urlData?.signedUrl || null
      const table = is_league ? "league_games" : "games"
      await supabase.from(table).update({ scoresheet_url: scoresheetUrl }).eq("id", game_id)
    }

    if (manager_emails?.length > 0 && RESEND_API_KEY) {
      const html = "<html><body style='background:#07111F;font-family:Arial,sans-serif;'><div style='max-width:520px;margin:0 auto;padding:32px 20px;'><div style='background:#0B1F3A;border-radius:16px;padding:32px;'><h2 style='color:#F4F7FA;'>Official Scoresheet</h2><p style='color:rgba(244,247,250,0.6);'>The signed scoresheet for " + home_team + " vs " + away_team + " in " + context_name + " is attached.</p><a href='https://www.rinkd.app' style='background:#D72638;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;display:inline-block;margin-top:16px;'>View on Rinkd</a></div></div></body></html>"
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: manager_emails, subject: "Official Scoresheet — " + home_team + " vs " + away_team, html, attachments: [{ filename, content: pdf_base64 }] }),
      })
      results.email = emailRes.ok ? "sent" : "error"
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Access-Control-Allow-Origin": "*" }
    })
  }
})
