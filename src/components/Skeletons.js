import React from 'react';

const C = {
  card: '#0f2847', border: 'rgba(46,91,140,0.4)',
  shimmer1: 'rgba(46,91,140,0.18)', shimmer2: 'rgba(46,91,140,0.32)',
  ice: '#F4F7FA', steel: '#8BA3BE', red: '#D72638',
};

/**
 * Pure CSS shimmer block. We inject the keyframes once globally so the
 * component stays a single import.
 */
let injected = false;
function ensureShimmerKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rinkdShimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
    .rinkd-shimmer { background: linear-gradient(90deg, ${C.shimmer1} 0%, ${C.shimmer2} 50%, ${C.shimmer1} 100%); background-size: 800px 100%; animation: rinkdShimmer 1.4s linear infinite; }
  `;
  document.head.appendChild(style);
}

function Shimmer({ width = '100%', height = 14, radius = 4, style }) {
  ensureShimmerKeyframes();
  return <div className="rinkd-shimmer" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** A single post card placeholder for the feed. */
export function PostSkeleton() {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <Shimmer width={38} height={38} radius={999} />
        <div style={{ flex: 1 }}>
          <Shimmer width="40%" height={12} />
          <div style={{ height: 6 }} />
          <Shimmer width="25%" height={10} />
        </div>
      </div>
      <Shimmer width="100%" height={14} />
      <div style={{ height: 6 }} />
      <Shimmer width="80%" height={14} />
      <div style={{ height: 12 }} />
      <Shimmer width="100%" height={180} radius={10} />
    </div>
  );
}

/** Three skeletons stacked — good default loading state for any feed. */
export function FeedSkeleton({ count = 3 }) {
  return <>{Array.from({ length: count }).map((_, i) => <PostSkeleton key={i} />)}</>;
}

/** A list row placeholder — for rosters, schedules, standings. */
export function ListRowSkeleton({ rows = 5 }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: i ? '1px solid rgba(46,91,140,0.25)' : 'none' }}>
          <Shimmer width={32} height={32} radius={6} />
          <div style={{ flex: 1 }}>
            <Shimmer width="55%" height={12} />
            <div style={{ height: 4 }} />
            <Shimmer width="30%" height={10} />
          </div>
          <Shimmer width={40} height={14} />
        </div>
      ))}
    </div>
  );
}

/** Grid card placeholder — for show cards, article cards, etc. */
export function CardGridSkeleton({ count = 6 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <Shimmer width="100%" height={150} radius={0} />
          <div style={{ padding: 14 }}>
            <Shimmer width="55%" height={11} />
            <div style={{ height: 8 }} />
            <Shimmer width="90%" height={16} />
            <div style={{ height: 6 }} />
            <Shimmer width="100%" height={11} />
            <div style={{ height: 4 }} />
            <Shimmer width="75%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state with art + headline + body + CTA. Use everywhere a list is
 * legitimately empty (not still loading).
 *
 *   <EmptyState icon="🏒" title="No posts yet" body="Be the first to drop a goal."
 *               cta={{ label: 'Post It', onClick: () => setComposerOpen(true) }} />
 */
export function EmptyState({ icon = '🏒', title, body, cta }) {
  return (
    <div style={{
      textAlign: 'center', padding: '50px 24px',
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
    }}>
      <div style={{ fontSize: 48, marginBottom: 14, lineHeight: 1 }}>{icon}</div>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900,
        fontSize: 22, lineHeight: 1.15, color: C.ice, marginBottom: 8,
        textTransform: 'uppercase',
      }}>{title}</div>
      {body && <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, maxWidth: 380, margin: '0 auto 18px' }}>{body}</div>}
      {cta && (
        <button onClick={cta.onClick} style={{
          background: C.red, color: '#fff', border: 'none',
          padding: '11px 22px', borderRadius: 999, cursor: 'pointer',
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic',
          fontSize: 14, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
