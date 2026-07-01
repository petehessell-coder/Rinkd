import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';
import { getProducts } from '../lib/products';
import { getMerchProducts, startStoreCheckout } from '../lib/store';
import { track } from '../lib/analytics';
import { supabase } from '../lib/supabase';
import { C, colors } from '../lib/tokens';

const CART_KEY = 'rinkd_cart_v1';

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
const fmtCents = (c, cur) => fmtPrice((c || 0) / 100, cur);

// ── Affiliate card (pure_hockey) — outbound link-out, unchanged behavior. ──────
function AffiliateCard({ p }) {
  const price = fmtPrice(p.price, p.currency);
  return (
    <a
      href={p.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
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
          <span style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>View on Pure Hockey ↗</span>
        </div>
      </div>
    </a>
  );
}

// ── Native merch card — variant picker + add to cart. ──────────────────────────
function MerchCard({ p, onAdd }) {
  const [variantId, setVariantId] = useState(p.variants[0]?.id);
  const variant = p.variants.find((v) => v.id === variantId) || p.variants[0];
  const img = variant?.image_url || p.image_url;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', color: C.ice }}>
      <div style={{ aspectRatio: '1 / 1', background: img ? `#fff url(${img}) center/contain no-repeat` : C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!img && <span style={{ fontSize: 40, opacity: 0.35 }}>🏒</span>}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</div>
        {p.variants.length > 1 && (
          <select
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            style={{ background: C.navy, color: C.ice, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 9px', fontSize: 13, fontFamily: "'Barlow', sans-serif" }}
          >
            {p.variants.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', gap: 8 }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 18 }}>
            {fmtPrice(variant?.price, variant?.currency)}
          </span>
          <button
            onClick={() => onAdd(p, variant)}
            style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <div style={{ marginBottom: 34 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase', color: C.ice }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: C.steel, marginTop: 2 }}>{sub}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginTop: 12 }}>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: '100%', background: C.navy, color: C.ice, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: "'Barlow', sans-serif", boxSizing: 'border-box' };

// ── Cart + checkout modal ──────────────────────────────────────────────────────
function CartModal({ cart, currency, onClose, onQty, onRemove, profile }) {
  const [step, setStep] = useState('cart'); // 'cart' | 'address'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({
    name: profile?.full_name || profile?.display_name || profile?.name || '',
    email: '',
    address1: '', address2: '', city: '', state: '', country: 'US', zip: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // YOUTH-PRIVACY: profiles.email is column-revoked. The checkout email prefill
  // comes from the auth session (the user's own address) instead of the profile.
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      const e = data?.user?.email;
      if (alive && e) setForm((f) => (f.email ? f : { ...f, email: e }));
    });
    return () => { alive = false; };
  }, []);

  const subtotalCents = cart.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0);

  async function pay() {
    setErr(null);
    setBusy(true);
    try {
      track('store_checkout_start', { items: cart.length, subtotal_cents: subtotalCents });
      const { url } = await startStoreCheckout({
        items: cart.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
        shipping: {
          name: form.name, address1: form.address1, address2: form.address2,
          city: form.city, state: form.state.trim().toUpperCase(),
          country: form.country.trim().toUpperCase(), zip: form.zip,
        },
        email: form.email,
      });
      window.location.href = url; // hand off to Stripe Checkout
    } catch (e) {
      setErr(e.reason === 'shipping'
        ? "We couldn't calculate shipping to that address. Double-check it."
        : e.reason === 'stale_cart'
        ? 'Some items are no longer available — please refresh your cart.'
        : (e.message || 'Could not start checkout.'));
      setBusy(false);
    }
  }

  const addressValid = form.name && form.email && form.address1 && form.city && form.country && form.zip;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.dark, borderTop: `1px solid ${C.border}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', padding: '20px 18px 28px', color: C.ice, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase' }}>
            {step === 'cart' ? 'Your Cart' : 'Shipping'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.steel, fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {cart.length === 0 && <div style={{ color: C.steel, fontSize: 14, padding: '20px 0' }}>Your cart is empty.</div>}

        {step === 'cart' && cart.length > 0 && (
          <>
            {cart.map((i) => (
              <div key={i.variant_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: i.image_url ? `#fff url(${i.image_url}) center/contain no-repeat` : C.navy }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.product_name}</div>
                  {i.variant_name && <div style={{ fontSize: 11.5, color: C.steel }}>{i.variant_name}</div>}
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{fmtPrice(i.price, currency)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => onQty(i.variant_id, i.quantity - 1)} style={qtyBtn}>–</button>
                  <span style={{ minWidth: 18, textAlign: 'center', fontSize: 14 }}>{i.quantity}</span>
                  <button onClick={() => onQty(i.variant_id, i.quantity + 1)} style={qtyBtn}>+</button>
                </div>
                <button onClick={() => onRemove(i.variant_id)} style={{ background: 'none', border: 'none', color: C.steel, fontSize: 12, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ color: C.steel, fontSize: 13 }}>Subtotal</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22 }}>{fmtCents(subtotalCents, currency)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.steel, marginTop: 4 }}>Shipping + tax calculated at the next step.</div>
            <button onClick={() => setStep('address')} style={{ ...primaryBtn, marginTop: 16 }}>Continue to shipping →</button>
          </>
        )}

        {step === 'address' && (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              <input style={inputStyle} placeholder="Full name" value={form.name} onChange={set('name')} />
              <input style={inputStyle} placeholder="Email" type="email" value={form.email} onChange={set('email')} />
              <input style={inputStyle} placeholder="Address" value={form.address1} onChange={set('address1')} />
              <input style={inputStyle} placeholder="Apt, suite (optional)" value={form.address2} onChange={set('address2')} />
              <input style={inputStyle} placeholder="City" value={form.city} onChange={set('city')} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <input style={inputStyle} placeholder="State" value={form.state} onChange={set('state')} />
                <input style={inputStyle} placeholder="ZIP" value={form.zip} onChange={set('zip')} />
                <input style={inputStyle} placeholder="Country" value={form.country} onChange={set('country')} />
              </div>
            </div>
            {err && <div style={{ color: C.red, fontSize: 13, marginTop: 12 }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
              <button onClick={() => setStep('cart')} disabled={busy} style={{ ...secondaryBtn, flex: '0 0 auto' }}>← Back</button>
              <button onClick={pay} disabled={busy || !addressValid} style={{ ...primaryBtn, flex: 1, opacity: (busy || !addressValid) ? 0.6 : 1 }}>
                {busy ? 'Starting checkout…' : 'Continue to payment →'}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: C.steel, marginTop: 10, textAlign: 'center' }}>Secure payment by Stripe. Shipping + tax shown before you pay.</div>
          </>
        )}
      </div>
    </div>
  );
}

const qtyBtn = { background: C.navy, color: C.ice, border: `1px solid ${C.border}`, borderRadius: 6, width: 26, height: 26, fontSize: 16, cursor: 'pointer', lineHeight: 1 };
const primaryBtn = { width: '100%', background: C.red, color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic' };
const secondaryBtn = { background: 'transparent', color: C.steel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 16px', fontSize: 14, cursor: 'pointer' };

export default function Store({ profile }) {
  const [affiliate, setAffiliate] = useState(null);
  const [merch, setMerch] = useState(null);
  const [cart, setCart] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY)) || [];
      // Self-heal: coerce any missing/invalid quantity (legacy carts) to a sane 1–20.
      return saved.map((i) => {
        const q = Math.round(Number(i.quantity));
        return { ...i, quantity: Number.isFinite(q) && q > 0 ? Math.min(20, q) : 1 };
      });
    } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => { track('store_view'); }, []);
  useEffect(() => { getProducts().then((all) => setAffiliate((all || []).filter((p) => p.source === 'pure_hockey'))); }, []);
  useEffect(() => { getMerchProducts().then(setMerch); }, []);
  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }, [cart]);

  // Stripe redirect handling.
  const success = params.get('success') === '1';
  const canceled = params.get('canceled') === '1';
  useEffect(() => {
    if (success) {
      setCart([]);
      track('store_purchase_complete');
    }
  }, [success]);
  const clearParams = () => { params.delete('success'); params.delete('canceled'); setParams(params, { replace: true }); };

  const addToCart = (p, v) => {
    if (!v) return;
    setCart((prev) => {
      const ex = prev.find((i) => i.variant_id === v.id);
      if (ex) return prev.map((i) => i.variant_id === v.id ? { ...i, quantity: Math.min(20, i.quantity + 1) } : i);
      return [...prev, { variant_id: v.id, product_id: p.id, product_name: p.name, variant_name: v.name, image_url: v.image_url || p.image_url, price: Number(v.price), currency: v.currency, quantity: 1 }];
    });
    track('store_add_to_cart', { product_id: p.id, variant_id: v.id });
    setCartOpen(true);
  };
  const setQty = (variantId, q) => {
    if (q <= 0) return setCart((prev) => prev.filter((i) => i.variant_id !== variantId));
    setCart((prev) => prev.map((i) => i.variant_id === variantId ? { ...i, quantity: Math.min(20, q) } : i));
  };
  const removeItem = (variantId) => setCart((prev) => prev.filter((i) => i.variant_id !== variantId));

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const currency = merch?.[0]?.variants?.[0]?.currency || cart[0]?.currency || 'USD';

  const phByCollection = useMemo(() => (affiliate || []).reduce((acc, p) => {
    const k = p.collection || 'featured';
    (acc[k] = acc[k] || []).push(p);
    return acc;
  }, {}), [affiliate]);

  const loading = merch === null || affiliate === null;
  const nothing = !loading && (merch || []).length === 0 && (affiliate || []).length === 0;

  return (
    <Layout profile={profile} currentPage="store">
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px 96px', color: C.ice, fontFamily: "'Barlow', sans-serif" }}>
        <TapeText height={30}>Store</TapeText>
        <div style={{ fontSize: 14, color: C.steel, marginTop: 12, marginBottom: 18 }}>Gear up. Rep the rink.</div>

        {success && (
          <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 13.5, lineHeight: 1.5 }}>
            <strong style={{ color: colors.success }}>Order confirmed!</strong> Thanks for repping Rinkd. You'll get an email when it ships.
            <button onClick={clearParams} style={{ background: 'none', border: 'none', color: C.steel, marginLeft: 8, cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
          </div>
        )}
        {canceled && (
          <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 13.5 }}>
            Checkout canceled — your cart is still here.
            <button onClick={clearParams} style={{ background: 'none', border: 'none', color: C.steel, marginLeft: 8, cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
          </div>
        )}

        {/* FTC affiliate disclosure — required by law + AvantLink TOS. */}
        <div style={{ fontSize: 11.5, color: C.steel, background: 'rgba(46,91,140,0.12)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', marginBottom: 24, lineHeight: 1.5 }}>
          Some links are affiliate links — Rinkd may earn a commission on purchases, at no extra cost to you.
        </div>

        {loading && <div style={{ color: C.steel, fontSize: 14 }}>Getting the ice ready.</div>}

        {!loading && (
          <>
            {(merch || []).length > 0 && (
              <Section title="Rinkd Merch" sub="Official Rinkd gear — shipped to your door">
                {merch.map((p) => <MerchCard key={p.id} p={p} onAdd={addToCart} />)}
              </Section>
            )}

            {Object.keys(phByCollection).map((slug) => (
              <Section key={slug} title={collectionLabel(slug)} sub={null}>
                {phByCollection[slug].map((p) => <AffiliateCard key={p.id} p={p} />)}
              </Section>
            ))}

            {nothing && (
              <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 20, textTransform: 'uppercase' }}>Store — coming soon</div>
                <div style={{ fontSize: 13, color: C.steel, marginTop: 6, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
                  Rinkd merch and curated hockey gear — coming soon.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating cart button */}
      {cartCount > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          style={{ position: 'fixed', right: 18, bottom: 84, zIndex: 900, background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '13px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.4)', fontFamily: "'Barlow', sans-serif" }}
        >
          🛒 Cart · {cartCount}
        </button>
      )}

      {cartOpen && (
        <CartModal
          cart={cart}
          currency={currency}
          profile={profile}
          onClose={() => setCartOpen(false)}
          onQty={setQty}
          onRemove={removeItem}
        />
      )}
    </Layout>
  );
}
