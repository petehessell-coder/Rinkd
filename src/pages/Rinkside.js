import React from 'react';
import Layout from '../components/Layout';

const C = {
  navy: '#0B1F3A', red: '#D72638', ice: '#F4F7FA',
  steel: '#8BA3BE', dark: '#07111F',
};

export default function Rinkside({ profile }) {
  return (
    <Layout profile={profile} currentPage="rinkside">
      <div style={{ background: C.dark, minHeight: '100vh', padding: '40px 24px', textAlign: 'center', fontFamily: 'Barlow, sans-serif' }}>
        <img src="/rinkside-logo.png" alt="Rinkside"
          style={{ width: 140, height: 140, borderRadius: 28, marginBottom: 14, boxShadow: '0 18px 40px rgba(0,0,0,0.5)' }} />
        <div style={{ display: 'block', background: 'rgba(46,91,140,0.18)', color: '#2E5B8C', fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 999, marginBottom: 14, border: '1px solid rgba(46,91,140,0.4)', width: 'fit-content', marginLeft: 'auto', marginRight: 'auto' }}>
          The Content
        </div>
        <div style={{ color: C.steel, fontSize: 15, maxWidth: 480, margin: '0 auto 28px', lineHeight: 1.55 }}>
          Daily hockey news, highlights, and creator content built for the Rinkd community. Coming soon.
        </div>
        <a href="https://rinkd.app/survey" target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', background: C.red, color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 15, padding: '12px 28px', borderRadius: 999, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Take the Survey →
        </a>
      </div>
    </Layout>
  );
}
