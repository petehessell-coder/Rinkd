import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { listLeagues } from '../lib/leagues';
import TapeText from '../components/TapeText';
import { TeamLogo } from '../components/Logos';

const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', card:'#0f2847', border:'rgba(46,91,140,0.4)' };

export default function Leagues({ profile }) {
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await listLeagues({ search });
      setLeagues(data);
      setLoading(false);
    }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28 }}><TapeText height={28}>LEAGUES</TapeText></div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>Season-long competition · Real-time standings</div>
          </div>
          <button onClick={() => navigate('/league/create')}
            style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
            + Create League
          </button>
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leagues..."
          style={{ width: '100%', background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '11px 14px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none', marginBottom: 16 }} />

        {loading && <div style={{ color: 'rgba(244,247,250,0.3)', fontSize: 13 }}>Getting the ice ready.</div>}

        {!loading && leagues.length === 0 && (
          <div style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{search ? 'No leagues found' : 'No leagues yet'}</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>Want to run a league on Rinkd?</div>
            <a href="mailto:hello@rinkd.app?subject=League Hosting Inquiry"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              ✉️ hello@rinkd.app
            </a>
          </div>
        )}

        {leagues.map(league => (
          <div key={league.id} onClick={() => navigate('/league/' + league.id)}
            style={{ background: C.card, border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, transition: 'border 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.8)'}
            onMouseLeave={e => e.currentTarget.style.border = `0.5px solid ${C.border}`}>
            <TeamLogo team={league} size={48} radius={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 17, color: C.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{league.name.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginTop: 3 }}>
                {[league.division, league.season, league.location].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {league.status === 'active' && <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>● ACTIVE</span>}
              {league.status === 'complete' && <span style={{ background: 'rgba(244,247,250,0.08)', color: 'rgba(244,247,250,0.4)', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>FINAL</span>}
              <div style={{ color: 'rgba(244,247,250,0.25)', fontSize: 18 }}>›</div>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
