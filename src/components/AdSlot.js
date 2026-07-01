import React, { useEffect, useRef, useState } from 'react';
import { getActivePlacements, pickByWeight } from '../lib/ads';
import { adImpression, adTap } from '../lib/adBeacon';
import { C } from '../lib/tokens';

// ADS-1 · M1 — renders one sponsor slot for a page. Picks a weighted placement
// once on mount, renders a plain <a><img> (or a "Presented by" text lockup when
// there's no image), and fires a batched impression (≥50% visible ≥1s, once) +
// tap. Renders NOTHING when there's no active placement, so pages with no
// sponsor are byte-identical. No third-party script.
//
//   <AdSlot slot="event_banner" targetType="league" targetId={id} />

const TAG = { position: 'absolute', top: 4, right: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.35)', padding: '1px 6px', borderRadius: 4, pointerEvents: 'none' };

export default function AdSlot({ slot, targetType, targetId, style, radius = 10 }) {
  const [placement, setPlacement] = useState(null);
  const ref = useRef(null);
  const seenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    seenRef.current = false;
    (async () => {
      const all = await getActivePlacements({ targetType, targetId });
      if (cancelled) return;
      setPlacement(pickByWeight(all.filter((p) => p.slot === slot)));
    })();
    return () => { cancelled = true; };
  }, [slot, targetType, targetId]);

  // Impression: once, when ≥50% visible for ≥1s.
  useEffect(() => {
    if (!placement || !ref.current || seenRef.current) return undefined;
    let t = null;
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        t = setTimeout(() => {
          if (!seenRef.current) { seenRef.current = true; adImpression(placement.id); io.disconnect(); }
        }, 1000);
      } else if (t) { clearTimeout(t); t = null; }
    }, { threshold: [0, 0.5, 1] });
    io.observe(ref.current);
    return () => { if (t) clearTimeout(t); io.disconnect(); };
  }, [placement]);

  if (!placement) return null;
  const c = placement.creative;
  const onClick = () => adTap(placement.id);

  const inner = c.image_url
    ? <img src={c.image_url} alt={c.sponsor_name || 'Sponsor'} loading="lazy" style={{ display: 'block', width: '100%', height: 'auto' }} />
    : <div style={{ padding: '10px 14px', textAlign: 'center', color: C.steel, fontSize: 12, fontFamily: "'Barlow', sans-serif" }}>
        Presented by <span style={{ color: C.ice, fontWeight: 700 }}>{c.sponsor_name}</span>
      </div>;

  const body = c.link_url
    ? <a href={c.link_url} target="_blank" rel="noopener noreferrer nofollow sponsored" onClick={onClick} style={{ display: 'block' }}>{inner}</a>
    : <div onClick={onClick} role="button">{inner}</div>;

  return (
    <div ref={ref} style={{ position: 'relative', overflow: 'hidden', borderRadius: radius, ...style }}>
      {body}
      <span style={TAG}>Sponsored</span>
    </div>
  );
}
