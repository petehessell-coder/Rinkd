#!/usr/bin/env node
/**
 * ChillerStats — Step 2: Scrape each team's schedule page.
 *
 * Reads data/teams.json (produced by discover.js), then for each team fetches
 * /team/schedule.cfm?TeamID=<GUID> and parses out:
 *   - team display name (authoritative — overrides the dashboard anchor text)
 *   - league + division + season label
 *   - games: [{ date, opponent, isHome, location, homeScore, awayScore, status }]
 *
 * Output: data/schedules.json
 *
 * Run: node scripts/chiller/scrape.js
 *
 * Parser strategy:
 *   ChillerStats renders schedules as a vanilla HTML table. The columns
 *   depend on whether the season is current (showing future games) or past
 *   (showing scores). We grep flexibly using row-by-row regex rather than
 *   relying on a heavy DOM parser — keeps this script dependency-free.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const IN_FILE   = path.join(DATA_DIR, 'teams.json');
const OUT_FILE  = path.join(DATA_DIR, 'schedules.json');

const USER_AGENT = 'Rinkd-Importer/0.1 (+https://rinkd.app · hello@rinkd.app)';
const SLEEP_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

async function fetchCached(url) {
  ensureDir(CACHE_DIR);
  const key = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 200);
  const cachePath = path.join(CACHE_DIR, key + '.html');
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  await sleep(SLEEP_MS);
  // eslint-disable-next-line no-console
  console.log('    GET', url);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  fs.writeFileSync(cachePath, html);
  return html;
}

/** Strip HTML tags and decode the few entities ChillerStats actually uses. */
function text(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSchedulePage(html, teamId) {
  // Team name — the page <title> on ChillerStats is always just "ChillerStats"
  // (the site name, not the team name). The real team name is in <h1>, usually
  // formatted like "Dayton Fire Hockey". Strip the trailing " Hockey" if
  // present so we store the clean team name.
  let teamName = null;
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    teamName = text(h1Match[1]).replace(/\s+Hockey\s*$/i, '').trim();
  }
  if (!teamName) {
    // Fallback for pages without an h1 — try title, but drop obvious
    // site-name boilerplate.
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      const t = text(titleMatch[1]).replace(/\s*[-|–].*$/, '').trim();
      if (t && !/^chillerstats$/i.test(t)) teamName = t;
    }
  }

  let seasonLabel = null;
  const seasonRe = /(Spring|Summer|Fall|Winter)\s+(20\d{2})/i;
  const seasonMatch = html.match(seasonRe);
  if (seasonMatch) seasonLabel = `${seasonMatch[1]} ${seasonMatch[2]}`;

  let divisionLabel = null;
  const divRe = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+([A-D](\+|-)?(\s*West|\s*East|\s*North|\s*South)?)/i;
  const divMatch = html.match(divRe);
  if (divMatch) divisionLabel = text(divMatch[0]);

  // ChillerStats schedule table has a stable column order:
  //   [0] Date   [1] Time   [2] Rink   [3] Ice
  //   [4] HOME team   [5] AWAY team   [6] Score "H - A"   [7] W/L button
  //
  // The "current team" (whoever's schedule page we're on) is rendered in
  // bold blue (style="font-weight:bold;color:#3276b1;"). The opponent is
  // a normal <a href="index.cfm?TeamID=...">Name</a> link. That gives us
  // both home/away (by which slot is bold) and the opponent's TeamID for
  // free — we save it so future runs can cross-link games between teams.
  const games = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRawRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;

  const dateMonthRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}\b/i;
  const dateSlashRe = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/;

  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const row = trMatch[1];

    // Capture raw cell HTML so we can inspect styles / hrefs for the
    // home-vs-away determination. Reset the regex per row.
    const cellsRaw = [];
    let tdMatch;
    tdRawRe.lastIndex = 0;
    while ((tdMatch = tdRawRe.exec(row)) !== null) cellsRaw.push(tdMatch[1]);
    if (cellsRaw.length < 7) continue;

    const cells = cellsRaw.map(text);

    // First cell must contain a date — that's the gate that filters out
    // header rows, separator rows, and anything that isn't a game line.
    if (!(dateMonthRe.test(cells[0]) || dateSlashRe.test(cells[0]))) continue;

    const dateStr = cells[0];
    const timeStr = cells[1] || null;
    // cells[2] = rink (e.g. "NTPRD Chiller"); cells[3] = ice surface ("Main Ice")
    // We tag these so the data is recoverable, but they're not displayed today.
    const rink = cells[2] || null;
    const surface = cells[3] || null;

    const homeRaw = cellsRaw[4] || '';
    const awayRaw = cellsRaw[5] || '';
    const homeName = text(homeRaw);
    const awayName = text(awayRaw);

    // Detect "current team" by absence of opponent-link. ChillerStats renders
    // the opponent as <a href="index.cfm?TeamID=...">Name</a>, and the current
    // team as plain text (bold-blue on the <td> — but that style attribute
    // sits on the <td> tag itself, not inside it, so we don't see it via the
    // cell-inner-content regex). The link-vs-plain signal is structural and
    // more robust than style-sniffing anyway.
    const oppLinkRe = /<a[^>]+href="[^"]*index\.cfm\?TeamID=/i;
    const homeHasOppLink = oppLinkRe.test(homeRaw);
    const awayHasOppLink = oppLinkRe.test(awayRaw);
    // current team = slot with NO opponent link
    const homeIsCurrent = !homeHasOppLink && awayHasOppLink;
    const awayIsCurrent = !awayHasOppLink && homeHasOppLink;

    // is_home = "is the current team listed in the home slot?"
    let isHome = null;
    if (homeIsCurrent && !awayIsCurrent) isHome = true;
    else if (awayIsCurrent && !homeIsCurrent) isHome = false;

    // Opponent: the non-bold side. If neither is bold (rare — e.g. forfeit
    // rows), fall back to using the slot with the <a href="index.cfm?TeamID=">
    // link, since that's always the opponent and never the current team.
    let opponent = null;
    let opponentTeamId = null;
    const oppTeamIdRe = /index\.cfm\?TeamID=([A-F0-9-]+)/i;

    if (homeIsCurrent) {
      opponent = awayName;
      const m = awayRaw.match(oppTeamIdRe);
      if (m) opponentTeamId = m[1].toUpperCase();
    } else if (awayIsCurrent) {
      opponent = homeName;
      const m = homeRaw.match(oppTeamIdRe);
      if (m) opponentTeamId = m[1].toUpperCase();
    } else {
      // Fall back: whichever side carries the team-link is the opponent.
      const mHome = homeRaw.match(oppTeamIdRe);
      const mAway = awayRaw.match(oppTeamIdRe);
      if (mHome) { opponent = homeName; opponentTeamId = mHome[1].toUpperCase(); }
      else if (mAway) { opponent = awayName; opponentTeamId = mAway[1].toUpperCase(); }
      else { opponent = awayName || homeName; }
    }

    // Score — cells[6] is the "X - Y" cell. Format "1 - 5" (home - away).
    let homeScore = null;
    let awayScore = null;
    const scoreCell = cells[6] || '';
    const scoreMatch = scoreCell.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    if (scoreMatch) {
      homeScore = Number(scoreMatch[1]);
      awayScore = Number(scoreMatch[2]);
    }

    // W/L outcome — cells[7] is "W" or "L" or "T" inside an anchor button.
    let outcome = null;
    const oc = cells[7] || '';
    if (/^[WLT]$/.test(oc)) outcome = oc;

    games.push({
      rawDate: dateStr,
      rawTime: timeStr,
      rink,
      surface,
      opponent,
      opponentTeamId,
      isHome,
      homeScore,
      awayScore,
      outcome,
      status: scoreMatch ? 'final' : 'scheduled',
    });
  }

  return { teamName, seasonLabel, divisionLabel, games };
}

async function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error('Missing data/teams.json. Run discover.js first.');
    process.exit(1);
  }
  const teams = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
  console.log(`Scraping ${teams.length} teams...`);

  const out = [];
  let i = 0;
  for (const t of teams) {
    i++;
    console.log(`  [${i}/${teams.length}] ${t.teamName || t.teamId}`);
    try {
      const html = await fetchCached(t.scheduleUrl);
      const parsed = parseSchedulePage(html, t.teamId);
      out.push({
        teamId: t.teamId,
        leagueId: t.leagueId,
        teamName: parsed.teamName || t.teamName || null,
        leagueName: t.leagueName || null,
        division: parsed.divisionLabel,
        season: parsed.seasonLabel,
        scheduleUrl: t.scheduleUrl,
        games: parsed.games,
        scrapedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`    ERROR: ${e.message}`);
      out.push({ teamId: t.teamId, error: e.message });
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  const ok = out.filter((x) => !x.error).length;
  console.log(`\n✓ Wrote ${ok}/${out.length} schedules to ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(`  Next step: node scripts/chiller/load.js`);
}

main().catch((e) => { console.error(e); process.exit(1); });
