#!/usr/bin/env node
/**
 * ChillerStats — Step 1: Discover all teams.
 *
 * ChillerStats organizes around three GUIDs:
 *   - LeagueID  → e.g. "Tuesday C West" (the playing slot, runs every season)
 *   - TeamID    → e.g. "Black Knights" (a roster, in one league, in one season)
 *   - SeasonID  → e.g. "Winter 2026"
 *
 * Pages we can reach without auth:
 *   /dashboard.cfm?LeagueID=<GUID>           — league overview + team list
 *   /team/index.cfm?TeamID=<GUID>            — team home (name, league, season)
 *   /team/schedule.cfm?TeamID=<GUID>         — team schedule
 *   /team/standings.cfm?TeamID=<GUID>        — division standings
 *
 * Strategy:
 *   1. Read a seed list of known LeagueIDs from data/seed-leagues.json
 *   2. For each league, fetch the dashboard, extract every TeamID found in
 *      anchor tags + the league/division/season label
 *   3. Optionally discover *more* LeagueIDs by following standings pages
 *      (which show all teams in the same division, including from other leagues)
 *   4. Write data/teams.json with [{ teamId, leagueId, leagueName, teamName,
 *      teamUrl, scheduleUrl, discoveredAt }]
 *
 * Run: node scripts/chiller/discover.js
 *
 * Politeness:
 *   - Sleeps 600ms between requests
 *   - Caches HTML responses to data/cache/ so re-runs don't re-hammer the site
 *   - Sets a User-Agent identifying Rinkd (good faith — they can see who's hitting them)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const SEED_FILE = path.join(DATA_DIR, 'seed-leagues.json');
const OUT_FILE  = path.join(DATA_DIR, 'teams.json');

const USER_AGENT = 'Rinkd-Importer/0.1 (+https://rinkd.app · hello@rinkd.app · user-initiated import for member-of-league discovery)';
const SLEEP_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

async function fetchCached(url) {
  ensureDir(CACHE_DIR);
  const key = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 200);
  const cachePath = path.join(CACHE_DIR, key + '.html');
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf8');
  }
  await sleep(SLEEP_MS);
  // eslint-disable-next-line no-console
  console.log('  GET', url);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const html = await res.text();
  fs.writeFileSync(cachePath, html);
  return html;
}

/** Extract every TeamID GUID from a dashboard page and any nearby labels. */
function parseDashboard(html, leagueId) {
  // ChillerStats uses GUIDs like XXXXXXXX-XXXX-XXXX-XXXXXXXXXXXXXXXX
  const teamIdRe = /TeamID=([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{16})/gi;
  const teams = new Map();
  let m;
  while ((m = teamIdRe.exec(html)) !== null) {
    const id = m[1].toUpperCase();
    if (!teams.has(id)) teams.set(id, { teamId: id, leagueId });
  }

  // Try to pull league name from page title or h1 — fallback to leagueId
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const leagueName = titleMatch ? titleMatch[1].replace(/\s*[\|\-–].*$/, '').trim() : null;

  // Extract team display names by finding anchor text near each TeamID. The
  // dashboard typically renders <a href="/team/?TeamID=...">Team Name</a>.
  // We do a simple, robust match: capture anchor->href->TeamID GUID.
  const anchorRe = /<a[^>]+href="[^"]*TeamID=([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{16})[^"]*"[^>]*>([^<]+)<\/a>/gi;
  while ((m = anchorRe.exec(html)) !== null) {
    const id = m[1].toUpperCase();
    const name = m[2].replace(/\s+/g, ' ').trim();
    const t = teams.get(id) || { teamId: id, leagueId };
    if (!t.teamName || (name && name.length > t.teamName.length)) t.teamName = name;
    teams.set(id, t);
  }

  return { leagueName, teams: Array.from(teams.values()) };
}

async function main() {
  ensureDir(DATA_DIR);

  if (!fs.existsSync(SEED_FILE)) {
    fs.writeFileSync(SEED_FILE, JSON.stringify({
      _comment: 'Seed list of ChillerStats LeagueIDs. Add more as you find them — each /dashboard.cfm?LeagueID=... covers one playing slot (e.g. Tuesday C West).',
      leagueIds: [
        'BF93DA81-A09D-FE6D-2ABF2E1E3E9C0A77',  // First known league (from initial recon)
      ],
    }, null, 2));
    console.error('Seeded data/seed-leagues.json with one example LeagueID. Edit it to add more, then re-run.');
  }

  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const allTeams = new Map();

  for (const leagueId of seed.leagueIds) {
    console.log(`\nLeague ${leagueId}`);
    const url = `https://chillerstats.com/dashboard.cfm?LeagueID=${leagueId}`;
    try {
      const html = await fetchCached(url);
      const { leagueName, teams } = parseDashboard(html, leagueId);
      console.log(`  → ${teams.length} team IDs found · league name: ${leagueName || '(unknown)'}`);
      for (const t of teams) {
        const enriched = {
          ...t,
          leagueName,
          teamUrl: `https://chillerstats.com/team/?TeamID=${t.teamId}`,
          scheduleUrl: `https://chillerstats.com/team/schedule.cfm?TeamID=${t.teamId}`,
          discoveredAt: new Date().toISOString(),
        };
        const existing = allTeams.get(t.teamId);
        if (!existing || (!existing.teamName && enriched.teamName)) {
          allTeams.set(t.teamId, enriched);
        }
      }
    } catch (e) {
      console.error(`  ERROR fetching league ${leagueId}: ${e.message}`);
    }
  }

  const list = Array.from(allTeams.values());
  fs.writeFileSync(OUT_FILE, JSON.stringify(list, null, 2));
  console.log(`\n✓ Wrote ${list.length} teams to ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(`  Next step: node scripts/chiller/scrape.js`);
}

main().catch((e) => { console.error(e); process.exit(1); });
