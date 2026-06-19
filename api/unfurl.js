// SHARE-GOAL-1 · OG — server-rendered unfurl HTML for crawlers.
//
// vercel.json routes ONLY crawler user-agents (facebookexternalhit, Twitterbot,
// Slackbot, WhatsApp, Discordbot, LinkedInBot, iMessage, …) hitting a public
// share route here; real browsers fall through to the SPA untouched. We fetch the
// game/event from Supabase's REST API as the anon role (same RLS the public page
// uses), build per-entity Open Graph + Twitter tags, and point og:image at the
// edge-rendered /api/og card. A human who somehow lands here is bounced to the
// real route by a meta-refresh.
//
// Robust by construction: any missing env / failed fetch / private event falls
// back to the generic Rinkd card — a link never unfurls broken, and a private
// event never leaks specifics.

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const DEFAULTS = {
  title: 'Rinkd · Where Hockey Lives Online',
  description: 'Live scores, stats, recaps, and the chirps — every game lives on Rinkd.',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mirrors lib/publicShare.isPublicSharingEnabled — adult ON by default, youth
// opt-in, explicit kill-switch respected.
function publicSharing(settings) {
  const s = settings || {};
  if (s.public_sharing === false) return false;
  if (s.public_sharing === true) return true;
  return s.feature_profile !== 'youth_competitive';
}

async function rest(path) {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] || null : rows;
  } catch { return null; }
}

function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'rinkd.app';
  return `${proto}://${host}`;
}

const roundLabel = (r) => {
  const v = String(r || '').toLowerCase();
  if (v === 'final' || v === 'championship') return 'Championship';
  if (v === 'semifinal' || v === 'sf') return 'Semifinal';
  if (v === 'quarterfinal' || v === 'qf') return 'Quarterfinal';
  if (v === 'pool' || v === '') return '';
  return r.charAt(0).toUpperCase() + r.slice(1);
};

// Resolve { title, description, image, canonical } for the request.
async function resolve(req, origin) {
  const { type, id } = req.query;
  if (!id) return null;

  const ogImg = (params) => `${origin}/api/og?` + new URLSearchParams(params).toString();

  if (type === 'g' || type === 'lg') {
    const isLeague = type === 'lg';
    const sel = isLeague
      ? 'home_score,away_score,status,round,home_lt:league_teams!home_team_id(team_name,team:teams(name)),away_lt:league_teams!away_team_id(team_name,team:teams(name)),league:leagues(name,settings,is_public)'
      : 'home_score,away_score,status,round,home_team:tournament_teams!home_team_id(team_name),away_team:tournament_teams!away_team_id(team_name),tournament:tournaments(name,settings,status)';
    const table = isLeague ? 'league_games' : 'games';
    const g = await rest(`${table}?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}&limit=1`);
    const canonical = `${origin}/${type}/${id}`;
    if (!g) return { ...DEFAULTS, image: `${origin}/og-fallback-rinkd.png`, canonical };

    const parent = isLeague ? g.league : g.tournament;
    const competition = parent?.name || 'Rinkd';
    const visible = publicSharing(parent?.settings) &&
      (isLeague ? parent?.is_public === true : ['active', 'complete'].includes(parent?.status));
    if (!visible) return { ...DEFAULTS, image: `${origin}/og-fallback-rinkd.png`, canonical };

    const home = isLeague ? (g.home_lt?.team?.name || g.home_lt?.team_name) : g.home_team?.team_name;
    const away = isLeague ? (g.away_lt?.team?.name || g.away_lt?.team_name) : g.away_team?.team_name;
    const homeN = home || 'Home', awayN = away || 'Away';
    const final = g.status === 'final';
    const live = g.status === 'live';
    const showScore = final || live;
    const state = final ? 'FINAL' : live ? 'LIVE' : '';
    const round = roundLabel(g.round);

    const title = showScore
      ? `${awayN} ${g.away_score ?? 0}, ${homeN} ${g.home_score ?? 0}${live ? ' (LIVE)' : ''}`
      : `${awayN} vs ${homeN}`;
    const description = [state, round, competition].filter(Boolean).join(' · ') || DEFAULTS.description;
    const imgParams = { type, id, home: homeN, away: awayN, sub: competition };
    if (showScore) { imgParams.hs = String(g.home_score ?? 0); imgParams.as = String(g.away_score ?? 0); imgParams.status = state; }
    else { imgParams.title = `${awayN} vs ${homeN}`; }
    return { title, description, image: ogImg(imgParams), canonical };
  }

  if (type === 'league' || type === 'tournament') {
    const table = type === 'league' ? 'leagues' : 'tournaments';
    const sel = type === 'league' ? 'name,division,season,settings,is_public' : 'name,division,status,settings';
    const e = await rest(`${table}?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}&limit=1`);
    const canonical = `${origin}/${type}/${id}`;
    if (!e || !publicSharing(e.settings)) return { ...DEFAULTS, image: `${origin}/og-fallback-rinkd.png`, canonical };
    const kindWord = type === 'league' ? 'league' : 'tournament';
    const title = e.name || DEFAULTS.title;
    const description = `${e.division || (type === 'league' ? 'League' : 'Tournament')} · Live scores, standings, stats & recaps on Rinkd.`;
    return { title, description, image: ogImg({ title, sub: `${kindWord} on rinkd` }), canonical };
  }

  return null;
}

export default async function handler(req, res) {
  const origin = originOf(req);
  let data;
  try { data = await resolve(req, origin); } catch { data = null; }
  if (!data) data = { ...DEFAULTS, image: `${origin}/og-fallback-rinkd.png`, canonical: `${origin}/` };

  const title = esc(data.title);
  const desc = esc(data.description);
  const image = esc(data.image);
  const canonical = esc(data.canonical);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Rinkd</title>
<meta name="description" content="${desc}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:site_name" content="Rinkd" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${canonical}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${image}" />
<meta http-equiv="refresh" content="0; url=${canonical}" />
</head>
<body style="margin:0;background:#07111F;color:#F4F7FA;font-family:sans-serif">
<p style="padding:24px">Opening on <a href="${canonical}" style="color:#9ec3ec">Rinkd</a>…</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Crawlers + the CDN can cache the unfurl briefly; live games refresh fast.
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  res.status(200).send(html);
}
