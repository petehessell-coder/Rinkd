import React from 'react';
import Layout from '../components/Layout';
export default function Leagues({ profile }) {
  return (
    <Layout profile={profile} currentPage="leagues">
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏒</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 32, color: '#F4F7FA', textTransform: 'uppercase', marginBottom: 12 }}>Leagues</div>
        <div style={{ color: '#8BA3BE', fontSize: 15, marginBottom: 32 }}>League pages, team locker rooms and tournament brackets. Coming soon.</div>
        <a href="/survey" style={{ display: 'inline-block', background: '#D72638', color: '#fff', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 16, padding: '12px 28px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Take the Survey</a>
      </div>
    </Layout>
  );
}