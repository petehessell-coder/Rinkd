// A1 (feed-engagement) — recap SHARE image, v2.
//
// Composes the RINKD GAME RECAP card client-side on a <canvas> over the
// /public/recap-card-bg2.png plate, from the get_game_recap_card RPC payload
// (same data as the in-feed RecapCard). Zero server render cost. Bakes the QR
// (rinkd.app deep link) into the footer so a flat Instagram repost still draws
// people back. Ported 1:1 from the Pete-approved public/recap-share-preview.html.
//
//   composeRecapCardV2(payload, { shareUrl, sponsorName }) -> Promise<Blob>
//
// Self-contained (own image/font loaders) so it never disturbs the shared
// shareCard.js pipeline that GamePuck + photo shares depend on.

import QRCode from 'qrcode';
import { colors } from './tokens';

const PLATE = '/recap-card-bg2.png';
const WORDMARK = '/rinkd-wordmark-tape.png';
const W = 1003, H = 1568, PAD = 58;
const C = { ice: colors.ice, steel: colors.muted, blue: '#4a93e6', line: 'rgba(46,91,140,.5)', dark: '#060c15' };
const PALETTE = [colors.blue, colors.red, '#1F9E6B', '#9333EA', '#E08A1E', '#0EA5E9'];

function teamColor(t) {
  if (t && t.logo_color) return t.logo_color;
  const name = (t && t.name) || '';
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] || colors.blue;
}
function initials(t) {
  if (t && t.logo_initials) return t.logo_initials;
  const name = (t && t.name) || '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
function periodString(periodScores, side) {
  const byP = {}; (periodScores || []).forEach((p) => { if (p.side === side) byP[p.period] = p.goals; });
  const maxP = Math.max(3, ...Object.keys(byP).map(Number).concat([0]));
  const out = []; for (let p = 1; p <= maxP; p++) out.push(byP[p] || 0);
  return out.join('·');
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    fetch(src, { cache: 'force-cache' }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b && typeof createImageBitmap === 'function') return createImageBitmap(b).then(resolve, () => resolve(null));
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null);
      img.src = b ? URL.createObjectURL(b) : src; if (!b) img.crossOrigin = 'anonymous';
    }).catch(() => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src;
    });
  });
}
async function ensureFonts() {
  try {
    if (!document.fonts) return;
    await Promise.all([
      document.fonts.load("900 italic 200px 'Barlow Condensed'"),
      document.fonts.load("800 46px 'Barlow Condensed'"),
      document.fonts.load("700 28px 'Barlow'"),
      document.fonts.load("600 30px 'Barlow'"),
    ]);
    await document.fonts.ready;
  } catch { /* best-effort */ }
}

export async function composeRecapCardV2(payload, { shareUrl, sponsorName = null } = {}) {
  await ensureFonts();
  let qrDataUrl = null;
  try { qrDataUrl = await QRCode.toDataURL(shareUrl || 'https://rinkd.app', { margin: 0, width: 204, color: { dark: colors.surfaceDeep, light: '#ffffff' } }); } catch { /* QR optional */ }
  const [plate, wm, qr] = await Promise.all([loadImage(PLATE), loadImage(WORDMARK), loadImage(qrDataUrl)]);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const homeC = teamColor(payload.home), awayC = teamColor(payload.away);

  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const shield = (cx, cy, w, h, color, init) => {
    ctx.save(); ctx.fillStyle = color; roundRect(cx - w / 2, cy - h / 2, w, h, 18); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "900 italic 52px 'Barlow Condensed'"; ctx.fillText(init, cx, cy + 3);
  };

  if (plate) ctx.drawImage(plate, 0, 0, W, H); else { ctx.fillStyle = colors.surfaceDeep; ctx.fillRect(0, 0, W, H); }
  const g = ctx.createLinearGradient(0, 420, 0, H);
  g.addColorStop(0, 'rgba(7,17,31,0)'); g.addColorStop(.10, 'rgba(7,17,31,.55)'); g.addColorStop(.34, 'rgba(6,12,21,.85)'); g.addColorStop(.6, C.dark); g.addColorStop(1, C.dark);
  ctx.fillStyle = g; ctx.fillRect(0, 420, W, H - 420);

  let y = 470;
  const ax = W * 0.24, hx = W * 0.76;
  shield(ax, y + 58, 95, 116, awayC, initials(payload.away));
  shield(hx, y + 58, 95, 116, homeC, initials(payload.home));
  ctx.fillStyle = C.steel; ctx.font = "900 italic 44px 'Barlow Condensed'"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VS', W / 2, y + 50);
  ctx.fillStyle = C.ice; ctx.font = "800 46px 'Barlow Condensed'";
  ctx.fillText((payload.away?.name || 'Away').toUpperCase(), ax, y + 150);
  ctx.fillText((payload.home?.name || 'Home').toUpperCase(), hx, y + 150);
  ctx.fillStyle = C.steel; ctx.font = "700 24px 'Barlow'"; ctx.fillText('AWAY', ax, y + 182); ctx.fillText('HOME', hx, y + 182);
  y += 210;

  ctx.fillStyle = C.ice; ctx.font = "900 italic 200px 'Barlow Condensed'"; ctx.textBaseline = 'middle';
  // Broadcast "score bug" lift — a soft drop shadow under the big numbers.
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillText(`${payload.away_score ?? 0}`, W * 0.30, y + 70); ctx.fillText(`${payload.home_score ?? 0}`, W * 0.70, y + 70);
  ctx.restore();
  ctx.fillStyle = C.steel; ctx.font = "800 100px 'Barlow Condensed'"; ctx.fillText('–', W / 2, y + 60);
  y += 160;

  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W / 2 - 130, y); ctx.moveTo(W / 2 + 130, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  ctx.fillStyle = C.blue; ctx.font = "800 26px 'Barlow'"; ctx.textBaseline = 'middle'; ctx.fillText('FINAL SCORE', W / 2, y);
  y += 44;

  if (payload.stats_available) {
    const colTop = y, lx = PAD, rx = W / 2 + 24, colW = W / 2 - PAD - 24;
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.blue; ctx.font = "900 italic 34px 'Barlow Condensed'"; ctx.textAlign = 'center';
    ctx.fillText('GOALS', lx + colW / 2, colTop + 30); ctx.fillText('GAME STATS', rx + colW / 2, colTop + 30);
    let gy = colTop + 76; const goals = (payload.goals || []).slice(0, 7);
    goals.forEach((g2) => {
      ctx.fillStyle = g2.side === 'H' ? homeC : awayC; roundRect(lx, gy - 12, 16, 16, 4); ctx.fill();
      ctx.fillStyle = C.ice; ctx.font = "600 30px 'Barlow'"; ctx.textAlign = 'left'; ctx.fillText(g2.name, lx + 28, gy + 3);
      ctx.fillStyle = C.steel; ctx.font = "600 27px 'Barlow'"; ctx.textAlign = 'right'; ctx.fillText(`P${g2.period} ${g2.time}`, lx + colW, gy + 3);
      gy += 46;
    });
    if ((payload.goals || []).length > 7) { ctx.fillStyle = C.steel; ctx.font = "600 26px 'Barlow'"; ctx.textAlign = 'left'; ctx.fillText(`+${payload.goals.length - 7} more`, lx + 28, gy + 3); }
    const stats = [['Shots', payload.shots_away, payload.shots_home], ['Pen Min', payload.pim_away, payload.pim_home], ['Saves', payload.saves_away, payload.saves_home], ['By Period', periodString(payload.period_scores, 'A'), periodString(payload.period_scores, 'H')]];
    let sy = colTop + 76;
    stats.forEach((s) => {
      ctx.fillStyle = C.blue; ctx.font = "800 42px 'Barlow Condensed'";
      ctx.textAlign = 'left'; ctx.fillText(`${s[1] ?? 0}`, rx, sy + 10); ctx.textAlign = 'right'; ctx.fillText(`${s[2] ?? 0}`, rx + colW, sy + 10);
      ctx.fillStyle = '#cdd9e6'; ctx.font = "700 22px 'Barlow'"; ctx.textAlign = 'center'; ctx.fillText(String(s[0]).toUpperCase(), rx + colW / 2, sy + 8);
      ctx.strokeStyle = 'rgba(46,91,140,.22)'; ctx.beginPath(); ctx.moveTo(rx, sy + 30); ctx.lineTo(rx + colW, sy + 30); ctx.stroke();
      sy += 58;
    });
    y = Math.max(gy, sy) + 30;
  }

  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  ctx.fillStyle = C.blue; ctx.font = "800 22px 'Barlow'"; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('LOCATION', W * 0.30, y + 34); ctx.fillText('DATE', W * 0.70, y + 34);
  ctx.fillStyle = C.ice; ctx.font = "600 30px 'Barlow'"; ctx.fillText(payload.rink || '—', W * 0.30, y + 70); ctx.fillText(fmtDate(payload.date), W * 0.70, y + 70);
  y += 104;

  ctx.fillStyle = 'rgba(10,24,48,.7)'; ctx.fillRect(0, y, W, 72);
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.moveTo(0, y + 72); ctx.lineTo(W, y + 72); ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.fillStyle = C.steel; ctx.font = "700 21px 'Barlow'"; ctx.textAlign = 'right'; ctx.fillText('RECAP PRESENTED BY', W / 2 - 12, y + 36);
  ctx.fillStyle = C.ice; ctx.font = "900 italic 34px 'Barlow Condensed'"; ctx.textAlign = 'left'; ctx.fillText((sponsorName || 'RINKD').toUpperCase(), W / 2 + 12, y + 38);
  y += 72;

  if (wm && (wm.width || wm.naturalWidth)) {
    const iw = wm.width || wm.naturalWidth, ih = wm.height || wm.naturalHeight, wh = 64, ww = wh * (iw / ih);
    ctx.drawImage(wm, PAD, y + 34, ww, wh);
  }
  ctx.fillStyle = C.steel; ctx.font = "700 28px 'Barlow'"; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('rinkd.app', PAD, y + 128);
  ctx.fillStyle = C.steel; ctx.font = "700 22px 'Barlow'"; ctx.textAlign = 'center';
  ctx.fillText('EVERY SHIFT.', W / 2, y + 50); ctx.fillText('EVERY GAME.', W / 2, y + 80); ctx.fillText('EVERY PLAYER.', W / 2, y + 110);
  if (qr) { ctx.fillStyle = '#fff'; roundRect(W - PAD - 126, y + 30, 126, 126, 14); ctx.fill(); ctx.drawImage(qr, W - PAD - 114, y + 42, 102, 102); }

  // Hairline broadcast safe-area frame.
  ctx.save(); ctx.strokeStyle = 'rgba(244,247,250,0.10)'; ctx.lineWidth = 2;
  roundRect(28, 28, W - 56, H - 56, 22); ctx.stroke(); ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png');
  });
}
