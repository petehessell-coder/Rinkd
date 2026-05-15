import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
export default function Legal() {
  const { pathname } = useLocation();
  const [tab, setTab] = useState(pathname === '/terms' ? 'terms' : 'privacy');
  const C = { navy: '#0B1F3A', dark: '#07111F', card: '#112236', border: '#1E3A5C', ice: '#F4F7FA', steel: '#8BA3BE', red: '#D72638' };
  return (
    <div style={{ minHeight: '100vh', background: C.dark, fontFamily: "'Barlow', sans-serif" }}>
      <div style={{ background: C.navy, borderBottom: "1px solid " + C.border, padding: '16px 24px' }}>
        <a href="/" style={{ color: C.steel, fontSize: 14 }}>Back to Rinkd</a>
      </div>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          {['privacy','terms'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 20px', borderRadius: 8, border: "1px solid " + (tab===t ? C.red : C.border), background: tab===t ? C.red+'22' : C.card, color: tab===t ? C.ice : C.steel, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, textTransform: 'uppercase', cursor: 'pointer' }}>
              {t === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
            </button>
          ))}
        </div>
        <div style={{ color: C.steel, fontSize: 14, lineHeight: 1.7 }}>
          {tab === 'privacy' ? (
            <div><h1 style={{ color: C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, marginBottom: 16 }}>Privacy Policy</h1><p style={{ marginBottom: 12 }}>Last updated: May 2026. Rinkd LLC operates rinkd.app. We collect information you provide and usage data. We do not knowingly collect data from children under 13. Contact: Pete@rinkd.app</p></div>
          ) : (
            <div><h1 style={{ color: C.ice, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, marginBottom: 16 }}>Terms of Service</h1><p style={{ marginBottom: 12 }}>Last updated: May 2026. By using Rinkd you agree to these terms. You agree not to post harmful or illegal content. Rinkd reserves the right to remove content and suspend accounts. Contact: Pete@rinkd.app</p></div>
          )}
        </div>
      </div>
    </div>
  );
}