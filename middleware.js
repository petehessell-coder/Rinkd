// GROWTH-SHARE-1 · M4 — Vercel Edge Middleware for per-game OG link unfurls.
//
// CRA is an SPA: every path serves the static index.html (generic OG), so a
// pasted /g or /lg link unfurls as the generic site card. This middleware runs
// at the edge BEFORE the SPA rewrite. It UA-sniffs:
//   • crawler  → returns a tiny HTML doc with per-game OG tags + og:image
//   • human    → returns undefined → continues to the SPA (no redirect flash)
// Zero per-request render: og:image points at the client-composed card stored in
// the `share-cards` bucket if present, else the generic /og-fallback-rinkd.png.

export const config = { matcher: ['/g/:path*', '/lg/:path*'] };

const SUPABASE_URL = 'https://tbpoopsyhfuqcbugrjbh.supabase.co';
// anon key is publishable (already shipped in the client bundle) — safe to embed.
const ANON =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRicG9vcHN5aGZ1cWNidWdyamJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NjkxMjQsImV4cCI6MjA5MzE0NTEyNH0.0gcGgxkyqmgjGwctCrLBBW18O1LfqFkzKBqJkvCDVpo';

const BOT_RE = /(facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|WhatsApp|Discordbot|LinkedInBot|TelegramBot|Applebot|redditbot|Pinterest|Embedly|Iframely|vkShare|SkypeUriPreview|Googlebot|Google-InspectionTool|bingbot|W3C_Validator|Mastodon|Bluesky|nuzzel)/i;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const sb = (path) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, authorization: `Bearer ${ANON}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// Public-sharing guardrail (mirror src/lib/publicShare.js).
function sharingEnabled(settings) {
  const s = settings || {};
  if (s.public_sharing === false) return false;
  if (s.public_sharing === true) return true;
  return s.feature_profile !== 'youth_competitive';
}
function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
}

function genericMeta(origin) {
  return {
    title: 'Rinkd · Where Hockey Lives Online',
    desc: 'Scores, stats, and the chirps — every game lives on Rinkd.',
    image: `${origin}/og-fallback-rinkd.png`,
  };
}

async function gameMeta(isLeague, gameId, origin) {
  let rows;
  if (isLeague) {
    rows = await sb(`league_games?id=eq.${gameId}&select=home_score,away_score,status,round,home_lt:league_teams!home_team_id(team_name,team:teams(name)),away_lt:league_teams!away_team_id(team_name,team:teams(name)),league:leagues(name,is_public,settings)`);
  } else {
    rows = await sb(`games?id=eq.${gameId}&select=home_score,away_score,status,round,home_team:tournament_teams!home_team_id(team_name,pool),away_team:tournament_teams!away_team_id(team_name,pool),tournament:tournaments(name,status,settings)`);
  }
  const g = rows && rows[0];
  if (!g) return genericMeta(origin);

  const parent = isLeague ? g.league : g.tournament;
  const parentPublic = isLeague ? parent?.is_public === true : ['active', 'complete'].includes(parent?.status);
  if (!parent || !parentPublic || !sharingEnabled(parent.settings)) return genericMeta(origin);

  const homeName = isLeague ? (g.home_lt?.team?.name || g.home_lt?.team_name) : g.home_team?.team_name;
  const awayName = isLeague ? (g.away_lt?.team?.name || g.away_lt?.team_name) : g.away_team?.team_name;
  const competition = parent.name || 'Rinkd';
  const roundLabel = (() => {
    if (isLeague) return g.round && g.round !== 'pool' ? titleCase(g.round) : 'Regular season';
    const r = (g.round || '').toLowerCase();
    if (r === 'final' || r === 'championship') return 'Championship';
    if (r === 'semifinal' || r === 'sf') return 'Semifinal';
    if (r === 'quarterfinal' || r === 'qf') return 'Quarterfinal';
    if (!r || r === 'pool') return 'Pool play';
    return titleCase(r);
  })();
  const statusLabel = g.status === 'final' ? 'FINAL' : g.status === 'live' ? 'LIVE' : null;
  const sponsorName = (parent.settings || {}).recap_sponsor?.name;

  const title = `${homeName || 'Home'} ${g.home_score ?? 0}, ${awayName || 'Away'} ${g.away_score ?? 0}`;
  const desc = [statusLabel, roundLabel, competition, sponsorName ? `Presented by ${sponsorName}` : null].filter(Boolean).join(' · ');

  // og:image priority:
  //   1. the client-composed card stored on a share (richest — real logos +
  //      scorers),
  //   2. else a per-game SERVER-RENDERED card from /api/og, so a game nobody
  //      has shared yet still unfurls a real broadcast card (not the generic
  //      site fallback). /api/og itself falls back to /og-fallback-rinkd.png.
  const cardUrl = `${SUPABASE_URL}/storage/v1/object/public/share-cards/${isLeague ? 'lg' : 'g'}/${gameId}.png`;
  const og = new URLSearchParams({ type: isLeague ? 'lg' : 'g', id: gameId, home: homeName || 'Home', away: awayName || 'Away', sub: competition });
  if (g.status === 'final' || g.status === 'live') {
    og.set('hs', String(g.home_score ?? 0)); og.set('as', String(g.away_score ?? 0)); og.set('status', statusLabel || '');
  } else {
    og.set('title', `${awayName || 'Away'} vs ${homeName || 'Home'}`);
  }
  let image = `${origin}/api/og?${og.toString()}`;
  try {
    const head = await fetch(cardUrl, { method: 'HEAD' });
    if (head.ok) image = cardUrl;
  } catch { /* keep the rendered card */ }

  return { title, desc, image };
}

function htmlDoc(meta, pageUrl) {
  const t = esc(meta.title);
  const d = esc(meta.desc);
  const img = esc(meta.image);
  const url = esc(pageUrl);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>${t} · Rinkd</title>
<meta property="og:site_name" content="Rinkd">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
</head><body><a href="${url}">${t} — view on Rinkd</a></body></html>`;
}

export default async function middleware(req) {
  const ua = req.headers.get('user-agent') || '';
  if (!BOT_RE.test(ua)) return; // human → continue to the SPA

  const url = new URL(req.url);
  const m = url.pathname.match(/^\/(g|lg)\/([0-9a-fA-F-]{10,})/);
  if (!m) return;
  const isLeague = m[1] === 'lg';
  const gameId = m[2];

  let meta;
  try {
    meta = await gameMeta(isLeague, gameId, url.origin);
  } catch {
    meta = genericMeta(url.origin);
  }
  return new Response(htmlDoc(meta, url.href), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600',
    },
  });
}
