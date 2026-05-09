import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';

export default function Tournaments({ profile }) {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .in('status', ['active', 'complete'])
        .order('start_date', { ascending: false });
      setTournaments(data || []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <Layout profile={profile}>
      <div style={{ background: '#07111F', minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: '#F4F7FA' }}>
        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28, marginBottom: 4 }}>TOURNAMENTS</div>
        <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 20 }}>Live standings · real-time scoring · LiveBarn streams</div>

        {loading && <div style={{ color: 'rgba(244,247,250,0.3)', fontSize: 13 }}>Loading...</div>}

        {!loading && tournaments.length === 0 && (
          <div style={{ background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🥅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No tournaments yet</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>Want to host your tournament on Rinkd?</div>
            <a href="mailto:hello@rinkd.app?subject=Tournament Hosting Inquiry" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#D72638', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 20px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              ✉️ hello@rinkd.app
            </a>
          </div>
        )}

        {tournaments.map(t => (
          <div key={t.id} onClick={() => navigate('/tournament/' + t.id)}
            style={{ background: '#0f2847', border: '0.5px solid rgba(46,91,140,0.4)', borderRadius: 12, padding: '16px 18px', marginBottom: 10, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.8)'}
            onMouseLeave={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.4)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 17 }}>{t.name.toUpperCase()}</div>
              {t.status === 'active' && <span style={{ background: 'rgba(215,38,56,0.15)', color: '#D72638', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>● Live</span>}
              {t.status === 'complete' && <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>Final</span>}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.5)' }}>{t.division} · {t.start_date} – {t.end_date}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
