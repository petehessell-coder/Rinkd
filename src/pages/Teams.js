import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { listTeams } from '../lib/teams';
import MapLink from '../components/MapLink';

export default function Teams({ profile }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await listTeams({ search });
      setTeams(data);
      setLoading(false);
    }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  const C = { navy:'#0B1F3A', blue:'#2E5B8C', red:'#D72638', ice:'#F4F7FA', steel:'#8BA3BE', dark:'#07111F', border:'rgba(46,91,140,0.4)' };

  return (
    <Layout profile={profile}>
      <div style={{ background: C.dark, minHeight: '100vh', padding: 20, fontFamily: 'Barlow, sans-serif', color: C.ice }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 28, color: C.ice }}>TEAMS</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginTop: 2 }}>Find your team · Free to join</div>
          </div>
          <button onClick={() => navigate('/team/create')}
            style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = C.ice; e.currentTarget.style.color = C.navy; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.red; e.currentTarget.style.color = '#fff'; }}>
            + Create Team
          </button>
        </div>

        {/* Search */}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search teams..."
          style={{ width: '100%', background: '#0f2847', border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '11px 14px', color: C.ice, fontFamily: 'Barlow, sans-serif', fontSize: 14, outline: 'none', marginBottom: 16 }}
        />

        {loading && <div style={{ color: 'rgba(244,247,250,0.3)', fontSize: 13 }}>Loading...</div>}

        {!loading && teams.length === 0 && (
          <div style={{ background: '#0f2847', border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🏒</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{search ? 'No teams found' : 'No teams yet'}</div>
            <div style={{ fontSize: 13, color: 'rgba(244,247,250,0.4)', marginBottom: 16 }}>Be the first to create a team on Rinkd</div>
            <button onClick={() => navigate('/team/create')}
              style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 999, padding: '10px 22px', fontFamily: 'Barlow, sans-serif', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + Create Team
            </button>
          </div>
        )}

        {teams.map(team => (
          <div key={team.id} onClick={() => navigate('/team/' + team.id)}
            style={{ background: '#0f2847', border: `0.5px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, transition: 'border 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.border = '0.5px solid rgba(46,91,140,0.8)'}
            onMouseLeave={e => e.currentTarget.style.border = `0.5px solid ${C.border}`}>
            {/* Team logo */}
            <div style={{ width: 48, height: 48, borderRadius: 10, background: team.logo_color || C.red, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 20, color: '#fff', flexShrink: 0 }}>
              {team.logo_initials || team.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontStyle: 'italic', fontWeight: 900, fontSize: 17, color: C.ice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name.toUpperCase()}</div>
              <div style={{ fontSize: 12, color: 'rgba(244,247,250,0.45)', marginTop: 3 }}>
                {[team.division, team.level, team.location].filter(Boolean).join(' · ')}
              </div>
              {team.home_rink && (
                <div style={{ fontSize: 11, color: 'rgba(244,247,250,0.3)', marginTop: 2 }} onClick={e => e.stopPropagation()}>
                  🏟 <MapLink text={team.home_rink} icon="" style={{ color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }} />
                </div>
              )}
            </div>
            <div style={{ color: 'rgba(244,247,250,0.25)', fontSize: 18 }}>›</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
