// GROWTH-SHARE-1 · M2 — the recap share-card composer.
//
// Composes the locked dual-brand recap card CLIENT-SIDE on a <canvas> → PNG Blob.
// Zero server render cost (Infra cost guardrail #2). Ported from the Pete-approved
// mockup at .preview-mockup/recap-card.html — same drawCard() routine, two formats.
//
//   composeRecapCard(card, { format }) -> Promise<Blob>
//
// `card` is a plain data object (see buildRecapCardData) so the same composer
// serves the public page, the feed recap Share button, and (later) OG previews.
//
// Youth/COPPA: pass scorersHome/scorersAway = [] (the caller suppresses via
// areScorersHidden) and the card renders team + score only.

import { teamInitials } from './teamInitials';

const C = {
  dark: '#07111F', navy: '#0B1F3A', navyHi: '#13335c', strip: '#0a1830',
  blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA', steel: '#8BA3BE',
  line: 'rgba(46,91,140,0.45)',
};

const WORDMARK_SRC = '/rinkd-wordmark-tape.png'; // same-origin asset in public/

const PORTRAIT = {
  W: 1080, H: 1350, pad: 64, topH: 150, heroPadTop: 64, finalPillW: 230, finalPillH: 64,
  heroGap: 50, chipR: 138, scoreSize: 248, nameSize: 56, scorerSize: 33, ctxSize: 34,
  botH: 240, wmText: 96, wmImgH: 96, wmSize: 150,
  homeXr: 0.205, awayXr: 0.795, scoreLr: 0.43, scoreRr: 0.57,
};
const WIDE = {
  W: 1200, H: 630, pad: 54, topH: 96, heroPadTop: 26, finalPillW: 150, finalPillH: 42,
  heroGap: 22, chipR: 74, scoreSize: 140, nameSize: 30, scorerSize: 18, ctxSize: 20,
  botH: 120, wmText: 54, wmImgH: 52, wmSize: 90,
  homeXr: 0.24, awayXr: 0.76, scoreLr: 0.42, scoreRr: 0.58,
};

// ---- helpers ----------------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Load an image for canvas compositing — taint-proof. We fetch the bytes and
// createImageBitmap() them: a bitmap built from a blob is ALWAYS canvas-clean,
// which sidesteps the service-worker/CORS replay traps that can taint a plain
// <img crossOrigin> (and make toBlob() throw). Any failure → null → the draw
// falls back (text wordmark / initials disc). Never breaks the share.
const _imgCache = new Map();
function _imgFromObjectURL(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function loadImage(src) {
  if (!src) return null;
  if (_imgCache.has(src)) return _imgCache.get(src);
  let result = null;
  try {
    const res = await fetch(src, { cache: 'force-cache' });
    if (res.ok) {
      const blob = await res.blob();
      result = typeof createImageBitmap === 'function'
        ? await createImageBitmap(blob)
        : await _imgFromObjectURL(URL.createObjectURL(blob));
    }
  } catch { /* fall through to the <img> attempt */ }
  if (!result) {
    // Fallback for environments without fetch/bitmap support.
    result = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  if (result) _imgCache.set(src, result); // cache hits only, so transient fails can retry
  return result;
}

// Make sure the brand fonts are rasterized before we draw, or canvas falls back
// to a system font mid-compose.
async function ensureFonts() {
  try {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load("900 italic 120px 'Barlow Condensed'"),
      document.fonts.load("800 italic 60px 'Barlow Condensed'"),
      document.fonts.load("700 28px 'Barlow'"),
      document.fonts.load("600 28px 'Barlow'"),
    ]);
    await document.fonts.ready;
  } catch { /* best-effort — fall back to whatever's available */ }
}

function fmtScorers(scorers) {
  return (scorers || []).map((s) => (s.goals > 1 ? `${s.name} (${s.goals})` : s.name));
}

// ---- drawing (1:1 with the approved mockup) ---------------------------------

function drawWatermark(ctx, W, H, size) {
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = C.ice;
  ctx.font = `900 italic ${size}px 'Barlow Condensed'`;
  ctx.textBaseline = 'middle';
  const step = size * 2.4;
  for (let y = -H; y < H * 2; y += step) {
    for (let x = -W; x < W * 2; x += size * 6) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 9);
      ctx.fillText('RINKD', 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

function teamChip(ctx, cx, cy, r, team, img) {
  if (img) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.save(); ctx.clip();
    const pad = r * 0.12, d = (r - pad) * 2;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - (r - pad), cy - (r - pad), d, d);
    ctx.restore();
    ctx.lineWidth = r * 0.06; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = team.color || C.blue; ctx.fill();
  ctx.lineWidth = r * 0.07; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 italic ${r * 0.92}px 'Barlow Condensed'`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(team.initials, cx, cy + r * 0.04);
  ctx.restore();
}

function drawScorerBlock(ctx, items, cx, topY, maxW, L) {
  ctx.font = `600 ${L.scorerSize}px 'Barlow'`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.steel;
  const sep = '   ·   ';
  const lines = []; let cur = '';
  for (let i = 0; i < items.length; i++) {
    const test = cur ? cur + sep + items[i] : items[i];
    if (ctx.measureText(test).width > maxW && cur) {
      if (lines.length === 1) { lines.push(cur + sep + '+' + (items.length - i)); cur = ''; break; }
      lines.push(cur); cur = items[i];
    } else cur = test;
  }
  if (cur) lines.push(cur);
  lines.slice(0, 2).forEach((ln, idx) => ctx.fillText(ln, cx, topY + idx * L.scorerSize * 1.4));
  return Math.min(lines.length, 2);
}

function drawCard(ctx, L, card, assets) {
  const { W, H } = L;
  const g = card;

  // hero background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.navyHi); grad.addColorStop(1, C.navy);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  drawWatermark(ctx, W, H, L.wmSize);

  // TOP STRIP — sponsor
  ctx.fillStyle = C.strip; ctx.fillRect(0, 0, W, L.topH);
  ctx.fillStyle = C.line; ctx.fillRect(0, L.topH - 2, W, 2);
  const chipR = L.topH * 0.30, chipX = L.pad + chipR, chipY = L.topH / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(chipX, chipY, chipR, 0, Math.PI * 2);
  ctx.fillStyle = C.blue; ctx.fill(); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 italic ${chipR * 0.95}px 'Barlow Condensed'`;
  ctx.fillText((g.league || 'R').slice(0, 1).toUpperCase(), chipX, chipY + chipR * 0.03);
  ctx.textAlign = 'left'; ctx.fillStyle = C.steel;
  ctx.font = `700 ${L.topH * 0.20}px 'Barlow'`;
  ctx.fillText('RECAP PRESENTED BY', chipX + chipR + L.pad * 0.5, chipY - L.topH * 0.13);
  ctx.fillStyle = C.ice;
  ctx.font = `800 italic ${L.topH * 0.30}px 'Barlow Condensed'`;
  // No sponsor sold → Rinkd fills the slot (house slot), never an empty placeholder.
  ctx.fillText((g.sponsor || 'RINKD').toUpperCase(), chipX + chipR + L.pad * 0.5, chipY + L.topH * 0.16);

  // HERO — FINAL pill
  const pillW = L.finalPillW, pillH = L.finalPillH, pillX = W / 2 - pillW / 2, pillY = L.topH + L.heroPadTop;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = g.tie ? C.blue : C.red; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 italic ${pillH * 0.52}px 'Barlow Condensed'`;
  ctx.fillText(g.tie ? 'FINAL · TIE' : 'FINAL', W / 2, pillY + pillH * 0.55);

  // teams + score
  const midY = pillY + pillH + L.heroGap + L.chipR;
  const homeX = W * L.homeXr, awayX = W * L.awayXr;
  teamChip(ctx, homeX, midY, L.chipR, g.home, assets.homeLogo);
  teamChip(ctx, awayX, midY, L.chipR, g.away, assets.awayLogo);

  ctx.fillStyle = C.ice; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 italic ${L.scoreSize}px 'Barlow Condensed'`;
  ctx.fillText(`${g.homeScore ?? 0}`, W * L.scoreLr, midY);
  ctx.fillText(`${g.awayScore ?? 0}`, W * L.scoreRr, midY);
  ctx.fillStyle = C.steel;
  ctx.font = `800 ${L.scoreSize * 0.5}px 'Barlow Condensed'`;
  ctx.fillText('–', W / 2, midY - L.scoreSize * 0.04);
  ctx.fillStyle = 'rgba(244,247,250,0.22)';
  ctx.font = `900 italic ${L.scoreSize * 0.14}px 'Barlow Condensed'`;
  ctx.fillText('RINKD', W / 2, midY + L.scoreSize * 0.42);

  // names + per-team color accent
  const nameY = midY + L.chipR + L.nameSize * 1.0;
  ctx.textAlign = 'center';
  [[g.home, homeX], [g.away, awayX]].forEach(([t, x]) => {
    ctx.fillStyle = C.ice;
    ctx.font = `800 italic ${L.nameSize}px 'Barlow Condensed'`;
    ctx.fillText((t.name || 'TBD').toUpperCase(), x, nameY);
    const barW = Math.min(ctx.measureText((t.name || 'TBD').toUpperCase()).width, L.chipR * 1.6);
    roundRect(ctx, x - barW / 2, nameY + L.nameSize * 0.30, barW, L.nameSize * 0.10, L.nameSize * 0.05);
    ctx.fillStyle = t.color || C.blue; ctx.fill();
  });

  // scorers (already youth-suppressed by the caller → empty arrays draw nothing)
  let blockLines = 0;
  const scorerTop = nameY + L.nameSize * 0.30 + L.scorerSize * 1.5;
  const hItems = fmtScorers(g.scorersHome), aItems = fmtScorers(g.scorersAway);
  if (hItems.length || aItems.length) {
    const hl = drawScorerBlock(ctx, hItems, homeX, scorerTop, W * 0.44, L);
    const al = drawScorerBlock(ctx, aItems, awayX, scorerTop, W * 0.44, L);
    blockLines = Math.max(hl, al);
  }

  // context line
  ctx.fillStyle = C.steel; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${L.ctxSize}px 'Barlow'`;
  const ctxLine = [g.round, g.competition].filter(Boolean).join('   ·   ');
  const ctxY = (blockLines ? scorerTop + (blockLines - 1) * L.scorerSize * 1.4 : nameY) + L.ctxSize * 2.0;
  ctx.fillText(ctxLine, W / 2, ctxY);

  // BOTTOM STRIP — Rinkd frame
  const bY = H - L.botH;
  ctx.fillStyle = C.dark; ctx.fillRect(0, bY, W, L.botH);
  ctx.fillStyle = C.line; ctx.fillRect(0, bY, W, 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const wmY = bY + L.botH * 0.40;
  let wmRight; // right edge of the wordmark, so the CTA never collides with it
  if (assets.wordmark) {
    const h = L.wmImgH, w = h * (assets.wordmark.width / assets.wordmark.height);
    ctx.drawImage(assets.wordmark, L.pad, wmY - h / 2, w, h);
    wmRight = L.pad + w;
  } else {
    ctx.font = `900 italic ${L.wmText}px 'Barlow Condensed'`;
    ctx.fillStyle = C.ice;
    ctx.fillText('RINKD', L.pad, wmY);
    const wmW = ctx.measureText('RINKD').width;
    ctx.fillStyle = C.red;
    ctx.beginPath(); ctx.arc(L.pad + wmW + L.wmText * 0.16, wmY, L.wmText * 0.10, 0, Math.PI * 2); ctx.fill();
    wmRight = L.pad + wmW + L.wmText * 0.26;
  }
  ctx.fillStyle = C.steel;
  ctx.font = `700 ${L.wmText * 0.34}px 'Barlow'`;
  ctx.fillText('rinkd.app', L.pad, bY + L.botH * 0.76);

  // CTA (right-aligned) — auto-fit so a long league name can't run under the
  // wordmark. Try the named version; if it won't fit, drop to a generic CTA and
  // shrink to the available width.
  const ctaMaxW = W - L.pad - wmRight - L.pad * 0.6;
  let ctaSize = L.wmText * 0.42;
  ctx.fillStyle = C.ice; ctx.textAlign = 'right';
  ctx.font = `700 italic ${ctaSize}px 'Barlow Condensed'`;
  let ctaText = `FOLLOW ${(g.league || 'YOUR LEAGUE').toUpperCase()} LIVE →`;
  if (ctx.measureText(ctaText).width > ctaMaxW) {
    ctaText = 'FOLLOW LIVE ON RINKD →';
    while (ctaSize > L.wmText * 0.26 && (ctx.font = `700 italic ${ctaSize}px 'Barlow Condensed'`, ctx.measureText(ctaText).width > ctaMaxW)) ctaSize -= 2;
  }
  ctx.fillText(ctaText, W - L.pad, bY + L.botH * 0.42);
  ctx.fillStyle = C.steel; ctx.font = `600 ${L.wmText * 0.21}px 'Barlow'`; ctx.textAlign = 'right';
  ctx.fillText('Every game lives on Rinkd', W - L.pad, bY + L.botH * 0.72);
}

// ---- public API -------------------------------------------------------------

// Normalize a team into the chip shape the card draws.
function normTeam(t) {
  if (!t) return { name: 'TBD', initials: '?', color: C.blue, logoUrl: null };
  return {
    name: t.name || 'TBD',
    initials: (t.logo_initials || teamInitials(t.name, 2) || '?').slice(0, 3).toUpperCase(),
    color: t.color || t.logo_color || null,
    logoUrl: t.logoUrl || t.logo_url || null,
  };
}

// Build the card data object from the pieces PublicGame already computes.
// scorersHome/Away must already honor the youth guardrail (pass [] to suppress).
export function buildRecapCardData({ home, away, homeScore, awayScore, round, competition, league, tie, scorersHome, scorersAway, sponsor }) {
  return {
    home: normTeam(home), away: normTeam(away),
    homeScore, awayScore, round, competition, league, tie: !!tie,
    scorersHome: scorersHome || [], scorersAway: scorersAway || [], sponsor: sponsor || null,
  };
}

// Compose one format → PNG Blob.
export async function composeRecapCard(card, { format = 'portrait' } = {}) {
  const L = format === 'wide' ? WIDE : PORTRAIT;
  await ensureFonts();
  const [homeLogo, awayLogo, wordmark] = await Promise.all([
    loadImage(card.home.logoUrl),
    loadImage(card.away.logoUrl),
    loadImage(WORDMARK_SRC),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = L.W; canvas.height = L.H;
  const ctx = canvas.getContext('2d');
  drawCard(ctx, L, card, { homeLogo, awayLogo, wordmark });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
  });
}

// Compose both formats at once (portrait for Web Share, wide for OG).
export async function composeBothFormats(card) {
  const [portrait, wide] = await Promise.all([
    composeRecapCard(card, { format: 'portrait' }),
    composeRecapCard(card, { format: 'wide' }),
  ]);
  return { portrait, wide };
}
