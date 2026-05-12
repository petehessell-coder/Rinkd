import React, { useEffect } from 'react';
import { track } from '../lib/analytics';

const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', card: '#0f2847', border: 'rgba(46,91,140,0.4)',
};

/**
 * Premium gate shown to users without an active Crease subscription.
 *
 * Payments are NOT live yet. Stays in "early access waitlist" mode until both:
 *   - REACT_APP_CREASE_PAYMENTS_LIVE=1 is set in Vercel
 *   - REACT_APP_CREASE_CHECKOUT_URL points at a real Stripe Checkout URL
 *
 * Until then, the CTA collects interest via mailto so you can hand-onboard
 * beta supporters by flipping profiles.is_premium = true on their row.
 */
export default function CreasePaywall({ episodeTitle, showTitle, compact = false }) {
  const paymentsLive = process.env.REACT_APP_CREASE_PAYMENTS_LIVE === '1';

  // Fire once per mount — gives us conversion-funnel data even before payments are live.
  useEffect(() => {
    track('crease_paywall_shown', { show: showTitle, episode: episodeTitle, payments_live: paymentsLive, compact });
  }, [showTitle, episodeTitle, paymentsLive, compact]);
  const checkoutUrl = paymentsLive
    ? (process.env.REACT_APP_CREASE_CHECKOUT_URL || 'mailto:hello@rinkd.app?subject=Crease%20Premium')
    : 'mailto:hello@rinkd.app?subject=Crease%20Early%20Access&body=Count%20me%20in%20when%20Crease%20launches.';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.navy} 0%, #1a2f52 100%)`,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: compact ? '20px 18px' : '32px 24px',
      textAlign: 'center',
      color: C.ice,
      fontFamily: "'Barlow', sans-serif",
    }}>
      <img src="/crease-logo.png" alt="Crease"
        style={{ width: compact ? 56 : 84, height: compact ? 56 : 84, borderRadius: compact ? 12 : 18, marginBottom: 12, boxShadow: '0 10px 24px rgba(0,0,0,0.4)' }} />
      <div style={{
        display: 'inline-block',
        background: 'rgba(215,38,56,0.15)',
        color: C.red,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        padding: '4px 12px',
        borderRadius: 999,
        marginBottom: 12,
        border: '1px solid rgba(215,38,56,0.3)',
      }}>
        Crease Premium
      </div>

      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 900,
        fontStyle: 'italic',
        fontSize: compact ? 22 : 30,
        lineHeight: 1.1,
        marginBottom: 8,
        textTransform: 'uppercase',
      }}>
        {episodeTitle ? `Unlock "${episodeTitle}"` : 'Step inside the Crease'}
      </div>

      <div style={{ fontSize: 14, color: C.steel, lineHeight: 1.55, marginBottom: 18, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
        {showTitle ? `${showTitle} and every Crease original.` : 'Every show. Every episode. The full Crease library.'}
        {' '}Plus early drops on new shows and discounts on Rinkd merch.
      </div>

      {!compact && (
        <div style={{
          background: 'rgba(46,91,140,0.18)',
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 18,
          maxWidth: 380,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          {[
            'All Crease originals + bonus episodes',
            'Premium long-form interviews',
            'Ad-free across Rinkd',
            'Early access to new shows',
            '10% off Rinkd merch drops',
          ].map((line) => (
            <div key={line} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, color: C.ice }}>
              <span style={{ color: C.red }}>✓</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      <a href={checkoutUrl} onClick={() => track('crease_subscribe_clicked', { show: showTitle, episode: episodeTitle, payments_live: paymentsLive })}
        style={{
          display: 'inline-block',
          background: C.red,
          color: '#fff',
          textDecoration: 'none',
          padding: '13px 28px',
          borderRadius: 999,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 900,
          fontStyle: 'italic',
          fontSize: 16,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}>
        {paymentsLive ? 'Subscribe to Crease →' : 'Get Early Access →'}
      </a>

      <div style={{ fontSize: 11, color: C.steel, marginTop: 12 }}>
        {paymentsLive
          ? '$4.99/mo · Cancel anytime · Free 7-day trial'
          : 'Crease launches with original shows soon — join the early-access list'}
      </div>
    </div>
  );
}
