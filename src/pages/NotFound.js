import React from 'react';
import { useNavigate } from 'react-router-dom';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638',
  ice: '#F4F7FA', steel: '#8BA3BE', dark: '#07111F',
  card: '#112236', border: '#1E3A5C',
};

/**
 * 404 page — "this rink doesn't exist." Hosted at the catch-all React Router
 * route (`*`). Replaces the previous silent redirect to /feed so users get a
 * real explanation when they hit a dead link, and so we get a chance to use
 * the Rinkd Rat mascot (Rizzo) as a brand moment instead of treating errors
 * as a hide-and-forget problem.
 */
export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: '100vh', background: C.dark,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px', fontFamily: "'Barlow', sans-serif",
    }}>
      <div style={{
        maxWidth: 480, width: '100%', textAlign: 'center',
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: '36px 24px 32px',
      }}>
        {/* <picture> falls back to PNG for the sub-1% of browsers that can't
            decode WebP. Modern browsers grab the 78KB WebP; only legacy Safari
            (<14) and IE will hit the 420KB PNG. */}
        <picture>
          <source srcSet="/mascot-rizzo.webp" type="image/webp" />
          <img
            src="/mascot-rizzo.png"
            alt="Rinkd Rat"
            width="220"
            height="220"
            style={{ display: 'block', margin: '0 auto 18px', maxWidth: '60%', height: 'auto' }}
          />
        </picture>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontStyle: 'italic', fontWeight: 900,
          fontSize: 64, lineHeight: 1, color: C.red,
          letterSpacing: '0.02em', marginBottom: 8,
        }}>
          404
        </div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontStyle: 'italic', fontWeight: 900,
          fontSize: 26, lineHeight: 1.1, color: C.ice,
          textTransform: 'uppercase', letterSpacing: '0.02em',
          marginBottom: 12,
        }}>
          This rink doesn't exist
        </div>
        <div style={{
          fontSize: 15, color: C.steel, lineHeight: 1.55,
          maxWidth: 360, margin: '0 auto 22px',
        }}>
          Wrong locker room, friend. The page you're looking for got benched or
          never made the roster. Skate it back to your home ice.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/home')} style={{
            background: C.red, color: '#fff', border: 'none',
            padding: '12px 24px', borderRadius: 999, cursor: 'pointer',
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
            fontSize: 15, letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            Home Ice
          </button>
          <button onClick={() => navigate(-1)} style={{
            background: 'transparent', color: C.steel, border: `1px solid ${C.border}`,
            padding: '12px 22px', borderRadius: 999, cursor: 'pointer',
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
            fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
