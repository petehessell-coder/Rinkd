import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';
import { getProducts } from '../lib/products';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
};

const COLLECTION_LABELS = {
  'beer-league-essentials': 'Beer League Essentials',
  'goalie-gear': 'Goalie Gear',
  'new-skater': 'New Skater Starter Kit',
};
const collectionLabel = (slug) =>
  COLLECTION_LABELS[slug] ||
  (slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Featured Gear');

function fmtPrice(p, cur) {
  if (p == null) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).format(p);
  } catch {
    return `$${p}`;
  }
}

function ProductCard({ p }) {
  const price = fmtPrice(p.price, p.currency);
  const cta = p.source === 'pure_hockey' ? 'View on Pure Hockey' : 'Shop';
  // affiliate links get rel="sponsored" per Google/FTC guidance; own merch doesn't.
  const rel = p.is_affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  return (
    <a
      href={p.url}
      target="_blank"
      rel={rel}
      onClick={() => track('store_product_click', { product_id: p.id, source: p.source })}
      style={{ display: 'flex', flexDirection: 'column', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', textDecoration: 'none', color: C.ice }}
    >
      <div style={{ aspectRatio: '1 / 1', background: p.image_url ? `#fff url(${p.image_url}) center/contain no-repeat` : C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!p.image_url && <span style={{ fontSize: 40, opacity: 0.35 }}>🏒</span>}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {p.brand && <div style={{ fontSize: 10, fontWeight: 700, color: C.steel, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{p.brand}</div>}
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, flex: 1 }}>{p.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 }}>
          {price && <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18 }}>{price}</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{cta} ↗</span>
        </div>
      </div>
    </a>
  );
}

function Section({ title, sub, products }) {
  if (!products.length) return null;
  return (
    <div style={{ marginBottom: 34 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', color: C.ice }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: C.steel, marginTop: 2 }}>{sub}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginTop: 12 }}>
        {products.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}

export default function Store({ profile }) {
  const [products, setProducts] = useState(null);

  useEffect(() => { track('store_view'); }, []);
  useEffect(() => { getProducts().then(setProducts); }, []);

  const loading = products === null;
  const merch = (products || []).filter((p) => p.source === 'rinkd_merch');
  const ph = (products || []).filter((p) => p.source === 'pure_hockey');
  const phByCollection = ph.reduce((acc, p) => {
    const k = p.collection || 'featured';
    (acc[k] = acc[k] || []).push(p);
    return acc;
  }, {});

  return (
    <Layout profile={profile} currentPage="store">
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px 64px', color: C.ice, fontFamily: "'Barlow', sans-serif" }}>
        <TapeText height={30}>Store</TapeText>
        <div style={{ fontSize: 14, color: C.steel, marginTop: 12, marginBottom: 18 }}>Gear up. Rep the rink.</div>

        {/* FTC affiliate disclosure — required by law + AvantLink TOS. */}
        <div style={{ fontSize: 11.5, color: C.steel, background: 'rgba(46,91,140,0.12)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', marginBottom: 24, lineHeight: 1.5 }}>
          Some links are affiliate links — Rinkd may earn a commission on purchases, at no extra cost to you.
        </div>

        {loading && <div style={{ color: C.steel, fontSize: 14 }}>Loading…</div>}

        {!loading && (
          <>
            <Section title="Rinkd Merch" sub="Official Rinkd gear" products={merch} />

            {Object.keys(phByCollection).map((slug) => (
              <Section key={slug} title={collectionLabel(slug)} sub={null} products={phByCollection[slug]} />
            ))}

            {/* Pure Hockey pro shop — coming-soon until the affiliate feed is live. */}
            {ph.length === 0 && (
              <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase' }}>Pro Shop — dropping soon</div>
                <div style={{ fontSize: 13, color: C.steel, marginTop: 6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
                  RINKD merch + Curated sticks, skates, and gear from Pure Hockey. We're finalizing the partnership now.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
