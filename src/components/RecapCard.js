// A1 (feed-engagement) — the RINKD GAME RECAP card, in-feed.
//
// Renders the get_game_recap_card payload over the /public/recap-card-bg2.png
// plate (header art + cracked-ice texture baked in; data flows beneath it on a
// scrim). Self-contained: pass gameId + source and it fetches its own data, so
// any feed surface (Feed, League, Tournament, TeamFeed) drops it in with one line.
//
// Layout ported 1:1 from the Pete-approved public/recap-preview.html. Container
// units (cqw) scale the whole card with its width — same design in-feed and at
// share size. team-source games render score-only (no goals/stats captured).

import { useEffect, useState } from 'react';
import { getRecapCardWithSponsor } from '../lib/recapCard';

const PLATE = '/recap-card-bg2.png';
const WORDMARK = '/rinkd-wordmark-tape.png';
const PALETTE = ['#2E5B8C', '#D72638', '#1F9E6B', '#9333EA', '#E08A1E', '#0EA5E9'];

function teamColor(t, fallback) {
  if (t && t.logo_color) return t.logo_color;
  const name = (t && t.name) || '';
  if (!name) return fallback;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(t) {
  if (t && t.logo_initials) return t.logo_initials;
  const name = (t && t.name) || '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
function periodString(periodScores, side) {
  const byP = {};
  (periodScores || []).forEach((p) => { if (p.side === side) byP[p.period] = p.goals; });
  const maxP = Math.max(3, ...Object.keys(byP).map(Number).concat([0]));
  const out = [];
  for (let p = 1; p <= maxP; p++) out.push(byP[p] || 0);
  return out.join('·');
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CSS = `
.rcap{container-type:inline-size;position:relative;width:100%;border-radius:14px;overflow:hidden;
  background:#07111F url(${PLATE}) top center / 100% auto no-repeat;font-family:'Barlow',sans-serif}
.rcap .d{margin-top:43cqw;display:flex;flex-direction:column;padding:3cqw 5cqw 4.5cqw;
  background:linear-gradient(to bottom,rgba(7,17,31,0) 0,rgba(7,17,31,.55) 9cqw,rgba(6,12,21,.85) 26cqw,#060c15 46cqw)}
.rcap .teams{display:flex;align-items:flex-start;justify-content:space-between;gap:2cqw}
.rcap .tm{flex:1;display:flex;flex-direction:column;align-items:center;gap:1.4cqw}
.rcap .sh{width:13cqw;height:15.5cqw;border-radius:2cqw 2cqw 5cqw 5cqw;display:flex;align-items:center;justify-content:center;
  font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:6cqw;color:#fff;border:.5cqw solid rgba(255,255,255,.2)}
.rcap .nm{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:4.6cqw;letter-spacing:.02em;text-align:center;line-height:1;color:#F4F7FA}
.rcap .sd{color:#8BA3BE;font-size:2.4cqw;font-weight:700;letter-spacing:.16em}
.rcap .vs{align-self:center;color:#8BA3BE;font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:4.4cqw;padding-top:5cqw}
.rcap .sc{display:flex;align-items:center;justify-content:center;gap:6cqw;margin:.5cqw 0 1cqw}
.rcap .sc .n{font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:21cqw;line-height:.82;color:#F4F7FA}
.rcap .sc .dh{color:#8BA3BE;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:11cqw}
.rcap .fin{display:flex;align-items:center;gap:2cqw;justify-content:center;color:#4a93e6;font-weight:800;font-size:2.7cqw;letter-spacing:.2em;margin-bottom:1.5cqw}
.rcap .fin::before,.rcap .fin::after{content:"";height:1px;flex:1;background:rgba(46,91,140,.5)}
.rcap .cols{display:grid;grid-template-columns:1fr 1fr;gap:4cqw}
.rcap h3{color:#4a93e6;font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:3.6cqw;letter-spacing:.06em;text-align:center;margin:0 0 2cqw}
.rcap .gl{display:flex;justify-content:space-between;align-items:center;gap:2cqw;font-size:3cqw;padding:.9cqw 0;color:#F4F7FA}
.rcap .gl .who{display:flex;align-items:center;gap:1.6cqw;min-width:0}
.rcap .gl .dot{width:1.8cqw;height:1.8cqw;border-radius:.4cqw;flex:none}
.rcap .gl .who span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rcap .gl .t{color:#8BA3BE;font-variant-numeric:tabular-nums;font-size:2.7cqw;flex:none}
.rcap .st{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:2cqw;padding:1.5cqw 0;border-bottom:1px solid rgba(46,91,140,.22)}
.rcap .st:last-child{border-bottom:none}
.rcap .st .v{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:4.4cqw;color:#4a93e6}
.rcap .st .v.l{text-align:left}.rcap .st .v.r{text-align:right}
.rcap .st .lab{color:#cdd9e6;font-size:2.4cqw;font-weight:700;letter-spacing:.04em;text-align:center;text-transform:uppercase;white-space:nowrap}
.rcap .meta{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid rgba(46,91,140,.4);margin-top:1cqw}
.rcap .meta>div{padding:2cqw;text-align:center}
.rcap .meta>div+div{border-left:1px solid rgba(46,91,140,.4)}
.rcap .meta .k{color:#4a93e6;font-weight:800;font-size:2.2cqw;letter-spacing:.12em;margin-bottom:.5cqw}
.rcap .meta .val{font-size:3cqw;font-weight:600;color:#F4F7FA}
.rcap .spon{display:flex;align-items:center;justify-content:center;gap:2cqw;background:rgba(10,24,48,.7);border-top:1px solid rgba(46,91,140,.4);border-bottom:1px solid rgba(46,91,140,.4);padding:1.8cqw;margin-top:1cqw}
.rcap .spon .lbl{color:#8BA3BE;font-size:2.1cqw;font-weight:700;letter-spacing:.16em}
.rcap .spon .nm{font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:900;font-size:3.6cqw;color:#F4F7FA}
.rcap .spon .sponimg{height:5.5cqw;width:auto;max-width:42cqw;object-fit:contain;display:block}
.rcap .foot{display:flex;align-items:center;justify-content:space-between;gap:3cqw;padding:2.5cqw 0 0}
.rcap .foot .rkimg{height:7cqw;width:auto;display:block}
.rcap .foot .url{color:#8BA3BE;font-weight:700;font-size:2.8cqw;margin-top:.8cqw}
.rcap .foot .mid{flex:1;text-align:center;color:#8BA3BE;font-weight:700;font-size:2.1cqw;letter-spacing:.12em;line-height:1.5}
`;

export default function RecapCard({ gameId, source }) {
  const [card, setCard] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!gameId || !source) return undefined;
    getRecapCardWithSponsor(gameId, source).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { setFailed(true); return; }
      setCard(data);
    });
    return () => { alive = false; };
  }, [gameId, source]);

  if (failed || !card) return null;

  const homeC = teamColor(card.home, '#2E5B8C');
  const awayC = teamColor(card.away, '#D72638');

  return (
    <div className="rcap">
      <style>{CSS}</style>
      <div className="d">
        <div className="teams">
          <div className="tm">
            <div className="sh" style={{ background: awayC }}>{initials(card.away)}</div>
            <div className="nm">{(card.away?.name || 'Away').toUpperCase()}</div>
            <div className="sd">AWAY</div>
          </div>
          <div className="vs">VS</div>
          <div className="tm">
            <div className="sh" style={{ background: homeC }}>{initials(card.home)}</div>
            <div className="nm">{(card.home?.name || 'Home').toUpperCase()}</div>
            <div className="sd">HOME</div>
          </div>
        </div>

        <div className="sc">
          <div className="n">{card.away_score ?? 0}</div>
          <div className="dh">–</div>
          <div className="n">{card.home_score ?? 0}</div>
        </div>
        <div className="fin">FINAL SCORE</div>

        {card.stats_available && (
          <div className="cols">
            <div>
              <h3>GOALS</h3>
              {(card.goals || []).length === 0 && <div className="gl"><span style={{ color: '#8BA3BE', fontSize: '2.7cqw' }}>No goals logged</span></div>}
              {(card.goals || []).map((g, i) => (
                <div className="gl" key={i}>
                  <div className="who">
                    <span className="dot" style={{ background: g.side === 'H' ? homeC : awayC }} />
                    <span>{g.name}</span>
                  </div>
                  <div className="t">P{g.period} {g.time}</div>
                </div>
              ))}
            </div>
            <div>
              <h3>GAME STATS</h3>
              <div className="st"><div className="v l">{card.shots_away ?? 0}</div><div className="lab">Shots</div><div className="v r">{card.shots_home ?? 0}</div></div>
              <div className="st"><div className="v l">{card.pim_away ?? 0}</div><div className="lab">Pen Min</div><div className="v r">{card.pim_home ?? 0}</div></div>
              <div className="st"><div className="v l">{card.saves_away ?? 0}</div><div className="lab">Saves</div><div className="v r">{card.saves_home ?? 0}</div></div>
              <div className="st"><div className="v l">{periodString(card.period_scores, 'A')}</div><div className="lab">By Period</div><div className="v r">{periodString(card.period_scores, 'H')}</div></div>
            </div>
          </div>
        )}

        <div className="meta">
          <div><div className="k">LOCATION</div><div className="val">{card.rink || '—'}</div></div>
          <div><div className="k">DATE</div><div className="val">{fmtDate(card.date) || '—'}</div></div>
        </div>

        <div className="spon">
          <span className="lbl">RECAP PRESENTED BY</span>
          {card.sponsorImageUrl
            ? <img className="sponimg" src={card.sponsorImageUrl} alt={card.sponsorName || 'Sponsor'} />
            : <span className="nm">{(card.sponsorName || 'RINKD').toUpperCase()}</span>}
        </div>

        <div className="foot">
          <div>
            <img className="rkimg" src={WORDMARK} alt="RINKD" />
            <div className="url">rinkd.app</div>
          </div>
          <div className="mid">EVERY SHIFT.<br />EVERY GAME.<br />EVERY PLAYER.</div>
        </div>
      </div>
    </div>
  );
}
