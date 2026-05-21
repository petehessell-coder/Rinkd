import React from 'react';
import Layout from '../components/Layout';
import TapeText from '../components/TapeText';
export default function Store({ profile }) {
  return (
    <Layout profile={profile} currentPage="store">
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🛒</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 32, color: '#F4F7FA', textTransform: 'uppercase', marginBottom: 12 }}><TapeText height={32}>Store</TapeText></div>
        <div style={{ color: '#8BA3BE', fontSize: 15, marginBottom: 32 }}>Rinkd merch, Rinkd Cards and tier-based discounts. Coming soon.</div>
        <a href="https://rinkd.app/survey" target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', background: '#D72638', color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 15, padding: '12px 28px', borderRadius: 999, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Take the Survey →
        </a>
      </div>
    </Layout>
  );
}