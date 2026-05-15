import React from 'react';
import Layout, { BRAND_COLORS as C } from '../components/Layout';

/**
 * Generic placeholder used by the manager/commissioner pages until the real
 * screens land. Item 4 of the Phase 1 sprint wires the nav links to these.
 */
export function ComingSoonPage({ profile, icon, title, subtitle }) {
  return (
    <Layout profile={profile}>
      <div style={{
        background: C.dark, minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Barlow', sans-serif", color: C.ice, padding: 20,
      }}>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: '40px 28px', maxWidth: 460, textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{icon}</div>
          <h1 style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase',
            fontSize: 28, color: C.ice, marginBottom: 8,
          }}>{title}</h1>
          <p style={{ fontSize: 14, color: C.steel, lineHeight: 1.5 }}>{subtitle}</p>
          <div style={{
            display: 'inline-block', marginTop: 18,
            background: C.navy, border: `1px solid ${C.border}`,
            borderRadius: 20, padding: '4px 12px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            color: C.steel, fontFamily: "'Barlow Condensed', sans-serif",
            textTransform: 'uppercase',
          }}>Coming soon</div>
        </div>
      </div>
    </Layout>
  );
}

export function DuesTrackerPage({ profile }) {
  return <ComingSoonPage profile={profile} icon="💸"
    title="Dues Tracker"
    subtitle="See who's paid, who's behind, and send reminders. Integrates with the Stripe checkout once wired." />;
}
