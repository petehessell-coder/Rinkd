import React from 'react';
import { C, motion } from '../lib/tokens';

// =============================================================================
// LiveLowerThird — the broadcast live "lower-third": a red-accent slab that
// bleeds to the card edges, a ring-expanding live dot, and condensed-italic
// "<PERIOD> · LIVE" text. Extracted from PublicGame so GameDetail and the
// public page render the identical live moment (S08).
//
//   <LiveLowerThird period={game.period} />                 // "2nd Period · Live"
//   <LiveLowerThird period={game.period} label="1st" />     // custom label text
//
// Props:
//   · period — game.period (1..5, may be null pre-first-period).
//   · label  — optional full label override. When omitted we derive the
//              broadcast "<ordinal> Period / Overtime / Shootout · Live".
//   · accent — optional right-side slot (e.g. a SoundToggle / watching count).
//              Rendered flush-right inside the slab.
//
// The ring uses the manifesto live-indicator token (motion.duration.pulse,
// 1.5s infinite) and is a no-op under prefers-reduced-motion — the keyframes
// are injected once and gated by the reduce media query.
// =============================================================================

// Broadcast period label — "2nd Period" / "Overtime" / "Shootout". Tolerates
// null/0 (live game before the scorer sets a period). Exported so callers that
// need to compose the label (e.g. appending a clock) can reuse it.
export function periodDisplay(p) {
  const n = p || 1;
  if (n === 4) return 'Overtime';
  if (n >= 5) return 'Shootout';
  const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  return `${ord} Period`;
}

// One-time keyframe inject — the red ring expands 0→16px and fades out, on the
// manifesto live cadence (pulse duration). Disabled under reduced motion.
let injected = false;
function ensureRingKeyframes() {
  if (injected || typeof document === 'undefined') return;
  if (document.getElementById('rinkd-llt-anim')) { injected = true; return; }
  injected = true;
  const secs = (motion.duration.pulse / 1000).toFixed(2);
  const el = document.createElement('style');
  el.id = 'rinkd-llt-anim';
  el.textContent =
    '@keyframes lltLiveRing{0%{box-shadow:0 0 0 0 rgba(215,38,56,0.7)}75%{box-shadow:0 0 0 16px rgba(215,38,56,0)}100%{box-shadow:0 0 0 0 rgba(215,38,56,0)}}'
    + `.llt-live-ring{animation:lltLiveRing ${secs}s ease-out infinite}`
    + '@media (prefers-reduced-motion: reduce){.llt-live-ring{animation:none}}';
  document.head.appendChild(el);
}

// `bleed` cancels the parent card's padding so the slab runs flush to the
// card edges — default matches PublicGame's 22px/18px card; GameDetail passes
// its own (its box pads 16px; the old hardcoded -18px clipped ~2px per side).
export default function LiveLowerThird({ period, label, accent, bleed = '-22px -18px 18px' }) {
  ensureRingKeyframes();
  const text = label != null ? label : `${periodDisplay(period)} · Live`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: bleed, padding: '7px 8px 7px 18px', background: C.navy, borderLeft: `4px solid ${C.red}` }}>
      <span className="llt-live-ring" style={{ width: 10, height: 10, borderRadius: 999, background: C.red, flex: '0 0 auto' }} />
      <span style={{ flex: 1, minWidth: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.05em', color: C.ice, fontSize: 17, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {text}
      </span>
      {accent}
    </div>
  );
}
