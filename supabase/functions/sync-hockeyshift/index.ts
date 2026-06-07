// Supabase Edge Function: sync-hockeyshift
// -----------------------------------------------------------------------------
// Pulls live league data from HockeyShift / DigitalShift (the ShiftStats API)
// and upserts it into Rinkd's league_teams + league_games + team_members for any
// league wired up via settings.hockeyshift.division_id.
//
// "Rinkd Social import wedge": an operator keeps scoring in their existing tool
// (HockeyShift), Rinkd pulls results, and the existing recap / standings / feed /
// leaderboard / roster surfaces do the rest. No double entry.
//
// Idempotent: every row is upserted on (external_source, external_id), so this
// is safe to run on a cron (every few minutes during game windows).
//
// First proven against XRHL (eXtreme Roller Hockey League, Toledo) — ShiftStats
// division 48313 — June 2026. Season opens 2026-07-10.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHIFT_BASE = "http://api.shiftstats.com/";
// Read-only key shipped inside the public HockeyShift mobile apps. Same key the
// open-source `shift_stats` client uses. Read access only; no XRHL credentials.
const SHIFT_KEY =
  "YXBpLnNoaWZ0c3RhdHMuY29tLDE5YjhhZGIwNDVjZjAxMzJhM2E5N2VmZDQ1YTRj";

const SHIFT_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Requested-With": "com.digitalshift.hockeyshift",
  "Accept-Language": "en-US",
};

async function shiftLogin(): Promise<string> {
  const r = await fetch(
    `${SHIFT_BASE}login?key=${encodeURIComponent(SHIFT_KEY)}`,
    { headers: SHIFT_HEADERS },
  );
  const j = await r.json();
  const ticket = j?.ticket?.hash;
  if (!ticket) {
    throw new Error("ShiftStats login failed: " + JSON.stringify(j).slice(0, 200));
  }
  return ticket;
}

function shiftGet(path: string, ticket: string): Promise<any> {
  return fetch(`${SHIFT_BASE}${path}`, {
    headers: { ...SHIFT_HEADERS, Authorization: `StatsAuth ticket="${ticket}"` },
  }).then((r) => r.json());
}

// ShiftStats status -> Rinkd league_games.status ('scheduled' | 'live' | 'final')
function mapStatus(g: any): string {
  const s = String(g?.status || "").toLowerCase();
  if (g?.is_finalized || g?.final_status || s === "final" || s === "forfeit") {
    return "final";
  }
  if (s === "in progress" || s === "in-progress" || s === "live") return "live";
  return "scheduled";
}

function startTime(g: any): string | null {
  if (g?.datetime_tz) return g.datetime_tz;
  if (g?.datetime) return g.datetime;
  if (g?.date) return `${g.date}T${g.time || "19:00"}`;
  return null;
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find leagues wired to a HockeyShift division. Only a handful of leagues,
    // so filter in JS rather than fight PostgREST nested-jsonb null filters.
    const { data: leagues, error: lerr } = await supabase
      .from("leagues")
      .select("id, name, settings");
    if (lerr) throw lerr;

    const wired = (leagues || []).filter(
      (l: any) => l?.settings?.hockeyshift?.division_id,
    );
    if (wired.length === 0) {
      return json({ ok: true, synced: [], note: "no leagues wired to hockeyshift" });
    }

    const ticket = await shiftLogin();
    const summary: any[] = [];

    for (const lg of wired) {
      const div = lg.settings.hockeyshift.division_id;

      // 1) Teams — insert any we don't have yet. We DON'T overwrite existing
      //    rows (ignoreDuplicates) so curated logos/names are preserved.
      const teamsRes = await shiftGet(`division/${div}/teams`, ticket);
      const teams: any[] = teamsRes?.teams || [];
      for (const t of teams) {
        await supabase.from("league_teams").upsert(
          {
            league_id: lg.id,
            external_source: "hockeyshift",
            external_id: String(t.id),
            team_name: t.name,
            logo_initials: (t.short_name || t.name || "?").slice(0, 3).toUpperCase(),
            logo_url: t?.logo_url?.medium || t?.logo_url?.full || null,
          },
          { onConflict: "external_source,external_id", ignoreDuplicates: true },
        );
      }

      // Map ShiftStats team id -> Rinkd league_team.id (games) and -> global
      // teams.id (rosters live in team_members on the global team).
      const { data: lts } = await supabase
        .from("league_teams")
        .select("id, external_id, team_id")
        .eq("league_id", lg.id)
        .eq("external_source", "hockeyshift");
      const leagueTeamMap = new Map<string, string>();
      const globalTeamMap = new Map<string, string>();
      (lts || []).forEach((r: any) => {
        leagueTeamMap.set(String(r.external_id), r.id);
        if (r.team_id) globalTeamMap.set(String(r.external_id), r.team_id);
      });

      // 2) Games — full upsert (scores/status change over time = the live path).
      const gamesRes = await shiftGet(`division/${div}/games`, ticket);
      const games: any[] = gamesRes?.games || [];
      let gcount = 0, gskip = 0;
      for (const g of games) {
        const home = leagueTeamMap.get(String(g.home_team_id));
        const away = leagueTeamMap.get(String(g.away_team_id));
        if (!home || !away) { gskip++; continue; }

        const row: Record<string, unknown> = {
          league_id: lg.id,
          external_source: "hockeyshift",
          external_id: String(g.id),
          home_team_id: home,
          away_team_id: away,
          start_time: startTime(g),
          home_score: g.home_score ?? 0,
          away_score: g.away_score ?? 0,
          status: mapStatus(g),
        };
        if (g.watch_live_url) row.youtube_url = g.watch_live_url;

        const { error: gerr } = await supabase
          .from("league_games")
          .upsert(row, { onConflict: "external_source,external_id" });
        if (gerr) throw gerr;
        gcount++;
      }

      // 3) Rosters — per team, pull active players and upsert team_members on
      //    the linked global team. Ghost roster: user_id null, name in
      //    invite_name (same shape Rinkd already uses for imported rosters).
      let rcount = 0, rskip = 0;
      for (const t of teams) {
        const globalTeamId = globalTeamMap.get(String(t.id));
        if (!globalTeamId) { rskip++; continue; }
        const playersRes = await shiftGet(
          `team/${t.id}/players?status=active`, ticket,
        );
        const players: any[] = playersRes?.players || [];
        for (const p of players) {
          const name = (p.name ||
            `${p.first_name || ""} ${p.last_name || ""}`).trim();
          if (!name) continue;
          const isGoalie = String(p.position || "").toUpperCase() === "G";
          const row: Record<string, unknown> = {
            team_id: globalTeamId,
            external_source: "hockeyshift",
            external_id: String(p.id),
            invite_name: name,
            jersey_number: p.number ?? null,
            position: p.position || null,
            role: isGoalie ? "goalie" : "player",
            status: "active",
          };
          const { error: rerr } = await supabase
            .from("team_members")
            .upsert(row, { onConflict: "external_source,external_id" });
          if (rerr) throw rerr;
          rcount++;
        }
      }

      summary.push({
        league: lg.name,
        division: div,
        teams_seen: teams.length,
        games_upserted: gcount,
        games_skipped_unmapped: gskip,
        roster_members_upserted: rcount,
        teams_skipped_no_global: rskip,
      });
    }

    return json({ ok: true, synced: summary });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
  });
}
