#!/usr/bin/env node
/**
 * ChillerStats — Step 3: Upsert scraped teams + games into Supabase.
 *
 * Reads data/schedules.json (produced by scrape.js), then upserts:
 *   - public.teams  (one row per ChillerStats team) — as a ghost team:
 *       source = 'external:chillerstats'
 *       external_id = ChillerStats TeamID
 *       external_source_url = ChillerStats team URL
 *       claimed_by = NULL (no Rinkd user yet)
 *       is_verified = false (until 2+ Rinkd players join)
 *       manager_id = NULL (will be set when claimed)
 *   - public.team_games (one row per scraped game)
 *
 * Dedup is automatic via the unique index on (source, external_id).
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY in env (NOT the anon key — we need to
 *   write to teams unconditionally, and RLS will block the anon key).
 *
 * Run:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/chiller/load.js
 *   (the URL is hard-coded since the Supabase project ID won't change)
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tbpoopsyhfuqcbugrjbh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Grab it from:');
  console.error('  https://supabase.com/dashboard/project/tbpoopsyhfuqcbugrjbh/settings/api-keys');
  console.error('Then run: SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/chiller/load.js');
  process.exit(1);
}

const IN_FILE = path.join(__dirname, 'data', 'schedules.json');

const HOCKEY_COLOR_PALETTE = ['#0B1F3A', '#D72638', '#2E5B8C', '#22C55E', '#F59E0B', '#8B5CF6', '#0EA5E9'];

function pickColor(seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HOCKEY_COLOR_PALETTE[h % HOCKEY_COLOR_PALETTE.length];
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/** Best-effort parse "10/14/25" or "Oct 14, 2025" + optional "7:30 PM" → ISO. */
function toIsoStart(rawDate, rawTime, fallbackYear) {
  if (!rawDate) return null;
  const dt = `${rawDate} ${rawTime || ''}`.trim();
  let d = new Date(dt);
  if (isNaN(d.getTime())) {
    // Try mm/dd/yy explicitly
    const m = rawDate.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m) {
      let [_, mo, da, yr] = m;
      yr = yr ? (yr.length === 2 ? '20' + yr : yr) : String(fallbackYear || new Date().getFullYear());
      d = new Date(`${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}T${rawTime || '19:00'}`);
    }
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function rpc(table, body, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: opts.method || 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${table}: ${res.status} ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error('Missing data/schedules.json. Run scrape.js first.');
    process.exit(1);
  }
  const rows = JSON.parse(fs.readFileSync(IN_FILE, 'utf8')).filter((r) => !r.error && r.teamName);

  console.log(`Loading ${rows.length} teams into Supabase...`);

  let teamsUpserted = 0;
  let gamesUpserted = 0;

  for (const r of rows) {
    // 1) Upsert the team. Conflict target: (source, external_id) via unique index.
    // Slug must be globally unique on the teams table — two different external
    // teams can legitimately share a name (e.g. multiple "Bruins" across divisions),
    // so we always suffix with the last 6 hex chars of the ChillerStats TeamID
    // GUID. Format: "dayton-fire-cs61a8de". Stable, readable, collision-free.
    const baseSlug = (r.teamName || 'team').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const idSuffix = (r.teamId || '').replace(/-/g, '').slice(-6).toLowerCase();
    const slug = `${baseSlug}-cs${idSuffix}`;
    const teamPayload = {
      name: r.teamName,
      slug,
      division: r.division || null,
      level: 'Beer League',
      location: 'Columbus, OH',
      home_rink: 'Chiller (TBD location)',
      logo_color: pickColor(r.teamName),
      logo_initials: initials(r.teamName),
      manager_id: null,
      is_public: true,
      source: 'external:chillerstats',
      external_id: r.teamId,
      external_source_url: r.scheduleUrl,
      is_verified: false,
      imported_at: new Date().toISOString(),
    };

    const teamRows = await rpc('teams?on_conflict=source,external_id', [teamPayload]);
    const team = teamRows[0];
    if (!team) {
      console.error(`  Skipping ${r.teamName} (no row returned)`);
      continue;
    }
    teamsUpserted++;

    // 2) Upsert games. Each ChillerStats game gets an external_id like
    //    "<TeamID>:<rawDate>:<opponent>" so re-runs are idempotent.
    if (!Array.isArray(r.games) || r.games.length === 0) continue;

    const fallbackYear = r.season && /(\d{4})/.test(r.season) ? Number(r.season.match(/\d{4}/)[0]) : null;

    const gamePayloads = r.games
      .filter((g) => g.opponent)
      .map((g) => ({
        team_id: team.id,
        opponent: g.opponent,
        is_home: g.isHome,
        // Real rink + surface (e.g. "NTPRD Chiller · Main Ice"). Falls back
        // to just the rink, or null, if either is missing.
        location: g.rink
          ? (g.surface ? `${g.rink} · ${g.surface}` : g.rink)
          : null,
        start_time: toIsoStart(g.rawDate, g.rawTime, fallbackYear),
        home_score: g.homeScore,
        away_score: g.awayScore,
        status: g.status === 'final' ? 'final' : 'scheduled',
        notes: g.outcome ? `outcome: ${g.outcome}` : null,
        source: 'external:chillerstats',
        external_id: `${r.teamId}:${(g.rawDate || '').replace(/\s+/g, '')}:${(g.opponent || '').slice(0, 60)}`,
        external_source_url: r.scheduleUrl,
        imported_at: new Date().toISOString(),
      }))
      .filter((g) => g.start_time);

    if (gamePayloads.length > 0) {
      await rpc('team_games?on_conflict=source,external_id', gamePayloads);
      gamesUpserted += gamePayloads.length;
    }

    console.log(`  ✓ ${r.teamName} (${gamePayloads.length} games)`);
  }

  console.log(`\nDone. Teams: ${teamsUpserted} · Games: ${gamesUpserted}`);
  console.log(`\nVerify in Supabase:`);
  console.log(`  SELECT name, division, source FROM teams WHERE source='external:chillerstats' ORDER BY name LIMIT 20;`);
}

main().catch((e) => { console.error(e); process.exit(1); });
