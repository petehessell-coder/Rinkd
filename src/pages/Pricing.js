import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import TapeText from '../components/TapeText';
import { track } from '../lib/analytics';

// Canonical source: docs/Rinkd_Pricing_Guide.docx. Keep these in sync with
// that file — it's the contract. BLPA Cleveland is intentionally OUT of this
// ladder (custom deal) and must never appear here.
const C = {
  navy: '#0B1F3A', blue: '#2E5B8C', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F', card: '#112236', border: '#1E3A5C',
};

const LEAGUE_TIERS = [
  { tier: 'Starter', teams: 'Up to 6 teams', price: '$299', unit: '/ season' },
  { tier: 'Standard', teams: 'Up to 12 teams', price: '$599', unit: '/ season', popular: true },
  { tier: 'Pro', teams: 'Up to 20 teams', price: '$999', unit: '/ season' },
];
const TOURNAMENT_TIERS = [
  { tier: 'Small', teams: 'Up to 8 teams', price: '$149', unit: '/ event' },
  { tier: 'Standard', teams: 'Up to 16 teams', price: '$299', unit: '/ event' },
  { tier: 'Large', teams: 'Up to 24 teams', price: '$499', unit: '/ event' },
  { tier: 'Premier', teams: '25+ teams', price: '$799', unit: '/ event' },
];

function PlanCard({ tier, teams, price, unit, popular }) {
  return (
    <div style={{
      flex: '1 1 200px', minWidth: 200, position: 'relative',
      background: C.card, borderRadius: 14,
      border: `1.5px solid ${popular ? C.red : C.border}`,
      padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {popular && (
        <div style={{
          position: 'absolute', top: -10, left: 18, background: C.red, color: '#fff',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
          padding: '3px 8px', borderRadius: 999, fontFamily: "'Barlow Condensed', sans-serif",
        }}>★ Most popular</div>
      )}
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase', color: C.ice }}>{tier}</div>
      <div style={{ fontSize: 12.5, color: C.steel }}>{teams}</div>
      <div style={{ marginTop: 6 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 34, color: C.ice }}>{price}</span>
        <span style={{ fontSize: 13, color: C.steel, marginLeft: 6 }}>{unit}</span>
      </div>
    </div>
  );
}

function SectionLabel({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontStyle: 'italic', fontWeight: 900, fontSize: 22, textTransform: 'uppercase', color: C.ice, letterSpacing: '0.02em' }}>{children}</div>
      {sub && <div style={{ fontSize: 13, color: C.steel, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Pricing({ currentUser }) {
  const navigate = useNavigate();
  const go = (path) => navigate(currentUser ? path : `/login?returnTo=${encodeURIComponent(path)}`);

  // Fire one view event per load with an `anonymous` flag (mirrors the
  // tournament/league view events) so we can tell whether the pricing page is
  // getting traffic and segment cold vs logged-in visitors.
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track('pricing_view', { anonymous: !currentUser });
  }, [currentUser]);

  const btn = (bg) => ({
    padding: '12px 22px', borderRadius: 999, border: 'none', cursor: 'pointer',
    background: bg, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 800, fontStyle: 'italic', fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em',
  });

  return (
    <div style={{ minHeight: '100vh', background: C.dark, color: C.ice, fontFamily: "'Barlow', sans-serif" }}>
      <SEO
        title="Pricing · Rinkd"
        description="Simple, all-in pricing for hockey leagues and tournaments. Every feature unlocked at every tier — leagues from $299/season, tournaments from $149/event."
        image="https://rinkd.app/rinkd-wordmark-large.png"
        url="https://rinkd.app/pricing"
      />

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
        <img src="/rinkd-wordmark-tape.png" alt="Rinkd" onClick={() => navigate(currentUser ? '/feed' : '/')}
          style={{ height: 26, width: 'auto', cursor: 'pointer' }} />
        <button onClick={() => navigate(currentUser ? '/feed' : '/')} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.steel, borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          {currentUser ? 'Back to Rinkd' : 'Home'}
        </button>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '36px 20px 64px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <TapeText height={46}>Pricing</TapeText>
          <div style={{ fontSize: 16, color: C.steel, marginTop: 14, maxWidth: 620, lineHeight: 1.5 }}>
            Simple and all-in. Every feature is unlocked at every tier — playoffs, live scoring, push, the works. You only pay for size.
          </div>
        </div>

        {/* Leagues */}
        <SectionLabel sub="Per season · all features unlocked · regular season through championship">League pricing</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
          {LEAGUE_TIERS.map((t) => <PlanCard key={t.tier} {...t} />)}
        </div>
        <div style={{ fontSize: 13, color: C.steel, marginBottom: 40 }}>
          <strong style={{ color: C.ice }}>Division add-on · +$99</strong> per additional division on the same league + season.
        </div>

        {/* Tournaments */}
        <SectionLabel sub="Per event · live scores · bracket · push notifications">Tournament pricing</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
          {TOURNAMENT_TIERS.map((t) => <PlanCard key={t.tier} {...t} />)}
        </div>
        <div style={{ fontSize: 13, color: C.steel, marginBottom: 40 }}>
          <strong style={{ color: C.ice }}>Division add-on · +$99</strong> per additional division in the same event.{' '}
          Running 5+ divisions?{' '}
          <a href="mailto:hello@rinkd.app?subject=Multi-division tournament — custom package" style={{ color: C.ice }}>
            Custom package pricing available — get in touch.
          </a>
        </div>

        {/* Cross-sell + registration */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 40 }}>
          <div style={{ flex: '1 1 300px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <SectionLabel>League member tournament discount</SectionLabel>
            <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.6 }}>
              <div><strong style={{ color: C.red }}>Year 1:</strong> first tournament <strong>free</strong> with any league plan.</div>
              <div><strong style={{ color: C.red }}>Year 2+:</strong> 15% off all tournaments for active league members.</div>
            </div>
          </div>
          <div style={{ flex: '1 1 300px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
            <SectionLabel sub="Coming soon — online player & team registration">Registration</SectionLabel>
            <div style={{ fontSize: 14, color: C.ice, lineHeight: 1.6 }}>
              <div><strong style={{ color: C.ice }}>1% platform fee</strong> on registrations processed through Rinkd.</div>
              <div style={{ color: C.steel }}>Payment processing (2.9% + $0.30) passed through at cost to the registrant at checkout — no markup. Fees flow directly to the organizer.</div>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 28 }}>
          <button onClick={() => go('/league/create')} style={btn(C.red)}>Run your league</button>
          <button onClick={() => go('/tournament/create')} style={btn(C.blue)}>Host your tournament</button>
        </div>

        <div style={{ fontSize: 13, color: C.steel, lineHeight: 1.6 }}>
          Questions, or need a custom quote for a bigger event? Email{' '}
          <a href="mailto:hello@rinkd.app?subject=Pricing question" style={{ color: C.ice }}>hello@rinkd.app</a>.
          <div style={{ marginTop: 10, fontStyle: 'italic', color: C.border }}>Where hockey lives between games.</div>
        </div>
      </div>
    </div>
  );
}
